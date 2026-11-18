/**
 * Narrowing a list of loaded issues by their fields: the facets a list can
 * be filtered by (type, status, sprint…), the values each has among the
 * rows with how many, and the rows a choice of values keeps. Within a facet
 * any chosen value will do; across facets every one must match. Pure.
 */
import type { JiraIssueRow } from "./jira.js";

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

/** How many of a facet's values are chips; the rest are a "+N" away. */
export const CHIP_LIMIT = 3;

/** The values chosen, by facet; a facet with none chosen keeps every row. */
export type FacetSelection = ReadonlyMap<Facet, ReadonlySet<string>>;

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

/** Whether the row has one of the chosen values of every facet a choice was made in. */
function matches(row: JiraIssueRow, selection: FacetSelection, except: Facet | null): boolean {
	for (const [facet, chosen] of selection) {
		if (facet === except || chosen.size === 0) continue;
		if (!facetValues(row, facet).some((value) => chosen.has(value))) return false;
	}
	return true;
}

/** The rows the choice keeps. */
export function filterRows<T extends JiraIssueRow>(
	rows: readonly T[],
	selection: FacetSelection,
): T[] {
	return rows.filter((row) => matches(row, selection, null));
}

export interface FacetCount {
	readonly value: string;
	readonly count: number;
}

/**
 * A facet's values among the rows the other facets keep, with how many
 * of each: most first (ties by first seen), the empty value last. A chosen
 * value no row has any more is still there, with none.
 */
export function facetCounts(
	rows: readonly JiraIssueRow[],
	facet: Facet,
	selection: FacetSelection = new Map(),
): FacetCount[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (!matches(row, selection, facet)) continue;
		for (const value of new Set(facetValues(row, facet))) {
			// An issue always has a type and a status; one that does not is left out.
			if (value === NONE && (facet === "type" || facet === "status")) continue;
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	for (const value of selection.get(facet) ?? []) {
		if (!counts.has(value)) counts.set(value, 0);
	}
	return [...counts]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => Number(a.value === NONE) - Number(b.value === NONE) || b.count - a.count);
}

/**
 * The values shown as chips and those behind "+N": the first `limit`, and
 * any chosen value past them, so a choice is always in sight.
 */
export function splitChips(
	counts: readonly FacetCount[],
	chosen: ReadonlySet<string>,
	limit = CHIP_LIMIT,
): { readonly chips: FacetCount[]; readonly more: FacetCount[] } {
	const chips: FacetCount[] = [];
	const more: FacetCount[] = [];
	counts.forEach((entry, index) => {
		(index < limit || chosen.has(entry.value) ? chips : more).push(entry);
	});
	return { chips, more };
}

/** The facets kept from settings: known ones, each once; the defaults when nothing was kept. */
export function facetsFrom(value: unknown): Facet[] {
	if (!Array.isArray(value)) return [...DEFAULT_FACETS];
	const known = new Set<string>(FACETS);
	const facets = [
		...new Set(value.filter((item): item is Facet => typeof item === "string" && known.has(item))),
	];
	return facets;
}
