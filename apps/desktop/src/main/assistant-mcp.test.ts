import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFLUENCE_TOOLS, ConfluenceLookups, isConfluenceTool } from "./assistant-confluence.js";
import { isJiraTool, JIRA_TOOLS, JiraLookups } from "./assistant-jira.js";
import { AssistantToolServer, mcpToolName, mcpTools } from "./assistant-mcp.js";
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
	id: "10007",
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
	descriptionHtml: null,
	remoteLinks: [],
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
	const tools = [...CONFLUENCE_TOOLS, ...JIRA_TOOLS];
	/** The app's side of a run: the look-ups, as the question would run them. */
	const call = async (name: string, input: unknown) => {
		if (isConfluenceTool(name)) {
			return {
				text: await new ConfluenceLookups(client).runTool(name, input, () => {}),
				isError: false,
			};
		}
		if (isJiraTool(name)) {
			return { text: await new JiraLookups(jira).runTool(name, input, () => {}), isError: false };
		}
		return { text: `There is no tool named ${name}.`, isError: true };
	};

	it("serves a question's tools to the CLI over MCP, through the app", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-mcp-"));
		const server = new AssistantToolServer({ folder, node: "/path/to/Kalem" });
		try {
			const run = await server.open(() => tools, call);
			// Only the user reads the files that hold the token.
			if (process.platform !== "win32") {
				expect((await stat(run.claude)).mode & 0o077).toBe(0);
				expect((await stat(run.copilot)).mode & 0o077).toBe(0);
			}
			const written = JSON.parse(await readFile(run.claude, "utf8"));
			expect(written.mcpServers.kalem).toMatchObject({
				type: "stdio",
				command: "/path/to/Kalem",
				env: {
					ELECTRON_RUN_AS_NODE: "1",
					KALEM_TOOLS_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
					KALEM_TOOLS_RUN: expect.stringMatching(/^[0-9a-f]{24}$/),
				},
			});
			// Copilot's form of the same server.
			const copilot = JSON.parse(await readFile(run.copilot, "utf8"));
			expect(copilot.mcpServers.kalem).toMatchObject({ type: "local", tools: ["*"] });

			const answers = await talk(run.claude, [
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
					params: { name: "nothing", arguments: {} },
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
			expect(result(2).tools).toEqual(mcpTools(tools));
			const text = (id: number): string =>
				(result(id).content as { text: string }[] | undefined)?.[0]?.text ?? "";
			expect(text(3)).toContain("1. Bulunan: onay (page id 42)");
			expect(text(4)).toContain('Page "Sprint Planı" (page id 42, space DEV)');
			expect(text(4)).toContain("Hedef");
			expect(byId.get(5)).toMatchObject({ error: { code: -32601 } });
			expect(text(6)).toContain("Issue DEV-7: Giriş zaman aşımı");
			expect(text(6)).toContain("Oturum **30 sn** sonra düşüyor.");
			expect(result(7)).toMatchObject({ isError: true });
			expect(text(7)).toContain("There is no tool named nothing.");

			// Once the question has ended, its tools answer no more, and its files are gone.
			const config = run.claude;
			const kept = await readFile(config, "utf8");
			await run.close();
			await expect(stat(config)).rejects.toThrow();
			const replay = join(folder, "replay.json");
			await writeFile(replay, kept);
			const [, ended] = await talk(replay, [
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "confluence_search", arguments: { query: "x" } },
				},
			]);
			expect(ended).toMatchObject({ result: { isError: true } });
		} finally {
			server.close();
		}
	});

	it("names its tools as Claude Code calls them", () => {
		expect(mcpToolName("confluence_search")).toBe("mcp__kalem__confluence_search");
	});

	it("answers only calls that carry this app's token", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-mcp-"));
		const server = new AssistantToolServer({ folder, node: "node" });
		try {
			const run = await server.open(() => tools, call);
			const config = JSON.parse(await readFile(run.claude, "utf8"));
			const url = config.mcpServers.kalem.env.KALEM_TOOLS_URL as string;
			const response = await fetch(`${url}/call`, {
				method: "POST",
				headers: {
					authorization: "Bearer wrong",
					"x-kalem-run": config.mcpServers.kalem.env.KALEM_TOOLS_RUN,
				},
				body: JSON.stringify({ name: "confluence_search", arguments: { query: "x" } }),
			});
			expect(response.status).toBe(403);
			await run.close();
		} finally {
			server.close();
		}
	});
});
