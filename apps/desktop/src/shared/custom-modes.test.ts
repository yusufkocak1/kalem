import { describe, expect, it } from "vitest";
import {
	customExcluded,
	customInstructions,
	newCustomMode,
	parseCustomModes,
	serverName,
} from "./custom-modes.js";
import { claudeAllowed, claudeServers, copilotServers, parseMcpServers } from "./mcp-servers.js";
import { detectMode } from "./mode-detect.js";
import { modePrompt, modeServers, modeToolsExcluded } from "./modes.js";

const SERVERS = parseMcpServers([
	{
		name: "files",
		transport: "stdio",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
		env: { TOKEN: "x", "bad key": "y" },
	},
	{
		name: "web",
		transport: "http",
		url: "https://mcp.example.com/mcp",
		headers: { Authorization: "Bearer t" },
		tools: ["search"],
	},
	{ name: "off", transport: "stdio", command: "x", enabled: false },
	{ name: "unused", transport: "stdio", command: "x" },
	{ name: "kalem", transport: "stdio", command: "x" },
	{ name: "nourl", transport: "http", url: "ftp://x" },
]);

const RAW = {
	id: "custom-1",
	name: "Test Analisti",
	icon: "target",
	description: "Test senaryosu yazar",
	prompt: "You are a test analyst.",
	steps: [
		{ id: "step-1", on: true, title: "Senaryolar", instruction: "Write test cases." },
		{ id: "step-2", on: false, title: "Kapalı", instruction: "Skip me." },
	],
	tools: ["document_read", "jira_get_issue"],
	mcp: ["files", "web", "off", " web ", ""],
	keywords: ["test senaryosu"],
	detail: "short",
};

describe("modes the user makes", () => {
	it("are read with their steps, tools and MCP servers, and only what is valid", () => {
		const [mode] = parseCustomModes([RAW, { id: "nope", name: "x" }, { id: "custom-2" }, "junk"]);
		expect(mode?.mcp).toEqual(["files", "web", "off"]);
		expect(SERVERS.map((server) => server.name)).toEqual(["files", "web", "off", "unused"]);
		expect(SERVERS[0]?.env).toEqual({ TOKEN: "x" });
		expect(mode?.tools).toEqual(["document_read", "jira_get_issue"]);
		expect(parseCustomModes([RAW, RAW])).toHaveLength(1);
		expect(serverName(" my server! ")).toBe("my-server");
	});

	it("tell the model their instructions and the steps that are on", () => {
		const [mode] = parseCustomModes([RAW]);
		if (mode === undefined) throw new Error("no mode");
		const text = customInstructions(mode);
		expect(text).toContain("## Mode: Test Analisti");
		expect(text).toContain("You are a test analyst.");
		expect(text).toContain("1. Write test cases.");
		expect(text).not.toContain("Skip me.");
		// The servers it uses are told of where the CLI is connected to them (assistant-prompt).
		expect(text).not.toContain("MCP");
		expect(text).toContain("Keep the reply short");
		expect(modePrompt("custom-1", {}, [mode])).toBe(text);
		// A mode that is gone is Ask.
		expect(modePrompt("custom-9", {}, [mode])).toBe("");
	});

	it("give only the tools chosen, and the servers they use to the CLIs", () => {
		const [mode] = parseCustomModes([RAW]);
		if (mode === undefined) throw new Error("no mode");
		const servers = modeServers("custom-1", {}, [mode], SERVERS);
		expect(servers.map((server) => server.name)).toEqual(["files", "web", "off"]);
		const all = ["document_read", "document_edit", "jira_get_issue", "report_findings"];
		expect([...customExcluded(mode, all)]).toEqual(["document_edit", "report_findings"]);
		expect([...modeToolsExcluded("custom-1", {}, [mode], all)]).toEqual([
			"document_edit",
			"report_findings",
		]);
		expect(customExcluded({ ...mode, tools: "all" }, all).size).toBe(0);
		expect(claudeServers(servers)).toEqual({
			files: {
				type: "stdio",
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
				env: { TOKEN: "x" },
			},
			web: {
				type: "http",
				url: "https://mcp.example.com/mcp",
				headers: { Authorization: "Bearer t" },
			},
		});
		expect(copilotServers(servers)).toMatchObject({
			files: { type: "local", command: "npx", tools: ["*"] },
			web: { type: "http", tools: ["search"] },
		});
		expect(claudeAllowed(servers)).toEqual(["mcp__files", "mcp__web__search"]);
	});

	it("are chosen automatically by their words", () => {
		const modes = parseCustomModes([RAW]);
		const none = { hasDocument: false, hasWorkspace: false };
		expect(detectMode("Bu gereksinim için test senaryosu çıkar", none, {}, modes).mode).toBe(
			"custom-1",
		);
		expect(detectMode("KVKK nedir?", none, {}, modes).mode).toBe("ask");
		expect(newCustomMode("Yeni", modes).id).toBe("custom-2");
	});
});
