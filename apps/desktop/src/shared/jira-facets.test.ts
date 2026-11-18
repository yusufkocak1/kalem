import { describe, expect, it } from "vitest";
import type { JiraIssueRow } from "./jira.js";
import { issueRowOf } from "./jira.js";
import {
	DEFAULT_FACETS,
	type Facet,
	type FacetSelection,
	facetCounts,
	facetsFrom,
	facetValues,
	filterRows,
	NONE,
	splitChips,
} from "./jira-facets.js";

const row = (key: string, extra: Partial<JiraIssueRow> = {}): JiraIssueRow => ({
	key,
	summary: key,
	status: "Open",
	statusCategory: "new",
	type: "Story",
	assignee: "Ayşe",
	priority: "Medium",
	updated: null,
	parent: null,
	sprintName: "Sprint 1",
	labels: [],
	...extra,
});

const pick = (entries: [Facet, string[]][]): FacetSelection =>
	new Map(entries.map(([facet, values]) => [facet, new Set(values)]));

const rows = [
	row("QR-1"),
	row("QR-2", { type: "Bug", sprintName: "Sprint 2", labels: ["ui", "api"] }),
	row("QR-3", { type: "Bug", status: "Done", assignee: "" }),
	row("PR-4", { type: "Task", sprintName: "", labels: ["ui"] }),
];

describe("facetValues", () => {
	it("reads a row's value of each facet", () => {
		expect(facetValues(rows[1] as JiraIssueRow, "label")).toEqual(["ui", "api"]);
		expect(facetValues(rows[0] as JiraIssueRow, "label")).toEqual([NONE]);
		expect(facetValues(rows[3] as JiraIssueRow, "project")).toEqual(["PR"]);
		const { sprintName: _, ...noSprint } = row("X-1");
		expect(facetValues(noSprint, "sprint")).toEqual([NONE]);
	});
});

describe("filterRows", () => {
	it("keeps rows with any chosen value, of every facet chosen in", () => {
		const keys = (selection: FacetSelection) => filterRows(rows, selection).map((each) => each.key);
		expect(keys(pick([]))).toEqual(["QR-1", "QR-2", "QR-3", "PR-4"]);
		expect(keys(pick([["type", ["Bug", "Task"]]]))).toEqual(["QR-2", "QR-3", "PR-4"]);
		expect(
			keys(
				pick([
					["type", ["Bug"]],
					["sprint", ["Sprint 1"]],
				]),
			),
		).toEqual(["QR-3"]);
		expect(keys(pick([["label", ["ui"]]]))).toEqual(["QR-2", "PR-4"]);
		expect(keys(pick([["sprint", []]]))).toHaveLength(4);
	});
});

describe("facetCounts", () => {
	it("counts the values most first, the empty one last", () => {
		expect(facetCounts(rows, "sprint")).toEqual([
			{ value: "Sprint 1", count: 2 },
			{ value: "Sprint 2", count: 1 },
			{ value: NONE, count: 1 },
		]);
		expect(facetCounts(rows, "label")).toEqual([
			{ value: "ui", count: 2 },
			{ value: "api", count: 1 },
			{ value: NONE, count: 2 },
		]);
	});

	it("counts among the rows the other facets keep, keeping chosen values", () => {
		const selection = pick([
			["type", ["Task"]],
			["sprint", ["Sprint 2"]],
		]);
		expect(facetCounts(rows, "sprint", selection)).toEqual([
			{ value: "Sprint 2", count: 0 },
			{ value: NONE, count: 1 },
		]);
		expect(facetCounts(rows, "type", selection)).toEqual([
			{ value: "Bug", count: 1 },
			{ value: "Task", count: 0 },
		]);
	});

	it("leaves out a missing type", () => {
		expect(facetCounts([row("A-1", { type: "" })], "type")).toEqual([]);
	});
});

describe("splitChips", () => {
	const counts = ["a", "b", "c", "d", "e", "f"].map((value, index) => ({
		value,
		count: 10 - index,
	}));
	it("shows the first few, and any chosen past them", () => {
		const { chips, more } = splitChips(counts, new Set(["f"]), 3);
		expect(chips.map((each) => each.value)).toEqual(["a", "b", "c", "f"]);
		expect(more.map((each) => each.value)).toEqual(["d", "e"]);
	});
});

describe("facetsFrom", () => {
	it("keeps known facets once, the defaults when nothing was kept", () => {
		expect(facetsFrom(undefined)).toEqual(DEFAULT_FACETS);
		expect(facetsFrom(["sprint", "nope", "sprint", 3, "type"])).toEqual(["sprint", "type"]);
		expect(facetsFrom([])).toEqual([]);
	});
});

describe("issueRowOf", () => {
	it("reads labels, and the sprint when its field was asked for", () => {
		const raw = {
			key: "QR-9",
			fields: {
				summary: "x",
				labels: ["ui"],
				customfield_10020: [
					{ id: 1, name: "Sprint 7", state: "closed" },
					{ id: 2, name: "Sprint 8", state: "active" },
				],
			},
		};
		expect(issueRowOf(raw)?.sprintName).toBeUndefined();
		expect(issueRowOf(raw)?.labels).toEqual(["ui"]);
		expect(issueRowOf(raw, "customfield_10020")?.sprintName).toBe("Sprint 8");
		expect(issueRowOf({ key: "QR-1", fields: {} }, "customfield_10020")?.sprintName).toBe("");
	});
});
