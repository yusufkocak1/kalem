import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/bridge.js";
import { CHANNEL, DEFAULT_SETTINGS } from "../shared/bridge.js";
import type { ClaudeEvent } from "../shared/claude.js";
import { stringsFor } from "../shared/i18n.js";
import { modeExcluded } from "../shared/modes.js";
import type { ApprovalAnswer, ApprovalRequest } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { PermissionGate } = await import("./assistant-permissions.js");
const { approver, runTool, toolsFor } = await import("./assistant-tools.js");
await import("./assistant-app-tools.js");
await import("./assistant-form-tools.js");
type ToolContext = import("./assistant-tools.js").ToolContext;
type Connections = import("./assistant-tools.js").Connections;

/** A chat whose forms are answered in turn, as told; what was asked is kept. */
function context(answers: ApprovalAnswer[], connections: Connections | null = null) {
	const asked: ApprovalRequest[] = [];
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		send(channel: string, request: ApprovalRequest) {
			if (channel !== CHANNEL.assistantApproval) return;
			asked.push(request);
			const given = answers.shift() ?? { approved: false, scope: "once" };
			queueMicrotask(() => gate.answer(request.id, given));
		},
	});
	const gate = new PermissionGate({ always: () => ["form:app_form"], setAlways: () => {} });
	let settings: Settings = { ...DEFAULT_SETTINGS };
	const events: ClaudeEvent[] = [];
	const rendered: string[] = [];
	const ctx: ToolContext = {
		chatId: "chat-1",
		sender: window as unknown as WebContents,
		t: stringsFor("en"),
		excluded: modeExcluded("ask"),
		settings: () => settings,
		changeSettings: (patch) => {
			settings = { ...settings, ...patch };
		},
		changeLanguage: () => {},
		confluence: null,
		jira: null,
		confluenceClient: null,
		jiraClient: null,
		connections,
		workspace: null,
		templates: null,
		document: null,
		step: () => {},
		emit: (event) => events.push(event),
		approve: (request) => approve(request),
		renderer: async (name) => {
			rendered.push(name);
			return { ok: true, text: "" };
		},
		readExternal: false,
	};
	const approve = approver(gate, ctx.sender, "chat-1", () => false);
	return { ctx, asked, events, rendered, settings: () => settings };
}

const sent = (values: Record<string, string | number | boolean>): ApprovalAnswer => ({
	approved: true,
	scope: "once",
	values,
});

function fakeConnections(fail: string[] = []) {
	const logins: { service: string; site: string; username: string; token: string }[] = [];
	const connections: Connections = {
		account: async (service) =>
			service === "jira" ? { site: "https://old.example.com", username: "ali" } : null,
		suggestedSite: async () => null,
		async connect(service, login) {
			logins.push({ service, ...login });
			const error = fail.shift();
			if (error !== undefined) throw new Error(error);
			return { site: login.site, username: login.username };
		},
		disconnect: async () => {},
	};
	return { connections, logins };
}

describe("forms in the chat", () => {
	it("asks for a Jira login with typed fields, and the token never reaches the model", async () => {
		const { connections, logins } = fakeConnections();
		const { ctx, asked, rendered } = context(
			[sent({ site: "https://jira.thy.com", username: "veli", token: "s3cret" })],
			connections,
		);
		const result = await runTool("app_form", { action: "jira_connection" }, ctx);
		// A form is asked every time, even when that kind of change was allowed always.
		expect(asked).toHaveLength(1);
		expect(asked[0]?.fields?.map((field) => [field.name, field.type, field.required])).toEqual([
			["site", "url", true],
			["username", "text", false],
			["token", "secret", true],
		]);
		expect(asked[0]?.fields?.[0]?.value).toBe("https://old.example.com");
		expect(asked[0]?.fields?.[2]?.value).toBeUndefined();
		expect(logins).toEqual([
			{ service: "jira", site: "https://jira.thy.com", username: "veli", token: "s3cret" },
		]);
		expect(result.text).toContain("Connected to Jira at https://jira.thy.com as veli");
		expect(result.text).not.toContain("s3cret");
		expect(rendered).toEqual(["accounts_changed"]);
	});

	it("shows the form again with the server's answer when the login fails", async () => {
		const { connections } = fakeConnections(["HTTP 401"]);
		const { ctx, asked } = context(
			[
				sent({ site: "https://jira.thy.com", username: "veli", token: "wrong" }),
				sent({ site: "https://jira.thy.com", username: "veli", token: "right" }),
			],
			connections,
		);
		const result = await runTool("app_form", { action: "jira_connection" }, ctx);
		expect(asked).toHaveLength(2);
		expect(asked[1]?.error).toBe("Could not connect: HTTP 401");
		// What was typed is kept, but the token is typed again.
		expect(asked[1]?.fields?.[1]?.value).toBe("veli");
		expect(asked[1]?.fields?.[2]?.value).toBeUndefined();
		expect(result.text).toContain("Connected to Jira");
	});

	it("checks what the window sent again before using it", async () => {
		const { connections, logins } = fakeConnections();
		const { ctx, asked } = context(
			[sent({ site: "jira", token: "x" }), { approved: false, scope: "once" }],
			connections,
		);
		const result = await runTool("app_form", { action: "jira_connection" }, ctx);
		expect(logins).toEqual([]);
		expect(asked[1]?.error).toContain("http:// or https://");
		expect(result.text).toContain("cancelled");
	});

	it("shows settings as fields of their types and applies what changed", async () => {
		const { ctx, asked, events, settings } = context([
			sent({ theme: '"dark"', zoom: 120, autoSave: true }),
		]);
		const result = await runTool(
			"app_form",
			{ action: "settings", keys: ["theme", "zoom", "autoSave", "nope"] },
			ctx,
		);
		const fields = asked[0]?.fields ?? [];
		expect(fields.map((field) => field.type)).toEqual(["choice", "number", "boolean"]);
		expect(fields[0]?.options).toContainEqual({ value: '"dark"', label: "Dark" });
		expect(fields[1]).toMatchObject({ min: expect.any(Number), max: expect.any(Number) });
		expect(settings()).toMatchObject({ theme: "dark", zoom: 120, autoSave: true });
		expect(result.text).toContain("Theme: System → Dark");
		expect(events.some((event) => event.kind === "changed")).toBe(true);
	});

	it("asks for what another feature needs and gives the model the checked values", async () => {
		const { ctx, asked } = context([sent({ summary: "Bug", points: "5", urgent: false })]);
		const result = await runTool(
			"ask_form",
			{
				title: "New issue",
				fields: [
					{ name: "summary", label: "Summary", type: "text" },
					{ name: "points", type: "number", min: 1, max: 13 },
					{ name: "urgent", type: "boolean", required: false },
				],
			},
			ctx,
		);
		expect(asked[0]?.title).toBe("New issue");
		expect(JSON.parse(result.text.replace(/^[^{]*/, ""))).toEqual({
			summary: "Bug",
			points: 5,
			urgent: false,
		});
	});

	it("does not let the model ask for a secret", async () => {
		const { ctx, asked } = context([]);
		const result = await runTool(
			"ask_form",
			{ title: "Login", fields: [{ name: "password", type: "secret" }] },
			ctx,
		);
		expect(asked).toHaveLength(0);
		expect(result.text).toContain("secrets are asked by app_form only");
	});

	it("offers the connection forms only where connections can be made", () => {
		const without = context([]).ctx;
		const description = toolsFor(without).find((tool) => tool.definition.name === "app_form")
			?.definition.description;
		expect(description).toContain("jira_connection");
	});
});
