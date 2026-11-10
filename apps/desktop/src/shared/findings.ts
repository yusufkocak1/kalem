/**
 * A problem a review found in an analysis document: where it is (a quote
 * and the section), why it is a problem, and what would fix it. Rules find
 * some (`analysis-lint.ts`), the model the others. Pure.
 */

export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_KINDS = [
	"ambiguity",
	"missing",
	"contradiction",
	"testability",
	"consistency",
	"security",
	"code",
	"other",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export interface Finding {
	readonly id: string;
	readonly severity: Severity;
	readonly kind: FindingKind;
	/** The heading of the part it is in; empty for the whole document. */
	readonly section: string;
	/** Text copied exactly from the document; empty when it is about something missing. */
	readonly quote: string;
	readonly problem: string;
	/** The text that would fix it, ready to put in place of the quote; empty when there is none. */
	readonly suggestion: string;
	/** What to ask the business, when the answer must come from them. */
	readonly question: string;
	/** Found by a rule, not by the model. */
	readonly rule?: boolean;
}

const text = (value: unknown, max: number): string =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

/** One finding as a model or a window sends it; `null` when it says nothing. */
export function parseFinding(raw: unknown, index: number): Finding | null {
	if (typeof raw !== "object" || raw === null) return null;
	const item = raw as Record<string, unknown>;
	const problem = text(item.problem, 2000);
	if (problem === "") return null;
	const severity = SEVERITIES.includes(item.severity as Severity)
		? (item.severity as Severity)
		: "medium";
	const kind = FINDING_KINDS.includes(item.kind as FindingKind)
		? (item.kind as FindingKind)
		: "other";
	const id = text(item.id, 20) || `F-${String(index + 1).padStart(2, "0")}`;
	return {
		id,
		severity,
		kind,
		section: text(item.section, 300),
		quote: typeof item.quote === "string" ? item.quote.slice(0, 4000) : "",
		problem,
		suggestion: typeof item.suggestion === "string" ? item.suggestion.slice(0, 8000) : "",
		question: text(item.question, 2000),
		...(item.rule === true ? { rule: true } : {}),
	};
}

export function parseFindings(raw: unknown): Finding[] {
	return (Array.isArray(raw) ? raw : [])
		.slice(0, 200)
		.map(parseFinding)
		.filter((finding): finding is Finding => finding !== null);
}

/** How ready the document is for development, 0-100: high findings weigh most. */
export function readiness(findings: readonly Finding[]): number {
	const weight: Readonly<Record<Severity, number>> = { high: 12, medium: 5, low: 2 };
	const lost = findings.reduce((sum, finding) => sum + weight[finding.severity], 0);
	return Math.max(0, 100 - lost);
}

/** A finding as a line under the document's open questions. */
export function questionLine(finding: Finding): string {
	const ask = finding.question || finding.problem;
	const where = finding.section === "" ? "" : ` (${finding.section})`;
	return `- [ ] ${finding.id}: ${ask}${where}`;
}

/** A finding as a note under the paragraph it is about: an info panel Confluence shows too. */
export function noteBlock(finding: Finding, label: string): string {
	const lines = [`📝 **${label} ${finding.id}:** ${finding.problem}`];
	if (finding.suggestion !== "") lines.push(`→ ${finding.suggestion}`);
	if (finding.question !== "") lines.push(`? ${finding.question}`);
	return lines.map((line) => `> ${line}`).join("\n>\n");
}

const QUESTION_HEADINGS =
	/^(#{1,6})\s+(?:açık sorular|acik sorular|open questions|sorular|questions)\b.*$/imu;

/**
 * The document with a line added at the end of its open questions'
 * section; a section is made at the end when there is none.
 */
export function addToQuestions(
	markdown: string,
	line: string,
	heading: string,
	named = "",
): string {
	const text = markdown.replace(/\r\n?/g, "\n");
	const lines = text.split("\n");
	const wanted = named.trim().toLocaleLowerCase("tr");
	const at = lines.findIndex((candidate) => {
		const title = /^(#{1,6})\s+(.*)$/.exec(candidate);
		if (title === null) return false;
		const name = (title[2] as string).trim().toLocaleLowerCase("tr");
		return wanted !== "" ? name === wanted : QUESTION_HEADINGS.test(candidate);
	});
	if (at === -1) return `${text.replace(/\n+$/, "")}\n\n## ${heading}\n\n${line}\n`;
	const level = (/^(#{1,6})/.exec(lines[at] as string)?.[1] ?? "#").length;
	let end = lines.length;
	for (let i = at + 1; i < lines.length; i++) {
		const next = /^(#{1,6})\s/.exec(lines[i] as string);
		if (next !== null && (next[1] as string).length <= level) {
			end = i;
			break;
		}
	}
	// After the section's last line with something on it; an empty "- [ ]" placeholder is replaced.
	let last = end - 1;
	while (last > at && (lines[last] as string).trim() === "") last--;
	if (/^\s*[-*+]\s+\[ \]\s*$/.test(lines[last] as string)) {
		lines[last] = line;
		return lines.join("\n");
	}
	lines.splice(last + 1, 0, ...(last === at ? ["", line] : [line]));
	return lines.join("\n");
}

/** The document with a note after the paragraph that has the quote; `null` when it is not there. */
export function withNoteAfter(markdown: string, quote: string, note: string): string | null {
	const text = markdown.replace(/\r\n?/g, "\n");
	const at = quote === "" ? -1 : text.indexOf(quote);
	if (at === -1) return null;
	const blank = text.indexOf("\n\n", at + quote.length);
	const end = blank === -1 ? text.replace(/\n+$/, "").length : blank;
	return `${text.slice(0, end)}\n\n${note}${text.slice(end) === "" ? "\n" : text.slice(end)}`;
}
