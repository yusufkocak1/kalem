import { describe, expect, it } from "vitest";
import { parseCustomModes } from "./custom-modes.js";
import {
	liftModeServers,
	mcpInstructions,
	newMcpServer,
	PROJECT,
	parseMcpServers,
	projectFolder,
	withProject,
} from "./mcp-servers.js";
import { modeInstructions, parseModeSettings, resolveMode, storeMode } from "./mode-config.js";
import { modeServers, renameServerRefs } from "./modes.js";
import { parseSettings } from "./settings-schema.js";

const I18N = {
	name: "i18n-db",
	transport: "stdio",
	command: "npx",
	args: ["-y", "@bytebase/dbhub", "--transport", "stdio", "--config", "/home/me/dbhub.toml"],
	tools: ["add_i18n_key"],
	purpose: "The project's i18n database. When you add an i18n key in code, add it here too.",
};

describe("the assistant's MCP servers", () => {
	it("are read with what they are for, one of each name, and never Kalem's own", () => {
		const servers = parseMcpServers([
			I18N,
			{ ...I18N, purpose: "twice" },
			{ name: "kalem", command: "x" },
			{ name: "no-command", transport: "stdio" },
		]);
		expect(servers.map((server) => server.name)).toEqual(["i18n-db"]);
		expect(servers[0]?.purpose).toContain("i18n database");
		expect(parseMcpServers("junk")).toEqual([]);
		expect(newMcpServer(servers).name).toBe("server-2");
	});

	it("tell the model what each is for, so it uses them on its own", () => {
		const servers = parseMcpServers([I18N, { name: "off", command: "x", enabled: false }]);
		const text = mcpInstructions(servers);
		expect(text).toContain("Use them on your own");
		expect(text).toContain(
			"- i18n-db (tools: add_i18n_key): The project's i18n database. When you add an i18n key in code, add it here too.",
		);
		expect(text).not.toContain("off");
		// Without a purpose, they are only named.
		expect(mcpInstructions(parseMcpServers([{ name: "files", command: "x" }]))).toBe(
			"The user connected these MCP servers for this mode; use their tools when they help: files.",
		);
		expect(mcpInstructions([])).toBe("");
	});

	it("are the assistant's, and each mode, Kalem's or the user's, chooses them by name", () => {
		const all = parseMcpServers([I18N, { name: "files", command: "x" }]);
		const settings = parseModeSettings({ code: { mcp: ["i18n-db", "gone", "i18n-db"] } });
		const code = resolveMode("code", settings);
		expect(code.mcp).toEqual(["i18n-db", "gone"]);
		expect(storeMode(code)).toEqual({ mcp: ["i18n-db", "gone"] });
		expect(storeMode(resolveMode("code"))).toEqual({});
		// A name no server has any more is let go.
		expect(modeServers("code", settings, [], all).map((server) => server.name)).toEqual([
			"i18n-db",
		]);
		// Another mode does not get them.
		expect(modeServers("ask", settings, [], all)).toEqual([]);
		expect(modeInstructions("code", settings)).not.toContain("i18n-db");
	});

	it("move from the modes that kept their own to the assistant, once each", () => {
		const files = { name: "files", command: "npx", args: ["a"] };
		const settings = parseSettings({
			theme: "dark",
			assistantModes: {
				code: { detail: "short", mcp: [I18N, files] },
				ask: { mcp: [{ ...files, enabled: false }] },
				write: { extra: "x" },
			},
			assistantCustomModes: [
				{ id: "custom-1", name: "Mine", mcp: [{ name: "files", command: "other" }] },
			],
		});
		expect(settings.theme).toBe("dark");
		// Serena, which the assistant starts with, first.
		expect(settings.assistantMcpServers.map((server) => [server.name, server.enabled])).toEqual([
			["serena", true],
			["i18n-db", true],
			["files", true],
			["files-2", true],
		]);
		expect(settings.assistantModes.code).toEqual({
			detail: "short",
			mcp: ["serena", "i18n-db", "files"],
		});
		// It was off in that mode: the mode does not use it.
		expect(settings.assistantModes.ask).toEqual({ mcp: [] });
		expect(settings.assistantCustomModes[0]?.mcp).toEqual(["files-2"]);
		// Moved once: settings already moved are as they are.
		const again = { ...settings } as unknown as Record<string, unknown>;
		expect(liftModeServers(again)).toBe(again);
	});

	it("follow a server renamed or removed in every mode that uses it", () => {
		const [mine] = parseCustomModes([{ id: "custom-1", name: "Mine", mcp: ["db", "web"] }]);
		if (mine === undefined) throw new Error("no mode");
		const modes = parseModeSettings({ code: { mcp: ["db"] }, ask: { detail: "short" } });
		const renamed = renameServerRefs(modes, [mine], "db", "database");
		expect(renamed.assistantModes.code).toEqual({ mcp: ["database"] });
		expect(renamed.assistantCustomModes[0]?.mcp).toEqual(["database", "web"]);
		const removed = renameServerRefs(modes, [mine], "db", null);
		// The Code mode's servers by default (Serena) were not chosen: none is left.
		expect(removed.assistantModes).toEqual({ ask: { detail: "short" }, code: { mcp: [] } });
		expect(removed.assistantCustomModes[0]?.mcp).toEqual(["web"]);
	});

	it("start with Serena on the user's code, in the modes that read code", () => {
		const settings = parseSettings({});
		expect(settings.assistantMcpServers.map((server) => server.name)).toEqual(["serena"]);
		const used = (
			mode: "ask" | "write" | "review" | "prompt" | "code" | "app",
		): readonly string[] =>
			modeServers(mode, settings.assistantModes, [], settings.assistantMcpServers).map(
				(server) => server.name,
			);
		expect([used("code"), used("review"), used("prompt")]).toEqual([
			["serena"],
			["serena"],
			["serena"],
		]);
		expect([used("ask"), used("write"), used("app")]).toEqual([[], [], []]);
		// Turned off in a mode, it stays off; removed, it is not added again.
		const off = parseModeSettings({ code: storeMode({ ...resolveMode("code"), mcp: [] }) });
		expect(off.code).toEqual({ mcp: [] });
		expect(resolveMode("code", off).mcp).toEqual([]);
		expect(parseSettings({ assistantMcpServers: [] }).assistantMcpServers).toEqual([]);
	});

	it("work on the folder of each question, and are left out without one", () => {
		const [serena] = parseSettings({}).assistantMcpServers;
		if (serena === undefined) throw new Error("no Serena");
		expect(serena.args.at(-1)).toBe(PROJECT);
		const [filled] = withProject([serena], "/home/me/app");
		expect(filled?.args.slice(-2)).toEqual(["--project", "/home/me/app"]);
		expect(filled?.purpose).toContain("the user's code at /home/me/app");
		expect(withProject([serena], null)).toEqual([]);
		const files = parseMcpServers([{ name: "files", command: "x" }]);
		expect(withProject(files, null)).toEqual(files);
		expect(projectFolder(undefined, "", "/work", "/doc")).toBe("/work");
		expect(projectFolder(null, undefined)).toBeNull();
	});
});
