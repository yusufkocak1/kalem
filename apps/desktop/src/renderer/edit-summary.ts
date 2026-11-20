/**
 * The assistant's changes still waiting, listed above the chat's question
 * box as a code editor lists an agent's edits, a file at a time: how many
 * files and their lines (+ and −), Accept and Reject for all of them, and a
 * line for each file with its own. The active document is one of them, its
 * changes under it (they are reviewed in the document, `edit-review.ts`);
 * the others are the workspace files the assistant proposed to change. A
 * click on a line shows it: the change in the document, or the file's
 * change in the chat.
 */
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import type { ReviewSummary } from "./edit-review.js";

/** The active document's changes waiting in it, and what is done with them. */
export interface DocumentEdits {
	/** The document's file name. */
	readonly name: string;
	readonly summary: ReviewSummary;
	acceptAll(): void;
	rejectAll(): void;
	select(index: number): void;
}

/** A workspace file's changes the assistant proposed, still to be applied. */
export interface FileEdits {
	/** As the workspace shows it. */
	readonly path: string;
	readonly added: number;
	readonly removed: number;
	/** The file is not there yet. */
	readonly created: boolean;
	apply(): void;
	discard(): void;
	/** Shows its change in the chat. */
	show(): void;
}

export interface EditSummary {
	readonly element: HTMLElement;
	/** Shows what waits; nothing hides it. */
	update(document: DocumentEdits | null, files: readonly FileEdits[]): void;
}

const counts = (added: number, removed: number): HTMLElement =>
	el("span", {
		class: "edit-summary-counts",
		children: [
			el("span", { class: "edit-summary-added", text: `+${added}` }),
			el("span", { class: "edit-summary-removed", text: `−${removed}` }),
		],
	});

const SVG = "http://www.w3.org/2000/svg";

/** A small line icon: a file, a check, an undo arrow. */
function glyph(path: string, kind: string): SVGSVGElement {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("edit-summary-glyph", kind);
	const shape = document.createElementNS(SVG, "path");
	shape.setAttribute("d", path);
	svg.append(shape);
	return svg;
}

const FILE = "M4 1.5h5.5L12.5 4.5v10h-8.5zM9.5 1.5v3h3M6 8h4.5M6 10.5h4.5";
const CHECK = "M3.5 8.5l3 3 6-7";
const UNDO = "M6 4L3 7l3 3M3.5 7H10a3 3 0 010 6H8";

export function createEditSummary(t: Strings): EditSummary {
	let open = true;
	let documentEdits: DocumentEdits | null = null;
	let files: readonly FileEdits[] = [];

	const chevron = el("button", {
		class: "edit-summary-toggle",
		attrs: { type: "button", "aria-expanded": "true", title: t.editSummaryToggle },
	});
	const title = el("span", { class: "edit-summary-title" });
	const total = el("span", { class: "edit-summary-total" });
	chevron.append(title, total);
	const accept = el("button", {
		class: "edit-summary-accept",
		text: t.editReviewAcceptAll,
		attrs: { type: "button", title: t.editReviewAcceptAll },
	});
	const reject = el("button", {
		class: "edit-summary-reject",
		text: t.editReviewRejectAll,
		attrs: { type: "button", title: t.editReviewRejectAll },
	});
	const list = el("ul", { class: "edit-summary-list", attrs: { "aria-label": t.editReviewTitle } });
	const element = el("section", {
		class: "edit-summary",
		attrs: { hidden: "", "aria-label": t.editReviewTitle },
		children: [
			el("div", { class: "edit-summary-head", children: [chevron, accept, reject] }),
			list,
		],
	});

	chevron.addEventListener("click", () => {
		open = !open;
		chevron.setAttribute("aria-expanded", String(open));
		list.hidden = !open;
	});
	accept.addEventListener("click", () => {
		documentEdits?.acceptAll();
		for (const file of files) file.apply();
	});
	reject.addEventListener("click", () => {
		documentEdits?.rejectAll();
		for (const file of files) file.discard();
	});

	/** A file's line: its name and folder, its lines, and Accept and Reject on it. */
	function fileRow(options: {
		readonly path: string;
		readonly added: number;
		readonly removed: number;
		readonly badge: string;
		readonly kind: string;
		show(): void;
		accept(): void;
		reject(): void;
	}): HTMLElement {
		const name = options.path.split(/[\\/]/).pop() ?? options.path;
		const folder = options.path.slice(0, options.path.length - name.length).replace(/[\\/]$/, "");
		const row = el("button", {
			class: "edit-summary-file",
			attrs: { type: "button", title: options.path, "data-kind": options.kind },
			children: [
				glyph(FILE, "file"),
				el("span", { class: "edit-summary-name", text: name }),
				el("span", {
					class: "edit-summary-folder",
					text: options.badge === "" ? folder : options.badge,
				}),
				counts(options.added, options.removed),
			],
		});
		row.addEventListener("click", () => options.show());
		const keep = el("button", {
			class: "edit-summary-act",
			attrs: {
				type: "button",
				title: t.editReviewAccept,
				"aria-label": `${t.editReviewAccept}: ${name}`,
			},
			children: [glyph(CHECK, "check")],
		});
		const undo = el("button", {
			class: "edit-summary-act",
			attrs: {
				type: "button",
				title: t.editReviewReject,
				"aria-label": `${t.editReviewReject}: ${name}`,
			},
			children: [glyph(UNDO, "undo")],
		});
		keep.addEventListener("click", () => options.accept());
		undo.addEventListener("click", () => options.reject());
		return el("li", {
			class: "edit-summary-entry",
			children: [row, el("span", { class: "edit-summary-acts", children: [keep, undo] })],
		});
	}

	/** The document's changes, each on a line under it. */
	function changeRows(edits: DocumentEdits): HTMLElement[] {
		return edits.summary.items.map((item, index) => {
			const row = el("button", {
				class: "edit-summary-item",
				attrs: { type: "button", title: t.editSummaryShow },
				children: [
					el("span", {
						class: `edit-summary-label${item.deletion ? " deleted" : ""}`,
						text: item.label === "" ? t.editSummaryEmpty : item.label,
					}),
					counts(item.added, item.removed),
				],
			});
			if (index === edits.summary.current) row.setAttribute("aria-current", "true");
			row.addEventListener("click", () => edits.select(index));
			return el("li", { children: [row] });
		});
	}

	return {
		element,
		update(next, nextFiles) {
			documentEdits = next !== null && next.summary.items.length > 0 ? next : null;
			files = nextFiles;
			const shown = (documentEdits === null ? 0 : 1) + files.length;
			element.hidden = shown === 0;
			if (shown === 0) {
				list.replaceChildren();
				return;
			}
			const items = documentEdits?.summary.items ?? [];
			const documentAdded = items.reduce((sum, item) => sum + item.added, 0);
			const documentRemoved = items.reduce((sum, item) => sum + item.removed, 0);
			title.textContent = shown === 1 ? t.editSummaryFile : format(t.editSummaryFiles, shown);
			total.replaceChildren(
				counts(
					documentAdded + files.reduce((sum, file) => sum + file.added, 0),
					documentRemoved + files.reduce((sum, file) => sum + file.removed, 0),
				),
			);
			list.hidden = !open;
			const rows: HTMLElement[] = [];
			if (documentEdits !== null) {
				const edits = documentEdits;
				rows.push(
					fileRow({
						path: edits.name,
						added: documentAdded,
						removed: documentRemoved,
						badge: format(t.editSummaryInDocument, items.length),
						kind: "document",
						show: () => edits.select(edits.summary.current),
						accept: () => edits.acceptAll(),
						reject: () => edits.rejectAll(),
					}),
					el("li", {
						class: "edit-summary-changes",
						children: [el("ul", { children: changeRows(edits) })],
					}),
				);
			}
			for (const file of files) {
				rows.push(
					fileRow({
						path: file.path,
						added: file.added,
						removed: file.removed,
						badge: file.created ? t.assistantEditNew : "",
						kind: "file",
						show: () => file.show(),
						accept: () => file.apply(),
						reject: () => file.discard(),
					}),
				);
			}
			list.replaceChildren(...rows);
		},
	};
}
