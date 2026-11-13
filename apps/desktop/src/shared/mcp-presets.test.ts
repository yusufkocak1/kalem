import { describe, expect, it } from "vitest";
import { MCP_PRESETS, presetServer } from "./mcp-presets.js";
import { parseMcpServer, parseMcpServers } from "./mcp-servers.js";

describe("ready-made MCP servers", () => {
	it("are each a server the settings keep as it is, saying what it is for", () => {
		expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(7);
		expect(new Set(MCP_PRESETS.map((preset) => preset.id)).size).toBe(MCP_PRESETS.length);
		for (const preset of MCP_PRESETS) {
			const server = presetServer(preset, []);
			expect(parseMcpServer(server)).toEqual(server);
			expect(server.purpose).not.toBe("");
		}
	});

	it("take a name not yet used in the mode", () => {
		const github = MCP_PRESETS.find((preset) => preset.id === "github");
		if (github === undefined) throw new Error("no GitHub");
		const first = presetServer(github, []);
		const second = presetServer(github, [first]);
		const third = presetServer(github, [first, second]);
		expect([first.name, second.name, third.name]).toEqual(["github", "github-2", "github-3"]);
		expect(parseMcpServers([first, second, third])).toHaveLength(3);
	});
});
