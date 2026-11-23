import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { McpServer } from "../shared/mcp-servers.js";
import { KeptServers } from "./mcp-kept.js";

/**
 * A stdio MCP server that holds something between calls (as a browser
 * holds a sign-in): `open` counts up, `count` says how far, `slow` answers
 * late. It writes down each greeting and what it heard back from the client.
 */
const SERVER = `
const fs = require("node:fs");
const log = process.argv[2];
let opened = 0;
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const note = (line) => fs.appendFileSync(log, line + "\\n");
let rest = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	rest += chunk;
	let at;
	while ((at = rest.indexOf("\\n")) !== -1) {
		const line = rest.slice(0, at);
		rest = rest.slice(at + 1);
		if (line.trim() === "") continue;
		const message = JSON.parse(line);
		if (message.method === "initialize") {
			note("initialize");
			send({ id: message.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
			// It asks the client for its folders, and says something on the side.
			send({ id: "roots-1", method: "roots/list" });
			send({ method: "notifications/message", params: { level: "info", data: "hello" } });
		} else if (message.id === "roots-1") {
			note("roots answered: " + (message.error ? "declined" : "given"));
		} else if (message.method === "notifications/cancelled") {
			note("cancelled " + message.params.requestId);
		} else if (message.method === "tools/call") {
			const name = message.params.name;
			if (name === "open") opened++;
			const answer = () => send({ id: message.id, result: { content: [{ type: "text", text: name + ":" + opened + ":" + process.pid }] } });
			if (name === "slow") setTimeout(answer, 300);
			else answer();
		}
	}
});
process.stdin.on("end", () => {
	note("stdin ended");
	process.exit(0);
});
`;

const kept: KeptServers[] = [];
const shims: ChildProcessWithoutNullStreams[] = [];

afterEach(() => {
	for (const shim of shims.splice(0)) shim.kill();
	for (const each of kept.splice(0)) each.stopAll();
});

async function setUp() {
	const folder = await mkdtemp(join(tmpdir(), "kalem-kept-"));
	const script = join(folder, "server.cjs");
	const log = join(folder, "server.log");
	await writeFile(script, SERVER);
	const servers = new KeptServers({ folder, node: process.execPath, env: () => process.env });
	kept.push(servers);
	const server: McpServer = {
		name: "tarayici",
		transport: "stdio",
		command: process.execPath,
		args: [script, log],
		env: {},
		url: "",
		headers: {},
		tools: [],
		purpose: "",
		preset: "",
		enabled: true,
		keepAlive: true,
	};
	const lines = async (): Promise<string[]> =>
		(await readFile(log, "utf8").catch(() => "")).split("\n").filter((line) => line !== "");
	return { servers, server, lines };
}

/** A question's CLI: runs the stand-in it was given, and talks to it a line at a time. */
function cli(stand: McpServer) {
	const shim = spawn(stand.command, [...stand.args], {
		env: { ...process.env, ...stand.env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	shims.push(shim);
	const answers = new Map<unknown, (message: Record<string, unknown>) => void>();
	let rest = "";
	shim.stdout.setEncoding("utf8");
	shim.stdout.on("data", (chunk: string) => {
		rest += chunk;
		let at = rest.indexOf("\n");
		while (at !== -1) {
			const message = JSON.parse(rest.slice(0, at)) as Record<string, unknown>;
			rest = rest.slice(at + 1);
			at = rest.indexOf("\n");
			answers.get(message.id)?.(message);
		}
	});
	const ask = (id: number, method: string, params: Record<string, unknown> = {}) =>
		new Promise<Record<string, unknown>>((resolve) => {
			answers.set(id, resolve);
			shim.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	const tell = (method: string, params: Record<string, unknown> = {}) =>
		shim.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	const text = (answer: Record<string, unknown>): string =>
		(answer.result as { content: { text: string }[] }).content[0]?.text ?? "";
	const call = async (id: number, name: string) => text(await ask(id, "tools/call", { name }));
	const done = () =>
		new Promise<void>((resolve) => {
			shim.once("close", () => resolve());
			shim.stdin.end();
		});
	return { ask, tell, call, done };
}

describe("MCP servers kept running between questions", () => {
	it("gives the CLI a stand-in for a server kept running, and leaves the others as they are", async () => {
		const { servers, server } = await setUp();
		const other: McpServer = { ...server, name: "diger", keepAlive: false };
		const [stand, same] = await servers.bridge([server, other]);
		expect(stand?.name).toBe("tarayici");
		expect(stand?.command).toBe(process.execPath);
		expect(stand?.args).toHaveLength(1);
		expect(stand?.args[0]).toMatch(/kalem-kept\.cjs$/);
		expect(stand?.env.KALEM_KEPT_SERVER).toBe("tarayici");
		expect(stand?.env.KALEM_KEPT_TOKEN).toMatch(/^[0-9a-f]{64}$/);
		expect(stand?.env.KALEM_KEPT_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		// The token is in the stand-in's environment, never on its command line.
		expect(stand?.args.join(" ")).not.toContain(stand?.env.KALEM_KEPT_TOKEN);
		expect(same).toBe(other);
		expect(servers.running()).toEqual(["tarayici"]);
	});

	it("keeps what the server holds from one question's CLI to the next, greeting it once", async () => {
		const { servers, server, lines } = await setUp();
		const [stand] = await servers.bridge([server]);
		const first = cli(stand as McpServer);
		const hello = await first.ask(1, "initialize", { protocolVersion: "2025-06-18" });
		expect(hello.result).toMatchObject({ serverInfo: { name: "fake" } });
		first.tell("notifications/initialized");
		const opened = await first.call(2, "open");
		expect(opened).toMatch(/^open:1:\d+$/);
		await first.done();

		// The next question: another CLI, the same server, what it held still there.
		const [again] = await servers.bridge([server]);
		const second = cli(again as McpServer);
		await second.ask(1, "initialize", { protocolVersion: "2025-06-18" });
		const counted = await second.call(2, "count");
		expect(counted).toBe(`count:1:${opened.split(":")[2]}`);
		await second.done();

		const log = await lines();
		expect(log.filter((line) => line === "initialize")).toHaveLength(1);
		// What it asked of the client was declined; what it said on the side went nowhere.
		expect(log).toContain("roots answered: declined");
		expect(log).not.toContain("stdin ended");
	});

	it("keeps two CLIs' requests apart when they number them alike", async () => {
		const { servers, server } = await setUp();
		const [stand] = await servers.bridge([server]);
		const a = cli(stand as McpServer);
		const b = cli(stand as McpServer);
		await Promise.all([a.ask(1, "initialize"), b.ask(1, "initialize")]);
		const [slow, open] = await Promise.all([a.call(7, "slow"), b.call(7, "open")]);
		expect(slow).toMatch(/^slow:/);
		expect(open).toMatch(/^open:1:/);
	});

	it("calls off what a CLI still waits for when it goes, and the server keeps running", async () => {
		const { servers, server, lines } = await setUp();
		const [stand] = await servers.bridge([server]);
		const gone = cli(stand as McpServer);
		await gone.ask(1, "initialize");
		void gone.ask(2, "tools/call", { name: "slow" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		await gone.done();
		await expect
			.poll(async () => (await lines()).some((line) => line.startsWith("cancelled ")))
			.toBe(true);
		expect(servers.running()).toEqual(["tarayici"]);
	});

	it("starts it again when it changed, and stops it when it is no longer kept", async () => {
		const { servers, server, lines } = await setUp();
		const [stand] = await servers.bridge([server]);
		const first = cli(stand as McpServer);
		await first.ask(1, "initialize");
		const before = await first.call(2, "open");
		await first.done();

		const changed = { ...server, env: { MODE: "other" } };
		const [restarted] = await servers.bridge([changed]);
		const second = cli(restarted as McpServer);
		await second.ask(1, "initialize");
		const after = await second.call(2, "count");
		expect(after).toMatch(/^count:0:/);
		expect(after.split(":")[2]).not.toBe(before.split(":")[2]);
		await second.done();

		servers.retain([{ ...changed, keepAlive: false }]);
		expect(servers.running()).toEqual([]);
		await expect.poll(async () => (await lines()).includes("stdin ended")).toBe(true);
	});

	it("says why when the server cannot start", async () => {
		const { servers, server } = await setUp();
		const broken = { ...server, args: ["-e", "process.exit(3)"] };
		const [stand] = await servers.bridge([broken]);
		const asked = cli(stand as McpServer);
		const answer = await asked.ask(1, "initialize");
		expect((answer.error as { message: string }).message).toMatch(/exit code 3|not running/);
	});
});
