import { describe, expect, it } from "vitest";
import { CONFLUENCE_TOOLS, ConfluenceLookups, isConfluenceTool } from "./assistant-confluence.js";
import type { ConfluenceClient } from "./confluence-client.js";

/** Just what the look-ups use of a client. */
function fakeClient() {
	const asked: unknown[] = [];
	let reads = 0;
	const client = {
		site: "https://wiki.example.com",
		async find(request: unknown) {
			asked.push(request);
			return {
				hits: [
					{
						id: "42",
						title: "İzin Süreci",
						titleParts: [],
						spaceName: "İK",
						spaceKey: "IK",
						modified: null,
						excerpt: [{ text: "izin", hit: true }],
						path: [],
					},
				],
				total: 1,
				next: null,
			};
		},
		async page(id: string) {
			reads++;
			if (id === "9") throw new Error("HTTP 404");
			return {
				page: {
					site: "",
					id,
					title: "İzin Süreci",
					spaceKey: "IK",
					version: 1,
					webUrl: "https://wiki.example.com/x",
				},
				storage: "<h1>Adımlar</h1><p>Yöneticiye gider.</p>",
			};
		},
	};
	return { client: client as unknown as ConfluenceClient, asked, reads: () => reads };
}

describe("ConfluenceLookups", () => {
	it("offers a search and a page read as tools", () => {
		expect(CONFLUENCE_TOOLS.map((tool) => tool.name)).toEqual([
			"confluence_search",
			"confluence_read_page",
		]);
		expect(isConfluenceTool("confluence_search")).toBe(true);
		expect(isConfluenceTool("search")).toBe(false);
	});

	it("searches inside pages by default and reads a page as Markdown, once", async () => {
		const { client, asked, reads } = fakeClient();
		const lookups = new ConfluenceLookups(client);
		const steps: string[] = [];
		const step = ({ tool, detail }: { tool: string; detail: string }): void => {
			steps.push(`${tool}: ${detail}`);
		};
		const found = await lookups.runTool("confluence_search", { query: "izin" }, step);
		expect(found).toContain("1. İzin Süreci (page id 42)");
		expect(asked[0]).toMatchObject({ query: "izin", mode: "content", spaceKey: null });
		const page = await lookups.runTool("confluence_read_page", { page_id: "42" }, step);
		expect(page).toContain("# Adımlar");
		expect(page).toContain("Yöneticiye gider.");
		await lookups.runTool("confluence_read_page", { page_id: "42", offset: 3 }, step);
		expect(reads()).toBe(1);
		expect(steps).toEqual([
			"confluence_search_content: izin",
			"confluence_read_page: İzin Süreci",
			"confluence_read_page: İzin Süreci",
		]);
	});

	it("says what failed instead of throwing, and what a call is missing", async () => {
		const lookups = new ConfluenceLookups(fakeClient().client);
		expect(await lookups.runTool("confluence_read_page", { page_id: "9" }, () => {})).toBe(
			"Reading page 9 failed: HTTP 404",
		);
		expect(await lookups.runTool("confluence_search", {}, () => {})).toContain("needs a query");
	});

	it("runs a CLI's round and asks it to go on or answer", async () => {
		const lookups = new ConfluenceLookups(fakeClient().client);
		const text = await lookups.runAll(
			[
				{ kind: "search", query: "izin", mode: "title", space: "IK" },
				{ kind: "read", id: "42", offset: 0 },
			],
			() => {},
		);
		expect(text.startsWith("<confluence-results>\nSearch (titles, space IK)")).toBe(true);
		expect(text).toContain('\n\n---\n\nPage "İzin Süreci"');
		expect(text).toContain("</confluence-results>");
	});
});
