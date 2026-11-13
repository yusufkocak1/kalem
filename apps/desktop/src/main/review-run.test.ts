import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { CheckProgress, ClaudeEvent } from "../shared/claude.js";
import { stringsFor } from "../shared/i18n.js";
import { modeExcluded } from "../shared/modes.js";
import { reviewPlan } from "../shared/review-plan.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { ReviewRun, ReviewRuns } = await import("./review-run.js");
await import("./assistant-analysis-tools.js");
type ToolContext = import("./assistant-tools.js").ToolContext;
type McpRun = import("./assistant-mcp.js").McpRun;
type ToolResult = import("./assistant-tools.js").ToolResult;

const window = {} as WebContents;

function context(): ToolContext {
	return {
		chatId: "chat-1",
		sender: window,
		t: stringsFor("en"),
		excluded: modeExcluded("review"),
		settings: () => ({}) as ReturnType<ToolContext["settings"]>,
		changeSettings: () => {},
		changeLanguage: () => {},
		confluence: null,
		jira: null,
		confluenceClient: null,
		jiraClient: null,
		connections: null,
		workspace: null,
		templates: null,
		document: { tabId: "tab-1", name: "a.md", text: "# A\n\nFast enough.\n", selection: "" },
		step: () => {},
		emit: () => {},
		approve: async () => ({ approved: false, scope: "once" }),
		renderer: async () => ({ ok: true, text: "" }),
		readExternal: false,
	};
}

/** A review whose reviewers report as told: each by its check's title. */
function review(
	behave: (
		title: string,
		report: (problem: string) => Promise<void>,
		send: (event: ClaudeEvent) => void,
	) => Promise<void>,
) {
	const plan = reviewPlan({}, { hasWorkspace: false });
	if (plan === null) throw new Error("no plan");
	const events: ClaudeEvent[] = [];
	let clock = 1000;
	const closed: string[] = [];
	const run = new ReviewRun({
		plan,
		t: stringsFor("en"),
		tools: context(),
		sender: window,
		open: async (_definitions, call) => {
			const id = String(closed.length + Math.random());
			const mcp: McpRun & { call: typeof call } = {
				claude: "",
				copilot: "",
				call,
				close: async () => {
					closed.push(id);
				},
			};
			return mcp;
		},
		forward: (event) => events.push(event),
		instructions: (modes) => JSON.stringify(modes.review?.steps ?? []),
		question: "Review it",
		ask: async (system, _question, mcp, _tools, send) => {
			const on = JSON.parse(system) as { id: string; on: boolean }[];
			const title = on.find((step) => step.on && step.id !== "report")?.id ?? "";
			const call = (mcp as McpRun & { call: (n: string, i: unknown) => Promise<ToolResult> }).call;
			clock += 1000;
			await behave(
				title,
				async (problem) => {
					await call("report_findings", { findings: [{ problem, quote: problem }] });
				},
				send,
			);
		},
		now: () => clock,
	});
	const last = (): readonly CheckProgress[] =>
		events.flatMap((event) => (event.kind === "checks" ? [event.checks] : [])).at(-1) ?? [];
	return { run, events, last, closed };
}

describe("a review run side by side", () => {
	it("says how each check goes: what it did, found and cost, and when it ended", async () => {
		const { run, events, last, closed } = review(async (title, report, send) => {
			send({ kind: "step", tool: "mcp__kalem__document_read", detail: title });
			send({ kind: "usage", input: 100, output: 20, cached: 5 });
			if (title === "scope") await report("No scope.");
		});
		const reviewed = await run.run(() => false);
		expect(reviewed?.failed).toEqual([]);
		const checks = last();
		expect(checks).toHaveLength(5);
		expect(checks.every((check) => check.status === "done")).toBe(true);
		expect(checks[0]).toMatchObject({
			findings: 1,
			last: { tool: "mcp__kalem__document_read", detail: "scope" },
			usage: { input: 100, output: 20, cached: 5 },
		});
		expect(checks[0]?.ended).toBeGreaterThan(checks[0]?.started ?? 0);
		// The findings are sent for this run, numbered in one list; the rules' first.
		const findings = events.filter((event) => event.kind === "findings");
		expect(findings.at(-1)).toMatchObject({ review: run.id, findings: [{ id: "F-01" }] });
		expect(findings[0]).toMatchObject({ review: run.id });
		expect(events.some((event) => event.kind === "checks" && event.rules)).toBe(true);
		// Each reviewer had its own run of the tools, closed when it was done.
		expect(closed).toHaveLength(5);
	});

	it("keeps why a check failed, and runs it again on its own", async () => {
		let attempt = 0;
		const { run, last } = review(async (title, report, send) => {
			if (title !== "security") return;
			attempt += 1;
			if (attempt === 1) send({ kind: "error", message: "rate   limited" });
			else await report("No consent text.");
		});
		const reviewed = await run.run(() => false);
		expect(reviewed?.failed).toHaveLength(1);
		const index = last().findIndex((check) => check.status === "failed");
		expect(last()[index]).toMatchObject({ status: "failed", error: "rate limited", findings: 0 });
		await run.retry(index, () => false);
		expect(last()[index]).toMatchObject({ status: "done", findings: 1 });
		expect(last()[index]?.error).toBeUndefined();
		// A check that did not fail is not run again.
		await run.retry(0, () => false);
		expect(attempt).toBe(2);
	});

	it("is left to the answer when no reviewer could run", async () => {
		const { run } = review(async (_title, _report, send) => {
			send({ kind: "error", message: "unknown option" });
		});
		expect(await run.run(() => false)).toBeNull();
	});

	it("is found again only by the window it ran in", () => {
		const { run } = review(async () => {});
		const runs = new ReviewRuns(1);
		runs.add(run);
		expect(runs.get(run.id, window)).toBe(run);
		expect(runs.get(run.id, {} as WebContents)).toBeNull();
		// The oldest are forgotten.
		const other = review(async () => {}).run;
		runs.add(other);
		expect(runs.get(run.id, window)).toBeNull();
		expect(runs.get(other.id, window)).toBe(other);
	});
});
