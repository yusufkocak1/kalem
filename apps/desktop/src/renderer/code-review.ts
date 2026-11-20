/**
 * The assistant's proposed change to a code file, reviewed in the file's
 * own tab, as a code editor shows an agent's edit: the whole file a line at
 * a time with its line numbers, the lines taken out on red, those put in on
 * green, and Accept and Reject at the change in hand; a pill at the bottom
 * goes from one change to the next and takes them all at once. The file's
 * text box is set aside meanwhile. Once nothing is left to decide, the text
 * as decided goes into the file (it is saved), and the text box is back.
 */
import type { ChangeDecision, LineStep } from "../shared/edit-review.js";
import { composeLines, lineReview } from "../shared/edit-review.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface CodeReviewHost {
	readonly t: Strings;
	/** Where the file is shown: the review goes in it, over the text box. */
	readonly container: HTMLElement;
	/** Sets the file's text box aside while the review is shown, and back. */
	showText(shown: boolean): void;
	/** A change was decided (or the review ended): what is left changed. */
	changed?(): void;
}

/** How the review ended: the text as decided, and what was decided about each run of lines. */
export interface CodeReviewResult {
	readonly text: string;
	readonly steps: readonly LineStep[];
	readonly decisions: ReadonlyMap<number, ChangeDecision>;
}

export interface CodeReviewUi {
	/**
	 * Shows the change from `before` to `after` for review; `done` gets the
	 * text as decided, once nothing is left. Resolves how many changes there are.
	 */
	start(before: string, after: string, done: (result: CodeReviewResult) => void): number;
	/** Whether a change waits. */
	active(): boolean;
	acceptAll(): void;
	rejectAll(): void;
	/** Ends the review with nothing decided and nothing written (its tab is closed). */
	cancel(): void;
	/** The lines the changes still waiting put in and take out. */
	remaining(): { readonly added: number; readonly removed: number };
}

const SVG = "http://www.w3.org/2000/svg";
const glyph = (path: string): SVGSVGElement => {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("edit-review-icon");
	const shape = document.createElementNS(SVG, "path");
	shape.setAttribute("d", path);
	svg.append(shape);
	return svg;
};

const CHECK = "M3.5 8.5l3 3 6-7";
const UNDO = "M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8";
const UP = "M4 10l4-4 4 4";
const DOWN = "M4 6l4 4 4-4";

export function createCodeReview(host: CodeReviewHost): CodeReviewUi {
	const { t } = host;
	let steps: LineStep[] = [];
	let decisions = new Map<number, ChangeDecision>();
	let current = 0;
	let finish: ((result: CodeReviewResult) => void) | null = null;

	const button = (
		label: string,
		title: string,
		kind: string,
		path: string,
		showLabel = true,
	): HTMLButtonElement => {
		const made = el("button", {
			class: `edit-review-button ${kind}`,
			attrs: { type: "button", title, "aria-label": title },
			children: [glyph(path)],
		});
		if (showLabel) made.append(el("span", { text: label }));
		return made;
	};

	const lines = el("div", { class: "code-review-lines", attrs: { role: "table" } });
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
	const pill = el("div", {
		class: "edit-review code-review-pill",
		attrs: { role: "region", "aria-label": t.editReviewTitle },
		children: [
			previous,
			count,
			next,
			el("span", { class: "edit-review-divider", attrs: { "aria-hidden": "true" } }),
			acceptAllButton,
			rejectAllButton,
		],
	});
	const element = el("div", {
		class: "code-review",
		attrs: { hidden: "", "aria-label": t.editReviewTitle },
		children: [lines, pill],
	});

	const pending = (): number[] =>
		steps.flatMap((step) =>
			step.kind === "change" && (decisions.get(step.change.id) ?? "pending") === "pending"
				? [step.change.id]
				: [],
		);

	function row(
		kind: "same" | "add" | "remove",
		old: string,
		now: string,
		text: string,
	): HTMLElement {
		return el("div", {
			class: `code-review-line ${kind}`,
			attrs: { role: "row" },
			children: [
				el("span", { class: "code-review-number", text: old }),
				el("span", { class: "code-review-number", text: now }),
				el("span", {
					class: "code-review-sign",
					text: kind === "add" ? "+" : kind === "remove" ? "−" : " ",
				}),
				el("span", { class: "code-review-text", text: text === "" ? " " : text }),
			],
		});
	}

	/** Draws the file as decided so far, the changes still to decide as a diff. */
	function render(scroll: boolean): void {
		const open = pending();
		const hand = open[current];
		const rows: HTMLElement[] = [];
		let oldLine = 1;
		let newLine = 1;
		let shown: HTMLElement | null = null;
		for (const step of steps) {
			if (step.kind === "same") {
				rows.push(row("same", String(oldLine), String(newLine), step.text));
				oldLine++;
				newLine++;
				continue;
			}
			const { change } = step;
			const decision = decisions.get(change.id) ?? "pending";
			if (decision !== "pending") {
				// Decided: it reads as the file does now. The numbers on the left are the file's
				// as it was, on the right as it will be.
				if (decision === "rejected") {
					for (const text of change.removed) {
						rows.push(row("same", String(oldLine++), String(newLine++), text));
					}
				} else {
					for (const text of change.added) rows.push(row("same", "", String(newLine++), text));
					oldLine += change.removed.length;
				}
				continue;
			}
			const block = el("div", {
				class: "code-review-change",
				attrs: { "data-change": String(change.id) },
			});
			if (change.id === hand) {
				block.setAttribute("data-current", "");
				const accept = button(
					t.editReviewAccept,
					t.editReviewAcceptHint,
					"edit-review-accept",
					CHECK,
				);
				const reject = button(
					t.editReviewReject,
					t.editReviewRejectHint,
					"edit-review-reject",
					UNDO,
				);
				accept.addEventListener("click", () => decide(change.id, "accepted"));
				reject.addEventListener("click", () => decide(change.id, "rejected"));
				block.append(
					el("div", { class: "edit-review-hunk code-review-hunk", children: [accept, reject] }),
				);
				shown = block;
			}
			for (const text of change.removed) block.append(row("remove", String(oldLine++), "", text));
			for (const text of change.added) block.append(row("add", "", String(newLine++), text));
			block.addEventListener("mouseenter", () => {
				const index = pending().indexOf(change.id);
				if (index !== -1 && index !== current) {
					current = index;
					render(false);
				}
			});
			rows.push(block);
		}
		lines.replaceChildren(...rows);
		count.textContent = format(t.editReviewCount, Math.min(current + 1, open.length), open.length);
		previous.disabled = open.length < 2;
		next.disabled = open.length < 2;
		if (scroll) (shown as HTMLElement | null)?.scrollIntoView({ block: "center" });
	}

	function settle(): void {
		if (pending().length > 0) {
			current = Math.min(current, pending().length - 1);
			render(true);
			host.changed?.();
			return;
		}
		const result = { text: composeLines(steps, decisions), steps, decisions };
		const done = finish;
		end();
		done?.(result);
		host.changed?.();
	}

	function decide(id: number, decision: ChangeDecision): void {
		decisions.set(id, decision);
		settle();
	}

	function decideAll(decision: ChangeDecision): void {
		for (const id of pending()) decisions.set(id, decision);
		settle();
	}

	function end(): void {
		steps = [];
		decisions = new Map();
		current = 0;
		finish = null;
		element.hidden = true;
		lines.replaceChildren();
		host.showText(true);
	}

	const move = (by: number): void => {
		const open = pending().length;
		if (open === 0) return;
		current = (current + by + open) % open;
		render(true);
	};
	previous.addEventListener("click", () => move(-1));
	next.addEventListener("click", () => move(1));
	acceptAllButton.addEventListener("click", () => decideAll("accepted"));
	rejectAllButton.addEventListener("click", () => decideAll("rejected"));

	return {
		start(before, after, done) {
			if (finish !== null) decideAll("accepted");
			steps = lineReview(before, after);
			const changes = steps.filter((step) => step.kind === "change").length;
			if (changes === 0) return 0;
			decisions = new Map();
			current = 0;
			finish = done;
			// The file's view is drawn anew as it loads: the review goes in it now.
			if (element.parentElement !== host.container) host.container.append(element);
			host.showText(false);
			element.hidden = false;
			render(true);
			return changes;
		},
		active: () => finish !== null,
		acceptAll: () => decideAll("accepted"),
		rejectAll: () => decideAll("rejected"),
		cancel() {
			if (finish === null) return;
			end();
			host.changed?.();
		},
		remaining() {
			const open = new Set(pending());
			let added = 0;
			let removed = 0;
			for (const step of steps) {
				if (step.kind !== "change" || !open.has(step.change.id)) continue;
				added += step.change.added.length;
				removed += step.change.removed.length;
			}
			return { added, removed };
		},
	};
}
