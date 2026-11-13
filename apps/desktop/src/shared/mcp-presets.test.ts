import { describe, expect, it } from "vitest";
import { stringsFor } from "./i18n.js";
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
			expect(server.preset).toBe(preset.id);
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

	it("each say how to set them up: what they are, then steps, in both languages", () => {
		for (const language of ["en", "tr"] as const) {
			const t = stringsFor(language);
			for (const preset of MCP_PRESETS) {
				const [intro, ...steps] = t[preset.guide].split("\n");
				expect(intro?.length).toBeGreaterThan(20);
				expect(steps.length).toBeGreaterThanOrEqual(2);
				for (const sample of preset.samples ?? []) expect(t[sample.title]).not.toBe("");
			}
		}
		const dbhub = MCP_PRESETS.find((preset) => preset.id === "dbhub");
		const toml = dbhub?.samples?.find((sample) => sample.title === "mcpSampleToml")?.text ?? "";
		// The sample defines exactly the tools the server is limited to.
		for (const tool of dbhub?.server.tools ?? []) expect(toml).toContain(`name        = "${tool}"`);
	});
});
