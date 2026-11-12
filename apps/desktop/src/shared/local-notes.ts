/**
 * The user's own notes on a document, as Word's comments: a balloon beside
 * the text it is about ("I did not get this, look later", "careful here").
 * They are the user's alone: kept on this computer, by document, never
 * written into the Markdown, a Confluence page or an export.
 *
 * A note holds on to its text by the words themselves, with a little of
 * what comes before and after: it finds its place again after the document
 * is edited elsewhere, and follows its words when they are edited a little.
 * Pure.
 */

export const NOTE_KINDS = ["question", "attention", "later", "note"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface LocalNote {
	readonly id: string;
	readonly kind: NoteKind;
	/** What the user wrote; may be empty (the mark alone says it). */
	readonly text: string;
	/** The words it is about, as the page shows them, spaces folded. */
	readonly quote: string;
	/** A little of the page's text just before and just after the words. */
	readonly prefix: string;
	readonly suffix: string;
	readonly created: number;
	readonly updated: number;
	readonly resolved: boolean;
}

/** How much text before and after a quote is kept to tell its occurrences apart. */
export const CONTEXT_LENGTH = 32;
const MAX_QUOTE = 2000;
const MAX_TEXT = 10_000;
const MAX_NOTES = 1000;

/** The key a document's notes are kept under: its file, or its Confluence page. */
export function noteKey(
	path: string | null,
	remote: { readonly site: string; readonly id: string } | null,
): string | null {
	if (remote !== null) return `confluence:${remote.site}#${remote.id}`;
	if (path !== null) return `file:${path}`;
	return null;
}

const text = (value: unknown, max: number): string =>
	typeof value === "string" ? value.slice(0, max) : "";

/** Notes read from a file or another process: what is not a note is left out. */
export function parseNotes(raw: unknown): LocalNote[] {
	if (!Array.isArray(raw)) return [];
	const notes: LocalNote[] = [];
	const ids = new Set<string>();
	for (const item of raw.slice(0, MAX_NOTES)) {
		if (typeof item !== "object" || item === null) continue;
		const value = item as Record<string, unknown>;
		const id = text(value.id, 100);
		const quote = text(value.quote, MAX_QUOTE);
		if (id === "" || quote === "" || ids.has(id)) continue;
		ids.add(id);
		const created = typeof value.created === "number" ? value.created : 0;
		notes.push({
			id,
			kind: NOTE_KINDS.includes(value.kind as NoteKind) ? (value.kind as NoteKind) : "note",
			text: text(value.text, MAX_TEXT),
			quote,
			prefix: text(value.prefix, CONTEXT_LENGTH),
			suffix: text(value.suffix, CONTEXT_LENGTH),
			created,
			updated: typeof value.updated === "number" ? value.updated : created,
			resolved: value.resolved === true,
		});
	}
	return notes;
}

/** Spaces folded into one, as the page's text is read. */
export function foldSpaces(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

/** A note's anchor in the page's text: where its quote is, from what the user selected. */
export function anchorAt(
	page: string,
	start: number,
	end: number,
): { quote: string; prefix: string; suffix: string } | null {
	let from = start;
	let to = end;
	while (from < to && page[from] === " ") from++;
	while (to > from && page[to - 1] === " ") to--;
	if (from >= to) return null;
	return {
		quote: page.slice(from, Math.min(to, from + MAX_QUOTE)),
		prefix: page.slice(Math.max(0, from - CONTEXT_LENGTH), from),
		suffix: page.slice(to, to + CONTEXT_LENGTH),
	};
}

/** How many characters at the end of `a` and of `b` are the same. */
function commonEnd(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
	return n;
}

function commonStart(a: string, b: string): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/**
 * Where a note's words are in the page's text (spaces folded), as
 * `[start, end)`; `null` when they cannot be found any more. The quote's
 * occurrence whose surroundings match best wins; when the quote itself
 * was edited, the text between its unchanged surroundings is taken.
 */
export function locateNote(
	page: string,
	note: Pick<LocalNote, "quote" | "prefix" | "suffix">,
): { start: number; end: number } | null {
	const { quote, prefix, suffix } = note;
	if (quote === "") return null;
	let best: { start: number; score: number } | null = null;
	for (let at = page.indexOf(quote); at !== -1; at = page.indexOf(quote, at + 1)) {
		const before = page.slice(Math.max(0, at - prefix.length), at);
		const after = page.slice(at + quote.length, at + quote.length + suffix.length);
		const score = commonEnd(before, prefix) + commonStart(after, suffix);
		if (best === null || score > best.score) best = { start: at, score };
	}
	if (best !== null) return { start: best.start, end: best.start + quote.length };

	// The words were edited: what is now between their surroundings, if that is still close in size.
	const head = prefix.slice(-Math.min(prefix.length, 16));
	const tail = suffix.slice(0, Math.min(suffix.length, 16));
	if (head.trim().length < 4 || tail.trim().length < 4) return null;
	let found: { start: number; end: number } | null = null;
	for (let at = page.indexOf(head); at !== -1; at = page.indexOf(head, at + 1)) {
		const start = at + head.length;
		const end = page.indexOf(tail, start);
		if (end === -1) break;
		const length = end - start;
		if (length < 1 || length > quote.length * 2 + 40 || length < quote.length / 3) continue;
		if (found !== null) return null;
		found = { start, end };
	}
	return found;
}

/** The note as it reads where it was found now: its quote and surroundings follow the page. */
export function reanchored(page: string, note: LocalNote, start: number, end: number): LocalNote {
	const anchor = anchorAt(page, start, end);
	if (anchor === null) return note;
	if (
		anchor.quote === note.quote &&
		anchor.prefix === note.prefix &&
		anchor.suffix === note.suffix
	) {
		return note;
	}
	return { ...note, ...anchor };
}

/** The notes in the order of the page, the ones not found last (newest first among them). */
export function noteOrder(
	notes: readonly LocalNote[],
	place: (note: LocalNote) => number | null,
): LocalNote[] {
	return [...notes].sort((a, b) => {
		const pa = place(a);
		const pb = place(b);
		if (pa === null && pb === null) return b.created - a.created;
		if (pa === null) return 1;
		if (pb === null) return -1;
		return pa - pb || a.created - b.created;
	});
}

/**
 * Where balloons go, top to bottom: each as close to its words as it can
 * be without covering the one above it.
 */
export function stackBalloons(
	wanted: readonly { readonly top: number; readonly height: number }[],
	gap: number,
	start = 0,
): number[] {
	let next = start;
	return wanted.map(({ top, height }) => {
		const y = Math.max(top, next);
		next = y + height + gap;
		return y;
	});
}
