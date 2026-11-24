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
type ToolContext = import("./assistant-tools.js").ToolContext;

/** A window that answers each question as told, and keeps what it was sent. */
function fakeWindow(answer: (request: ApprovalRequest) => ApprovalAnswer | null) {
	const asked: ApprovalRequest[] = [];
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		send(channel: string, request: ApprovalRequest) {
			if (channel !== CHANNEL.assistantApproval) return;
			asked.push(request);
			const given = answer(request);
			if (given !== null) queueMicrotask(() => gate.answer(request.id, given));
		},
	});
	let always: readonly string[] = [];
	const gate = new PermissionGate({ always: () => always, setAlways: (list) => (always = list) });
	return { window: window as unknown as WebContents, asked, gate, always: () => always };
}

function context(
	answer: (request: ApprovalRequest) => ApprovalAnswer | null,
	extra: Partial<ToolContext> = {},
) {
	const { window, asked, gate, always } = fakeWindow(answer);
	let settings: Settings = { ...DEFAULT_SETTINGS };
	const events: ClaudeEvent[] = [];
	const languages: (string | null)[] = [];
	const rendered: { name: string; input: unknown }[] = [];
	const ctx: ToolContext = {
		chatId: "chat-1",
		sender: window,
		t: stringsFor("en"),
		excluded: modeExcluded("ask"),
		settings: () => settings,
		changeSettings: (patch) => {
			settings = { ...settings, ...patch };
		},
		changeLanguage: (language) => languages.push(language),
		confluence: null,
		jira: null,
		confluenceClient: null,
		jiraClient: null,
		connections: null,
		workspace: null,
		templates: null,
		document: null,
		step: () => {},
		emit: (event) => events.push(event),
		approve: (request) => approve(request),
		renderer: async (name, input) => {
			rendered.push({ name, input });
			return { ok: true, text: "2 changes", document: "# Yeni\n" };
		},
		readExternal: false,
		...extra,
	};
	const approve = approver(gate, window, "chat-1", () => ctx.readExternal);
	return { ctx, asked, events, languages, rendered, always, settings: () => settings };
}

const allow: ApprovalAnswer = { approved: true, scope: "once" };

describe("the assistant's app tools", () => {
	it("finds a setting by the user's words and changes it once allowed", async () => {
		const { ctx, asked, events, settings } = context(() => allow);
		const found = await runTool("settings_find", { query: "koyu tema" }, ctx);
		expect(found.text).toContain('- theme: "Theme" (appearance) = "system"');
		expect(found.text).toContain('"dark" (Dark)');

		const set = await runTool(
			"settings_set",
			{ changes: [{ key: "theme", value: "Dark" }], reason: "koyu tema istendi" },
			ctx,
		);
		expect(set.text).toBe("Changed: Theme: System → Dark.");
		expect(settings().theme).toBe("dark");
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			chatId: "chat-1",
			risk: "ui",
			permission: "settings/appearance",
			lines: ["Theme: System → Dark"],
			reason: "koyu tema istendi",
			scopes: ["once", "session", "always"],
		});
		// The chat can put it back.
		expect(events).toContainEqual({
			kind: "changed",
			label: "Theme: System → Dark",
			undo: { theme: "system" },
		});
	});

	it("changes nothing the user refuses, and says not to try again", async () => {
		const { ctx, settings } = context(() => ({ approved: false, scope: "once" }));
		const set = await runTool("settings_set", { changes: [{ key: "autoSave", value: true }] }, ctx);
		expect(set.text).toContain("The user did not allow: AutoSave: Off → On. Do not try again.");
		expect(settings().autoSave).toBe(false);
	});

	it("reaches every setting, asking every time about those that widen what it may do", async () => {
		const { ctx, asked, always } = context(() => allow);
		const set = await runTool(
			"settings_set",
			{
				changes: [
					{ key: "claudePath", value: "/tmp/claude" },
					{ key: "assistantPermissions", value: ["document"] },
					{ key: "copilotTools", value: "block" },
					{ key: "assistantCustomModes", value: [] },
					{ key: "zoom", value: "huge" },
				],
			},
			ctx,
		);
		expect(set.text).toContain('zoom: "huge" is not a value it takes');
		expect(set.text).toContain("assistantCustomModes: change it with mode_save");
		// Each sensitive one on a card of its own, never kept as allowed.
		const sensitive = asked.filter((request) => request.mustAsk === true);
		expect(sensitive.map((request) => request.permission).sort()).toEqual([
			"settings:sensitive:assistantPermissions",
			"settings:sensitive:claudePath",
		]);
		expect(asked.filter((request) => request.mustAsk !== true)).toHaveLength(1);
		expect(ctx.settings().claudePath).toBe("/tmp/claude");
		expect(ctx.settings().copilotTools).toBe("block");
		expect(always()).not.toContain("settings:sensitive:claudePath");
		const all = await runTool("settings_find", { query: "" }, ctx);
		expect(all.text).toContain("claudePath");
		expect(all.text).toContain("[the user is asked every time]");
		// A structured setting takes its whole value as JSON; a wrong shape is refused.
		const pinned = await runTool(
			"settings_set",
			{ changes: [{ key: "jiraFavorites", value: '"nope"' }] },
			ctx,
		);
		expect(pinned.text).toContain("is not a value it takes");
	});

	it("never shows the model how an MCP server runs: its tokens stay out", async () => {
		const { ctx } = context(() => allow);
		ctx.changeSettings({
			assistantMcpServers: [
				{
					name: "github",
					transport: "http",
					command: "",
					args: ["--secret-arg"],
					env: { TOKEN: "env-secret" },
					url: "https://mcp.example.com/mcp",
					headers: { Authorization: "Bearer header-secret" },
					tools: ["search"],
					purpose: "The team's GitHub.",
					preset: "github",
					enabled: true,
					keepAlive: false,
				},
			],
			assistantModes: { code: { mcp: ["github"] } },
		});
		const read = await runTool(
			"settings_get",
			{ keys: ["assistantModes", "assistantMcpServers"] },
			ctx,
		);
		expect(read.text).toContain('"mcp":["github"]');
		for (const secret of ["header-secret", "env-secret", "--secret-arg", "mcp.example.com"]) {
			expect(read.text).not.toContain(secret);
		}
	});

	it("does not ask again what was allowed for the session or always", async () => {
		const { ctx, asked, always } = context((request) =>
			request.permission === "settings/appearance"
				? { approved: true, scope: "session" }
				: { approved: true, scope: "always" },
		);
		await runTool("settings_set", { changes: [{ key: "theme", value: "dark" }] }, ctx);
		await runTool("settings_set", { changes: [{ key: "palette", value: "rose" }] }, ctx);
		await runTool("settings_set", { changes: [{ key: "autoSave", value: true }] }, ctx);
		await runTool("settings_set", { changes: [{ key: "spellCheck", value: false }] }, ctx);
		// A page at a time, as the window shows them: the theme's allows the palette, not the editing.
		expect(asked.map((request) => request.permission)).toEqual([
			"settings/appearance",
			"settings/editor",
		]);
		expect(always()).toEqual(["settings/editor"]);
	});

	it("asks again for a setting on another page than the one allowed", async () => {
		const { ctx, asked } = context(() => ({ approved: true, scope: "session" }));
		await runTool("settings_set", { changes: [{ key: "theme", value: "dark" }] }, ctx);
		// Full Width is on Document View, not on Theme & Colours: allowing the theme did not allow it.
		await runTool("settings_set", { changes: [{ key: "fullWidth", value: true }] }, ctx);
		expect(asked.map((request) => request.permission)).toEqual([
			"settings/appearance",
			"settings/documentView",
		]);
	});

	it("moves the Jira panel to the bottom dock", async () => {
		const { ctx, asked, settings } = context(() => allow);
		const moved = await runTool("pane_move", { pane: "jira", place: "bottom" }, ctx);
		expect(moved.text).toBe("Moved: Jira: Left → Bottom. It shows once connected.");
		expect(asked[0]).toMatchObject({
			permission: "settings/panels",
			lines: ["Jira: Left → Bottom"],
		});
		expect(settings().panePlaces.jira).toBe("bottom");
		expect(settings().bottomDock).toBe(true);
		expect(settings().bottomPane).toBe("jira");
	});

	it("moves its own panel under the document", async () => {
		const { ctx, settings } = context(() => allow);
		const moved = await runTool("pane_move", { pane: "assistant", place: "bottom" }, ctx);
		expect(moved.text).toBe("Moved: Assistant: Right → Bottom.");
		expect(settings().assistantPlace).toBe("bottom");
		expect(
			(await runTool("pane_move", { pane: "assistant", place: "hidden" }, ctx)).text,
		).toContain("left, right or bottom");
	});

	it("shows a panel on its own side, closing its own panel there, and its Undo opens that again", async () => {
		const { ctx, events, settings } = context(() => allow);
		ctx.changeSettings({ assistant: true, assistantPlace: "right", rightDock: false });
		const shown = await runTool("pane_show", { pane: "notes" }, ctx);
		expect(shown.text).toBe("Shown: notes.");
		// One panel open on each side: My Notes on the right, the assistant's panel closed.
		expect(settings()).toMatchObject({ rightDock: true, rightPane: "notes", assistant: false });
		expect(events.at(-1)).toMatchObject({
			kind: "changed",
			undo: { rightDock: false, assistant: true },
		});
	});

	it("changes the language through the app's own flow", async () => {
		const { ctx, languages } = context(() => allow);
		const set = await runTool("settings_set", { changes: [{ key: "language", value: "tr" }] }, ctx);
		expect(set.text).toContain("Language: System Language → Türkçe");
		expect(languages).toEqual(["tr"]);
	});

	it("reads a long document by its parts and changes it through the window", async () => {
		const text =
			"# Analiz\n\n## Amaç\n\nSipariş iptali hızlı olmalı.\n\n## Kapsam\n\nWeb ve mobil.\n";
		const document = { tabId: "tab-1", name: "analiz.md", text, selection: "" };
		const { ctx, asked, rendered } = context(() => allow, { document });
		// Asked first, all at once, when changes are not reviewed in the document.
		ctx.changeSettings({ assistantEditReview: false });
		expect(toolsFor(ctx).map((tool) => tool.definition.name)).toEqual(
			expect.arrayContaining(["document_outline", "document_read", "document_edit"]),
		);
		expect((await runTool("document_outline", {}, ctx)).text).toContain("## Amaç (lines 3-6");
		expect((await runTool("document_read", { heading: "amaç" }, ctx)).text).toBe(
			"(lines 3-6 of 10)\n## Amaç\n\nSipariş iptali hızlı olmalı.\n",
		);
		expect((await runTool("document_search", { query: "MOBİL" }, ctx)).text).toBe(
			"9: Web ve mobil.",
		);

		const missing = await runTool(
			"document_edit",
			{ actions: [{ type: "replace", find: "yok böyle bir metin", replace: "x" }] },
			ctx,
		);
		expect(missing.text).toContain("is not in the document");
		expect(asked).toHaveLength(0);

		const edited = await runTool(
			"document_edit",
			{ actions: [{ type: "replace", find: "hızlı olmalı", replace: "2 sn içinde onaylanmalı" }] },
			ctx,
		);
		expect(edited.text).toContain("Changed the document");
		expect(asked[0]).toMatchObject({ risk: "document", permission: "document" });
		expect(asked[0]?.preview).toBe("- hızlı olmalı\n+ 2 sn içinde onaylanmalı");
		expect(rendered[0]).toMatchObject({ name: "document_edit", input: { tabId: "tab-1" } });
		expect(document.text).toBe("# Yeni\n");
	});

	it("shows a change in the document for review, without asking first", async () => {
		const text = "# Analiz\n\nSipariş iptali hızlı olmalı.\n";
		const document = { tabId: "tab-1", name: "analiz.md", text, selection: "" };
		const { ctx, asked, rendered } = context(() => allow, { document });
		const edited = await runTool(
			"document_edit",
			{ actions: [{ type: "replace", find: "hızlı olmalı", replace: "2 sn içinde onaylanmalı" }] },
			ctx,
		);
		expect(edited.text).toContain("each part marked for the user to accept or reject");
		expect(asked).toHaveLength(0);
		expect(rendered[0]).toMatchObject({
			name: "document_edit",
			input: { tabId: "tab-1", review: true },
		});
		expect(document.text).toBe("# Yeni\n");
	});

	it("offers the document's tools only when the document is shared", () => {
		const { ctx } = context(() => allow);
		const names = toolsFor(ctx).map((tool) => tool.definition.name);
		expect(names).toContain("settings_set");
		expect(names).not.toContain("document_read");
	});

	it("tells the user that a change comes after Jira or Confluence content was read", async () => {
		const { ctx, asked } = context(() => allow);
		ctx.readExternal = true;
		await runTool("pane_move", { pane: "files", place: "right" }, ctx);
		expect(asked[0]?.afterExternal).toBe(true);
	});

	it("gives its guides on request", async () => {
		const { ctx } = context(() => allow);
		expect((await runTool("kalem_help", { topic: "diagram" }, ctx)).text).toContain('"shape"');
		expect((await runTool("kalem_help", { topic: "nope" }, ctx)).text).toContain("Topics: diagram");
		expect((await runTool("app_state", {}, ctx)).text).toContain("Jira: not connected");
		expect((await runTool("kalem_tools", { query: "panel" }, ctx)).text).toContain("pane_move");
	});
});
