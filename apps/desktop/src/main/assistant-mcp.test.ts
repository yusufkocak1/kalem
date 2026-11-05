import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssistantToolServer, MCP_TOOLS, mcpToolName } from "./assistant-mcp.js";
import type { ConfluenceClient } from "./confluence-client.js";
import type { JiraClient } from "./jira-client.js";

/** Just what the look-ups use of a client. */
const client = {
	site: "https://wiki.example.com",
	async find(request: { query: string }) {
		return {
			hits: [
				{
					id: "42",
					title: `Bulunan: ${request.query}`,
					titleParts: [],
					spaceName: "DEV",
					spaceKey: "DEV",
					modified: null,
					excerpt: [],
					path: [],
				},
			],
			total: 1,
			next: null,
		};
	},
	async page(id: string) {
		return {
			page: {
				site: "",
				id,
				title: "Sprint Planı",
				spaceKey: "DEV",
				version: 1,
				webUrl: "https://x",
			},
			storage: "<p>Hedef</p>",
		};
	},
} as unknown as ConfluenceClient;

const issue = {
	key: "DEV-7",
	summary: "Giriş zaman aşımı",
	status: "In Progress",
	statusCategory: "indeterminate",
	type: "Bug",
	assignee: "Ayşe",
	priority: "High",
	updated: "2026-11-01T10:00:00.000+0300",
	url: "https://jira.example.com/browse/DEV-7",
	project: "Geliştirme",
	reporter: "Mehmet",
	created: null,
	due: null,
	resolution: "",
	labels: [],
	components: [],
	fixVersions: [],
	description: "Oturum **30 sn** sonra düşüyor.",
	parent: null,
	subtasks: [],
	links: [],
	comments: [],
	commentTotal: 0,
};
const jira = {
	site: "https://jira.example.com",
	async issue() {
		return issue;
	},
	async search(jql: string) {
		return { jql, issues: [issue], total: 1, next: null };
	},
} as unknown as JiraClient;

/** Runs the server's script as the CLI would, sends it JSON-RPC lines and collects the answers. */
async function talk(
	config: string,
	messages: readonly unknown[],
): Promise<Record<string, unknown>[]> {
	const { mcpServers } = JSON.parse(await readFile(config, "utf8"));
	const server = mcpServers.kalem as {
		command: string;
		args: string[];
		env: Record<string, string>;
	};
	// The test runs the script with Node itself, as the app's executable would with ELECTRON_RUN_AS_NODE.
	const child = spawn(process.execPath, server.args, {
		env: { ...process.env, ...server.env },
		stdio: ["pipe", "pipe", "inherit"],
	});
	const answers: Record<string, unknown>[] = [];
	const expected = messages.filter(
		(message) => (message as { id?: unknown }).id !== undefined,
	).length;
	return new Promise((resolve, reject) => {
		let rest = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			rest += chunk;
			const lines = rest.split("\n");
			rest = lines.pop() ?? "";
			for (const line of lines) if (line.trim() !== "") answers.push(JSON.parse(line));
			if (answers.length >= expected) {
				child.stdin.end();
				resolve(answers);
			}
		});
		child.on("error", reject);
		for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
	});
}

describe("AssistantToolServer", () => {
	it("serves Kalem's Confluence tools to the CLI over MCP, through the app", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-mcp-"));
		let connected = true;
		const tools = new AssistantToolServer({
			folder,
			node: "/path/to/Kalem",
			confluence: async () => (connected ? client : null),
			jira: async () => (connected ? jira : null),
			notConnected: () => "Not connected to Confluence.",
			jiraNotConnected: () => "Not connected to Jira.",
		});
		try {
			const config = await tools.config();
			expect(await tools.config()).toBe(config);
			// Only the user reads the file that holds the token.
			if (process.platform !== "win32") expect((await stat(config)).mode & 0o077).toBe(0);
			const written = JSON.parse(await readFile(config, "utf8"));
			expect(written.mcpServers.kalem).toMatchObject({
				type: "stdio",
				command: "/path/to/Kalem",
				env: {
					ELECTRON_RUN_AS_NODE: "1",
					KALEM_TOOLS_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/call$/),
				},
			});

			const answers = await talk(config, [
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				{ jsonrpc: "2.0", id: 2, method: "tools/list" },
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "confluence_search", arguments: { query: "onay" } },
				},
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "confluence_read_page", arguments: { page_id: "42" } },
				},
				{ jsonrpc: "2.0", id: 5, method: "nope" },
				{
					jsonrpc: "2.0",
					id: 6,
					method: "tools/call",
					params: { name: "jira_get_issue", arguments: { key: "dev-7" } },
				},
				{
					jsonrpc: "2.0",
					id: 7,
					method: "tools/call",
					params: { name: "jira_search", arguments: { jql: "project = DEV" } },
				},
			]);
			const byId = new Map(answers.map((answer) => [answer.id, answer]));
			expect(byId.get(1)).toMatchObject({
				result: {
					protocolVersion: "2025-06-18",
					capabilities: { tools: {} },
					serverInfo: { name: "kalem" },
				},
			});
			const result = (id: number): Record<string, unknown> =>
				(byId.get(id)?.result ?? {}) as Record<string, unknown>;
			expect(result(2).tools).toEqual(MCP_TOOLS);
			const text = (id: number): string =>
				(result(id).content as { text: string }[] | undefined)?.[0]?.text ?? "";
			expect(text(3)).toContain("1. Bulunan: onay (page id 42)");
			expect(text(4)).toContain('Page "Sprint Planı" (page id 42, space DEV)');
			expect(text(4)).toContain("Hedef");
			expect(byId.get(5)).toMatchObject({ error: { code: -32601 } });
			expect(text(6)).toContain("Issue DEV-7: Giriş zaman aşımı");
			expect(text(6)).toContain("Status: In Progress");
			expect(text(6)).toContain("Oturum **30 sn** sonra düşüyor.");
			expect(text(7)).toContain("Jira search `project = DEV`: 1 issues.");
			expect(text(7)).toContain("- DEV-7 Giriş zaman aşımı (Bug, In Progress, assignee Ayşe");

			// Without a connection the call says so, as an error the model reads.
			connected = false;
			const [, offline] = await talk(config, [
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "confluence_search", arguments: { query: "x" } },
				},
			]);
			expect(offline).toMatchObject({
				result: { content: [{ text: "Not connected to Confluence." }], isError: true },
			});
			const [, noJira] = await talk(config, [
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "jira_get_issue", arguments: { key: "DEV-7" } },
				},
			]);
			expect(noJira).toMatchObject({
				result: { content: [{ text: "Not connected to Jira." }], isError: true },
			});
		} finally {
			tools.close();
		}
	});

	it("names its tools as Claude Code calls them", () => {
		expect(mcpToolName("confluence_search")).toBe("mcp__kalem__confluence_search");
	});

	it("answers only calls that carry this run's token", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-mcp-"));
		const tools = new AssistantToolServer({
			folder,
			node: "node",
			confluence: async () => client,
			jira: async () => null,
			notConnected: () => "",
			jiraNotConnected: () => "",
		});
		try {
			const config = JSON.parse(await readFile(await tools.config(), "utf8"));
			const url = config.mcpServers.kalem.env.KALEM_TOOLS_URL as string;
			const response = await fetch(url, {
				method: "POST",
				headers: { authorization: "Bearer wrong" },
				body: JSON.stringify({ name: "confluence_search", arguments: { query: "x" } }),
			});
			expect(response.status).toBe(403);
		} finally {
			tools.close();
		}
	});
});
