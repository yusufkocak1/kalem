import { describe, expect, it } from "vitest";
import { mcpInstructions, newMcpServer, parseMcpServers } from "./mcp-servers.js";
import { modeInstructions, parseModeSettings, resolveMode, storeMode } from "./mode-config.js";
import { modeServers } from "./modes.js";

const I18N = {
	name: "i18n-db",
	transport: "stdio",
	command: "npx",
	args: ["-y", "@bytebase/dbhub", "--transport", "stdio", "--config", "/home/me/dbhub.toml"],
	tools: ["add_i18n_key"],
	purpose: "The project's i18n database. When you add an i18n key in code, add it here too.",
};

describe("MCP servers in a mode", () => {
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

	it("are kept in Kalem's own modes too, and given to the CLI in them", () => {
		const settings = parseModeSettings({ code: { mcp: [I18N, { name: "kalem", command: "x" }] } });
		const code = resolveMode("code", settings);
		expect(code.mcp.map((server) => server.name)).toEqual(["i18n-db"]);
		expect(storeMode(code)).toEqual({ mcp: code.mcp });
		expect(storeMode(resolveMode("code"))).toEqual({});
		expect(modeInstructions("code", settings)).toContain("- i18n-db (tools: add_i18n_key)");
		expect(modeServers("code", settings)).toEqual(code.mcp);
		// Another mode does not get them.
		expect(modeServers("ask", settings)).toEqual([]);
		expect(modeInstructions("ask", settings)).not.toContain("i18n-db");
	});
});
