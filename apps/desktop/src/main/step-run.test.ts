import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { CheckProgress, ClaudeEvent } from "../shared/claude.js";
import { parseCustomModes } from "../shared/custom-modes.js";
import { stringsFor } from "../shared/i18n.js";
import { stepPlan } from "../shared/step-stages.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { StepRun } = await import("./step-run.js");
type ToolContext = import("./assistant-tools.js").ToolContext;

function context(): ToolContext {
	return {
		chatId: "chat-1",
		sender: {} as WebContents,
		t: stringsFor("en"),
		excluded: new Set(),
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
		document: null,
		step: () => {},
		emit: () => {},
		approve: async () => ({ approved: false, scope: "once" }),
		renderer: async () => ({ ok: true, text: "" }),
		readExternal: false,
	};
}

/** Steps 1 2 one by one, 3 4 5 at once, then 6. */
const custom = parseCustomModes([
	{
		id: "custom-1",
		name: "Six",
		parallel: true,
		steps: [1, 2, 3, 4, 5, 6].map((n) => ({
			id: `step-${n}`,
			title: `S${n}`,
			instruction: `Do ${n}`,
			parallel: n >= 3 && n <= 5,
		})),
	},
]);

function stepRun(fail: ReadonlySet<string> = new Set()) {
	const plan = stepPlan("custom-1", {}, custom);
	if (plan === null) throw new Error("no plan");
	const log: string[] = [];
	const asked = new Map<string, string>();
	const events: ClaudeEvent[] = [];
	let running = 0;
	let most = 0;
	const run = new StepRun({
		plan,
		t: stringsFor("en"),
		tools: context(),
		open: async () => null,
		forward: (event) => events.push(event),
		instructions: (step) => step.id,
		question: "Q",
		ask: async (system, question, _run, _tools, send) => {
			asked.set(system, question);
			log.push(`start ${system}`);
			running += 1;
			most = Math.max(most, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running -= 1;
			log.push(`end ${system}`);
			if (fail.has(system)) send({ kind: "error", message: "broke" });
			else send({ kind: "text", text: `result of ${system}` });
		},
	});
	return { run, log, asked, events, most: () => most };
}

describe("StepRun", () => {
	it("runs 1 then 2, then 3 4 5 at once, and leaves 6 to the answer", async () => {
		const { run, log, asked, events, most } = stepRun();
		const done = await run.run(() => false);
		expect(log.slice(0, 4)).toEqual(["start step-1", "end step-1", "start step-2", "end step-2"]);
		expect(log.slice(4, 7).sort()).toEqual(["start step-3", "start step-4", "start step-5"]);
		expect(most()).toBe(3);
		expect(log).not.toContain("start step-6");
		expect(done?.results.map((result) => result.id)).toEqual([
			"step-1",
			"step-2",
			"step-3",
			"step-4",
			"step-5",
		]);
		expect([...(done?.left ?? [])]).toEqual(["step-6"]);
		// Each step is told what the ones before it produced.
		expect(asked.get("step-1")).toBe("Q");
		expect(asked.get("step-2")).toContain("result of step-1");
		expect(asked.get("step-4")).toContain("result of step-2");
		expect(asked.get("step-4")).not.toContain("result of step-3");
		const last = events.filter((event) => event.kind === "checks").at(-1);
		const checks = (last as { checks: readonly CheckProgress[] }).checks;
		expect(checks.map((check) => check.status)).toEqual(["done", "done", "done", "done", "done"]);
		expect(checks.map((check) => check.parallel === true)).toEqual([
			false,
			false,
			true,
			true,
			true,
		]);
	});

	it("stops at a step that fails and leaves the rest to the answer", async () => {
		const { run, log } = stepRun(new Set(["step-2"]));
		const done = await run.run(() => false);
		expect(log).not.toContain("start step-3");
		expect(done?.results.map((result) => result.id)).toEqual(["step-1"]);
		expect([...(done?.left ?? [])]).toEqual(["step-2", "step-3", "step-4", "step-5", "step-6"]);
	});

	it("leaves everything to the answer when no step could be done", async () => {
		const { run } = stepRun(new Set(["step-1"]));
		expect(await run.run(() => false)).toBeNull();
	});
});
