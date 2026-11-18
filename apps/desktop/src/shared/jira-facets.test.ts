import { describe, expect, it } from "vitest";
import type { JiraIssueRow } from "./jira.js";
import { issueRowOf } from "./jira.js";
import {
	composeJql,
	conditionJql,
	conditionsFrom,
	DEFAULT_CONDITIONS,
	DEFAULT_FACETS,
	facetChoices,
	facetCounts,
	facetJql,
	facetsFrom,
	facetValues,
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

	it("leaves out a missing type", () => {
		expect(facetCounts([row("A-1", { type: "" })], "type")).toEqual([]);
	});
});

describe("facetChoices", () => {
	it("keeps values seen before and chosen ones, with none, after those of now", () => {
		const now = [{ value: "Sprint 27", count: 16 }];
		expect(facetChoices(now, ["Sprint 26", "Sprint 27", NONE], new Set(["Sprint 30"]))).toEqual([
			{ value: "Sprint 27", count: 16 },
			{ value: "Sprint 26", count: 0 },
			{ value: "Sprint 30", count: 0 },
			{ value: NONE, count: 0 },
		]);
	});
});

describe("splitChips", () => {
	it("shows the first few, and any chosen past them", () => {
		const counts = ["a", "b", "c", "d", "e", "f"].map((value, index) => ({
			value,
			count: 10 - index,
		}));
		const { chips, more } = splitChips(counts, new Set(["f"]), 3);
		expect(chips.map((each) => each.value)).toEqual(["a", "b", "c", "f"]);
		expect(more.map((each) => each.value)).toEqual(["d", "e"]);
		expect(splitChips(["x", "y", "z"], new Set(["z"]), 1)).toEqual({
			chips: ["x", "z"],
			more: ["y"],
		});
	});
});

describe("facetJql", () => {
	it("asks for any chosen value, the empty one as EMPTY", () => {
		expect(facetJql("sprint", ["Kırmızı Sprint 27"])).toBe('sprint in ("Kırmızı Sprint 27")');
		expect(facetJql("type", ["Bug", "Story"])).toBe('issuetype in ("Bug", "Story")');
		expect(facetJql("label", ['a "b"', NONE])).toBe('(labels in ("a \\"b\\"") OR labels is EMPTY)');
		expect(facetJql("sprint", [])).toBeNull();
	});

	it("names people by their ids", () => {
		const ids = new Map([["Yusuf T", "ytest"]]);
		expect(facetJql("assignee", ["Yusuf T", NONE], (name) => ids.get(name))).toBe(
			'(assignee in ("ytest") OR assignee is EMPTY)',
		);
	});
});

describe("conditionJql", () => {
	it("gives each condition's JQL, the starred issues by key", () => {
		expect(conditionJql("mine")).toBe("assignee = currentUser()");
		expect(conditionJql("favorites", ["QR-1", "QR-2"])).toBe("key in (QR-1, QR-2)");
		expect(conditionJql("favorites", [])).toBeNull();
	});
});

describe("composeJql", () => {
	const mine = ["assignee = currentUser()", "resolution = Unresolved"];
	it("joins the filters, latest first", () => {
		expect(composeJql(mine, "")).toBe(
			"assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
		);
		expect(composeJql([], "")).toBe("ORDER BY updated DESC");
	});

	it("takes a sprint without the user's own condition", () => {
		expect(composeJql(['sprint in ("Sprint 27")'], "")).toBe(
			'sprint in ("Sprint 27") ORDER BY updated DESC',
		);
	});

	it("narrows by the search box's words or JQL, keeping its order", () => {
		expect(composeJql(mine.slice(0, 1), "offload")).toBe(
			'(text ~ "offload") AND assignee = currentUser() ORDER BY updated DESC',
		);
		expect(composeJql(mine.slice(0, 1), "project = QR ORDER BY created ASC")).toBe(
			"(project = QR) AND assignee = currentUser() ORDER BY created ASC",
		);
		expect(composeJql([], "project = QR")).toBe("project = QR ORDER BY updated DESC");
	});

	it("finds a typed key whatever the filters", () => {
		expect(composeJql(mine, "qr-48215")).toBe("key = QR-48215");
		expect(composeJql(mine, "https://jira.example.com/browse/QR-7")).toBe("key = QR-7");
	});
});

describe("kept settings", () => {
	it("keeps known names once, the defaults when nothing was kept", () => {
		expect(facetsFrom(undefined)).toEqual(DEFAULT_FACETS);
		expect(facetsFrom(["sprint", "nope", "sprint", 3, "type"])).toEqual(["sprint", "type"]);
		expect(facetsFrom([])).toEqual([]);
		expect(conditionsFrom(undefined)).toEqual(DEFAULT_CONDITIONS);
		expect(conditionsFrom(["unresolved", "x"])).toEqual(["unresolved"]);
		expect(conditionsFrom([])).toEqual([]);
	});
});

describe("issueRowOf", () => {
	it("reads labels, the assignee's id, and the sprint when its field was asked for", () => {
		const raw = {
			key: "QR-9",
			fields: {
				summary: "x",
				labels: ["ui"],
				assignee: { displayName: "Yusuf T", name: "ytest" },
				customfield_10020: [
					{ id: 1, name: "Sprint 7", state: "closed" },
					{ id: 2, name: "Sprint 8", state: "active" },
				],
			},
		};
		expect(issueRowOf(raw)?.sprintName).toBeUndefined();
		expect(issueRowOf(raw)).toMatchObject({ labels: ["ui"], assigneeId: "ytest" });
		expect(issueRowOf(raw, "customfield_10020")?.sprintName).toBe("Sprint 8");
		expect(issueRowOf({ key: "QR-1", fields: {} }, "customfield_10020")?.sprintName).toBe("");
	});
});
