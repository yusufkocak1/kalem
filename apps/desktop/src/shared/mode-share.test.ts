import { describe, expect, it } from "vitest";
import type { CustomMode } from "./custom-modes.js";
import { newCustomMode } from "./custom-modes.js";
import type { McpServer } from "./mcp-servers.js";
import { newMcpServer } from "./mcp-servers.js";
import { resolveMode } from "./mode-config.js";
import type { ModeSettingsPart } from "./mode-share.js";
import {
	exportCustomMode,
	exportKalemMode,
	importMode,
	MODE_FILE_KIND,
	modeFileName,
	parseModeFile,
	sameNamed,
	serversOf,
	shareableServer,
	toFillIn,
} from "./mode-share.js";

const server = (name: string, more: Partial<McpServer> = {}): McpServer => ({
	...newMcpServer([]),
	name,
	args: ["-y", `@example/${name}`],
	...more,
});

const github = server("github", {
	transport: "http",
	command: "",
	args: [],
	url: "https://api.example.com/mcp?api_key=s3cret&region=eu",
	headers: { Authorization: "Bearer ghp_secret", "X-MCP-Readonly": "true" },
	purpose: "The team's GitHub.",
});
const sentry = server("sentry", {
	env: { SENTRY_ACCESS_TOKEN: "sntrys_secret", SENTRY_HOST: "sentry.io" },
	args: ["-y", "@sentry/mcp-server", "--api-key", "k3y", "--password=hunter2", "--verbose"],
	keepAlive: true,
});

const meeting: CustomMode = {
	...newCustomMode("Toplantı notu", []),
	icon: "chats",
	description: "Toplantıdan karar listesi",
	prompt: "Write meeting notes.",
	steps: [
		{
			id: "decisions",
			on: true,
			title: "Kararlar",
			instruction: "List the decisions.",
			custom: true,
		},
		{
			id: "owners",
			on: false,
			title: "Sorumlular",
			instruction: "List who does what.",
			custom: true,
			parallel: true,
		},
	],
	tools: ["document_read", "document_edit"],
	mcp: ["github", "sentry"],
	keywords: ["toplantı"],
	detail: "short",
	language: "tr",
	parallel: true,
	enabled: false,
};

const settings = (part: Partial<ModeSettingsPart> = {}): ModeSettingsPart => ({
	assistantModes: {},
	assistantCustomModes: [],
	assistantMcpServers: [],
	...part,
});

/** A file as it is written and read back. */
const roundTrip = (file: unknown) => {
	const read = parseModeFile(JSON.stringify(file, null, 2));
	if (!read.ok) throw new Error(read.error);
	return read.file;
};

describe("sharing an assistant mode as a file", () => {
	it("leaves out what looks like a secret, saying what to fill in", () => {
		expect(shareableServer(github)).toMatchObject({
			url: "https://api.example.com/mcp?api_key=<api_key>&region=eu",
			headers: { Authorization: "<Authorization>", "X-MCP-Readonly": "true" },
		});
		expect(shareableServer(sentry)).toMatchObject({
			env: { SENTRY_ACCESS_TOKEN: "<SENTRY_ACCESS_TOKEN>", SENTRY_HOST: "sentry.io" },
			args: [
				"-y",
				"@sentry/mcp-server",
				"--api-key",
				"<api-key>",
				"--password=<password>",
				"--verbose",
			],
			keepAlive: true,
		});
		// What was left to fill in already stays as it is.
		expect(shareableServer(server("gh", { env: { GITHUB_TOKEN: "<GITHUB_TOKEN>" } })).env).toEqual({
			GITHUB_TOKEN: "<GITHUB_TOKEN>",
		});
		expect(toFillIn([shareableServer(github), shareableServer(sentry)])).toEqual([
			"github: <api_key>",
			"github: <Authorization>",
			"sentry: <api-key>",
			"sentry: <password>",
			"sentry: <SENTRY_ACCESS_TOKEN>",
		]);
	});

	it("writes a mode of the user's with the servers it uses, and nothing secret", () => {
		const unused = server("unused");
		const file = exportCustomMode(meeting, [github, sentry, unused]);
		expect(file.kind).toBe(MODE_FILE_KIND);
		expect(file.custom).not.toHaveProperty("id");
		expect(file.custom).not.toHaveProperty("enabled");
		expect(file.servers.map((each) => each.name)).toEqual(["github", "sentry"]);
		const text = JSON.stringify(file);
		for (const secret of ["s3cret", "ghp_secret", "sntrys_secret", "k3y", "hunter2"]) {
			expect(text).not.toContain(secret);
		}
		expect(modeFileName("Toplantı: notu / v2")).toBe("Toplantı notu v2.kalem-mode.json");
		expect(modeFileName("   ")).toBe("mode.kalem-mode.json");
	});

	it("brings the same mode back on another computer, on and with an id of its own", () => {
		const file = roundTrip(exportCustomMode(meeting, [github, sentry]));
		const other = settings({
			assistantCustomModes: [{ ...newCustomMode("Başka", []), id: "custom-1" }],
		});
		const done = importMode(file, other, { servers: true, replace: false });
		expect(done?.custom).toBe("custom-2");
		const made = done?.patch.assistantCustomModes?.find((mode) => mode.id === "custom-2");
		const { id: _a, enabled: _b, ...expected } = meeting;
		expect(made).toEqual({ ...expected, id: "custom-2", enabled: true });
		expect(done?.added).toEqual(["github", "sentry"]);
		expect(done?.patch.assistantMcpServers?.map((each) => each.name)).toEqual(["github", "sentry"]);
	});

	it("keeps the user's own server of a name, and adds none unless asked", () => {
		const file = roundTrip(exportCustomMode(meeting, [github, sentry]));
		const mine = server("github", { url: "https://mine.example.com/mcp", transport: "http" });
		const other = settings({ assistantMcpServers: [mine] });
		expect(serversOf(file, other.assistantMcpServers).kept.map((each) => each.name)).toEqual([
			"github",
		]);
		const done = importMode(file, other, { servers: true, replace: false });
		expect(done?.added).toEqual(["sentry"]);
		expect(done?.patch.assistantMcpServers?.[0]).toBe(mine);
		const alone = importMode(file, other, { servers: false, replace: false });
		expect(alone?.added).toEqual([]);
		expect(alone?.patch).not.toHaveProperty("assistantMcpServers");
	});

	it("names it apart from a mode of the same name, or takes its place when asked", () => {
		const file = roundTrip(exportCustomMode(meeting, []));
		const same = { ...newCustomMode("toplantı NOTU", []), id: "custom-7", prompt: "Old." };
		const other = settings({ assistantCustomModes: [same] });
		expect(sameNamed(file, other.assistantCustomModes)).toBe(same);
		const copy = importMode(file, other, { servers: false, replace: false });
		expect(copy?.patch.assistantCustomModes?.map((mode) => mode.name)).toEqual([
			"toplantı NOTU",
			"Toplantı notu (2)",
		]);
		const replaced = importMode(file, other, { servers: false, replace: true });
		expect(replaced?.custom).toBe("custom-7");
		expect(replaced?.patch.assistantCustomModes).toHaveLength(1);
		expect(replaced?.patch.assistantCustomModes?.[0]).toMatchObject({
			id: "custom-7",
			name: "Toplantı notu",
			prompt: "Write meeting notes.",
		});
	});

	it("shares Kalem's mode as the user shaped it, which takes the place of the importer's", () => {
		const shaped = settings({
			assistantModes: {
				review: { detail: "detailed", extra: "Check the dates too.", mcp: ["github"] },
				code: { detail: "short" },
			},
			assistantMcpServers: [github, sentry],
		});
		const file = roundTrip(exportKalemMode("review", shaped));
		expect(file.kalem?.mode).toBe("review");
		expect(file.servers.map((each) => each.name)).toEqual(["github"]);
		const other = settings({
			assistantModes: { review: { detail: "short" }, write: { language: "en" } },
		});
		const done = importMode(file, other, { servers: true, replace: false });
		expect(done?.kalem).toBe("review");
		expect(done?.patch.assistantModes).toEqual({
			review: { detail: "detailed", extra: "Check the dates too.", mcp: ["github"] },
			write: { language: "en" },
		});
		expect(resolveMode("review", done?.patch.assistantModes).extra).toBe("Check the dates too.");
	});

	it("tells a file that is not a mode from one made by a newer Kalem", () => {
		expect(parseModeFile("{ not json")).toEqual({ ok: false, error: "json" });
		expect(parseModeFile('{"kind":"something"}')).toEqual({ ok: false, error: "kind" });
		expect(
			parseModeFile(`{"kind":"${MODE_FILE_KIND}","version":99,"custom":{"name":"x"}}`),
		).toEqual({ ok: false, error: "newer" });
		expect(parseModeFile(`{"kind":"${MODE_FILE_KIND}","version":1}`)).toEqual({
			ok: false,
			error: "empty",
		});
		expect(
			parseModeFile(`{"kind":"${MODE_FILE_KIND}","version":1,"kalem":{"mode":"nope"}}`),
		).toEqual({ ok: false, error: "empty" });
		// A byte-order mark, as some editors save JSON, is fine.
		expect(parseModeFile(`﻿{"kind":"${MODE_FILE_KIND}","custom":{"name":"A"}}`).ok).toBe(true);
	});

	it("drops what a mode cannot have, and adds no mode past the most kept", () => {
		const file = roundTrip({
			kind: MODE_FILE_KIND,
			version: 1,
			custom: { name: "Garip", icon: "nope", steps: [{ id: "BAD ID", instruction: "x" }] },
			servers: [
				{ name: "kalem", command: "x" },
				{ name: "ok", command: "npx" },
			],
		});
		expect(file.custom).toMatchObject({ name: "Garip", icon: "star", steps: [] });
		expect(file.servers.map((each) => each.name)).toEqual(["ok"]);
		const full = settings({
			assistantCustomModes: Array.from({ length: 30 }, (_, i) => ({
				...newCustomMode(`m${i}`, []),
				id: `custom-${i + 1}`,
			})),
		});
		expect(importMode(file, full, { servers: true, replace: false })).toBeNull();
	});
});
