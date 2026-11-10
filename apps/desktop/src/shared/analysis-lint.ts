/**
 * The checks of an analysis document that need no model: vague words,
 * open "TBD"s, sections the template requires that are missing or empty,
 * requirement ids repeated or skipped, requirements without acceptance
 * criteria, links to headings that are not there. Instant and free: the
 * review starts with it, and the model looks for what rules cannot. Pure.
 */
import { outlineOf } from "./document-outline.js";
import type { Finding } from "./findings.js";
import type { TemplateMeta } from "./templates.js";

/** Words that promise nothing measurable, in Turkish and English. */
export const VAGUE_WORDS: readonly string[] = [
	"hızlı",
	"hızlıca",
	"yavaş",
	"kullanıcı dostu",
	"uygun şekilde",
	"uygun bir şekilde",
	"gerekirse",
	"gerektiğinde",
	"mümkün olduğunca",
	"vb.",
	"vs.",
	"esnek",
	"kolay",
	"kolayca",
	"yeterli",
	"makul",
	"sorunsuz",
	"anlık",
	"fast",
	"quick",
	"quickly",
	"user-friendly",
	"user friendly",
	"appropriate",
	"appropriately",
	"if needed",
	"if necessary",
	"as soon as possible",
	"etc.",
	"flexible",
	"easy",
	"easily",
	"sufficient",
	"reasonable",
	"seamless",
	"real-time",
];

const OPEN =
	/\b(?:TBD|TODO|TBA|FIXME|XXX)\b|\?\?+|\b(?:belirlenecek|netleşecek|sonra karar verilecek)\b/iu;

const ACCEPTANCE =
	/kabul kriter|acceptance|\bgiven\b|diyelim ki|\bwhen\b[\s\S]*\bthen\b|eğer[\s\S]*o zaman/iu;

const fold = (text: string): string => text.toLocaleLowerCase("tr");

/** GitHub's anchor for a heading: lower case, spaces to dashes, most punctuation dropped. */
export function headingAnchor(title: string): string {
	return fold(title)
		.trim()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/\s/g, "-");
}

/** A line as it can be quoted: its text after list and quote marks, exactly as written. */
function quotable(line: string): string {
	return line.replace(/^\s*(?:>\s*)*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, "").trim();
}

/** Whether a line says something: not blank, not a comment, not an empty list item or table row. */
function hasContent(line: string): boolean {
	const text = line.trim();
	if (text === "" || /^<!--[\s\S]*-->$/.test(text)) return false;
	if (/^[-*+](\s+\[[ xX]\])?\s*$/.test(text)) return false;
	if (/^\|[\s|:-]*\|$/.test(text)) return false;
	return true;
}

/** Where a line is: the heading of its part. */
function sectionAt(headings: readonly { title: string; line: number }[], line: number): string {
	let title = "";
	for (const heading of headings) {
		if (heading.line > line) break;
		title = heading.title;
	}
	return title;
}

const DEFAULT_IDS: Readonly<Record<string, string>> = { BR: "BR-", FR: "FR-", NFR: "NFR-" };

/** Runs the rules; at most `max` findings, the most important first. */
export function lintAnalysis(
	markdown: string,
	template: Pick<TemplateMeta, "required" | "ids"> | null,
	max = 80,
): Finding[] {
	const text = markdown.replace(/\r\n?/g, "\n");
	const lines = text.split("\n");
	const headings = outlineOf(text);
	const findings: Omit<Finding, "id">[] = [];
	const add = (finding: Omit<Finding, "id" | "rule">): void => {
		findings.push({ ...finding, rule: true });
	};

	// Lines in code blocks and comments are not prose.
	const prose: boolean[] = [];
	let fence = false;
	let comment = false;
	for (const line of lines) {
		if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
			fence = !fence;
			prose.push(false);
			continue;
		}
		const opens = line.includes("<!--");
		const closes = line.includes("-->");
		const inComment = comment || (opens && !closes) || /^\s*<!--.*-->\s*$/.test(line);
		if (opens && !closes) comment = true;
		if (comment && closes) comment = false;
		prose.push(!fence && !inComment);
	}

	// Required sections.
	for (const required of template?.required ?? []) {
		const wanted = fold(required.trim());
		if (wanted === "") continue;
		const found = headings.find((heading) => fold(heading.title).includes(wanted));
		if (found === undefined) {
			add({
				severity: "high",
				kind: "missing",
				section: "",
				quote: "",
				problem: `The template's section "${required}" is missing.`,
				suggestion: `## ${required}\n\n`,
				question: "",
			});
		}
	}

	// Empty sections: a heading with nothing under it before the next one.
	for (const [n, heading] of headings.entries()) {
		if (heading.level < 2) continue;
		const next = headings[n + 1];
		const until = next === undefined ? lines.length : next.line - 1;
		const body = lines.slice(heading.line, until);
		const hasChild = next !== undefined && next.level > heading.level;
		if (!hasChild && !body.some(hasContent)) {
			add({
				severity: "medium",
				kind: "missing",
				section: heading.title,
				quote: "",
				problem: `The section "${heading.title}" is empty.`,
				suggestion: "",
				question: "",
			});
		}
	}

	// Vague words and open questions, a finding per line.
	const vague = VAGUE_WORDS.map((word) => ({
		word,
		pattern: new RegExp(
			`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
			"iu",
		),
	}));
	for (const [i, line] of lines.entries()) {
		if (!prose[i] || /^\s*#/.test(line)) continue;
		const quote = quotable(line);
		if (quote === "") continue;
		const section = sectionAt(headings, i + 1);
		if (OPEN.test(line)) {
			add({
				severity: "medium",
				kind: "missing",
				section,
				quote,
				problem: "An open point (TBD, TODO, ??) is still in the text.",
				suggestion: "",
				question: "",
			});
			continue;
		}
		const words = vague.filter(({ pattern }) => pattern.test(line)).map(({ word }) => word);
		if (words.length > 0) {
			add({
				severity: "medium",
				kind: "ambiguity",
				section,
				quote,
				problem: `Not measurable: ${words.map((word) => `"${word}"`).join(", ")}.`,
				suggestion: "",
				question: "",
			});
		}
	}

	// Requirement ids: where each is defined, in a heading or at the start of an item.
	const prefixes = Object.values(
		template !== null && Object.keys(template.ids).length > 0 ? template.ids : DEFAULT_IDS,
	);
	const idPattern = new RegExp(
		`^\\s*(?:#{1,6}\\s+|[-*+]\\s+|\\d+[.)]\\s+)?(?:\\*\\*)?(${prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(\\d+)\\b`,
		"u",
	);
	const defined = new Map<string, { prefix: string; number: number; lines: number[] }>();
	for (const [i, line] of lines.entries()) {
		if (!prose[i]) continue;
		const match = idPattern.exec(line);
		if (match === null) continue;
		const prefix = match[1] as string;
		const number = Number(match[2]);
		const id = `${prefix}${match[2]}`;
		const known = defined.get(id) ?? { prefix, number, lines: [] };
		known.lines.push(i + 1);
		defined.set(id, known);
	}
	for (const [id, { lines: at }] of defined) {
		if (at.length < 2) continue;
		add({
			severity: "high",
			kind: "consistency",
			section: sectionAt(headings, at[1] as number),
			quote: quotable(lines[(at[1] as number) - 1] ?? ""),
			problem: `${id} is defined ${at.length} times (lines ${at.join(", ")}).`,
			suggestion: "",
			question: "",
		});
	}
	for (const prefix of prefixes) {
		const numbers = [...defined.values()]
			.filter((entry) => entry.prefix === prefix)
			.map((entry) => entry.number)
			.sort((a, b) => a - b);
		const last = numbers.at(-1);
		if (last === undefined) continue;
		const missing: number[] = [];
		for (let n = numbers[0] as number; n < last; n++) if (!numbers.includes(n)) missing.push(n);
		if (missing.length > 0 && missing.length <= 20) {
			add({
				severity: "low",
				kind: "consistency",
				section: "",
				quote: "",
				problem: `Ids skipped: ${missing.map((n) => `${prefix}${String(n).padStart(2, "0")}`).join(", ")}.`,
				suggestion: "",
				question: "",
			});
		}
	}

	// Functional requirements with a heading of their own need acceptance criteria.
	const functional = template?.ids.FR ?? "FR-";
	for (const [n, heading] of headings.entries()) {
		if (!heading.title.startsWith(functional)) continue;
		const next = headings.slice(n + 1).find((other) => other.level <= heading.level);
		const body = lines
			.slice(heading.line, next === undefined ? lines.length : next.line - 1)
			.join("\n");
		if (!ACCEPTANCE.test(body)) {
			add({
				severity: "high",
				kind: "testability",
				section: heading.title,
				quote: "",
				problem: `${heading.title.split(/[:\s]/)[0]} has no acceptance criteria.`,
				suggestion: "",
				question: "",
			});
		}
	}

	// Links to headings of this document.
	const anchors = new Set(headings.map((heading) => headingAnchor(heading.title)));
	for (const [i, line] of lines.entries()) {
		if (!prose[i]) continue;
		for (const match of line.matchAll(/\[([^\]]*)\]\(#([^)\s]+)\)/g)) {
			const anchor = decodeURIComponent(match[2] as string);
			if (anchors.has(fold(anchor))) continue;
			add({
				severity: "low",
				kind: "consistency",
				section: sectionAt(headings, i + 1),
				quote: match[0],
				problem: `The link goes to "#${anchor}", which no heading has.`,
				suggestion: "",
				question: "",
			});
		}
	}

	const order = { high: 0, medium: 1, low: 2 } as const;
	return findings
		.sort((a, b) => order[a.severity] - order[b.severity])
		.slice(0, max)
		.map((finding, index) => ({ ...finding, id: `L-${String(index + 1).padStart(2, "0")}` }));
}

/** Findings as the model reads them, one a line. */
export function findingsText(findings: readonly Finding[]): string {
	if (findings.length === 0) return "The rules found nothing.";
	return findings
		.map(
			(finding) =>
				`${finding.id} [${finding.severity}, ${finding.kind}]${finding.section === "" ? "" : ` in "${finding.section}"`}: ${finding.problem}${finding.quote === "" ? "" : ` Quote: "${finding.quote}"`}`,
		)
		.join("\n");
}
