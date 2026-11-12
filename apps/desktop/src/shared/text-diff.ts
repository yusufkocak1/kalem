/**
 * A line diff of two texts, cut into hunks as `git diff` shows them: the
 * lines that changed with a few unchanged ones around them. A hunk can be
 * put back on its own, so the user can keep one change and drop another.
 * Within a changed line pair, the words that differ are found too. Pure.
 */

export type DiffKind = " " | "-" | "+";

export interface DiffRow {
	readonly kind: DiffKind;
	readonly text: string;
	/** Its number in the old text (1-based); `null` for an added line. */
	readonly oldLine: number | null;
	/** Its number in the new text (1-based); `null` for a removed line. */
	readonly newLine: number | null;
}

export interface DiffHunk {
	/** Where it starts in the old text (0-based) and how many old lines it covers. */
	readonly oldStart: number;
	readonly oldCount: number;
	/** The same in the new text. */
	readonly newStart: number;
	readonly newCount: number;
	readonly rows: readonly DiffRow[];
	/** The nearest Markdown heading above it in the new text, as `git diff` names a function. */
	readonly heading: string;
}

export interface TextDiff {
	readonly hunks: readonly DiffHunk[];
	readonly added: number;
	readonly removed: number;
}

const lines = (text: string): string[] => {
	const normal = text.replace(/\r\n?/g, "\n");
	if (normal === "") return [];
	return (normal.endsWith("\n") ? normal.slice(0, -1) : normal).split("\n");
};

/**
 * The shortest edit script between two sequences (Myers' O(ND) algorithm),
 * as each element's kind in order.
 */
export function diffSequence<T>(a: readonly T[], b: readonly T[]): DiffKind[] {
	// The common start and end are cut off first: most edits are small.
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
	const middle: DiffKind[] = [];
	if (n === 0) for (let i = 0; i < m; i++) middle.push("+");
	else if (m === 0) for (let i = 0; i < n; i++) middle.push("-");
	else middle.push(...myers(a, b, start, n, m));
	return [
		...Array<DiffKind>(start).fill(" "),
		...middle,
		...Array<DiffKind>(a.length - endA).fill(" "),
	];
}

function myers<T>(
	a: readonly T[],
	b: readonly T[],
	from: number,
	n: number,
	m: number,
): DiffKind[] {
	const max = n + m;
	const offset = max;
	const v = new Int32Array(2 * max + 2);
	const trace: Int32Array[] = [];
	let found = false;
	for (let d = 0; d <= max && !found; d++) {
		trace.push(v.slice());
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))
					? (v[offset + k + 1] as number)
					: (v[offset + k - 1] as number) + 1;
			let y = x - k;
			while (x < n && y < m && a[from + x] === b[from + y]) {
				x++;
				y++;
			}
			v[offset + k] = x;
			if (x >= n && y >= m) {
				found = true;
				break;
			}
		}
	}
	// Back from the end, through the saved frontiers.
	const out: DiffKind[] = [];
	let x = n;
	let y = m;
	for (let d = trace.length - 1; d > 0; d--) {
		const frontier = trace[d] as Int32Array;
		const k = x - y;
		const down =
			k === -d ||
			(k !== d && (frontier[offset + k - 1] as number) < (frontier[offset + k + 1] as number));
		const prevK = down ? k + 1 : k - 1;
		const prevX = frontier[offset + prevK] as number;
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			out.push(" ");
			x--;
			y--;
		}
		out.push(down ? "+" : "-");
		x = prevX;
		y = prevY;
	}
	while (x > 0 && y > 0) {
		out.push(" ");
		x--;
		y--;
	}
	return out.reverse();
}

const HEADING = /^#{1,6}\s+(.*)$/;

/** How `after` differs from `before`, line by line, in hunks with `context` lines around each change. */
export function diffText(before: string, after: string, context = 3): TextDiff {
	const a = lines(before);
	const b = lines(after);
	const kinds = diffSequence(a, b);
	const rows: DiffRow[] = [];
	let i = 0;
	let j = 0;
	let added = 0;
	let removed = 0;
	for (const kind of kinds) {
		if (kind === " ") {
			rows.push({ kind, text: b[j] as string, oldLine: i + 1, newLine: j + 1 });
			i++;
			j++;
		} else if (kind === "-") {
			rows.push({ kind, text: a[i] as string, oldLine: i + 1, newLine: null });
			i++;
			removed++;
		} else {
			rows.push({ kind, text: b[j] as string, oldLine: null, newLine: j + 1 });
			j++;
			added++;
		}
	}
	// Changed rows, widened by the context; ranges that touch are one hunk.
	const ranges: [number, number][] = [];
	rows.forEach((row, index) => {
		if (row.kind === " ") return;
		const from = Math.max(0, index - context);
		const to = Math.min(rows.length, index + context + 1);
		const last = ranges[ranges.length - 1];
		if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
		else ranges.push([from, to]);
	});
	const hunks = ranges.map(([from, to]): DiffHunk => {
		const slice = rows.slice(from, to);
		const first = slice[0] as DiffRow;
		// Lines before the hunk, in each text.
		let oldStart = 0;
		let newStart = 0;
		for (const row of rows.slice(0, from)) {
			if (row.kind !== "+") oldStart++;
			if (row.kind !== "-") newStart++;
		}
		let heading = "";
		for (let line = (first.newLine ?? newStart + 1) - 1; line >= 0; line--) {
			const match = HEADING.exec(b[line] ?? "");
			if (match !== null) {
				heading = (match[1] as string).trim();
				break;
			}
		}
		return {
			oldStart,
			oldCount: slice.filter((row) => row.kind !== "+").length,
			newStart,
			newCount: slice.filter((row) => row.kind !== "-").length,
			rows: slice,
			heading,
		};
	});
	return { hunks, added, removed };
}

/**
 * `after` with one of its hunks (from `diffText(before, after)`) put back
 * as it was in `before`; the other changes stay.
 */
export function revertHunk(after: string, hunk: DiffHunk): string {
	const b = lines(after);
	const old = hunk.rows.filter((row) => row.kind !== "+").map((row) => row.text);
	b.splice(hunk.newStart, hunk.newCount, ...old);
	const text = b.join("\n");
	return text === "" ? "" : `${text}\n`;
}

export interface WordPart {
	readonly text: string;
	readonly changed: boolean;
}

const WORDS = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

/** Two versions of a line, each cut into parts, the parts that differ marked. */
export function wordDiff(before: string, after: string): { before: WordPart[]; after: WordPart[] } {
	const a = before.match(WORDS) ?? [];
	const b = after.match(WORDS) ?? [];
	const kinds = diffSequence(a, b);
	const left: WordPart[] = [];
	const right: WordPart[] = [];
	const push = (parts: WordPart[], text: string, changed: boolean): void => {
		const last = parts[parts.length - 1];
		if (last !== undefined && last.changed === changed) {
			parts[parts.length - 1] = { text: last.text + text, changed };
		} else parts.push({ text, changed });
	};
	let i = 0;
	let j = 0;
	for (const kind of kinds) {
		if (kind === " ") {
			push(left, a[i++] as string, false);
			push(right, b[j++] as string, false);
		} else if (kind === "-") push(left, a[i++] as string, true);
		else push(right, b[j++] as string, true);
	}
	return { before: left, after: right };
}

/**
 * The rows of a hunk with each run of removed lines paired with the added
 * lines that follow it, one to one: these are the lines to compare word by word.
 */
export function pairedRows(rows: readonly DiffRow[]): Map<DiffRow, DiffRow> {
	const pairs = new Map<DiffRow, DiffRow>();
	for (let index = 0; index < rows.length; ) {
		if ((rows[index] as DiffRow).kind !== "-") {
			index++;
			continue;
		}
		const removed: DiffRow[] = [];
		while (index < rows.length && (rows[index] as DiffRow).kind === "-")
			removed.push(rows[index++] as DiffRow);
		const added: DiffRow[] = [];
		while (index < rows.length && (rows[index] as DiffRow).kind === "+")
			added.push(rows[index++] as DiffRow);
		for (let k = 0; k < Math.min(removed.length, added.length); k++) {
			pairs.set(removed[k] as DiffRow, added[k] as DiffRow);
			pairs.set(added[k] as DiffRow, removed[k] as DiffRow);
		}
	}
	return pairs;
}
