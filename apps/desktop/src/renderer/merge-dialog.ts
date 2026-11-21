/**
 * Merging the user's edits of a Confluence page with a newer version
 * someone else saved meanwhile, a block at a time.
 *
 * What only one side changed is already merged; the dialog says how much.
 * Each block both sides changed differently is shown beside its other
 * version, the words that differ marked, and the user chooses theirs, the
 * page's or both. The result goes into the editor as one edit (Ctrl+Z
 * brings the user's own text back), saved to Confluence from here or not.
 */
import type { BlockMerge, MergeChoice, MergeChunk } from "../shared/confluence-merge.js";
import { conflictsOf, resolveMerge } from "../shared/confluence-merge.js";
import { atomsAsText } from "../shared/confluence-storage.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { wordDiff } from "../shared/text-diff.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

type Conflict = Extract<MergeChunk, { readonly kind: "conflict" }>;

/** The merge shown, and what to do with its result. */
export interface MergeSource {
	readonly title: string;
	readonly merge: BlockMerge;
	/**
	 * Puts the merged text in the document and, with `save`, saves it to
	 * Confluence. Resolves to `null` when it is done, or to why it is not.
	 */
	apply(text: string, save: boolean): Promise<string | null>;
}

export function createMergeDialog(t: Strings): {
	show(source: MergeSource): void;
	readonly open: boolean;
} {
	const title = el("h2", { class: "changes-title", attrs: { id: "merge-title" } });
	const summary = el("p", { class: "changes-summary" });
	const close = el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": t.close, title: t.close },
		children: [icon("close")],
	});
	const body = el("div", { class: "changes-body merge-body", attrs: { tabindex: "0" } });
	const allYours = el("button", {
		class: "dialog-button",
		text: t.mergeAllYours,
		attrs: { type: "button" },
	});
	const allTheirs = el("button", {
		class: "dialog-button",
		text: t.mergeAllTheirs,
		attrs: { type: "button" },
	});
	const status = el("p", { class: "changes-status merge-status", attrs: { role: "status" } });
	const cancel = el("button", {
		class: "dialog-button",
		text: t.cancel,
		attrs: { type: "button" },
	});
	const applyButton = el("button", {
		class: "dialog-button",
		text: t.mergeApply,
		attrs: { type: "button" },
	});
	const save = el("button", {
		class: "dialog-button primary",
		children: [icon("confluence"), t.mergeSave],
		attrs: { type: "button" },
	});
	const dialog = el("dialog", {
		class: "merge-dialog",
		attrs: { "aria-labelledby": "merge-title" },
		children: [
			el("div", {
				class: "changes-head",
				children: [el("div", { class: "changes-heading", children: [title, summary] }), close],
			}),
			body,
			el("div", {
				class: "changes-actions",
				children: [allYours, allTheirs, status, cancel, applyButton, save],
			}),
		],
	});
	document.body.append(dialog);

	let source: MergeSource | null = null;
	let conflicts: Conflict[] = [];
	let choices: (MergeChoice | undefined)[] = [];
	let busy = false;
	/** Why the last apply did not go through. */
	let problem = "";

	const shut = (): void => {
		dialog.close();
		source = null;
	};
	close.addEventListener("click", shut);
	cancel.addEventListener("click", shut);
	dialog.addEventListener("close", () => {
		source = null;
	});
	allYours.addEventListener("click", () => choose(() => "yours"));
	allTheirs.addEventListener("click", () => choose(() => "theirs"));
	applyButton.addEventListener("click", () => void finish(false));
	save.addEventListener("click", () => void finish(true));

	function choose(pick: (index: number) => MergeChoice): void {
		choices = conflicts.map((_, index) => pick(index));
		for (const input of body.querySelectorAll<HTMLInputElement>("input[type=radio]")) {
			input.checked = choices[Number(input.dataset.conflict)] === input.value;
		}
		refresh();
	}

	async function finish(andSave: boolean): Promise<void> {
		const page = source;
		if (page === null || busy) return;
		const text = resolveMerge(page.merge, choices);
		if (text === null) return;
		busy = true;
		problem = "";
		refresh();
		const result = await page.apply(text, andSave).catch((error: unknown) => String(error));
		busy = false;
		if (source !== page) return;
		if (result === null) shut();
		else {
			problem = result;
			refresh();
		}
	}

	/** The buttons and the count of what is left to decide. */
	function refresh(): void {
		const left = choices.filter((choice) => choice === undefined).length;
		applyButton.disabled = busy || left > 0;
		save.disabled = busy || left > 0;
		allYours.hidden = conflicts.length === 0;
		allTheirs.hidden = conflicts.length === 0;
		status.textContent = problem !== "" ? problem : left > 0 ? format(t.mergeUndecided, left) : "";
	}

	/** A version's blocks as read, the words that differ from `other` marked. */
	function blocksView(
		blocks: readonly string[],
		other: readonly string[],
		first: boolean,
	): HTMLElement {
		if (blocks.length === 0) {
			return el("div", { class: "merge-text deleted", text: t.mergeDeleted });
		}
		const text = atomsAsText(blocks.join("\n\n"));
		const otherText = atomsAsText(other.join("\n\n"));
		const parts =
			other.length === 0
				? [{ text, changed: false }]
				: first
					? wordDiff(text, otherText).before
					: wordDiff(otherText, text).after;
		return el("div", {
			class: "merge-text",
			children: parts.map((part) =>
				part.changed ? el("mark", { class: "changes-word", text: part.text }) : part.text,
			),
		});
	}

	function option(
		index: number,
		value: MergeChoice,
		label: string,
		content: HTMLElement | null,
	): HTMLElement {
		const input = el("input", {
			attrs: { type: "radio", name: `merge-${index}`, value, "data-conflict": String(index) },
		});
		input.checked = choices[index] === value;
		input.addEventListener("change", () => {
			choices[index] = value;
			refresh();
		});
		return el("label", {
			class: `merge-option ${value}`,
			children: [
				el("span", { class: "merge-option-head", children: [input, el("span", { text: label })] }),
				...(content === null ? [] : [content]),
			],
		});
	}

	function conflictView(conflict: Conflict, index: number): HTMLElement {
		const head = format(t.mergeConflict, index + 1, conflicts.length);
		const base = el("details", {
			class: "merge-base",
			children: [
				el("summary", { text: t.mergeBase }),
				conflict.base.length === 0
					? el("div", { class: "merge-text deleted", text: t.mergeNothing })
					: el("div", { class: "merge-text", text: atomsAsText(conflict.base.join("\n\n")) }),
			],
		});
		return el("section", {
			class: "changes-hunk merge-conflict",
			attrs: { role: "radiogroup", "aria-label": head },
			children: [
				el("header", {
					class: "changes-hunk-head",
					children: [
						el("span", { class: "changes-hunk-range", text: head }),
						...(conflict.heading === ""
							? []
							: [
									el("span", {
										class: "changes-hunk-heading",
										text: atomsAsText(conflict.heading),
									}),
								]),
					],
				}),
				el("div", {
					class: "merge-sides",
					children: [
						option(index, "yours", t.mergeYours, blocksView(conflict.yours, conflict.theirs, true)),
						option(
							index,
							"theirs",
							t.mergeTheirs,
							blocksView(conflict.theirs, conflict.yours, false),
						),
					],
				}),
				el("div", {
					class: "merge-extra",
					children: [
						...(conflict.yours.length > 0 && conflict.theirs.length > 0
							? [option(index, "both", t.mergeBoth, null)]
							: []),
						base,
					],
				}),
			],
		});
	}

	function render(page: MergeSource): void {
		const { merge } = page;
		title.textContent = format(t.mergeTitle, page.title);
		const merged = format(t.mergeSummary, merge.yours, merge.theirs);
		summary.textContent = `${merged} ${
			merge.conflicts === 0 ? t.mergeNoConflicts : format(t.mergeConflicts, merge.conflicts)
		}`;
		body.replaceChildren(
			...(conflicts.length === 0
				? [el("p", { class: "changes-empty", text: t.mergeNoConflicts })]
				: conflicts.map((conflict, index) => conflictView(conflict, index))),
		);
		refresh();
	}

	return {
		show(next) {
			source = next;
			conflicts = conflictsOf(next.merge);
			choices = conflicts.map(() => undefined);
			busy = false;
			problem = "";
			render(next);
			if (!dialog.open) dialog.showModal();
			body.scrollTop = 0;
			(conflicts.length === 0 ? save : body).focus();
		},
		get open() {
			return dialog.open;
		},
	};
}
