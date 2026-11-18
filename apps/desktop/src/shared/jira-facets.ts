/**
 * The Jira list's filters, one model for all of them: quick conditions
 * (assigned to me, unresolved, in an open sprint…) and the values of
 * facets (type, status, sprint…) chosen as chips. Every filter can be taken
 * away, and together they are the JQL the list is asked for: within a
 * facet any chosen value will do, across filters every one must match.
 * The chips' values are those seen in the answers so far. Pure.
 */
import type { JiraIssueRow } from "./jira.js";
import { issueKey, issueKeyFromUrl, searchJql } from "./jira.js";

export const FACETS = [
	"type",
	"status",
	"sprint",
	"assignee",
	"priority",
	"project",
	"label",
] as const;
export type Facet = (typeof FACETS)[number];

/** The facets a list starts with. */
export const DEFAULT_FACETS: readonly Facet[] = ["type"];

/** The quick conditions, most used first: the first ones are chips, the rest a "+N" away. */
export const CONDITIONS = [
	"mine",
	"unresolved",
	"openSprints",
	"reported",
	"watching",
	"favorites",
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** What a list starts with: the user's own open issues. */
export const DEFAULT_CONDITIONS: readonly Condition[] = ["mine", "unresolved"];

/** The conditions as JQL; the starred issues are asked for by their keys. */
const CONDITION_JQL: Readonly<Record<Exclude<Condition, "favorites">, string>> = {
	mine: "assignee = currentUser()",
	unresolved: "resolution = Unresolved",
	openSprints: "sprint in openSprints()",
	reported: "reporter = currentUser()",
	watching: "watcher = currentUser()",
};

/** How many of a row's values are chips; the rest are a "+N" away. */
export const CHIP_LIMIT = 3;

/** `""` is the empty value: no sprint, unassigned, no label. */
export const NONE = "";

/** A facet's values on a row (a label facet can have several). */
export function facetValues(row: JiraIssueRow, facet: Facet): readonly string[] {
	switch (facet) {
		case "type":
			return [row.type];
		case "status":
			return [row.status];
		case "sprint":
			return [row.sprintName ?? NONE];
		case "assignee":
			return [row.assignee];
		case "priority":
			return [row.priority];
		case "project":
			return [row.key.replace(/-\d+$/, "")];
		case "label":
			return row.labels === undefined || row.labels.length === 0 ? [NONE] : row.labels;
	}
}

export interface FacetCount {
	readonly value: string;
	readonly count: number;
}

const sortCounts = (counts: FacetCount[]): FacetCount[] =>
	counts.sort((a, b) => Number(a.value === NONE) - Number(b.value === NONE) || b.count - a.count);

/** A facet's values among the rows, with how many of each: most first (ties by first seen), the empty value last. */
export function facetCounts(rows: readonly JiraIssueRow[], facet: Facet): FacetCount[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		for (const value of new Set(facetValues(row, facet))) {
			// An issue always has a type and a status; one that does not is left out.
			if (value === NONE && (facet === "type" || facet === "status")) continue;
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	return sortCounts([...counts].map(([value, count]) => ({ value, count })));
}

/**
 * The values a facet's chips offer: those of the rows now, with how many,
 * then those seen in earlier answers and any chosen one (none now: a
 * filter left them out); the empty value last.
 */
export function facetChoices(
	now: readonly FacetCount[],
	seen: Iterable<string>,
	chosen: ReadonlySet<string>,
): FacetCount[] {
	const counts = new Map(now.map((entry) => [entry.value, entry.count]));
	for (const value of [...seen, ...chosen]) if (!counts.has(value)) counts.set(value, 0);
	return sortCounts([...counts].map(([value, count]) => ({ value, count })));
}

/**
 * The values shown as chips and those behind "+N": the first `limit`, and
 * any chosen value past them, so a choice is always in sight.
 */
export function splitChips<T extends string | { readonly value: string }>(
	values: readonly T[],
	chosen: ReadonlySet<string>,
	limit = CHIP_LIMIT,
): { readonly chips: T[]; readonly more: T[] } {
	const chips: T[] = [];
	const more: T[] = [];
	values.forEach((entry, index) => {
		const value = typeof entry === "string" ? entry : entry.value;
		(index < limit || chosen.has(value) ? chips : more).push(entry);
	});
	return { chips, more };
}

const FIELDS: Readonly<Record<Facet, string>> = {
	type: "issuetype",
	status: "status",
	sprint: "sprint",
	assignee: "assignee",
	priority: "priority",
	project: "project",
	label: "labels",
};

const quote = (text: string): string => `"${text.replace(/["\\]/g, "\\$&")}"`;

/**
 * A facet's chosen values as JQL: any of them, the empty value as `is
 * EMPTY`; `null` when none is chosen. `idOf` gives a person's id
 * (username or account id) by the name the list shows.
 */
export function facetJql(
	facet: Facet,
	values: Iterable<string>,
	idOf: (name: string) => string | undefined = () => undefined,
): string | null {
	const all = [...values];
	const field = FIELDS[facet];
	const named = all
		.filter((value) => value !== NONE)
		.map((value) => quote(facet === "assignee" ? (idOf(value) ?? value) : value));
	const parts = [
		...(named.length === 0 ? [] : [`${field} in (${named.join(", ")})`]),
		...(all.includes(NONE) ? [`${field} is EMPTY`] : []),
	];
	if (parts.length === 0) return null;
	return parts.length === 1 ? (parts[0] as string) : `(${parts.join(" OR ")})`;
}

/** A condition as JQL; the starred issues by their keys (`null` when none is starred). */
export function conditionJql(
	condition: Condition,
	favorites: readonly string[] = [],
): string | null {
	if (condition !== "favorites") return CONDITION_JQL[condition];
	return favorites.length === 0 ? null : `key in (${favorites.join(", ")})`;
}

/**
 * The JQL the list is asked for: the search box's words (or its JQL) and
 * every filter. An issue key or address typed is that issue, whatever the
 * filters. Nothing at all is the latest issues.
 */
export function composeJql(filters: readonly string[], typed: string): string {
	const text = typed.trim();
	const key = issueKey(text) ?? issueKeyFromUrl(text);
	if (key !== null) return `key = ${key}`;
	let body = text === "" ? "" : searchJql(text);
	let order = "ORDER BY updated DESC";
	const ordered = /(?:^|\s)ORDER\s+BY\s[\s\S]*$/i.exec(body);
	if (ordered !== null) {
		order = ordered[0].trim();
		body = body.slice(0, ordered.index).trim();
	}
	const clauses = [...(body === "" ? [] : [filters.length === 0 ? body : `(${body})`]), ...filters];
	return [clauses.join(" AND "), order].filter((part) => part !== "").join(" ");
}

const known = <T extends string>(all: readonly T[], value: readonly unknown[]): T[] => {
	const names = new Set<string>(all);
	return [
		...new Set(value.filter((item): item is T => typeof item === "string" && names.has(item))),
	];
};

/** The facets kept from settings: known ones, each once; the defaults when nothing was kept. */
export function facetsFrom(value: unknown): Facet[] {
	return Array.isArray(value) ? known(FACETS, value) : [...DEFAULT_FACETS];
}

/** The conditions kept from settings: known ones, each once; the defaults when nothing was kept. */
export function conditionsFrom(value: unknown): Condition[] {
	return Array.isArray(value) ? known(CONDITIONS, value) : [...DEFAULT_CONDITIONS];
}
