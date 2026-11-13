import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { McpServer } from "../shared/mcp-servers.js";
import { newMcpServer, parseToolList, toggleTool } from "../shared/mcp-servers.js";
import { answerIn, listMcpTools } from "./mcp-probe.js";

/** A server that lists its tools in two pages, as MCP servers on standard input and output do. */
const FAKE = `
const readline = require("node:readline");
console.log("not json: a banner some servers print");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	const message = JSON.parse(line);
	const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
	if (message.method === "initialize") reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } });
	else if (message.method === "tools/list" && !message.params.cursor) reply({ tools: [{ name: "query", description: "Runs a query" }], nextCursor: "2" });
	else if (message.method === "tools/list") reply({ tools: [{ name: "schema", description: "Shows " + process.env.FAKE_WORD }] });
});
`;

const stdio = (path: string): McpServer => ({
	...newMcpServer([]),
	command: process.execPath,
	args: [path],
	env: { FAKE_WORD: "tables" },
});

describe("listMcpTools", () => {
	it("starts a program and lists its tools, page by page", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-mcp-"));
		const path = join(folder, "fake.cjs");
		await writeFile(path, FAKE);
		expect(await listMcpTools(stdio(path))).toEqual({
			ok: true,
			tools: [
				{ name: "query", description: "Runs a query" },
				{ name: "schema", description: "Shows tables" },
			],
		});
	});

	it("says why when the program cannot answer", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-mcp-"));
		const path = join(folder, "dies.cjs");
		await writeFile(path, 'console.error("missing API_KEY"); process.exit(3);');
		const answer = await listMcpTools(stdio(path));
		expect(answer.ok).toBe(false);
		expect(!answer.ok && answer.error).toMatch(/exit code 3[\s\S]*missing API_KEY/);
	});

	it("asks an address, answered as events, with its session and headers", async () => {
		const seen: string[] = [];
		const server = createServer((request, response) => {
			let body = "";
			request.on("data", (chunk) => {
				body += chunk;
			});
			request.on("end", () => {
				if (request.method !== "POST") return void response.end();
				const message = JSON.parse(body);
				seen.push(
					`${message.method} ${request.headers.authorization} ${request.headers["mcp-session-id"] ?? "-"}`,
				);
				if (message.id === undefined) return void response.writeHead(202).end();
				const result =
					message.method === "initialize"
						? { protocolVersion: "2025-06-18", capabilities: {} }
						: { tools: [{ name: "search", description: "Searches logs" }] };
				response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "s1" });
				response.end(
					`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`,
				);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const answer = await listMcpTools({
			...newMcpServer([]),
			transport: "http",
			url: `http://127.0.0.1:${port}/mcp`,
			headers: { Authorization: "Bearer t" },
		});
		server.close();
		expect(answer).toEqual({ ok: true, tools: [{ name: "search", description: "Searches logs" }] });
		expect(seen).toEqual([
			"initialize Bearer t -",
			"notifications/initialized Bearer t s1",
			"tools/list Bearer t s1",
		]);
	});
});

describe("answerIn", () => {
	it("reads a JSON body, or the event with the request's id", () => {
		expect(answerIn('{"id":1,"result":{}}', "application/json", 1)).toEqual({ id: 1, result: {} });
		const events =
			'data: {"method":"notifications/message"}\n\ndata: {"id":2,"result":{"a":1}}\n\n';
		expect(answerIn(events, "text/event-stream", 2)).toEqual({ id: 2, result: { a: 1 } });
		expect(() => answerIn("", "text/event-stream", 2)).toThrow();
	});
});

describe("parseToolList", () => {
	it("keeps named tools once each", () => {
		expect(
			parseToolList({
				tools: [{ name: "a", description: "x" }, { name: "a" }, { name: "" }, { name: "b" }],
			}),
		).toEqual([
			{ name: "a", description: "x" },
			{ name: "b", description: "" },
		]);
		expect(parseToolList(null)).toEqual([]);
	});
});

describe("toggleTool", () => {
	const listed = ["a", "b", "c"];
	it("turns one off from all of them", () => {
		expect(toggleTool([], listed, "b", false)).toEqual(["a", "c"]);
	});
	it("keeps all on as all of them", () => {
		expect(toggleTool(["a", "c"], listed, "b", true)).toEqual([]);
	});
	it("does not leave none, which would mean all", () => {
		expect(toggleTool(["a"], listed, "a", false)).toBeNull();
	});
	it("keeps a typed tool the server did not list", () => {
		expect(toggleTool(["a", "x"], listed, "b", true)).toEqual(["a", "b", "x"]);
		expect(toggleTool(["a", "x"], listed, "x", false)).toEqual(["a"]);
	});
});
