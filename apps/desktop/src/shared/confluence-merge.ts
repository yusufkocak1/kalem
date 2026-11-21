/**
 * Merging two people's edits of one Confluence page a block at a time.
 *
 * The user opened the page at some version (the base), edited it, and on
 * saving found that someone else had saved a newer version meanwhile. Instead
 * of choosing whose page wins, the three texts are compared block by block
 * (a paragraph, a heading, a list, a table, a locked macro): a block only
 * one side changed takes that side's change; a block both changed the same
 * way is taken once; only blocks both changed differently are a conflict,
 * and each conflict is decided on its own.
 *
 * The merged text is saved on top of the newer version's storage (see
 * `exportPage`), so the other person's blocks go back as their own XML,
 * byte for byte, and only the user's changed blocks are converted.
 */
import { blockTexts, commonBlocks } from "./confluence-sync.js";

/** A run of blocks and where it came from. */
export type MergeChunk =
	/** The same on all three sides. */
	| { readonly kind: "kept"; readonly blocks: readonly string[] }
	/** Changed by the user only. */
	| { readonly kind: "yours"; readonly base: readonly string[]; readonly blocks: readonly string[] }
	/** Changed on Confluence only. */
	| {
			readonly kind: "theirs";
			readonly base: readonly string[];
			readonly blocks: readonly string[];
	  }
	/** Changed the same way on both sides. */
	| { readonly kind: "both"; readonly base: readonly string[]; readonly blocks: readonly string[] }
	/** Changed differently on both sides: someone decides. */
	| {
			readonly kind: "conflict";
			readonly base: readonly string[];
			readonly yours: readonly string[];
			readonly theirs: readonly string[];
			/** The heading the conflict is under, as written; empty before the first one. */
			readonly heading: string;
	  };

export interface BlockMerge {
	readonly chunks: readonly MergeChunk[];
	/** Places only the user changed. */
	readonly yours: number;
	/** Places only Confluence changed. */
	readonly theirs: number;
	/** Places both sides changed the same way. */
	readonly both: number;
	readonly conflicts: number;
}

/** How a conflict is decided: one side's blocks, or both, the user's first. */
export type MergeChoice = "yours" | "theirs" | "both";

/** A matching that would be slower than the page is worth; such a page is not merged. */
const MAX_PAIRS = 4_000_000;

const same = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((text, i) => text === b[i]);

/** A heading block's text without its marks; `null` for any other block. */
function headingOf(block: string): string | null {
	const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(block);
	if (atx !== null && !block.includes("\n")) return (atx[1] ?? "").trim();
	const setext = /^([^\n]+)\n {0,3}(?:=+|-+)[ \t]*$/.exec(block);
	return setext === null ? null : (setext[1] as string).trim();
}

/** A side's change: base blocks `[start, end)` replaced by `blocks`. */
interface Hunk {
	readonly start: number;
	readonly end: number;
	readonly blocks: readonly string[];
}

/** The words of a block, for telling an edited block from a new one. */
function wordsOf(block: string): string[] {
	return block.toLocaleLowerCase("tr").match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

/** How alike two blocks are, 0 to 1: the share of their words they have in common. */
function likeness(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 && b.length === 0) return 1;
	const counts = new Map<string, number>();
	for (const word of a) counts.set(word, (counts.get(word) ?? 0) + 1);
	let common = 0;
	for (const word of b) {
		const left = counts.get(word) ?? 0;
		if (left > 0) {
			common++;
			counts.set(word, left - 1);
		}
	}
	return (2 * common) / (a.length + b.length);
}

/** Below this, a block in place of another is a new block, not an edit of it. */
const EDITED = 0.3;
/** A run of changed blocks longer than this is not split up. */
const MAX_ALIGN = 400;

/**
 * Splits a change of several blocks into a change per block: each base
 * block paired with the side's block most like it, in order, so a side
 * that edited three paragraphs in a row has three changes, not one.
 * What pairs with nothing is an insertion or a deletion of its own.
 */
function split(hunk: Hunk, base: readonly string[]): Hunk[] {
	const from = base.slice(hunk.start, hunk.end);
	const to = hunk.blocks;
	const n = from.length;
	const m = to.length;
	if (n === 0 || m === 0 || (n === 1 && m === 1) || n * m > MAX_ALIGN) return [hunk];
	const a = from.map(wordsOf);
	const b = to.map(wordsOf);
	const like = a.map((words) => b.map((other) => likeness(words, other)));
	// The best total likeness of pairing from[i..] with to[j..], in order.
	const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const score = (like[i] as number[])[j] as number;
			const row = best[i] as Float64Array;
			row[j] = Math.max(
				(best[i + 1] as Float64Array)[j] as number,
				row[j + 1] as number,
				score >= EDITED ? score + ((best[i + 1] as Float64Array)[j + 1] as number) : 0,
			);
		}
	}
	const out: Hunk[] = [];
	let i = 0;
	let j = 0;
	let inserted: string[] = [];
	const flushInserted = (): void => {
		if (inserted.length > 0)
			out.push({ start: hunk.start + i, end: hunk.start + i, blocks: inserted });
		inserted = [];
	};
	while (i < n && j < m) {
		const score = (like[i] as number[])[j] as number;
		const here = (best[i] as Float64Array)[j] as number;
		if (score >= EDITED && here === score + ((best[i + 1] as Float64Array)[j + 1] as number)) {
			flushInserted();
			out.push({ start: hunk.start + i, end: hunk.start + i + 1, blocks: [to[j] as string] });
			i++;
			j++;
		} else if (here === ((best[i + 1] as Float64Array)[j] as number)) {
			flushInserted();
			out.push({ start: hunk.start + i, end: hunk.start + i + 1, blocks: [] });
			i++;
		} else {
			inserted.push(to[j] as string);
			j++;
		}
	}
	inserted.push(...to.slice(j));
	flushInserted();
	for (; i < n; i++) out.push({ start: hunk.start + i, end: hunk.start + i + 1, blocks: [] });
	return out;
}

/** Where `side` differs from `base`, in order, a block at a time where it can be told. */
function hunksOf(base: readonly string[], side: readonly string[]): Hunk[] {
	const hunks: Hunk[] = [];
	let b = 0;
	let s = 0;
	for (const [bi, si] of [...commonBlocks(base, side), [base.length, side.length] as const]) {
		if (bi > b || si > s)
			hunks.push(...split({ start: b, end: bi, blocks: side.slice(s, si) }, base));
		b = bi + 1;
		s = si + 1;
	}
	return hunks;
}

/** Whether a change touches the base range `[start, end)`: an insertion inside it, or blocks of it. */
function overlaps(hunk: Hunk, start: number, end: number): boolean {
	if (hunk.start === hunk.end && start === end) return hunk.start === start;
	return hunk.start < end && hunk.end > start;
}

/** The side's text for base blocks `[start, end)`: its changes in place, the base elsewhere. */
function sideText(
	base: readonly string[],
	hunks: readonly Hunk[],
	start: number,
	end: number,
): string[] {
	const out: string[] = [];
	let at = start;
	for (const hunk of hunks) {
		while (at < hunk.start) out.push(base[at++] as string);
		out.push(...hunk.blocks);
		at = Math.max(at, hunk.end);
	}
	while (at < end) out.push(base[at++] as string);
	return out;
}

/**
 * The three-way merge of `yours` and `theirs`, both edits of `base` (all
 * three Markdown). Changes of the two sides to different blocks never
 * conflict, even next to each other. `null` when the page is too big to compare.
 */
export function mergeBlocks(base: string, yours: string, theirs: string): BlockMerge | null {
	const b = blockTexts(base);
	const y = blockTexts(yours);
	const t = blockTexts(theirs);
	if (b.length * Math.max(y.length, t.length) > MAX_PAIRS) return null;

	type Sided = Hunk & { readonly side: "yours" | "theirs" };
	// Insertions before the change that starts at the same block.
	const all: Sided[] = [
		...hunksOf(b, y).map((hunk) => ({ ...hunk, side: "yours" as const })),
		...hunksOf(b, t).map((hunk) => ({ ...hunk, side: "theirs" as const })),
	].sort((p, q) => p.start - q.start || p.end - p.start - (q.end - q.start));

	const chunks: MergeChunk[] = [];
	let heading = "";
	const push = (chunk: MergeChunk): void => {
		const last = chunks[chunks.length - 1];
		if (chunk.kind === "kept" && last?.kind === "kept")
			(last.blocks as string[]).push(...chunk.blocks);
		else chunks.push(chunk);
		const blocks =
			chunk.kind === "conflict"
				? chunk.theirs.length > 0
					? chunk.theirs
					: chunk.yours
				: chunk.blocks;
		for (const block of blocks) heading = headingOf(block) ?? heading;
	};

	let at = 0;
	for (let i = 0; i < all.length; ) {
		// A group: changes that overlap one another, from either side.
		const group: Sided[] = [all[i++] as Sided];
		let start = (group[0] as Sided).start;
		let end = (group[0] as Sided).end;
		while (i < all.length && overlaps(all[i] as Sided, start, end)) {
			const next = all[i++] as Sided;
			group.push(next);
			start = Math.min(start, next.start);
			end = Math.max(end, next.end);
		}
		if (at < start) push({ kind: "kept", blocks: b.slice(at, start) });
		at = end;
		const from = b.slice(start, end);
		const mine = group.filter((hunk) => hunk.side === "yours");
		const others = group.filter((hunk) => hunk.side === "theirs");
		if (others.length === 0) {
			push({ kind: "yours", base: from, blocks: sideText(b, mine, start, end) });
			continue;
		}
		if (mine.length === 0) {
			push({ kind: "theirs", base: from, blocks: sideText(b, others, start, end) });
			continue;
		}
		const ours = sideText(b, mine, start, end);
		const theirsText = sideText(b, others, start, end);
		if (same(ours, theirsText)) {
			push({ kind: "both", base: from, blocks: ours });
			continue;
		}
		// What both sides wrote alike at the edges of the place is not part of the conflict.
		let lead = 0;
		while (lead < ours.length && lead < theirsText.length && ours[lead] === theirsText[lead])
			lead++;
		let tail = 0;
		while (
			tail < ours.length - lead &&
			tail < theirsText.length - lead &&
			ours[ours.length - 1 - tail] === theirsText[theirsText.length - 1 - tail]
		) {
			tail++;
		}
		if (lead > 0) push({ kind: "both", base: [], blocks: ours.slice(0, lead) });
		push({
			kind: "conflict",
			base: from,
			yours: ours.slice(lead, ours.length - tail),
			theirs: theirsText.slice(lead, theirsText.length - tail),
			heading,
		});
		if (tail > 0) push({ kind: "both", base: [], blocks: ours.slice(ours.length - tail) });
	}
	if (at < b.length) push({ kind: "kept", blocks: b.slice(at) });

	const count = (kind: MergeChunk["kind"]): number =>
		chunks.filter((chunk) => chunk.kind === kind).length;
	return {
		chunks,
		yours: count("yours"),
		theirs: count("theirs"),
		both: count("both"),
		conflicts: count("conflict"),
	};
}

/** The conflicts of a merge, in order: what `choices` are indexed by. */
export function conflictsOf(
	merge: BlockMerge,
): Extract<MergeChunk, { readonly kind: "conflict" }>[] {
	return merge.chunks.filter(
		(chunk): chunk is Extract<MergeChunk, { readonly kind: "conflict" }> =>
			chunk.kind === "conflict",
	);
}

/**
 * The merged Markdown, each conflict decided by `choices` (by its place
 * among the conflicts). `null` while a conflict is undecided.
 */
export function resolveMerge(
	merge: BlockMerge,
	choices: readonly (MergeChoice | undefined)[],
): string | null {
	const blocks: string[] = [];
	let conflict = 0;
	for (const chunk of merge.chunks) {
		if (chunk.kind !== "conflict") {
			blocks.push(...chunk.blocks);
			continue;
		}
		const choice = choices[conflict++];
		if (choice === undefined) return null;
		if (choice !== "theirs") blocks.push(...chunk.yours);
		if (choice !== "yours") blocks.push(...chunk.theirs);
	}
	return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}
