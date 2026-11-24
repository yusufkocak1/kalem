import { describe, expect, it } from "vitest";
import {
	commentsText,
	developmentText,
	findSprint,
	historyText,
	sprintsText,
	timeTrackingLine,
	worklogsText,
} from "./jira-assistant-text.js";

const HISTORIES = [
	{
		created: "2026-01-02T10:00:00.000+0300",
		author: { displayName: "Ayşe" },
		items: [{ field: "status", fromString: "To Do", toString: "In Progress" }],
	},
	{
		created: "2026-01-05T09:30:00.000+0300",
		author: { displayName: "Mehmet" },
		items: [
			{ field: "assignee", fromString: null, toString: "Ali" },
			{ field: "priority", fromString: "Low", toString: "High" },
		],
	},
];

describe("historyText", () => {
	it("lists every change, newest first", () => {
		const text = historyText("ABC-1", HISTORIES);
		expect(text).toContain("(2 changes)");
		const lines = text.split("\n").filter((line) => line.startsWith("- "));
		expect(lines[0]).toBe("- 2026-01-05 09:30, Mehmet: assignee: — → Ali; priority: Low → High");
		expect(lines[1]).toBe("- 2026-01-02 10:00, Ayşe: status: To Do → In Progress");
	});
	it("keeps one field's changes", () => {
		const text = historyText("ABC-1", HISTORIES, "Status");
		expect(text).toContain("In Progress");
		expect(text).not.toContain("Mehmet");
		expect(historyText("ABC-1", HISTORIES, "sprint")).toContain('no recorded changes of "sprint"');
	});
});

describe("commentsText", () => {
	const comment = (body: string) => ({
		author: "Ayşe",
		authorId: "a",
		created: "2026-01-02T10:00:00.000+0300",
		body,
		html: null,
		mentions: [],
	});
	it("numbers the comments and says where the next ones start", () => {
		const text = commentsText("ABC-1", [comment("bir"), comment("iki")], 5, 0);
		expect(text).toContain("Comments 1–2 of 5");
		expect(text).toContain("### 2. Ayşe, 2026-01-02 10:00\niki");
		expect(text).toContain('"start": 3');
		expect(commentsText("ABC-1", [], 0, 0)).toBe("ABC-1 has no comments.");
	});
});

describe("worklogs", () => {
	it("writes time tracking as a line", () => {
		expect(timeTrackingLine({ estimate: 7200, spent: 5400, remaining: null })).toBe(
			"original estimate 2h, logged 1h 30m",
		);
		expect(timeTrackingLine({ estimate: null, spent: null, remaining: null })).toBe("");
	});
	it("totals by person and lists each log", () => {
		const text = worklogsText(
			"ABC-1",
			[
				{
					author: { displayName: "Ayşe" },
					started: "2026-01-02T09:00:00.000+0300",
					timeSpentSeconds: 3600,
					comment: "inceleme",
				},
				{
					author: { displayName: "Ayşe" },
					started: "2026-01-03T09:00:00.000+0300",
					timeSpentSeconds: 1800,
				},
				{
					author: { displayName: "Ali" },
					started: "2026-01-04T09:00:00.000+0300",
					timeSpentSeconds: 600,
				},
			],
			{ timeSpentSeconds: 6000 },
		);
		expect(text).toContain("logged 1h 40m");
		expect(text).toContain("- Ayşe: 1h 30m\n- Ali: 10m");
		expect(text).toContain("- 2026-01-02 09:00, Ayşe: 1h — inceleme");
	});
});

describe("developmentText", () => {
	it("says when there is none", () => {
		expect(developmentText("ABC-1", null, [])).toContain("no development information");
	});
	it("lists pull requests", () => {
		const count = { count: 1, updated: null };
		const text = developmentText(
			"ABC-1",
			{
				branches: count,
				commits: { count: 3, updated: null },
				pullRequests: { ...count, state: "MERGED" },
				builds: { count: 0, updated: null },
				sources: ["stash"],
			},
			[
				{
					kind: "pullRequests",
					items: [
						{
							title: "Fix login",
							detail: "feature/x → main",
							repository: "web",
							author: "Ali",
							when: "2026-01-02T10:00:00Z",
							state: "MERGED",
							url: "https://git/pr/1",
						},
					],
				},
			],
		);
		expect(text).toContain("1 branches, 3 commits, 1 pull requests (MERGED), 0 builds");
		expect(text).toContain(
			"- Fix login (web, Ali, 2026-01-02 10:00, MERGED) — feature/x → main https://git/pr/1",
		);
	});
});

describe("sprints", () => {
	const sprints = [
		{
			id: "11",
			name: "Sprint 11",
			state: "active",
			boardId: "5",
			startDate: "2026-01-01T00:00:00Z",
			endDate: "2026-01-14T00:00:00Z",
			goal: "Giriş",
		},
		{
			id: "12",
			name: "Sprint 12",
			state: "future",
			boardId: "5",
			startDate: "",
			endDate: "",
			goal: "",
		},
	];
	it("lists them", () => {
		const text = sprintsText({ id: "5", name: "Takım" }, sprints);
		expect(text).toContain("- Sprint 11 (id 11, active, 2026-01-01 → 2026-01-14) — goal: Giriş");
		expect(text).toContain("- Sprint 12 (id 12, future)");
	});
	it("finds one by id or name", () => {
		expect(findSprint(sprints, "12")).toMatchObject({ name: "Sprint 12" });
		expect(findSprint(sprints, "sprint 11")).toMatchObject({ id: "11" });
		expect(findSprint(sprints, "sprint")).toContain("More than one sprint");
		expect(findSprint(sprints, "yok")).toContain('No open sprint named "yok"');
	});
});
