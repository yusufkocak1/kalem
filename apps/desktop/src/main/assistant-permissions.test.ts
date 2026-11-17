import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { CHANNEL } from "../shared/bridge.js";
import type { ApprovalMode, ApprovalRequest, ToolPolicy } from "../shared/tool-protocol.js";
import { parseToolPolicies } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { PermissionGate } = await import("./assistant-permissions.js");

/** A gate whose window answers yes, keeping what it was asked. */
function gateWith(
	policies: Record<string, ToolPolicy>,
	always: string[] = [],
	mode: ApprovalMode = "ask",
) {
	const asked: ApprovalRequest[] = [];
	const gate = new PermissionGate({
		always: () => always,
		setAlways: (list) => {
			always = [...list];
		},
		toolPolicy: (tool) => policies[tool],
		approvalMode: () => mode,
	});
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		send(channel: string, request: ApprovalRequest) {
			if (channel !== CHANNEL.assistantApproval) return;
			asked.push(request);
			queueMicrotask(() => gate.answer(request.id, { approved: true, scope: "always" }));
		},
	}) as unknown as WebContents;
	return { gate, window, asked, always: () => always };
}

const request = (tool: string, risk: ApprovalRequest["risk"], permission: string) => ({
	chatId: "c",
	tool,
	risk,
	permission,
	title: tool,
	lines: [],
	scopes: ["once", "session", "always"] as const,
});

describe("the tools' settings", () => {
	it("run a write to Jira without asking when set so", async () => {
		const { gate, window, asked } = gateWith({ jira_add_comment: "auto" });
		const answer = await gate.ask(window, request("jira_add_comment", "external", "jira"));
		expect(answer.approved).toBe(true);
		expect(asked).toEqual([]);
	});

	it("ask every time when set so, whatever was allowed always, and remember nothing", async () => {
		const { gate, window, asked, always } = gateWith({ settings_set: "ask" }, [
			"settings:appearance",
		]);
		await gate.ask(window, request("settings_set", "ui", "settings:appearance"));
		expect(asked).toHaveLength(1);
		expect(asked[0]?.scopes).toEqual(["once"]);
		expect(asked[0]?.everyTime).toBe(true);
		expect(always()).toEqual(["settings:appearance"]);
	});

	it("keep a tool's way when nothing is set", async () => {
		const { gate, window, asked } = gateWith({}, ["settings:appearance"]);
		await gate.ask(window, request("settings_set", "ui", "settings:appearance"));
		expect(asked).toEqual([]);
	});

	it("refuse a tool turned off", async () => {
		const { gate, window } = gateWith({ jira_assign: "off" });
		expect((await gate.ask(window, request("jira_assign", "external", "jira"))).approved).toBe(
			false,
		);
	});

	it("are read safely from the settings file", () => {
		expect(
			parseToolPolicies({
				jira_search: "off",
				settings_set: "ask",
				bad: "maybe",
				"Bad Name": "off",
			}),
		).toEqual({ jira_search: "off", settings_set: "ask" });
		expect(parseToolPolicies([])).toEqual({});
	});
});

describe("the approval mode", () => {
	it("asks about everything when it is `ask`; a command every time", async () => {
		const { gate, window, asked, always } = gateWith({});
		await gate.ask(window, request("document_edit", "document", "document"));
		await gate.ask(window, { ...request("run_command", "command", "command"), scopes: ["once"] });
		expect(asked.map((each) => each.tool)).toEqual(["document_edit", "run_command"]);
		// A command is never kept as allowed, whatever the answer said.
		await gate.ask(window, { ...request("run_command", "command", "command"), scopes: ["once"] });
		expect(asked).toHaveLength(3);
		expect(always()).toEqual(["document"]);
	});

	it("makes code and document changes at once with `edits`, and asks the rest", async () => {
		const { gate, window, asked } = gateWith({}, [], "edits");
		expect(
			(await gate.ask(window, request("document_edit", "document", "document"))).approved,
		).toBe(true);
		await gate.ask(window, request("settings_set", "ui", "settings:appearance"));
		await gate.ask(window, request("run_command", "command", "command"));
		await gate.ask(window, request("jira_add_comment", "external", "jira"));
		expect(asked.map((each) => each.tool)).toEqual([
			"settings_set",
			"run_command",
			"jira_add_comment",
		]);
	});

	it("lets everything run with `all`, but a form, an MCP server and a tool set to ask", async () => {
		const { gate, window, asked, always } = gateWith({ jira_assign: "ask" }, [], "all");
		for (const [tool, risk] of [
			["document_edit", "document"],
			["settings_set", "ui"],
			["run_command", "command"],
			["jira_add_comment", "external"],
		] as const) {
			expect((await gate.ask(window, request(tool, risk, tool))).approved).toBe(true);
		}
		expect(asked).toEqual([]);
		// Nothing is kept for later: going back to `ask` asks again.
		expect(always()).toEqual([]);
		await gate.ask(window, request("jira_assign", "external", "jira"));
		await gate.ask(window, { ...request("mcp_add", "ui", "mcp"), mustAsk: true });
		await gate.ask(window, { ...request("connect", "ui", "connect"), fields: [] });
		expect(asked.map((each) => each.tool)).toEqual(["jira_assign", "mcp_add", "connect"]);
	});

	it("still refuses a tool turned off", async () => {
		const { gate, window } = gateWith({ run_command: "off" }, [], "all");
		expect((await gate.ask(window, request("run_command", "command", "command"))).approved).toBe(
			false,
		);
	});
});
