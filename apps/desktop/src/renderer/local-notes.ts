/**
 * The user's own notes on the open document, as Word's comments: the words
 * a note is about are tinted in its colour, and the note is a card in the
 * "My Notes" pane (a side dock, left or right, like the assistant's), in
 * the order of the page. They live on this computer only (see
 * `shared/local-notes.ts`): nothing here changes the document, and the
 * page keeps its width whatever the notes do.
 *
 * A note is one of four kinds — "I did not get this", "careful", "look
 * later", or a plain note — and can be resolved (kept, out of the way) or
 * deleted. Clicking tinted words picks their card; clicking a card shows
 * its words.
 */
import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { LocalNote, NoteKind } from "../shared/local-notes.js";
import { anchorAt, locateNote, NOTE_KINDS, noteOrder, reanchored } from "../shared/local-notes.js";
import type { TextMap } from "./document-marks.js";
import { textMap } from "./document-marks.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

/** The tab whose notes are shown. */
export interface NotesTarget {
	readonly id: string;
	/** The rendered document: where the notes' words are looked for. */
	readonly canvas: HTMLElement;
	/** Where the notes are kept; `null` for a document never saved (they wait in memory). */
	key(): string | null;
	/** `false` in source mode or for a plain text file: there are no words to tint. */
	available(): boolean;
}

export interface LocalNotesOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly lang: string;
	/** Whether the notes' words are tinted in the text (the setting). */
	visible(): boolean;
	/** Whether the My Notes pane is on the screen. */
	shown(): boolean;
	/** Brings the My Notes pane into view. */
	reveal(): void;
	/** Says something to the user, with buttons. */
	notify(text: string, actions?: readonly { label: string; run(): void }[]): void;
}

export interface LocalNotes {
	/** The My Notes pane's content, for its dock. */
	readonly element: HTMLElement;
	attach(target: NotesTarget): void;
	/** The document or the page's size changed: the notes find their words again. */
	refresh(): void;
	/** A note on the selection (or the word at the caret). */
	add(): void;
	/** Goes to the next or the previous note. */
	go(direction: 1 | -1): void;
	/** How many open notes the shown document has. */
	count(): number;
}

const KIND_ICON: Readonly<Record<NoteKind, IconName>> = {
	question: "noteQuestion",
	attention: "noteAttention",
	later: "noteLater",
	note: "note",
};

const HIGHLIGHT = (kind: NoteKind): string => `kalem-note-${kind}`;
const CURRENT = (kind: NoteKind): string => `kalem-note-current-${kind}`;
const SAVE_DELAY = 400;

interface TabNotes {
	key: string | null;
	notes: LocalNote[];
	loaded: boolean;
	saveTimer: ReturnType<typeof setTimeout> | undefined;
}

/** Where a note's words are on the page now. */
interface Placed {
	readonly range: Range;
	readonly start: number;
}

export function createLocalNotes(options: LocalNotesOptions): LocalNotes {
	const { t, bridge } = options;
	const kindLabel: Readonly<Record<NoteKind, string>> = {
		question: t.noteKindQuestion,
		attention: t.noteKindAttention,
		later: t.noteKindLater,
		note: t.noteKindNote,
	};
	const dateFormat = new Intl.DateTimeFormat(options.lang, {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

	const tabs = new Map<string, TabNotes>();
	let target: NotesTarget | null = null;
	let active: string | null = null;
	/** A note just made: Escape takes it away again. */
	let fresh: string | null = null;
	let showResolved = false;
	let lastKind: NoteKind = "question";
	let placed = new Map<string, Placed>();
	let refreshTimer: ReturnType<typeof setTimeout> | undefined;

	// --- The pane -------------------------------------------------------------------

	const countLabel = el("span", { class: "notes-count" });
	const newButton = el("button", {
		class: "notes-head-button notes-new",
		attrs: { type: "button", title: `${t.noteNew} (Ctrl+Alt+M)` },
		children: [icon("noteNew"), el("span", { text: t.noteNew })],
	});
	const resolvedToggle = el("button", {
		class: "notes-head-button",
		attrs: { type: "button" },
	});
	const head = el("div", {
		class: "notes-head",
		children: [
			el("div", {
				class: "notes-head-title",
				children: [el("strong", { text: t.notesOpen }), countLabel],
			}),
			el("div", { class: "notes-head-actions", children: [newButton, resolvedToggle] }),
			el("p", { class: "notes-private", text: t.notesPrivate }),
		],
	});
	const list = el("div", { class: "notes-list", attrs: { role: "list" } });
	const element = el("div", {
		class: "notes-pane",
		attrs: { "aria-label": t.notesTitle },
		children: [head, list],
	});

	resolvedToggle.addEventListener("click", () => {
		showResolved = !showResolved;
		render();
	});
	// Pressed with the mouse, the button must not take the selection out of the text first.
	newButton.addEventListener("mousedown", (event) => event.preventDefault());
	newButton.addEventListener("click", () => add());

	const views = new Map<string, Balloon>();

	// --- Keeping ------------------------------------------------------------------

	function tabNotes(tab: NotesTarget): TabNotes {
		let state = tabs.get(tab.id);
		if (state === undefined) {
			state = { key: tab.key(), notes: [], loaded: false, saveTimer: undefined };
			tabs.set(tab.id, state);
			void load(tab, state);
		}
		return state;
	}

	async function load(tab: NotesTarget, state: TabNotes): Promise<void> {
		const key = state.key;
		const stored = key === null ? [] : await bridge.localNotes(key).catch(() => []);
		// Notes made while it was loading stay, after the stored ones.
		const made = state.notes.filter((note) => !stored.some((other) => other.id === note.id));
		state.notes = [...stored, ...made];
		state.loaded = true;
		if (made.length > 0) save(state);
		if (target === tab) refresh();
	}

	function save(state: TabNotes): void {
		clearTimeout(state.saveTimer);
		const key = state.key;
		if (key === null) return;
		state.saveTimer = setTimeout(() => {
			void bridge.setLocalNotes(key, state.notes).catch((error: unknown) => {
				options.notify(format(t.notesSaveFailed, error instanceof Error ? error.message : ""));
			});
		}, SAVE_DELAY);
	}

	function change(id: string, patch: Partial<LocalNote>): void {
		const state = current();
		if (state === null) return;
		state.notes = state.notes.map((note) =>
			note.id === id ? { ...note, ...patch, updated: Date.now() } : note,
		);
		save(state);
	}

	function current(): TabNotes | null {
		return target === null ? null : tabNotes(target);
	}

	/** A document saved for the first time (or under another name): its notes go with it. */
	function followKey(tab: NotesTarget, state: TabNotes): void {
		const key = tab.key();
		if (key === state.key) return;
		const before = state.key;
		state.key = key;
		if (key === null) return;
		if (before === null) {
			// The notes made before the first save: kept under the new key, with any stored there.
			state.loaded = false;
			void load(tab, state);
		} else {
			save(state);
		}
	}

	// --- Finding the words ----------------------------------------------------------

	function rangeOf(map: TextMap, start: number, end: number): Range | null {
		const from = map.at[start];
		const to = map.at[end - 1];
		if (from === undefined || to === undefined) return null;
		const range = document.createRange();
		range.setStart(from.node, from.offset);
		range.setEnd(to.node, Math.min(to.offset + 1, to.node.data.length));
		return range;
	}

	/** The selection as offsets in the page's text; a caret takes the word it is in. */
	function selectionOffsets(map: TextMap, root: HTMLElement): [number, number] | null {
		const selection = window.getSelection();
		if (selection === null || selection.rangeCount === 0) return null;
		const range = selection.getRangeAt(0);
		if (!root.contains(range.commonAncestorContainer)) return null;
		let start = -1;
		let end = -1;
		for (let i = 0; i < map.at.length; i++) {
			const at = map.at[i] as { node: Text; offset: number };
			const where = range.comparePoint(at.node, at.offset);
			if (range.collapsed ? where >= 0 : where === 0) {
				if (start === -1) start = i;
				end = i + 1;
				if (range.collapsed) break;
			} else if (where > 0) break;
		}
		if (start === -1) return null;
		if (!range.collapsed) return [start, end];
		// A caret: the word around it; just after a word's end (". " at a line's end), that word.
		const word = /[\p{L}\p{N}_-]/u;
		let at = start;
		for (
			let steps = 0;
			steps < 3 &&
			at > 0 &&
			!word.test(map.text[at] ?? " ") &&
			!word.test(map.text[at - 1] as string);
			steps++
		) {
			at--;
		}
		let from = at;
		let to = at;
		while (from > 0 && word.test(map.text[from - 1] as string)) from--;
		while (to < map.text.length && word.test(map.text[to] as string)) to++;
		return from < to ? [from, to] : null;
	}

	// --- Drawing ----------------------------------------------------------------------

	const highlights = (): HighlightRegistry | null =>
		typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null;

	function clearHighlights(): void {
		const registry = highlights();
		for (const kind of NOTE_KINDS) registry?.delete(HIGHLIGHT(kind));
		for (const kind of NOTE_KINDS) registry?.delete(CURRENT(kind));
	}

	function detach(): void {
		clearHighlights();
	}

	function refresh(): void {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(render, 120);
	}

	function render(): void {
		clearTimeout(refreshTimer);
		const tab = target;
		if (tab === null) return;
		const state = tabNotes(tab);
		followKey(tab, state);
		const shown = state.notes.filter((note) => showResolved || !note.resolved);
		if (!tab.available()) {
			detach();
			placed = new Map();
			countLabel.textContent = "";
			resolvedToggle.hidden = true;
			list.replaceChildren(el("p", { class: "notes-empty", text: t.notesUnavailable }));
			views.clear();
			return;
		}

		// Where each note's words are now; notes whose words were edited follow them.
		const map = textMap(tab.canvas);
		placed = new Map();
		let moved = false;
		state.notes = state.notes.map((note) => {
			const found = locateNote(map.text, note);
			if (found === null) return note;
			const range = rangeOf(map, found.start, found.end);
			if (range !== null) placed.set(note.id, { range, start: found.start });
			const next = reanchored(map.text, note, found.start, found.end);
			if (next !== note) moved = true;
			return next;
		});
		if (moved) save(state);

		const registry = options.visible() ? highlights() : null;
		if (registry === null) clearHighlights();
		else {
			for (const kind of NOTE_KINDS) {
				const ranges = state.notes
					.filter((note) => note.kind === kind && !note.resolved)
					.flatMap((note) => {
						const where = placed.get(note.id);
						return where === undefined ? [] : [where.range];
					});
				registry.set(HIGHLIGHT(kind), new Highlight(...ranges));
			}
			const where = active === null ? undefined : placed.get(active);
			const kind = state.notes.find((note) => note.id === active)?.kind;
			for (const each of NOTE_KINDS) {
				if (where === undefined || each !== kind) registry.delete(CURRENT(each));
				else registry.set(CURRENT(each), new Highlight(where.range));
			}
		}

		const open = state.notes.filter((note) => !note.resolved).length;
		const resolved = state.notes.length - open;
		countLabel.textContent = String(open);
		resolvedToggle.textContent = showResolved
			? t.notesHideResolved
			: format(t.notesShowResolved, resolved);
		resolvedToggle.hidden = resolved === 0;
		resolvedToggle.setAttribute("aria-pressed", String(showResolved));

		const ordered = noteOrder(shown, (note) => placed.get(note.id)?.start ?? null);
		for (const [id, view] of views) {
			if (!ordered.some((note) => note.id === id)) {
				view.element.remove();
				views.delete(id);
			}
		}
		const balloons = ordered.map((note) => {
			let view = views.get(note.id);
			if (view === undefined) {
				view = balloon(note.id);
				views.set(note.id, view);
			}
			view.update(note, !placed.has(note.id), note.id === active);
			return view;
		});
		// Moved only when the order changed: a card taken out of the pane loses the focus.
		const wantedChildren: Element[] =
			balloons.length === 0
				? [
						el("p", {
							class: "notes-empty",
							text: state.notes.length === 0 ? t.notesEmptyHint : t.notesEmpty,
						}),
					]
				: balloons.map((view) => view.element);
		const same =
			balloons.length > 0 &&
			list.children.length === wantedChildren.length &&
			wantedChildren.every((child, i) => list.children[i] === child);
		if (!same) list.replaceChildren(...wantedChildren);
	}

	// --- A balloon -----------------------------------------------------------------------

	interface Balloon {
		readonly element: HTMLElement;
		kind: NoteKind;
		update(note: LocalNote, lost: boolean, isActive: boolean): void;
		focus(): void;
	}

	function balloon(id: string): Balloon {
		const kindMark = el("span", { class: "note-kind" });
		const time = el("time", { class: "note-time" });
		const resolve = el("button", { class: "note-action", attrs: { type: "button" } });
		const remove = el("button", {
			class: "note-action",
			attrs: { type: "button", title: t.noteDelete, "aria-label": t.noteDelete },
			children: [icon("trash")],
		});
		const quote = el("blockquote", { class: "note-quote" });
		const textArea = el("textarea", {
			class: "note-text",
			attrs: { rows: "1", placeholder: t.notePlaceholder, "aria-label": t.notesTitle },
		});
		const kinds = el("div", {
			class: "note-kinds",
			attrs: { role: "radiogroup", "aria-label": t.noteKindLabel },
		});
		const kindButtons = NOTE_KINDS.map((kind) => {
			const button = el("button", {
				class: `note-kind-chip kind-${kind}`,
				attrs: { type: "button", role: "radio", title: kindLabel[kind] },
				children: [icon(KIND_ICON[kind]), el("span", { text: kindLabel[kind] })],
			});
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				lastKind = kind;
				change(id, { kind });
				render();
				textArea.focus({ preventScroll: true });
			});
			kinds.append(button);
			return { kind, button };
		});
		const card = el("article", {
			class: "note-balloon",
			attrs: { "data-note": id, tabindex: "-1", role: "listitem" },
			children: [
				el("header", {
					class: "note-head",
					children: [
						kindMark,
						time,
						el("div", { class: "note-actions", children: [resolve, remove] }),
					],
				}),
				quote,
				kinds,
				textArea,
			],
		});
		const grow = (): void => {
			textArea.style.height = "auto";
			textArea.style.height = `${textArea.scrollHeight}px`;
		};
		textArea.addEventListener("input", () => {
			grow();
			change(id, { text: textArea.value });
		});
		textArea.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				if (fresh === id && textArea.value.trim() === "") {
					const where = placed.get(id)?.range.cloneRange() ?? null;
					deleteNote(id, false);
					backToText(where);
				} else leave();
			} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				leave();
			}
		});
		textArea.addEventListener("focus", () => activate(id, false));
		textArea.addEventListener("blur", () => {
			if (fresh === id) fresh = null;
		});
		card.addEventListener("click", () => activate(id, true));
		resolve.addEventListener("click", (event) => {
			event.stopPropagation();
			const note = current()?.notes.find((item) => item.id === id);
			if (note === undefined) return;
			change(id, { resolved: !note.resolved });
			if (!note.resolved && active === id) active = null;
			render();
		});
		remove.addEventListener("click", (event) => {
			event.stopPropagation();
			deleteNote(id, true);
		});

		const view: Balloon = {
			element: card,
			kind: "note",
			update(note, lost, isActive) {
				view.kind = note.kind;
				card.className = `note-balloon kind-${note.kind}${isActive ? " active" : ""}${
					note.resolved ? " resolved" : ""
				}${lost ? " lost" : ""}`;
				kindMark.replaceChildren(icon(KIND_ICON[note.kind]), kindLabel[note.kind]);
				time.textContent = dateFormat.format(note.created);
				time.dateTime = new Date(note.created).toISOString();
				resolve.replaceChildren(icon(note.resolved ? "undo" : "check"));
				resolve.title = note.resolved ? t.noteReopen : t.noteResolve;
				resolve.setAttribute("aria-label", resolve.title);
				quote.textContent = lost ? format(t.noteLost, note.quote) : `“${note.quote}”`;
				for (const { kind, button } of kindButtons) {
					button.setAttribute("aria-checked", String(kind === note.kind));
				}
				if (document.activeElement !== textArea && textArea.value !== note.text) {
					textArea.value = note.text;
				}
				requestAnimationFrame(grow);
			},
			focus() {
				// The page must not move: the card is in its pane, the words stay where they are.
				textArea.focus({ preventScroll: true });
				card.scrollIntoView({ block: "nearest" });
				const end = textArea.value.length;
				textArea.setSelectionRange(end, end);
			},
		};
		return view;
	}

	function activate(id: string | null, reveal: boolean): void {
		if (active === id) return;
		active = id;
		render();
		if (id !== null) views.get(id)?.element.scrollIntoView({ block: "nearest" });
		if (reveal && id !== null) {
			const where = placed.get(id);
			where?.range.startContainer.parentElement?.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			});
		}
	}

	/** Out of the balloon, back to the words. */
	function leave(): void {
		fresh = null;
		const where = active === null ? null : (placed.get(active)?.range.cloneRange() ?? null);
		active = null;
		render();
		backToText(where);
	}

	/**
	 * The focus back in the text, the caret just after the note's words (where
	 * the user was), without moving the page. Without it the focus is lost and
	 * what is typed next goes nowhere.
	 */
	function backToText(range: Range | null): void {
		const tab = target;
		if (tab === null) return;
		const node = range?.endContainer ?? null;
		const host =
			node === null || !node.isConnected
				? null
				: (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
						"[contenteditable='true']",
					);
		if (range === null || host === null || host === undefined) {
			tab.canvas
				.querySelector<HTMLElement>("[contenteditable='true']")
				?.focus({ preventScroll: true });
			return;
		}
		host.focus({ preventScroll: true });
		range.collapse(false);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	function deleteNote(id: string, undoable: boolean): void {
		const state = current();
		if (state === null) return;
		const note = state.notes.find((item) => item.id === id);
		if (note === undefined) return;
		const index = state.notes.indexOf(note);
		state.notes = state.notes.filter((item) => item.id !== id);
		if (active === id) active = null;
		if (fresh === id) fresh = null;
		save(state);
		render();
		if (undoable) {
			options.notify(t.noteDeleted, [
				{
					label: t.reviewUndo,
					run: () => {
						if (state.notes.some((item) => item.id === id)) return;
						state.notes.splice(Math.min(index, state.notes.length), 0, note);
						save(state);
						render();
					},
				},
			]);
		}
	}

	// --- Clicking the tinted words ---------------------------------------------------------

	function onCanvasClick(event: MouseEvent): void {
		const caret = document.caretRangeFromPoint?.(event.clientX, event.clientY);
		if (caret === null || caret === undefined) return;
		for (const [id, where] of placed) {
			const note = current()?.notes.find((item) => item.id === id);
			if (note === undefined || note.resolved) continue;
			if (where.range.isPointInRange(caret.startContainer, caret.startOffset)) {
				if (!options.shown()) options.reveal();
				activate(id, false);
				return;
			}
		}
		if (active !== null) activate(null, false);
	}

	/** A note on the selection, or the word at the caret; its card takes the focus. */
	function add(): void {
		const tab = target;
		if (tab === null) return;
		if (!tab.available()) {
			options.notify(t.notesUnavailable);
			return;
		}
		const map = textMap(tab.canvas);
		const offsets = selectionOffsets(map, tab.canvas);
		const anchor = offsets === null ? null : anchorAt(map.text, offsets[0], offsets[1]);
		if (anchor === null) {
			options.notify(t.notesSelectFirst);
			return;
		}
		if (!options.shown()) options.reveal();
		const now = Date.now();
		const note: LocalNote = {
			id: crypto.randomUUID(),
			kind: lastKind,
			text: "",
			...anchor,
			created: now,
			updated: now,
			resolved: false,
		};
		const state = tabNotes(tab);
		state.notes = [...state.notes, note];
		save(state);
		fresh = note.id;
		active = note.id;
		render();
		// At once: what is typed next is the note, not more of the document. A pane
		// that is only now being shown takes it a frame later.
		const view = views.get(note.id);
		view?.focus();
		if (view !== undefined && !view.element.contains(document.activeElement)) {
			requestAnimationFrame(() => view.focus());
		}
	}

	return {
		element,
		attach(next) {
			if (target === next) {
				refresh();
				return;
			}
			if (target !== null) {
				target.canvas.removeEventListener("click", onCanvasClick);
				detach();
			}
			target = next;
			active = null;
			fresh = null;
			views.clear();
			list.replaceChildren();
			next.canvas.addEventListener("click", onCanvasClick);
			tabNotes(next);
			render();
		},
		refresh,
		add,
		go(direction) {
			const state = current();
			if (state === null) return;
			const ordered = noteOrder(
				state.notes.filter((note) => !note.resolved && placed.has(note.id)),
				(note) => placed.get(note.id)?.start ?? null,
			);
			if (ordered.length === 0) {
				options.notify(t.notesNone);
				return;
			}
			if (!options.shown()) options.reveal();
			const index = ordered.findIndex((note) => note.id === active);
			const next =
				index === -1
					? direction === 1
						? ordered[0]
						: ordered[ordered.length - 1]
					: ordered[(index + direction + ordered.length) % ordered.length];
			if (next !== undefined) {
				activate(next.id, true);
			}
		},
		count() {
			const state = current();
			return state === null ? 0 : state.notes.filter((note) => !note.resolved).length;
		},
	};
}
