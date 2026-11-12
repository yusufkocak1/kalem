/**
 * What changed in a Confluence page since it was opened or last saved,
 * shown as `git diff` shows it: each place that changed with a few lines
 * around it, removed lines in red, added ones in green, the words that
 * differ marked within a changed line. A change can be undone on its own
 * (one editor edit: Ctrl+Z brings it back), all of them at once, or the
 * page saved to Confluence from here.
 */
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { DiffHunk, DiffRow, WordPart } from "../shared/text-diff.js";
import { diffText, pairedRows, revertHunk, wordDiff } from "../shared/text-diff.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

/** The page whose changes are shown. */
export interface ChangesSource {
	readonly title: string;
	/** The page's text as it was opened or last saved. */
	base(): string;
	/** The text in the editor now. */
	current(): string;
	/** Whether the text can be changed (not read only, not in source mode). */
	editable(): boolean;
	/** Puts `text` in the editor as one edit; `false` when it could not. */
	replace(text: string): boolean;
	/** Saves the page to Confluence; resolves to whether it was saved. */
	save(): Promise<boolean>;
}

export interface ChangesDialogOptions {
	readonly t: Strings;
	/** Whether saving to Confluence shows this first. */
	reviewBeforeSave(): boolean;
	setReviewBeforeSave(value: boolean): void;
}

type Layout = "unified" | "split";

export function createChangesDialog(options: ChangesDialogOptions): {
	show(source: ChangesSource): void;
	readonly open: boolean;
} {
	const { t } = options;
	const title = el("h2", { class: "changes-title" });
	const summary = el("p", { class: "changes-summary" });
	const close = el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": t.close, title: t.close },
		children: [icon("close")],
	});
	const unified = el("button", {
		class: "changes-layout-button",
		text: t.changesUnified,
		attrs: { type: "button" },
	});
	const split = el("button", {
		class: "changes-layout-button",
		text: t.changesSplit,
		attrs: { type: "button" },
	});
	const body = el("div", { class: "changes-body", attrs: { tabindex: "0" } });
	const always = el("input", { attrs: { type: "checkbox" } });
	const revertAll = el("button", {
		class: "dialog-button",
		text: t.changesRevertAll,
		attrs: { type: "button" },
	});
	const done = el("button", { class: "dialog-button", text: t.close, attrs: { type: "button" } });
	const save = el("button", {
		class: "dialog-button primary",
		children: [icon("confluence"), t.changesSave],
		attrs: { type: "button" },
	});
	const status = el("p", { class: "changes-status", attrs: { role: "status" } });
	const dialog = el("dialog", {
		class: "changes",
		attrs: { "aria-labelledby": "changes-title" },
		children: [
			el("div", {
				class: "changes-head",
				children: [
					el("div", { class: "changes-heading", children: [title, summary] }),
					el("div", {
						class: "changes-layout",
						attrs: { role: "group", "aria-label": t.changesButton },
						children: [unified, split],
					}),
					close,
				],
			}),
			body,
			status,
			el("div", {
				class: "changes-actions",
				children: [
					el("label", {
						class: "changes-always",
						children: [always, el("span", { text: t.changesReviewBeforeSave })],
					}),
					revertAll,
					done,
					save,
				],
			}),
		],
	});
	title.id = "changes-title";
	document.body.append(dialog);

	let source: ChangesSource | null = null;
	let layout: Layout = "unified";

	const shut = (): void => {
		dialog.close();
		source = null;
	};
	close.addEventListener("click", shut);
	done.addEventListener("click", shut);
	dialog.addEventListener("close", () => {
		source = null;
	});
	always.addEventListener("change", () => options.setReviewBeforeSave(always.checked));
	for (const [button, value] of [
		[unified, "unified"],
		[split, "split"],
	] as const) {
		button.addEventListener("click", () => {
			layout = value;
			render();
		});
	}
	revertAll.addEventListener("click", () => {
		if (source === null) return;
		apply(source.base());
	});
	save.addEventListener("click", async () => {
		if (source === null) return;
		const page = source;
		save.disabled = true;
		const saved = await page.save().catch(() => false);
		save.disabled = false;
		// The save's own notice says why it failed; the changes stay in view.
		if (saved && source === page) shut();
	});

	function apply(text: string): void {
		if (source === null) return;
		status.textContent = source.replace(text) ? "" : t.changesReadOnly;
		render();
	}

	function render(): void {
		if (source === null) return;
		title.textContent = format(t.changesTitle, source.title);
		unified.setAttribute("aria-pressed", String(layout === "unified"));
		split.setAttribute("aria-pressed", String(layout === "split"));
		const current = source.current();
		const diff = diffText(source.base(), current);
		const editable = source.editable();
		summary.textContent =
			diff.hunks.length === 0
				? t.changesNone
				: format(t.changesSummary, diff.added, diff.removed, diff.hunks.length);
		revertAll.disabled = diff.hunks.length === 0 || !editable;
		save.disabled = diff.hunks.length === 0;
		if (!editable && status.textContent === "") status.textContent = t.changesReadOnly;
		if (diff.hunks.length === 0) {
			body.replaceChildren(el("p", { class: "changes-empty", text: t.changesNone }));
			return;
		}
		body.replaceChildren(
			el("div", {
				class: `changes-columns ${layout}`,
				attrs: { "aria-hidden": "true" },
				children:
					layout === "split"
						? [el("span", { text: t.changesBase }), el("span", { text: t.changesYours })]
						: [el("span", { text: `${t.changesBase} → ${t.changesYours}` })],
			}),
			...diff.hunks.map((hunk) => hunkView(hunk, current, editable)),
		);
	}

	function hunkView(hunk: DiffHunk, current: string, editable: boolean): HTMLElement {
		const undo = el("button", {
			class: "changes-hunk-undo",
			children: [icon("undo"), t.changesRevertHunk],
			attrs: { type: "button" },
		});
		undo.disabled = !editable;
		undo.addEventListener("click", () => apply(revertHunk(current, hunk)));
		const range = `@@ -${hunk.oldStart + 1},${hunk.oldCount} +${hunk.newStart + 1},${hunk.newCount} @@`;
		return el("section", {
			class: "changes-hunk",
			children: [
				el("header", {
					class: "changes-hunk-head",
					children: [
						el("code", { class: "changes-hunk-range", text: range }),
						...(hunk.heading === ""
							? []
							: [el("span", { class: "changes-hunk-heading", text: hunk.heading })]),
						undo,
					],
				}),
				layout === "split" ? splitRows(hunk.rows) : unifiedRows(hunk.rows),
			],
		});
	}

	function parts(row: DiffRow, pairs: Map<DiffRow, DiffRow>): (Node | string)[] {
		const other = pairs.get(row);
		if (other === undefined || row.kind === " ") return [row.text === "" ? " " : row.text];
		const words =
			row.kind === "-"
				? wordDiff(row.text, other.text).before
				: wordDiff(other.text, row.text).after;
		return words.map((part: WordPart) =>
			part.changed ? el("mark", { class: "changes-word", text: part.text }) : part.text,
		);
	}

	const kindClass = (kind: DiffRow["kind"]): string =>
		kind === "+" ? "add" : kind === "-" ? "remove" : "keep";

	function unifiedRows(rows: readonly DiffRow[]): HTMLElement {
		const pairs = pairedRows(rows);
		return el("div", {
			class: "changes-rows unified",
			children: rows.map((row) =>
				el("div", {
					class: `changes-row ${kindClass(row.kind)}`,
					children: [
						el("span", { class: "changes-number", text: row.oldLine?.toString() ?? "" }),
						el("span", { class: "changes-number", text: row.newLine?.toString() ?? "" }),
						el("span", { class: "changes-sign", text: row.kind }),
						el("span", { class: "changes-text", children: parts(row, pairs) }),
					],
				}),
			),
		});
	}

	function splitRows(rows: readonly DiffRow[]): HTMLElement {
		const pairs = pairedRows(rows);
		// Each row is a line of the old text beside its counterpart in the new one.
		const lines: [DiffRow | null, DiffRow | null][] = [];
		for (let index = 0; index < rows.length; ) {
			const row = rows[index] as DiffRow;
			if (row.kind === " ") {
				lines.push([row, row]);
				index++;
				continue;
			}
			const removed: DiffRow[] = [];
			const added: DiffRow[] = [];
			while (index < rows.length && (rows[index] as DiffRow).kind === "-") {
				removed.push(rows[index++] as DiffRow);
			}
			while (index < rows.length && (rows[index] as DiffRow).kind === "+") {
				added.push(rows[index++] as DiffRow);
			}
			for (let k = 0; k < Math.max(removed.length, added.length); k++) {
				lines.push([removed[k] ?? null, added[k] ?? null]);
			}
		}
		const side = (row: DiffRow | null, number: number | null): HTMLElement[] =>
			row === null
				? [
						el("span", { class: "changes-number empty" }),
						el("span", { class: "changes-text empty" }),
					]
				: [
						el("span", {
							class: `changes-number ${kindClass(row.kind)}`,
							text: number?.toString() ?? "",
						}),
						el("span", {
							class: `changes-text ${kindClass(row.kind)}`,
							children: parts(row, pairs),
						}),
					];
		return el("div", {
			class: "changes-rows split",
			children: lines.map(([left, right]) =>
				el("div", {
					class: "changes-row",
					children: [...side(left, left?.oldLine ?? null), ...side(right, right?.newLine ?? null)],
				}),
			),
		});
	}

	return {
		show(next) {
			source = next;
			always.checked = options.reviewBeforeSave();
			status.textContent = "";
			render();
			if (!dialog.open) dialog.showModal();
			body.scrollTop = 0;
			body.focus();
		},
		get open() {
			return dialog.open;
		},
	};
}
