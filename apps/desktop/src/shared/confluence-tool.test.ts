import { describe, expect, it } from "vitest";
import {
	CONFLUENCE_FENCE,
	confluenceInstructions,
	confluenceRequests,
	MAX_REQUESTS,
	PAGE_CHUNK,
	pageText,
	requestOf,
	searchResultText,
	withoutRequests,
} from "./confluence-tool.js";

const block = (body: unknown): string =>
	`Bakıyorum.\n\n\`\`\`${CONFLUENCE_FENCE}\n${JSON.stringify(body)}\n\`\`\`\n`;

describe("confluenceRequests", () => {
	it("reads searches and reads from a reply's block", () => {
		expect(
			confluenceRequests(
				block([
					{ search: "izin onay" },
					{ search: "İzin Süreci", mode: "title", space: "IK" },
					{ read: "123456" },
					{ read: 42, offset: 24000 },
				]),
			),
		).toEqual([
			{ kind: "search", query: "izin onay", mode: "content", space: null },
			{ kind: "search", query: "İzin Süreci", mode: "title", space: "IK" },
			{ kind: "read", id: "123456", offset: 0 },
			{ kind: "read", id: "42", offset: 24000 },
		]);
	});

	it("takes one request, leaves out what is not one, and keeps to the limit", () => {
		expect(confluenceRequests(block({ search: "x" }))).toHaveLength(1);
		expect(
			confluenceRequests(
				block([{ search: "" }, { read: "../1" }, { space: 'a" OR 1=1', search: "y" }]),
			),
		).toEqual([{ kind: "search", query: "y", mode: "content", space: null }]);
		expect(
			confluenceRequests(block(Array.from({ length: 10 }, (_, i) => ({ read: String(i + 1) })))),
		).toHaveLength(MAX_REQUESTS);
		expect(confluenceRequests("```kalem-confluence\nnot json\n```")).toEqual([]);
		expect(confluenceRequests("No look-ups.")).toEqual([]);
	});

	it("reads a tool call's input", () => {
		expect(requestOf({ query: "deploy", mode: "title" }, "search")).toEqual({
			kind: "search",
			query: "deploy",
			mode: "title",
			space: null,
		});
		expect(requestOf({ page_id: "77" }, "read")).toEqual({ kind: "read", id: "77", offset: 0 });
		expect(requestOf({ page_id: "77" }, "search")).toBeNull();
	});

	it("are left out of what the reader sees", () => {
		expect(withoutRequests(`${block({ search: "x" })}\nSonuç burada.`)).toBe(
			"Bakıyorum.\n\nSonuç burada.",
		);
	});
});

describe("results", () => {
	it("write a search's pages with their address, place and highlighted text", () => {
		expect(
			searchResultText(
				{ kind: "search", query: "izin", mode: "content", space: null },
				{
					hits: [
						{
							id: "42",
							title: "İzin Süreci",
							titleParts: [],
							spaceName: "İK",
							spaceKey: "IK",
							modified: "2026-10-01T10:00:00.000Z",
							excerpt: [
								{ text: "Yıllık ", hit: false },
								{ text: "izin", hit: true },
								{ text: " yöneticiye gider.", hit: false },
							],
							path: ["Süreçler"],
						},
					],
					total: 1,
					next: null,
				},
				"https://wiki.example.com",
			),
		).toBe(
			[
				'Search (inside pages) for "izin": 1 pages.',
				"1. İzin Süreci (page id 42)",
				"   https://wiki.example.com/pages/viewpage.action?pageId=42",
				"   in: İK › Süreçler",
				"   changed: 2026-10-01",
				"   text: Yıllık «izin» yöneticiye gider.",
			].join("\n"),
		);
		expect(
			searchResultText(
				{ kind: "search", query: "yok", mode: "title", space: "IK" },
				{ hits: [], total: 0, next: null },
				"https://x",
			),
		).toContain("Nothing found. Try other words");
	});

	it("write a long page in parts", () => {
		const page = { id: "42", title: "Uzun", spaceKey: "IK", url: "https://x/42" };
		const text = "a".repeat(PAGE_CHUNK + 10);
		const first = pageText(page, text, 0);
		expect(first).toContain(`(characters 0-${PAGE_CHUNK} of ${PAGE_CHUNK + 10})`);
		expect(first).toContain(`read again with offset ${PAGE_CHUNK}`);
		expect(pageText(page, text, PAGE_CHUNK)).toContain(`${"a".repeat(10)}`);
		expect(pageText(page, "Kısa", 0)).toBe(
			'Page "Uzun" (page id 42, space IK)\nhttps://x/42\n\nKısa',
		);
	});
});

describe("confluenceInstructions", () => {
	it("tells a CLI to write requests, an API to call the tools, and asks to connect without a site", () => {
		expect(confluenceInstructions("https://wiki.example.com", true)).toContain(
			`\`\`\`${CONFLUENCE_FENCE}`,
		);
		expect(confluenceInstructions("https://wiki.example.com", false)).toContain(
			"`confluence_search`",
		);
		expect(confluenceInstructions(null, true)).toContain("not connected to Confluence");
	});
});
