/**
 * A Markdown document's headings and parts, for the assistant to read a
 * long document a part at a time instead of all of it. Code blocks are
 * passed over: a `#` in them is not a heading. Pure.
 */

export interface OutlineEntry {
	readonly level: number;
	readonly title: string;
	/** The heading's line, from 1. */
	readonly line: number;
	/** The part's last line: before the next heading of the same or a higher level. */
	readonly end: number;
	/** Characters of the part, the heading included. */
	readonly size: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The ATX and setext headings of the document, each with the lines its part takes. */
export function outlineOf(markdown: string): OutlineEntry[] {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const found: { level: number; title: string; line: number }[] = [];
	let fence: string | null = null;
	for (const [i, line] of lines.entries()) {
		const opened = FENCE.exec(line)?.[1];
		if (fence !== null) {
			if (opened !== undefined && opened[0] === fence[0] && opened.length >= fence.length)
				fence = null;
			continue;
		}
		if (opened !== undefined) {
			fence = opened;
			continue;
		}
		const atx = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
		if (atx !== null) {
			found.push({
				level: (atx[1] as string).length,
				title: (atx[2] as string).trim(),
				line: i + 1,
			});
			continue;
		}
		const under = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
		const above = lines[i - 1];
		if (
			under !== null &&
			i > 0 &&
			above !== undefined &&
			above.trim() !== "" &&
			!/^ {0,3}([-*+>]|\d+[.)]|#)/.test(above) &&
			found.at(-1)?.line !== i
		) {
			found.push({ level: (under[1] as string)[0] === "=" ? 1 : 2, title: above.trim(), line: i });
		}
	}
	return found.map((heading, n) => {
		const next = found.slice(n + 1).find((other) => other.level <= heading.level);
		const end = next === undefined ? lines.length : next.line - 1;
		const size = lines.slice(heading.line - 1, end).join("\n").length;
		return { ...heading, end, size };
	});
}

/** The outline as the model reads it: one heading a line, indented by level. */
export function outlineText(markdown: string): string {
	const entries = outlineOf(markdown);
	const total = markdown.split("\n").length;
	if (entries.length === 0) return `No headings; ${total} lines, ${markdown.length} characters.`;
	return [
		`${total} lines, ${markdown.length} characters.`,
		...entries.map(
			(entry) =>
				`${"  ".repeat(entry.level - 1)}${"#".repeat(entry.level)} ${entry.title} (lines ${entry.line}-${entry.end}, ${entry.size} chars)`,
		),
	].join("\n");
}

const fold = (text: string): string => text.toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

/** The heading a name means: the same title, else the first whose title has it. */
export function findHeading(markdown: string, name: string): OutlineEntry | null {
	const entries = outlineOf(markdown);
	const wanted = fold(name.replace(/^#+\s*/, ""));
	return (
		entries.find((entry) => fold(entry.title) === wanted) ??
		entries.find((entry) => fold(entry.title).includes(wanted)) ??
		null
	);
}

/** Lines `from` to `to` of the document, with what they are. */
export function documentLines(markdown: string, from: number, to: number): string {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const first = Math.max(1, Math.floor(from));
	const last = Math.min(lines.length, Math.floor(to));
	if (first > lines.length) return `The document has ${lines.length} lines.`;
	return `(lines ${first}-${last} of ${lines.length})\n${lines.slice(first - 1, last).join("\n")}`;
}

/** The lines that have the words, as `line: text`; at most `max`. */
export function searchDocument(markdown: string, query: string, max = 40): string {
	const wanted = fold(query);
	if (wanted === "") return "Give words to find.";
	const hits: string[] = [];
	for (const [i, line] of markdown.replace(/\r\n?/g, "\n").split("\n").entries()) {
		if (!fold(line).includes(wanted)) continue;
		hits.push(`${i + 1}: ${line.length > 300 ? `${line.slice(0, 300)}…` : line}`);
		if (hits.length >= max) break;
	}
	return hits.length === 0 ? "No line has it." : hits.join("\n");
}
