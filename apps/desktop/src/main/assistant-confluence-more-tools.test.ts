import { describe, expect, it, vi } from "vitest";
import { stringsFor } from "../shared/i18n.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { runTool } = await import("./assistant-tools.js");
await import("./assistant-confluence-tools.js");
await import("./assistant-confluence-more-tools.js");
const { aboutText } = await import("./assistant-confluence.js");
type ToolContext = import("./assistant-tools.js").ToolContext;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);

function context(confluence: unknown): ToolContext {
	return {
		chatId: "c",
		t: stringsFor("en"),
		excluded: new Set<string>(),
		settings: () => ({ assistantToolPolicies: {} }),
		confluence: null,
		jira: null,
		jiraClient: null,
		confluenceClient: confluence,
		connections: null,
		workspace: null,
		templates: null,
		document: null,
		step: () => {},
		emit: () => {},
		approve: async () => ({ approved: false, scope: "once" }),
		readExternal: false,
	} as unknown as ToolContext;
}

function fakeConfluence() {
	const downloaded: string[] = [];
	const client = {
		site: "https://wiki.example.com",
		cloud: false,
		attachments: async () => [
			{
				id: "1",
				name: "Mimari.png",
				size: 9,
				mediaType: "image/png",
				modified: null,
				author: "Ali",
				version: 1,
			},
			{
				id: "2",
				name: "notlar.txt",
				size: 5,
				mediaType: "text/plain",
				modified: null,
				author: "",
				version: 1,
			},
		],
		async attachment(_page: string, name: string) {
			downloaded.push(name);
			return new Response(name === "Mimari.png" ? PNG : "satır");
		},
		versions: async () => [
			{ number: 2, when: "2026-02-01T10:00:00.000Z", by: "Ali", message: "güncel", minor: false },
			{ number: 1, when: "2026-01-01T10:00:00.000Z", by: "Ayşe", message: "", minor: false },
		],
		pageVersion: async (_id: string, version: number) =>
			version === 1
				? "<h1>Süreç</h1><p>Onay 2 gün sürer.</p>"
				: "<h1>Süreç</h1><p>Onay 1 gün sürer.</p>",
		user: async () => null,
		users: async () => [{ name: "Ayşe Yılmaz", username: "ayse", detail: "ayse@example.com" }],
	};
	return { client, downloaded };
}

describe("confluence_get_attachment", () => {
	it("lists the attachments and reads a text file", async () => {
		const { client, downloaded } = fakeConfluence();
		const ctx = context(client);
		const list = await runTool("confluence_get_attachment", { page_id: "5" }, ctx);
		expect(list.text).toContain("Attachments of page 5 (2)");
		const read = await runTool("confluence_get_attachment", { page_id: "5", name: "notlar" }, ctx);
		expect(read.text).toContain("satır");
		expect(downloaded).toEqual(["notlar.txt"]);
	});

	it("shows a picture to the model", async () => {
		const ctx = context(fakeConfluence().client);
		const result = await runTool(
			"confluence_get_attachment",
			{ page_id: "5", name: "Mimari.png" },
			ctx,
		);
		expect(result.images?.[0]).toMatchObject({ label: "Mimari.png", mediaType: "image/png" });
	});
});

describe("confluence_page_history", () => {
	it("lists the versions, then shows what one changed", async () => {
		const ctx = context(fakeConfluence().client);
		const list = await runTool("confluence_page_history", { page_id: "5" }, ctx);
		expect(list.text).toContain('- Version 2: Ali, 2026-02-01 10:00 — "güncel"');
		const changes = await runTool("confluence_page_history", { page_id: "5", version: 2 }, ctx);
		expect(changes.text).toContain("from version 1 to 2: 1 lines added, 1 removed");
		expect(changes.text).toContain("-Onay 2 gün sürer.");
		expect(changes.text).toContain("+Onay 1 gün sürer.");
		expect(
			(await runTool("confluence_page_history", { page_id: "5", version: 1 }, ctx)).text,
		).toContain("the page's first");
	});
});

describe("confluence_find_user", () => {
	it("finds people by name", async () => {
		const ctx = context(fakeConfluence().client);
		const result = await runTool("confluence_find_user", { query: "ayşe" }, ctx);
		expect(result.text).toContain("- Ayşe Yılmaz (user name ayse, ayse@example.com)");
	});
});

describe("aboutText", () => {
	it("says where a page sits, who wrote it and its labels", () => {
		const text = aboutText(
			{
				type: "page",
				ancestors: [
					{ id: "1", title: "Ana Sayfa" },
					{ id: "2", title: "Süreçler" },
				],
				version: 4,
				modified: "2026-02-01T10:00:00.000Z",
				modifiedBy: "Ali",
				created: "2026-01-01T10:00:00.000Z",
				createdBy: "Ayşe",
			},
			["ik", "surec"],
		);
		expect(text).toContain("Under: Ana Sayfa (id 1) › Süreçler (id 2)");
		expect(text).toContain("Created: Ayşe, 2026-01-01");
		expect(text).toContain("Last changed: version 4, Ali, 2026-02-01");
		expect(text).toContain("Labels: ik, surec");
	});
});
