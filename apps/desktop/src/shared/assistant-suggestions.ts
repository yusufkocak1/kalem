import type { Strings } from "./i18n.js";
import { format } from "./i18n.js";

/** One of the empty chat's suggestions: what it says, and its icon. */
export interface Suggestion {
	readonly text: string;
	readonly icon: "file" | "diagram" | "pencil" | "table" | "target" | "check" | "code" | "new";
}

const MAX = 4;

/** Words that look like a Jira key and are not one. */
const NOT_KEYS = new Set(["UTF", "ISO", "SHA", "RFC", "AES", "TLS", "HTTP", "MD", "UTC", "GMT"]);

/** A Jira issue the document names: a `/browse/KEY` link first, else a key on its own. */
export function jiraKeyIn(markdown: string): string | null {
	const linked = /\/browse\/([A-Z][A-Z0-9]+-\d+)/.exec(markdown);
	if (linked?.[1] !== undefined) return linked[1];
	for (const found of markdown.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g)) {
		const project = found[1] ?? "";
		if (!NOT_KEYS.has(project)) return `${project}-${found[2]}`;
	}
	return null;
}

/** An analysis or a spec: headings a requirements document has. */
const ANALYSIS =
	/^#{1,6}\s.*(kabul|acceptance|gereksinim|requirement|açık sorular|open questions|kapsam|scope)/im;
/** A GFM table's delimiter row. */
const TABLE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m;
/** A fenced block of code (not a diagram or a formula). */
const CODE = /^(```|~~~)\s*(?!mermaid|math|latex|katex|tex)[a-z]+/im;

/**
 * What the empty chat suggests for the document open beside it: the things
 * only this document has first (an issue it names, the gaps of an analysis,
 * its table, its code), then the usual ones, four at most. An empty
 * document gets a way to start one.
 */
export function suggestionsFor(markdown: string, t: Strings): Suggestion[] {
	if (markdown.trim() === "") {
		return [
			{ text: t.assistantSuggestDraft, icon: "new" },
			{ text: t.assistantSuggestOutline, icon: "file" },
		];
	}
	const found: Suggestion[] = [];
	const key = jiraKeyIn(markdown);
	if (key !== null) found.push({ text: format(t.assistantSuggestJira, key), icon: "target" });
	if (ANALYSIS.test(markdown)) found.push({ text: t.assistantSuggestGaps, icon: "check" });
	if (TABLE.test(markdown)) found.push({ text: t.assistantSuggestTableCheck, icon: "table" });
	if (CODE.test(markdown)) found.push({ text: t.assistantSuggestCode, icon: "code" });
	const usual: Suggestion[] = [
		{ text: t.assistantSuggestSummary, icon: "file" },
		{ text: t.assistantSuggestDiagram, icon: "diagram" },
		{ text: t.assistantSuggestFix, icon: "pencil" },
		{ text: t.assistantSuggestTable, icon: "table" },
	];
	for (const suggestion of usual) {
		if (found.length >= MAX) break;
		// A table of the key points means little beside a table already checked.
		if (suggestion.text === t.assistantSuggestTable && TABLE.test(markdown)) continue;
		found.push(suggestion);
	}
	return found.slice(0, MAX);
}
