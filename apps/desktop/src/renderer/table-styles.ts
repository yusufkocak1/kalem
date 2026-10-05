import type { Root, Table } from "@kalem-editor/core";
import type { Editor } from "@kalem-editor/editor";
import { ID_ATTR } from "@kalem-editor/editor";
import type { TableStyle } from "../shared/table-style.js";
import { clampColumnWidth, isPlain, NO_STYLE } from "../shared/table-style.js";

function tableIds(doc: Root): string[] {
	return doc.children.flatMap((block) =>
		block.type === "table" && block.id !== undefined ? [block.id] : [],
	);
}

/**
 * Colors and column widths of the document's top-level tables, keyed by the
 * editor's block id. They live outside the Markdown AST: the editor only ever
 * sees plain tables, and the styles are written back as comments on save.
 */
export class TableStyles {
	readonly #styles = new Map<string, TableStyle>();
	/** Table ids in document order as of the last reconcile. */
	#order: string[] = [];
	/** Styles for the tables the next change inserts, in order. */
	#pasted: readonly TableStyle[] | null = null;

	/** `styles` holds one entry per table, in document order. */
	reset(doc: Root, styles: readonly TableStyle[]): void {
		this.#styles.clear();
		this.#order = tableIds(doc);
		for (const [i, id] of this.#order.entries()) {
			const style = styles[i];
			if (style !== undefined && !isPlain(style)) this.#styles.set(id, style);
		}
	}

	get(id: string): TableStyle {
		return this.#styles.get(id) ?? NO_STYLE;
	}

	set(id: string, style: TableStyle): void {
		if (isPlain(style)) this.#styles.delete(id);
		else this.#styles.set(id, style);
	}

	get isEmpty(): boolean {
		return this.#styles.size === 0;
	}

	readonly styleOf = (table: Table): TableStyle | undefined =>
		table.id === undefined ? undefined : this.#styles.get(table.id);

	expectPaste(styles: readonly TableStyle[] | null): void {
		this.#pasted = styles;
	}

	/**
	 * Leaving source mode re-parses the document and gives every block a new
	 * id. When that happens the styles are carried over by table position.
	 * Styles of a deleted table are kept, so undo brings them back.
	 */
	reconcile(doc: Root): void {
		const ids = tableIds(doc);
		const current = new Set(ids);
		const previous = this.#order;
		const reparsed =
			previous.length > 0 &&
			previous.length === ids.length &&
			previous.every((id) => !current.has(id));

		if (reparsed) {
			const moved = previous.map((id) => this.#styles.get(id));
			this.#styles.clear();
			for (const [i, style] of moved.entries()) {
				const id = ids[i];
				if (style !== undefined && id !== undefined) this.#styles.set(id, style);
			}
		}

		const pasted = this.#pasted;
		this.#pasted = null;
		if (pasted !== null) {
			const before = new Set(previous);
			const added = ids.filter((id) => !before.has(id));
			if (added.length === pasted.length) {
				for (const [i, id] of added.entries()) this.set(id, pasted[i] ?? NO_STYLE);
			}
		}
		this.#order = ids;
	}

	/** The editor re-creates a table's cells when it re-renders it, so this runs after every change. */
	decorate(editor: Editor): void {
		for (const id of this.#order) {
			const table = editor.getBlockElement(id);
			if (!(table instanceof HTMLTableElement)) continue;
			const style = this.get(id);

			if (style.color === null) table.removeAttribute("data-table-color");
			else table.setAttribute("data-table-color", style.color);

			for (const row of Array.from(table.rows)) {
				for (const cell of Array.from(row.cells)) {
					const width = style.widths[cell.cellIndex] ?? null;
					// In px at 100% zoom; the page's `--zoom` scales it with the text.
					const value = width === null ? "" : `calc(${width}px * var(--zoom, 1))`;
					if (cell.style.width === value) continue;
					cell.style.width = value;
					cell.style.minWidth = value;
					cell.style.maxWidth = value;
				}
			}
		}
	}
}

// --- Dragging column borders --------------------------------------------------

export interface ColumnResizeOptions {
	enabled(): boolean;
	zoom(): number;
	/** Called while dragging, and once more with `done` when the border is released. */
	resize(tableId: string, column: number, width: number, done: boolean): void;
}

/** Distance from a column border within which the pointer grabs it. */
const GRIP = 5;

interface Grip {
	readonly table: HTMLTableElement;
	readonly column: number;
}

interface Drag {
	readonly tableId: string;
	readonly column: number;
	readonly startX: number;
	readonly startWidth: number;
}

export function enableColumnResize(canvas: HTMLElement, options: ColumnResizeOptions): void {
	let drag: Drag | null = null;

	function gripAt(event: PointerEvent): Grip | null {
		const cell = event.target instanceof Element ? event.target.closest("th, td") : null;
		const table = cell?.closest("table");
		if (!(cell instanceof HTMLTableCellElement) || !(table instanceof HTMLTableElement))
			return null;
		// Only top-level tables carry styles.
		if (table.parentElement !== canvas) return null;

		const box = cell.getBoundingClientRect();
		if (box.right - event.clientX <= GRIP) return { table, column: cell.cellIndex };
		if (event.clientX - box.left <= GRIP && cell.cellIndex > 0) {
			return { table, column: cell.cellIndex - 1 };
		}
		return null;
	}

	function widthAt(event: PointerEvent, current: Drag): number {
		return clampColumnWidth((current.startWidth + event.clientX - current.startX) / options.zoom());
	}

	// Capture phase: the editor must not see these events, or it would start a
	// text selection while the border is being dragged.
	canvas.addEventListener(
		"pointerdown",
		(event) => {
			const grip = event.button === 0 && options.enabled() ? gripAt(event) : null;
			const header = grip?.table.rows[0]?.cells[grip.column];
			const tableId = grip?.table.getAttribute(ID_ATTR);
			if (grip === null || header === undefined || tableId == null) return;

			event.preventDefault();
			event.stopPropagation();
			drag = {
				tableId,
				column: grip.column,
				startX: event.clientX,
				startWidth: header.getBoundingClientRect().width,
			};
			canvas.setPointerCapture(event.pointerId);
			canvas.setAttribute("data-column-grip", "");
		},
		true,
	);

	canvas.addEventListener(
		"pointermove",
		(event) => {
			if (drag === null) {
				canvas.toggleAttribute("data-column-grip", options.enabled() && gripAt(event) !== null);
				return;
			}
			event.stopPropagation();
			options.resize(drag.tableId, drag.column, widthAt(event, drag), false);
		},
		true,
	);

	const finish = (event: PointerEvent): void => {
		if (drag === null) return;
		event.stopPropagation();
		const finished = drag;
		drag = null;
		canvas.releasePointerCapture(event.pointerId);
		canvas.removeAttribute("data-column-grip");
		options.resize(finished.tableId, finished.column, widthAt(event, finished), true);
	};
	canvas.addEventListener("pointerup", finish, true);
	canvas.addEventListener("pointercancel", finish, true);
}
