/**
 * The assistant's change to the document, reviewed where it is: each
 * changed block is marked in the page, a deleted one by a line where it
 * was, and a bar above the document goes through them, one at a time,
 * with Accept and Reject (and both for all). Until it is decided a change
 * stays as the assistant wrote it; a rejected one is put back as it was.
 * The user typing in the document ends the review with what is there.
 */
import type { ChangeDecision, EditReview, PendingChange } from "../shared/edit-review.js";
import { composeReview, reviewEdit } from "../shared/edit-review.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface EditReviewHost {
	readonly t: Strings;
	/** Where the bar goes: above the document. */
	readonly bar: HTMLElement;
	/** The page the editor draws the document in. */
	readonly canvas: HTMLElement;
	/** The document's Markdown now. */
	text(): string;
	/** Puts the whole document in; `false` when it cannot be changed. */
	replace(text: string): boolean;
	/** The ids of the editor's top-level blocks, in order. */
	blockIds(): readonly string[];
}

export interface EditReviewUi {
	/** Shows a change made from `before` to `after` for review; resolves how many changes it has. */
	start(before: string, after: string): number;
	/** The document changed: when it is not by the review, the review ends with what is there. */
	changed(): void;
	/** Whether changes wait for the user. */
	active(): boolean;
	/** Keeps every change still waiting, and ends the review. */
	acceptAll(): void;
	/** Puts back every change still waiting, and ends the review. */
	rejectAll(): void;
}

/** On a block the change put in: `added` or `changed`. */
const MARK = "data-ai-change";
/** On the block text was deleted before (`before`) or, at the end, after (`after`). */
const REMOVED = "data-ai-removed";
/** On the blocks of the change in hand: `change`, or `removed` for a deletion. */
const CURRENT = "data-ai-current";

const clip = (text: string, max: number): string =>
	text.length > max ? `${text.slice(0, max)}…` : text;

export function createEditReview(host: EditReviewHost): EditReviewUi {
	const { t } = host;
	let review: EditReview | null = null;
	let decisions = new Map<number, ChangeDecision>();
	let pending: readonly PendingChange[] = [];
	let current = 0;
	/** The document as the review left it: anything else is the user's own change. */
	let expected = "";
	let replacing = false;

	const count = el("span", { class: "edit-review-count", attrs: { "aria-live": "polite" } });
	const button = (label: string, title: string, kind = ""): HTMLButtonElement =>
		el("button", {
			class: `notice-action${kind === "" ? "" : ` ${kind}`}`,
			text: label,
			attrs: { type: "button", title },
		});
	const previous = button("‹", t.editReviewPrevious);
	const next = button("›", t.editReviewNext);
	previous.setAttribute("aria-label", t.editReviewPrevious);
	next.setAttribute("aria-label", t.editReviewNext);
	const accept = button(t.editReviewAccept, t.editReviewAcceptHint, "edit-review-accept");
	const reject = button(t.editReviewReject, t.editReviewRejectHint, "edit-review-reject");
	const acceptAllButton = button(t.editReviewAcceptAll, t.editReviewAcceptAll);
	const rejectAllButton = button(t.editReviewRejectAll, t.editReviewRejectAll);
	const was = el("pre", { class: "edit-review-was" });
	const wasLabel = el("summary", { class: "edit-review-summary", text: t.editReviewWas });
	const wasBox = el("details", { class: "edit-review-details", children: [wasLabel, was] });
	const element = el("div", {
		class: "notice edit-review",
		attrs: { role: "region", "aria-label": t.editReviewTitle, hidden: "" },
		children: [
			el("div", {
				class: "edit-review-row",
				children: [
					el("strong", { class: "edit-review-title", text: t.editReviewTitle }),
					previous,
					count,
					next,
					accept,
					reject,
					el("span", { class: "edit-review-gap" }),
					acceptAllButton,
					rejectAllButton,
				],
			}),
			wasBox,
		],
	});
	host.bar.prepend(element);

	function clearMarks(): void {
		for (const marked of host.canvas.querySelectorAll(`[${MARK}], [${REMOVED}], [${CURRENT}]`)) {
			marked.removeAttribute(MARK);
			marked.removeAttribute(REMOVED);
			marked.removeAttribute(CURRENT);
		}
	}

	function blockElement(index: number): HTMLElement | null {
		const id = host.blockIds()[index];
		if (id === undefined || id === "") return null;
		return host.canvas.querySelector<HTMLElement>(`[data-kalem-id="${CSS.escape(id)}"]`);
	}

	/** Where a change is in the page: the blocks it put in, else where it took text out. */
	function elementsOf(change: PendingChange): {
		elements: HTMLElement[];
		attribute: string;
		kind: string;
	} {
		if (change.blocks.length > 0) {
			const elements = change.blocks
				.map(blockElement)
				.filter((found): found is HTMLElement => found !== null);
			return { elements, attribute: MARK, kind: change.removed === "" ? "added" : "changed" };
		}
		if (change.before !== null) {
			const found = blockElement(change.before);
			return { elements: found === null ? [] : [found], attribute: REMOVED, kind: "before" };
		}
		const last = blockElement(host.blockIds().length - 1);
		return { elements: last === null ? [] : [last], attribute: REMOVED, kind: "after" };
	}

	function mark(scroll: boolean): void {
		clearMarks();
		for (const [index, change] of pending.entries()) {
			const { elements, attribute, kind } = elementsOf(change);
			for (const found of elements) {
				found.setAttribute(attribute, kind);
				if (index === current)
					found.setAttribute(CURRENT, attribute === MARK ? "change" : "removed");
			}
			if (scroll && index === current) elements[0]?.scrollIntoView({ block: "nearest" });
		}
	}

	function renderBar(): void {
		const change = pending[current];
		element.hidden = change === undefined;
		if (change === undefined) return;
		count.textContent = format(t.editReviewCount, current + 1, pending.length);
		previous.disabled = pending.length < 2;
		next.disabled = pending.length < 2;
		const removed = change.removed.trim();
		wasBox.hidden = removed === "";
		wasLabel.textContent = change.added === "" ? t.editReviewRemoved : t.editReviewWas;
		was.textContent = clip(removed, 4000);
	}

	/** Puts the document together as decided, and shows what is left to decide. */
	function apply(scroll: boolean): void {
		if (review === null) return;
		const composed = composeReview(review, decisions);
		replacing = true;
		try {
			if (composed.text !== host.text().replace(/\r\n?/g, "\n")) host.replace(composed.text);
		} finally {
			replacing = false;
		}
		expected = host.text();
		pending = composed.pending;
		if (pending.length === 0) {
			end();
			return;
		}
		current = Math.min(current, pending.length - 1);
		renderBar();
		// The editor draws the new blocks first.
		requestAnimationFrame(() => mark(scroll));
	}

	function end(): void {
		review = null;
		decisions = new Map();
		pending = [];
		current = 0;
		clearMarks();
		element.hidden = true;
	}

	function decide(decision: ChangeDecision): void {
		const change = pending[current];
		if (change === undefined) return;
		decisions.set(change.id, decision);
		apply(true);
	}

	function decideAll(decision: ChangeDecision): void {
		for (const change of pending) decisions.set(change.id, decision);
		apply(false);
	}

	const move = (by: number): void => {
		if (pending.length === 0) return;
		current = (current + by + pending.length) % pending.length;
		renderBar();
		mark(true);
	};

	previous.addEventListener("click", () => move(-1));
	next.addEventListener("click", () => move(1));
	accept.addEventListener("click", () => decide("accepted"));
	reject.addEventListener("click", () => decide("rejected"));
	acceptAllButton.addEventListener("click", () => decideAll("accepted"));
	rejectAllButton.addEventListener("click", () => decideAll("rejected"));

	return {
		start(before, after) {
			if (review !== null) decideAll("accepted");
			const next = reviewEdit(before, after);
			if (next.changes.length === 0) return 0;
			review = next;
			decisions = new Map();
			current = 0;
			apply(true);
			return next.changes.length;
		},
		changed() {
			if (review === null || replacing) return;
			if (host.text() !== expected) end();
		},
		active: () => review !== null,
		acceptAll: () => decideAll("accepted"),
		rejectAll: () => decideAll("rejected"),
	};
}
