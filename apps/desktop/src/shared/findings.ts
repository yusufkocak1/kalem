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
