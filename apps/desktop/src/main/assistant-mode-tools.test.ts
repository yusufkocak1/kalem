import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/bridge.js";
import { CHANNEL, DEFAULT_SETTINGS } from "../shared/bridge.js";
import { parseCustomModes } from "../shared/custom-modes.js";
import { stringsFor } from "../shared/i18n.js";
import { resolveMode } from "../shared/mode-config.js";
import { modeExcluded } from "../shared/modes.js";
import type { ApprovalAnswer, ApprovalRequest, ToolPolicy } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { PermissionGate } = await import("./assistant-permissions.js");
const { approver, runTool } = await import("./assistant-tools.js");
await import("./assistant-mode-tools.js");
type ToolContext = import("./assistant-tools.js").ToolContext;

/** A chat whose window answers each question as told, with settings of its own. */
function chat(
	answer: (request: ApprovalRequest) => ApprovalAnswer,
	options: { policy?: ToolPolicy; always?: readonly string[]; settings?: Partial<Settings> } = {},
) {
	const asked: ApprovalRequest[] = [];
	let always = options.always ?? [];
	const gate = new PermissionGate({
		always: () => always,
		setAlways: (list) => (always = list),
		toolPolicy: () => options.policy,
	});
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		send(channel: string, request: ApprovalRequest) {
			if (channel !== CHANNEL.assistantApproval) return;
			asked.push(request);
			queueMicrotask(() => gate.answer(request.id, answer(request)));
		},
	}) as unknown as WebContents;
	let settings: Settings = { ...DEFAULT_SETTINGS, ...options.settings };
	const ctx: ToolContext = {
		chatId: "chat-1",
		sender: window,
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
		connections: null,
		workspace: null,
		templates: null,
		document: null,
		step: () => {},
		emit: () => {},
		approve: (request) => approve(request),
		renderer: async () => ({ ok: true, text: "" }),
		readExternal: false,
	};
	const approve = approver(gate, window, "chat-1", () => false);
	return { ctx, asked, settings: () => settings, always: () => always };
}

const allow = (): ApprovalAnswer => ({ approved: true, scope: "always" });
const refuse = (): ApprovalAnswer => ({ approved: false, scope: "once" });

describe("the assistant connecting modes to MCP servers", () => {
	it("adds a ready-made server to a mode once the user sees the whole of it and allows it", async () => {
		const { ctx, asked, settings, always } = chat(allow);
		const done = await runTool(
			"mode_mcp_change",
			{
				action: "add",
				mode: "Code",
				preset: "dbhub",
				server: {
					args: ["-y", "@bytebase/dbhub@latest", "--config", "/home/me/dbhub.toml"],
				},
				reason: "i18n anahtarları için",
			},
			ctx,
		);
		expect(done.text).toContain("Done: Connect the MCP server db to the Code mode");
		const [request] = asked;
		expect(request?.title).toBe("Connect the MCP server db to the Code mode");
		expect(request?.lines).toContain(
			"Command: npx -y @bytebase/dbhub@latest --config /home/me/dbhub.toml",
		);
		expect(request?.lines).toContain("Tools it may use: get_parameter, add_i18n_key");
		expect(request?.reason).toBe("i18n anahtarları için");
		// Only once: it is never allowed for later.
		expect(request?.scopes).toEqual(["once"]);
		expect(always()).toEqual([]);
		const [server] = resolveMode("code", settings().assistantModes).mcp;
		expect(server).toMatchObject({
			name: "db",
			preset: "dbhub",
			tools: ["get_parameter", "add_i18n_key"],
		});
		expect(server?.purpose).toContain("get_parameter");
	});

	it("asks every time, even when the tool is set to run without asking or the kind was allowed always", async () => {
		const { ctx, asked } = chat(allow, { policy: "auto", always: ["settings:mcp"] });
		await runTool("mode_mcp_change", { action: "add", mode: "ask", preset: "context7" }, ctx);
		await runTool("mode_mcp_change", { action: "add", mode: "code", preset: "context7" }, ctx);
		expect(asked).toHaveLength(2);
		expect(asked.every((request) => request.mustAsk === true)).toBe(true);
	});

	it("changes nothing when the user does not allow it", async () => {
		const { ctx, settings } = chat(refuse);
		const answer = await runTool(
			"mode_mcp_change",
			{ action: "add", mode: "code", preset: "github" },
			ctx,
		);
		expect(answer.text).toContain("did not allow");
		expect(settings().assistantModes).toEqual({});
	});

	it("shows tokens on the card only by their start, and never lists how a server runs", async () => {
		const { ctx, asked } = chat(allow);
		await runTool(
			"mode_mcp_change",
			{
				action: "add",
				mode: "code",
				preset: "github",
				server: { headers: { Authorization: "Bearer ghp_verysecret123" } },
			},
			ctx,
		);
		expect(asked[0]?.lines).toContain("Authorization: Bear…");
		expect(asked[0]?.lines.join(" ")).not.toContain("verysecret");
		const list = await runTool("mode_mcp_list", {}, ctx);
		expect(list.text).toContain("- code (Code):\n  - github");
		expect(list.text).toContain("- dbhub (DBHub)");
		expect(list.text).not.toContain("verysecret");
		expect(list.text).not.toContain("api.githubcopilot.com");
	});

	it("changes a server's fields, keeping the rest, and removes it", async () => {
		const { ctx, settings } = chat(allow);
		await runTool("mode_mcp_change", { action: "add", mode: "code", preset: "sentry" }, ctx);
		const updated = await runTool(
			"mode_mcp_change",
			{
				action: "update",
				mode: "code",
				name: "sentry",
				server: { env: { SENTRY_ACCESS_TOKEN: "sntrys_abc123456" }, enabled: false },
			},
			ctx,
		);
		expect(updated.text).toContain("Done");
		const [sentry] = resolveMode("code", settings().assistantModes).mcp;
		expect(sentry?.env).toEqual({
			SENTRY_ACCESS_TOKEN: "sntrys_abc123456",
			SENTRY_HOST: "sentry.io",
		});
		expect(sentry?.enabled).toBe(false);
		await runTool("mode_mcp_change", { action: "remove", mode: "code", name: "sentry" }, ctx);
		expect(settings().assistantModes).toEqual({});
	});

	it("works on the user's own modes, by name, and refuses what cannot be used", async () => {
		const [mine] = parseCustomModes([{ id: "custom-1", name: "Test Analisti" }]);
		if (mine === undefined) throw new Error("no mode");
		const { ctx, settings, asked } = chat(allow, { settings: { assistantCustomModes: [mine] } });
		await runTool(
			"mode_mcp_change",
			{
				action: "add",
				mode: "test analisti",
				server: { name: "files", command: "npx", args: ["-y", "mcp-files"] },
			},
			ctx,
		);
		expect(settings().assistantCustomModes[0]?.mcp.map((server) => server.name)).toEqual(["files"]);
		const bad = await runTool(
			"mode_mcp_change",
			{ action: "add", mode: "code", server: { name: "kalem", command: "x" } },
			ctx,
		);
		expect(bad.text).toContain("cannot be used");
		const twice = await runTool(
			"mode_mcp_change",
			{ action: "add", mode: "custom-1", server: { name: "files", command: "x" } },
			ctx,
		);
		expect(twice.text).toContain("already has a server named files");
		const nowhere = await runTool(
			"mode_mcp_change",
			{ action: "add", mode: "nope", preset: "git" },
			ctx,
		);
		expect(nowhere.text).toContain("There is no mode");
		// Only the one change that could be made was asked about.
		expect(asked).toHaveLength(1);
	});
});
