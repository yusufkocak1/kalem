/**
 * The assistant's change to the document, reviewed where it is, as a code
 * editor shows an inline diff: the text it replaced or deleted is drawn
 * above, struck through on red, the text it put in on green, each with a
 * bar in the margin. The change in hand has a small toolbar at its corner
 * (Accept, Reject); a pill at the bottom of the page goes from one change
 * to the next and takes them all at once. The old text is drawn by the
 * block's own `::before` (from an attribute), so it is never part of the
 * document, cannot be typed into, and goes when the mark does. A rejected
 * change is put back as it was; the user typing in the document ends the
 * review with what is there.
 */
import type { ChangeDecision, EditReview, PendingChange } from "../shared/edit-review.js";
import { composeReview, reviewEdit } from "../shared/edit-review.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface EditReviewHost {
	readonly t: Strings;
	/** The page the document is drawn on: the change's toolbar is placed on it. */
	readonly page: HTMLElement;
	/** The scrolled area around the page: the pill stays at its bottom. */
	readonly desk: HTMLElement;
	/** Where the editor draws the document. */
	readonly canvas: HTMLElement;
	/** The document's Markdown now. */
	text(): string;
	/** Puts the whole document in; `false` when it cannot be changed. */
	replace(text: string): boolean;
	/** The ids of the editor's top-level blocks, in order. */
	blockIds(): readonly string[];
	/** The changes waiting, or the one in hand, changed (for the chat's list of them). */
	updated?(): void;
}

/** A change waiting, as the chat lists it. */
export interface ReviewItem {
	/** A few words of what it put in, or of what it took out. */
	readonly label: string;
	/** Whether it only took text out. */
	readonly deletion: boolean;
	/** Lines it put in and took out. */
	readonly added: number;
	readonly removed: number;
}

export interface ReviewSummary {
	readonly items: readonly ReviewItem[];
	/** The one in hand. */
	readonly current: number;
}

/** The lines a piece of Markdown has, blank ones left out. */
const lineCount = (markdown: string): number =>
	markdown.split("\n").filter((line) => line.trim() !== "").length;

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
	/** Makes a change the one in hand, and shows it. */
	select(index: number): void;
	/** The changes waiting; `null` when there are none. */
	summary(): ReviewSummary | null;
}

/** On a block the change put in: `added` or `changed`. */
const MARK = "data-ai-change";
/** Which change a marked block's own text belongs to. */
const INDEX = "data-ai-index";
/** Text a change took out, drawn above the block (its `::before`). */
const WAS = "data-ai-was";
/** Which change the text above the block belongs to. */
const WAS_INDEX = "data-ai-was-index";
/** `changed`: the block's own old text, joined to it; `removed`: text deleted before the block. */
const WAS_KIND = "data-ai-was-kind";
/** Text a change deleted after the block, drawn under it (its `::after`). */
const GONE = "data-ai-gone";
/** Which change the text under the block belongs to. */
const GONE_INDEX = "data-ai-gone-index";
/** On the blocks of the change in hand. */
const CURRENT = "data-ai-current";
const ATTRIBUTES = [MARK, INDEX, WAS, WAS_INDEX, WAS_KIND, GONE, GONE_INDEX, CURRENT];

/** Where on a block a change is drawn: the band above it, its own text, or the band under it. */
type Part = "was" | "content" | "gone";

/** Markdown as it reads: without the marks of headings, emphasis, code and links. */
export function plainText(markdown: string, max = 2000): string {
	const text = markdown
		.replace(/\r\n?/g, "\n")
		.split("\n")
		// A code fence (with its language), a table's rule row, a comment: nothing to read.
		.filter(
			(line) =>
				!/^\s*(?:`{3,}[^`]*|~{3,}.*|<!--.*-->|\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*)$/.test(line),
		)
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}\s+/, "")
				.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1☐ ")
				.replace(/^(\s*)[-*+]\s+/, "$1• ")
				.replace(/^\s*>\s?/, "")
				.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/^\s*\|(.*)\|\s*$/, (_row, cells: string) =>
					cells
						.split("|")
						.map((cell) => cell.trim())
						.join("   "),
				)
				.replace(/(\*\*|__|~~|`)/g, "")
				.replace(/(^|[^\p{L}\p{N}*_])[*_]([^*_\n]+)[*_](?=[^\p{L}\p{N}*_]|$)/gu, "$1$2"),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

const icon = (path: string): SVGSVGElement => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("edit-review-icon");
	const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
	shape.setAttribute("d", path);
	svg.append(shape);
	return svg;
};

const CHECK = "M3.5 8.5l3 3 6-7";
const UNDO = "M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8";
const UP = "M4 10l4-4 4 4";
const DOWN = "M4 6l4 4 4-4";

export function createEditReview(host: EditReviewHost): EditReviewUi {
	const { t } = host;
	let review: EditReview | null = null;
	let decisions = new Map<number, ChangeDecision>();
	let pending: readonly PendingChange[] = [];
	let current = 0;
	/** The document as the review left it: anything else is the user's own change. */
	let expected = "";
	let replacing = false;

	const button = (
		label: string,
		title: string,
		kind: string,
		path: string | null,
		showLabel = true,
	): HTMLButtonElement => {
		const made = el("button", {
			class: `edit-review-button ${kind}`,
			attrs: { type: "button", title, "aria-label": title },
		});
		if (path !== null) made.append(icon(path));
		if (showLabel) made.append(el("span", { text: label }));
		return made;
	};

	// The change in hand: its toolbar at its corner.
	const accept = button(t.editReviewAccept, t.editReviewAcceptHint, "edit-review-accept", CHECK);
	const reject = button(t.editReviewReject, t.editReviewRejectHint, "edit-review-reject", UNDO);
	const hunk = el("div", {
		class: "edit-review-hunk",
		attrs: { role: "toolbar", "aria-label": t.editReviewTitle, hidden: "" },
		children: [accept, reject],
	});
	host.page.append(hunk);

	// All of them: the pill at the bottom.
	const previous = button("", t.editReviewPrevious, "edit-review-step", UP, false);
	const next = button("", t.editReviewNext, "edit-review-step", DOWN, false);
	const count = el("span", { class: "edit-review-count", attrs: { "aria-live": "polite" } });
	const acceptAllButton = button(
		t.editReviewAcceptAll,
		t.editReviewAcceptAll,
		"edit-review-all",
		CHECK,
	);
	const rejectAllButton = button(
		t.editReviewRejectAll,
		t.editReviewRejectAll,
		"edit-review-all",
		UNDO,
	);
	const element = el("div", {
		class: "edit-review",
		attrs: { role: "region", "aria-label": t.editReviewTitle, hidden: "" },
		children: [
			previous,
			count,
			next,
			el("span", { class: "edit-review-divider", attrs: { "aria-hidden": "true" } }),
			acceptAllButton,
			rejectAllButton,
		],
	});
	host.desk.append(element);

	function clearMarks(): void {
		const selector = ATTRIBUTES.map((name) => `[${name}]`).join(", ");
		for (const marked of host.canvas.querySelectorAll(selector)) {
			for (const name of ATTRIBUTES) marked.removeAttribute(name);
		}
	}

	function blockElement(index: number): HTMLElement | null {
		const id = host.blockIds()[index];
		if (id === undefined || id === "") return null;
		return host.canvas.querySelector<HTMLElement>(`[data-kalem-id="${CSS.escape(id)}"]`);
	}

	/** Where each change is drawn: the block its toolbar goes on, and which part of it. */
	let anchors = new Map<number, { element: HTMLElement; part: Part }>();

	/** Marks the blocks a change put in, its old text above the first. */
	function markBlocks(change: PendingChange, index: number): void {
		const elements = change.blocks
			.map(blockElement)
			.filter((found): found is HTMLElement => found !== null);
		for (const found of elements) {
			found.setAttribute(MARK, change.removed === "" ? "added" : "changed");
			found.setAttribute(INDEX, String(index));
			if (index === current) found.setAttribute(CURRENT, "");
		}
		const first = elements[0];
		if (first === undefined) return;
		const was = plainText(change.removed);
		if (was !== "") {
			first.setAttribute(WAS, was);
			first.setAttribute(WAS_INDEX, String(index));
			first.setAttribute(WAS_KIND, "changed");
		}
		anchors.set(index, { element: first, part: "content" });
	}

	/**
	 * Marks text a change only took out: above the block after it, or, when
	 * that block shows text of its own change there (or there is none),
	 * under the block before it. A block can so show two changes, one above,
	 * one under, and neither hides the other.
	 */
	function markDeletion(change: PendingChange, index: number): void {
		const was = plainText(change.removed);
		const next = change.before !== null ? blockElement(change.before) : null;
		if (next !== null && !next.hasAttribute(WAS)) {
			next.setAttribute(WAS, was);
			next.setAttribute(WAS_INDEX, String(index));
			next.setAttribute(WAS_KIND, "removed");
			anchors.set(index, { element: next, part: "was" });
			return;
		}
		const previous = blockElement(
			change.before !== null ? change.before - 1 : host.blockIds().length - 1,
		);
		if (previous !== null && !previous.hasAttribute(GONE)) {
			previous.setAttribute(GONE, was);
			previous.setAttribute(GONE_INDEX, String(index));
			anchors.set(index, { element: previous, part: "gone" });
			return;
		}
		// Nowhere free (the first block, changed itself): above it, before its own old text.
		if (next === null) return;
		const own = next.getAttribute(WAS) ?? "";
		next.setAttribute(WAS, own === "" ? was : `${was}\n\n${own}`);
		anchors.set(index, { element: next, part: "was" });
	}

	/** Where a block's own text is drawn, without the bands above and under it. */
	function contentRect(element: HTMLElement): DOMRect {
		const range = document.createRange();
		range.selectNodeContents(element);
		const rect = range.getBoundingClientRect();
		return rect.height > 0 ? rect : element.getBoundingClientRect();
	}

	/** Which change the pointer is on, in a marked block: by the band it is over. */
	function changeAt(element: Element, y: number): number | null {
		const read = (name: string): number | null => {
			const value = element.getAttribute(name);
			return value === null ? null : Number(value);
		};
		const content = read(INDEX);
		const was = read(WAS_INDEX);
		const gone = read(GONE_INDEX);
		if (!(element instanceof HTMLElement)) return content ?? was ?? gone;
		const rect = contentRect(element);
		if (was !== null && (y < rect.top || content === null)) return was;
		if (gone !== null && (y > rect.bottom || content === null)) return gone;
		return content ?? was ?? gone;
	}

	let anchor: { element: HTMLElement; part: Part } | null = null;

	/** Puts the toolbar at the top right of the change in hand. */
	function place(): void {
		if (anchor === null || !anchor.element.isConnected || review === null) {
			hunk.hidden = true;
			return;
		}
		hunk.hidden = false;
		const { element, part } = anchor;
		const page = host.page.getBoundingClientRect();
		const block = element.getBoundingClientRect();
		// Its own text, under another change's band: the toolbar goes on the text.
		const other =
			part === "content" &&
			element.hasAttribute(WAS) &&
			element.getAttribute(WAS_INDEX) !== element.getAttribute(INDEX);
		// Text deleted under a block: its toolbar sits over the band, not on the next block.
		const top =
			part === "gone"
				? contentRect(element).bottom - page.top - hunk.offsetHeight + 4
				: (other ? contentRect(element).top : block.top) - page.top - hunk.offsetHeight - 2;
		hunk.style.top = `${Math.max(0, top)}px`;
		hunk.style.right = `${Math.max(0, page.right - block.right)}px`;
	}

	function mark(scroll: boolean): void {
		clearMarks();
		anchors = new Map();
		// The blocks first: a deletion is drawn where no block's own old text is.
		for (const [index, change] of pending.entries()) {
			if (change.blocks.length > 0) markBlocks(change, index);
		}
		for (const [index, change] of pending.entries()) {
			if (change.blocks.length === 0) markDeletion(change, index);
		}
		anchor = anchors.get(current) ?? null;
		place();
		if (scroll) anchor?.element.scrollIntoView({ block: "nearest" });
	}

	function renderPill(): void {
		host.updated?.();
		element.hidden = pending.length === 0;
		count.textContent = format(t.editReviewCount, current + 1, pending.length);
		previous.disabled = pending.length < 2;
		next.disabled = pending.length < 2;
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
		renderPill();
		// The editor draws the new blocks first.
		requestAnimationFrame(() => mark(scroll));
	}

	function end(): void {
		review = null;
		decisions = new Map();
		pending = [];
		current = 0;
		anchor = null;
		clearMarks();
		element.hidden = true;
		hunk.hidden = true;
		host.updated?.();
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

	const select = (index: number, scroll: boolean): void => {
		if (pending.length === 0) return;
		const wanted = (index + pending.length) % pending.length;
		if (wanted === current) return;
		current = wanted;
		renderPill();
		mark(scroll);
	};

	previous.addEventListener("click", () => select(current - 1, true));
	next.addEventListener("click", () => select(current + 1, true));
	accept.addEventListener("click", () => decide("accepted"));
	reject.addEventListener("click", () => decide("rejected"));
	acceptAllButton.addEventListener("click", () => decideAll("accepted"));
	rejectAllButton.addEventListener("click", () => decideAll("rejected"));
	// Pointing at another change makes it the one in hand, as a diff's toolbar follows the mouse.
	host.canvas.addEventListener("mousemove", (event) => {
		if (review === null || !(event.target instanceof Element)) return;
		const marked = event.target.closest(`[${INDEX}], [${WAS_INDEX}], [${GONE_INDEX}]`);
		if (marked === null) return;
		const index = changeAt(marked, event.clientY);
		if (index !== null) select(index, false);
	});
	window.addEventListener("resize", () => {
		if (review !== null) place();
	});
	new ResizeObserver(() => {
		if (review !== null) place();
	}).observe(host.canvas);

	return {
		start(before, after) {
			if (review !== null) decideAll("accepted");
			const made = reviewEdit(before, after);
			if (made.changes.length === 0) return 0;
			review = made;
			decisions = new Map();
			current = 0;
			apply(true);
			return made.changes.length;
		},
		changed() {
			if (review === null || replacing) return;
			if (host.text() !== expected) end();
		},
		active: () => review !== null,
		acceptAll: () => decideAll("accepted"),
		rejectAll: () => decideAll("rejected"),
		select(index) {
			if (index === current) {
				anchor?.element.scrollIntoView({ block: "nearest" });
				return;
			}
			select(index, true);
		},
		summary() {
			if (review === null || pending.length === 0) return null;
			return {
				current,
				items: pending.map((change) => {
					const deletion = change.added === "";
					const words = plainText(deletion ? change.removed : change.added, 200)
						.split("\n")
						.find((line) => line.trim() !== "");
					return {
						label: words ?? "",
						deletion,
						added: lineCount(change.added),
						removed: lineCount(change.removed),
					};
				}),
			};
		},
	};
}
