/**
 * The assistant's change to a document, for the user to accept or reject
 * a part at a time: the document before and after are cut into their
 * top-level blocks, the blocks that differ are grouped into changes, and
 * the document is put together again from each change's side the user
 * chose. In a run of blocks that differ, each rewritten block is paired with
 * the one it most looks like, so each paragraph can be kept or taken back on
 * its own; what was only put in or taken out is a change of its own. Pure.
 */
import { parse } from "@kalem-editor/core";
import { parseDirective } from "./table-style.js";

/** A top-level block as written, with the blank lines after it. */
export interface Chunk {
	readonly text: string;
	/** What is compared: the block without the lines after it. */
	readonly key: string;
	/** Whether the editor shows it as a block (a table's style comment it does not). */
	readonly block: boolean;
}

/** The document cut into its blocks; joined, they are the document again, byte for byte. */
export function chunksOf(markdown: string): Chunk[] {
	const text = markdown.replace(/\r\n?/g, "\n");
	const blocks = parse(text).children;
	const chunks: Chunk[] = [];
	for (const [i, block] of blocks.entries()) {
		const from = i === 0 ? 0 : (block.position?.start.offset ?? 0);
		const next = blocks[i + 1];
		const to = next === undefined ? text.length : (next.position?.start.offset ?? text.length);
		const piece = text.slice(from, to);
		const style =
			block.type === "html" && next?.type === "table" && parseDirective(block.value) !== null;
		chunks.push({ text: piece, key: piece.replace(/\s+$/, ""), block: !style });
	}
	// Text with no block (blank lines only) is kept as it is.
	if (chunks.length === 0 && text !== "") chunks.push({ text, key: "", block: false });
	return chunks;
}

/** One change: the blocks it took out of the document, and those it put in. */
export interface ReviewChange {
	readonly id: number;
	/** Indexes into the review's `before`. */
	readonly removed: readonly number[];
	/** Indexes into the review's `after`. */
	readonly added: readonly number[];
}

type Step =
	| { readonly kind: "same"; readonly after: number }
	| { readonly kind: "change"; readonly change: number };

export interface EditReview {
	readonly before: readonly Chunk[];
	readonly after: readonly Chunk[];
	readonly changes: readonly ReviewChange[];
	readonly steps: readonly Step[];
}

/** The longest run of items the two have in common, in order, as pairs of their indexes: what no change touched. */
export function common(a: readonly string[], b: readonly string[]): [number, number][] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const n = endA - start;
	const m = endB - start;
	// The longest common run of a[start+i..] and b[start+j..], at i * (m + 1) + j.
	const width = m + 1;
	const lengths = new Uint32Array((n + 1) * width);
	const at = (i: number, j: number): number => lengths[i * width + j] as number;
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lengths[i * width + j] =
				a[start + i] === b[start + j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
		}
	}
	const pairs: [number, number][] = [];
	for (let i = 0; i < start; i++) pairs.push([i, i]);
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[start + i] === b[start + j]) {
			pairs.push([start + i, start + j]);
			i++;
			j++;
		} else if (at(i + 1, j) >= at(i, j + 1)) i++;
		else j++;
	}
	for (let k = 0; k < a.length - endA; k++) pairs.push([endA + k, endB + k]);
	return pairs;
}

/** The words of a block, for telling how alike two are. */
const words = (text: string): Set<string> =>
	new Set(
		text
			.toLocaleLowerCase("tr")
			.split(/[^\p{L}\p{N}]+/u)
			.filter((word) => word !== ""),
	);

/** How alike two blocks are, 0 to 1: the words they share of all their words. */
export function likeness(a: string, b: string): number {
	const one = words(a);
	const two = words(b);
	if (one.size === 0 && two.size === 0) return a.trim() === b.trim() ? 1 : 0;
	let shared = 0;
	for (const word of one) if (two.has(word)) shared++;
	return shared / (one.size + two.size - shared);
}

/** At least this alike, a block put in is taken for a rewrite of one taken out. */
const ALIKE = 0.3;

/** Pairs blocks taken out with blocks put in, in order, each with the most alike one left after the last pair. */
function pairBlocks(removed: readonly string[], added: readonly string[]): [number, number][] {
	const pairs: [number, number][] = [];
	let from = 0;
	for (const [r, text] of removed.entries()) {
		let best = -1;
		let score = ALIKE;
		for (let a = from; a < added.length; a++) {
			const alike = likeness(text, added[a] as string);
			if (alike >= score) {
				best = a;
				score = alike;
			}
		}
		if (best === -1) continue;
		pairs.push([r, best]);
		from = best + 1;
	}
	return pairs;
}

/** The changes between a document and the assistant's version of it. */
export function reviewEdit(before: string, after: string): EditReview {
	const was = chunksOf(before);
	const now = chunksOf(after);
	const pairs = common(
		was.map((chunk) => chunk.key),
		now.map((chunk) => chunk.key),
	);
	const changes: ReviewChange[] = [];
	const steps: Step[] = [];
	const push = (removed: readonly number[], added: readonly number[]): void => {
		if (removed.length === 0 && added.length === 0) return;
		changes.push({ id: changes.length, removed, added });
		steps.push({ kind: "change", change: changes.length - 1 });
	};
	/**
	 * A run of blocks that differ: each block taken out is paired, in order,
	 * with the block put in that is most like it, so a rewritten paragraph is a
	 * change of its own; what is left over is put in or taken out on its own.
	 */
	const change = (removed: number[], added: number[]): void => {
		const pairs = pairBlocks(
			removed.map((index) => (was[index] as Chunk).key),
			added.map((index) => (now[index] as Chunk).key),
		);
		let r = 0;
		let a = 0;
		for (const [pr, pa] of [...pairs, [removed.length, added.length] as [number, number]]) {
			// Taken out and put in between two pairs: one change, as it was.
			push(removed.slice(r, pr), added.slice(a, pa));
			if (pr < removed.length && pa < added.length) {
				push([removed[pr] as number], [added[pa] as number]);
				r = pr + 1;
				a = pa + 1;
			}
		}
	};
	let i = 0;
	let j = 0;
	for (const [a, b] of [...pairs, [was.length, now.length] as [number, number]]) {
		const removed: number[] = [];
		const added: number[] = [];
		for (; i < a; i++) removed.push(i);
		for (; j < b; j++) added.push(j);
		change(removed, added);
		if (a < was.length && b < now.length) {
			steps.push({ kind: "same", after: b });
			i = a + 1;
			j = b + 1;
		}
	}
	return { before: was, after: now, changes, steps };
}

/** What the user decided about a change; one not decided yet stays as the assistant wrote it. */
export type ChangeDecision = "pending" | "accepted" | "rejected";

/** A change still to be decided, where the editor shows it. */
export interface PendingChange {
	readonly id: number;
	/** The editor's blocks it put in (their indexes in the document as put together). */
	readonly blocks: readonly number[];
	/** The block it took text out before, when it only took text out; `null` at the end. */
	readonly before: number | null;
	/** What it took out, as written. */
	readonly removed: string;
	/** What it put in, as written. */
	readonly added: string;
}

/**
 * The document with each change as the user decided: a rejected one as it
 * was, the others as the assistant wrote them; and the changes still to be
 * decided, with the editor blocks each is at.
 */
export function composeReview(
	review: EditReview,
	decisions: ReadonlyMap<number, ChangeDecision>,
): { readonly text: string; readonly pending: readonly PendingChange[] } {
	let text = "";
	let blocks = 0;
	const pending: PendingChange[] = [];
	const deletions: { id: number; removed: string; at: number }[] = [];
	let side: "before" | "after" = "after";
	const put = (chunk: Chunk, from: "before" | "after" = "after"): number | null => {
		// Blocks from the two sides next to each other: a blank line between them, so they stay two.
		if (from !== side && text !== "" && chunk.text !== "" && !text.endsWith("\n\n")) {
			text += text.endsWith("\n") ? "\n" : "\n\n";
		}
		side = from;
		text += chunk.text;
		if (!chunk.block) return null;
		blocks++;
		return blocks - 1;
	};
	for (const step of review.steps) {
		if (step.kind === "same") {
			put(review.after[step.after] as Chunk);
			continue;
		}
		const change = review.changes[step.change] as ReviewChange;
		const decision = decisions.get(change.id) ?? "pending";
		const removed = change.removed.map((index) => (review.before[index] as Chunk).text).join("");
		if (decision === "rejected") {
			for (const index of change.removed) put(review.before[index] as Chunk, "before");
			continue;
		}
		const at: number[] = [];
		for (const index of change.added) {
			const block = put(review.after[index] as Chunk);
			if (block !== null) at.push(block);
		}
		if (decision !== "pending") continue;
		const added = change.added.map((index) => (review.after[index] as Chunk).text).join("");
		if (at.length === 0) deletions.push({ id: change.id, removed, at: blocks });
		else pending.push({ id: change.id, blocks: at, before: null, removed, added });
	}
	for (const deletion of deletions) {
		pending.push({
			id: deletion.id,
			blocks: [],
			before: deletion.at < blocks ? deletion.at : null,
			removed: deletion.removed,
			added: "",
		});
	}
	pending.sort((a, b) => a.id - b.id);
	return { text, pending };
}

/** A run of lines that differ in a file: the old lines it takes out, the new ones it puts in. */
export interface LineChange {
	readonly id: number;
	readonly removed: readonly string[];
	readonly added: readonly string[];
}

/** A file's text as lines, each the same or a change, in order. */
export type LineStep =
	| { readonly kind: "same"; readonly text: string; readonly old: number; readonly new: number }
	| { readonly kind: "change"; readonly change: LineChange };

/** The changes between two texts, a run of lines each, with the lines between them. */
export function lineReview(before: string, after: string): LineStep[] {
	const a = before.replace(/\r\n?/g, "\n").split("\n");
	const b = after.replace(/\r\n?/g, "\n").split("\n");
	const steps: LineStep[] = [];
	let i = 0;
	let j = 0;
	let id = 0;
	for (const [x, y] of [...common(a, b), [a.length, b.length] as [number, number]]) {
		if (i < x || j < y) {
			steps.push({
				kind: "change",
				change: { id: id++, removed: a.slice(i, x), added: b.slice(j, y) },
			});
		}
		if (x < a.length && y < b.length) {
			steps.push({ kind: "same", text: a[x] as string, old: x + 1, new: y + 1 });
			i = x + 1;
			j = y + 1;
		}
	}
	return steps;
}

/** The text with each change as decided: a rejected one as it was, the others as proposed. */
export function composeLines(
	steps: readonly LineStep[],
	decisions: ReadonlyMap<number, ChangeDecision>,
): string {
	const lines: string[] = [];
	for (const step of steps) {
		if (step.kind === "same") lines.push(step.text);
		else if (decisions.get(step.change.id) === "rejected") lines.push(...step.change.removed);
		else lines.push(...step.change.added);
	}
	return lines.join("\n");
}

/**
 * A file's text with the changes the assistant proposed to it applied in
 * order, each in place of the text it names; `null` when one's text is not
 * there (the file changed since).
 */
export function applyProposals(
	text: string,
	proposals: readonly { readonly oldText: string; readonly newText: string }[],
): string | null {
	let result = text.replace(/\r\n?/g, "\n");
	for (const proposal of proposals) {
		const from = proposal.oldText.replace(/\r\n?/g, "\n");
		const to = proposal.newText.replace(/\r\n?/g, "\n");
		if (from === "") {
			result = to;
			continue;
		}
		const at = result.indexOf(from);
		if (at === -1) return null;
		result = `${result.slice(0, at)}${to}${result.slice(at + from.length)}`;
	}
	return result;
}
