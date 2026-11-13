import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { CHANNEL } from "../shared/bridge.js";
import type { ApprovalRequest, ToolPolicy } from "../shared/tool-protocol.js";
import { parseToolPolicies } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { PermissionGate } = await import("./assistant-permissions.js");

/** A gate whose window answers yes, keeping what it was asked. */
function gateWith(policies: Record<string, ToolPolicy>, always: string[] = []) {
	const asked: ApprovalRequest[] = [];
	const gate = new PermissionGate({
		always: () => always,
		setAlways: (list) => {
			always = [...list];
		},
		toolPolicy: (tool) => policies[tool],
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
