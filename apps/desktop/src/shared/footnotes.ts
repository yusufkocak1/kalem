import type { Block, Frontmatter, Inline, Root } from "@kalem-editor/core";

/**
 * GFM footnotes (`text[^1]` and `[^1]: note`) as Kalem's parser sees them.
 * It has no footnote syntax: a reference is a shortcut link reference
 * labelled `^1` (or plain text when it comes from elsewhere), and a
 * definition is a paragraph opening with such a reference and a colon — or,
 * when the note is a single word, a link reference definition. Exports
 * turn them into real footnotes; the editor keeps the text as written.
 */

const DEFINITION_START = /^\[\^([^\]\s]+)\]:[ \t]*/;
const REFERENCE = /\[\^([^\]\s]+)\]/g;

export interface Footnotes {
	/** Note content by label. */
	readonly notes: ReadonlyMap<string, readonly Inline[]>;
	/** Labels in footnote number order: by first reference, unreferenced notes last. */
	readonly order: readonly string[];
}

/** `^1` → `1` for a reference written `[^1]`. */
function referenceName(node: Inline | undefined): string | null {
	if (node?.type !== "linkReference" || node.syntax?.referenceType !== "shortcut") return null;
	return /^\^[^\]\s]+$/.test(node.label) ? node.label.slice(1) : null;
}

/** The label a definition block defines, or `null` for any other block. */
export function footnoteDefinitionLabel(block: Block | Frontmatter): string | null {
	if (block.type === "definition") return block.label.startsWith("^") ? block.label.slice(1) : null;
	if (block.type !== "paragraph") return null;
	const [first, second] = block.children;
	if (first?.type === "text") return DEFINITION_START.exec(first.value)?.[1] ?? null;
	const name = referenceName(first);
	return name !== null && second?.type === "text" && second.value.startsWith(":") ? name : null;
}

function definitionContent(block: Block | Frontmatter): Inline[] {
	if (block.type === "definition") {
		const text = block.title === null ? block.url : `${block.url} "${block.title}"`;
		return [{ type: "text", value: text }];
	}
	if (block.type !== "paragraph") return [];
	const [first, second, ...rest] = block.children;
	// `[^1]` parsed as a reference, then `: note…`.
	if (first?.type === "linkReference" && second?.type === "text") {
		const value = second.value.replace(/^:[ \t]*/, "");
		return value === "" ? rest : [{ type: "text", value }, ...rest];
	}
	if (first?.type !== "text") return [...block.children];
	const value = first.value.replace(DEFINITION_START, "");
	const tail = second === undefined ? rest : [second, ...rest];
	return value === "" ? tail : [{ type: "text", value }, ...tail];
}

export type TextPart = string | { readonly label: string };

/** Splits text at references to the given notes. */
export function splitReferences(text: string, notes: ReadonlyMap<string, unknown>): TextPart[] {
	const parts: TextPart[] = [];
	let last = 0;
	for (const match of text.matchAll(REFERENCE)) {
		const label = match[1] as string;
		if (!notes.has(label)) continue;
		if (match.index > last) parts.push(text.slice(last, match.index));
		parts.push({ label });
		last = match.index + match[0].length;
	}
	if (last < text.length) parts.push(text.slice(last));
	return parts;
}

/** The label of a link reference used as a reference to one of the notes. */
export function referenceLabel(node: Inline, notes: ReadonlyMap<string, unknown>): string | null {
	const label = referenceName(node);
	return label !== null && notes.has(label) ? label : null;
}

export function collectFootnotes(doc: Root): Footnotes {
	const notes = new Map<string, Inline[]>();
	for (const block of doc.children) {
		const label = footnoteDefinitionLabel(block);
		if (label !== null && !notes.has(label)) notes.set(label, definitionContent(block));
	}

	const order: string[] = [];
	const seen = (label: string): void => {
		if (!order.includes(label)) order.push(label);
	};
	const visit = (node: { type?: string; value?: unknown; children?: readonly unknown[] }): void => {
		if (node.type === "text" && typeof node.value === "string") {
			for (const part of splitReferences(node.value, notes))
				if (typeof part !== "string") seen(part.label);
			return;
		}
		const label = referenceLabel(node as Inline, notes);
		if (label !== null) {
			seen(label);
			return;
		}
		for (const child of node.children ?? []) visit(child as typeof node);
	};
	for (const block of doc.children) if (footnoteDefinitionLabel(block) === null) visit(block);
	for (const note of notes.values()) for (const node of note) visit(node);
	for (const label of notes.keys()) seen(label);
	return { notes, order };
}
