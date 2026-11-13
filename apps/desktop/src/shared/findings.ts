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
	/** A section the template requires that the document does not have: its name. */
	readonly missingSection?: string;
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
		...(typeof item.missingSection === "string" && item.missingSection.trim() !== ""
			? { missingSection: text(item.missingSection, 300) }
			: {}),
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

/** What a finding's button did to the document, so it can be taken back on its own. */
export type FindingEdit =
	| {
			readonly kind: "fixed";
			readonly quote: string;
			readonly suggestion: string;
			readonly at: number;
	  }
	| { readonly kind: "noted"; readonly note: string }
	/** A section the template requires, added at the end: its heading line. */
	| { readonly kind: "added"; readonly heading: string }
	| {
			readonly kind: "asked";
			readonly line: string;
			readonly heading: string;
			readonly madeHeading: boolean;
	  };

/**
 * The document with one finding's change taken back, the rest of the
 * document (later edits included) as it is; `null` when the change is no
 * longer there (the user took it back in the document already).
 */
export function revertFindingEdit(markdown: string, edit: FindingEdit): string | null {
	const text = markdown.replace(/\r\n?/g, "\n");
	switch (edit.kind) {
		case "fixed": {
			if (edit.suggestion === "") return null;
			// The suggestion nearest to where the quote was: the one the fix put there.
			let best = -1;
			for (
				let at = text.indexOf(edit.suggestion);
				at !== -1;
				at = text.indexOf(edit.suggestion, at + 1)
			) {
				if (best === -1 || Math.abs(at - edit.at) < Math.abs(best - edit.at)) best = at;
			}
			if (best === -1) return null;
			return text.slice(0, best) + edit.quote + text.slice(best + edit.suggestion.length);
		}
		case "noted": {
			const at = text.indexOf(edit.note);
			if (at === -1) return null;
			// The blank line before the note goes with it.
			let from = at;
			while (from > 0 && text[from - 1] === "\n") from--;
			const end = at + edit.note.length;
			const rest = text.slice(end);
			return from === 0
				? rest.replace(/^\n+/, "")
				: text.slice(0, from) + (rest === "" ? "\n" : rest);
		}
		case "added": {
			const lines = text.split("\n");
			const at = lines.indexOf(edit.heading);
			if (at === -1) return null;
			let end = at + 1;
			while (end < lines.length && !/^#{1,6}\s/.test(lines[end] as string)) {
				// Something was written in it since: it is the user's now.
				if ((lines[end] as string).trim() !== "") return null;
				end++;
			}
			let from = at;
			while (from > 0 && (lines[from - 1] as string).trim() === "") from--;
			lines.splice(from, end - from, ...(from === 0 || end === lines.length ? [] : [""]));
			const next = lines.join("\n");
			return next.endsWith("\n") || next === "" ? next : `${next}\n`;
		}
		case "asked": {
			const lines = text.split("\n");
			const at = lines.indexOf(edit.line);
			if (at === -1) return null;
			lines.splice(at, 1);
			let next = lines.join("\n");
			// A section that was made for it and has nothing left goes too.
			if (edit.madeHeading) {
				const empty = new RegExp(`\\n*#{1,6}\\s+${escapeRegExp(edit.heading)}\\s*$`, "u");
				next = next.replace(empty, "\n");
			}
			return next;
		}
	}
}

/** The heading line a missing section is added with. */
export const sectionHeading = (name: string): string => `## ${name.trim()}`;

const fold = (text: string): string => text.trim().toLocaleLowerCase("tr");

/** Whether the document has a heading for the section, as the rule checks look for it. */
export function hasSection(markdown: string, name: string): boolean {
	const wanted = fold(name);
	return markdown
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.some((line) => {
			const title = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
			return title !== undefined && fold(title).includes(wanted);
		});
}

/**
 * The document with the sections the template requires added at its end,
 * in the order given; one it has by now (the user added it) is not added again.
 */
export function withSections(markdown: string, names: readonly string[]): string {
	const text = markdown.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
	const missing = names.filter((name) => !hasSection(text, name));
	if (missing.length === 0) return text === "" ? "" : `${text}\n`;
	const added = missing.map((name) => `${sectionHeading(name)}\n`).join("\n");
	return text === "" ? added : `${text}\n\n${added}`;
}

/** Whether the document has an open questions' section already: `addToQuestions` then makes none. */
export function hasQuestions(markdown: string): boolean {
	return QUESTION_HEADINGS.test(markdown.replace(/\r\n?/g, "\n"));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
