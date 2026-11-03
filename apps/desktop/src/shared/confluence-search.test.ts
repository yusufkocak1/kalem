import { describe, expect, it } from "vitest";
import type { ConfluenceSearchRequest } from "./confluence-search.js";
import {
	DEFAULT_SEARCH,
	decodeEntities,
	hasCriteria,
	highlightParts,
	markWords,
	parseSearchRequest,
	queryTerms,
	searchCql,
} from "./confluence-search.js";

const ask = (
	query: string,
	more: Partial<ConfluenceSearchRequest> = {},
): ConfluenceSearchRequest => ({
	...DEFAULT_SEARCH,
	query,
	spaceKey: null,
	...more,
});

describe("queryTerms", () => {
	it("reads words, phrases and excluded words", () => {
		expect(queryTerms('sprint "release plan" -draft -"old notes" api')).toEqual({
			words: ["sprint", "api"],
			phrases: ["release plan"],
			excluded: ["draft", "old notes"],
		});
	});

	it("drops what the search engine would read as syntax", () => {
		expect(queryTerms('a+b (c) "x*y" - "')).toEqual({
			words: ["ab", "c"],
			phrases: ["x y"],
			excluded: [],
		});
	});

	it("takes an unclosed quote as a phrase being typed", () => {
		expect(queryTerms('"onay sür')).toEqual({ words: [], phrases: ["onay sür"], excluded: [] });
	});
});

describe("searchCql", () => {
	it("looks for titles starting with the words, newest first", () => {
		expect(searchCql(ask("Sprint", { spaceKey: "DEV" }))).toBe(
			'type=page AND space="DEV" AND title~"Sprint*" ORDER BY lastmodified DESC',
		);
	});

	it("looks inside pages for every word, the last also while it is typed", () => {
		expect(searchCql(ask("onay süreci", { mode: "content" }))).toBe(
			'type=page AND text~"onay" AND (text~"süreci" OR text~"süreci*")',
		);
		// A space after the last word: it is finished.
		expect(searchCql(ask("onay süreci ", { mode: "content" }))).toBe(
			'type=page AND text~"onay" AND text~"süreci"',
		);
	});

	it("looks for phrases as written and leaves excluded words out", () => {
		expect(searchCql(ask('"go live" -taslak -"eski plan"', { mode: "content" }))).toBe(
			'type=page AND text~"\\"go live\\"" AND NOT text~"taslak" AND NOT text~"\\"eski plan\\""',
		);
	});

	it("narrows by date, contributor, label and a page above", () => {
		expect(
			searchCql(
				ask("api ", {
					mode: "content",
					period: "week",
					mine: true,
					label: "mimari",
					ancestor: "41",
					sort: "modified",
				}),
			),
		).toBe(
			'type=page AND ancestor=41 AND text~"api" AND lastmodified>=now("-1w") AND contributor=currentUser() AND label="mimari" ORDER BY lastmodified DESC',
		);
		expect(searchCql(ask("", { sort: "title", period: "year" }))).toBe(
			'type=page AND lastmodified>=now("-52w") ORDER BY title ASC',
		);
	});

	it("keeps quotes and backslashes inside the strings", () => {
		expect(searchCql(ask('a"b', { mode: "title" }))).toContain('title~"a\\"b*"');
	});
});

describe("hasCriteria", () => {
	it("needs words, or a filter that narrows the pages", () => {
		expect(hasCriteria(ask(""))).toBe(false);
		expect(hasCriteria(ask("  "))).toBe(false);
		expect(hasCriteria(ask("x"))).toBe(true);
		expect(hasCriteria(ask("-only", { mode: "content" }))).toBe(false);
		expect(hasCriteria(ask("", { period: "day" }))).toBe(true);
		expect(hasCriteria(ask("", { mine: true }))).toBe(true);
		expect(hasCriteria(ask("", { label: "x" }))).toBe(true);
		// Sorting or a place alone lists nothing new.
		expect(hasCriteria(ask("", { sort: "title", ancestor: "41" }))).toBe(false);
	});
});

describe("highlightParts", () => {
	it("splits Confluence's highlighting into parts", () => {
		expect(
			highlightParts("…the @@@hl@@@release@@@endhl@@@ &amp; @@@hl@@@plan@@@endhl@@@ for\n Q3 "),
		).toEqual([
			{ text: "…the ", hit: false },
			{ text: "release", hit: true },
			{ text: " & ", hit: false },
			{ text: "plan", hit: true },
			{ text: " for Q3", hit: false },
		]);
		expect(highlightParts("")).toEqual([]);
		expect(highlightParts("plain")).toEqual([{ text: "plain", hit: false }]);
	});

	it("writes out entities", () => {
		expect(decodeEntities("&lt;b&gt; &#252; &#x15F; &quot;x&quot; &bogus;")).toBe(
			'<b> ü ş "x" &bogus;',
		);
	});
});

describe("markWords", () => {
	it("marks the words at the start of the title's words, in the interface's language", () => {
		expect(markWords("İzin Talebi ve izinler", "izin", "tr")).toEqual([
			{ text: "İzin", hit: true },
			{ text: " Talebi ve ", hit: false },
			{ text: "izin", hit: true },
			{ text: "ler", hit: false },
		]);
		expect(markWords("Başvuru", "vuru", "tr")).toEqual([{ text: "Başvuru", hit: false }]);
		expect(markWords("Plan", "", "en")).toEqual([{ text: "Plan", hit: false }]);
	});
});

describe("parseSearchRequest", () => {
	it("keeps what is valid and drops the rest", () => {
		expect(
			parseSearchRequest({
				query: "x",
				spaceKey: 'DEV" OR 1=1',
				mode: "content",
				sort: "bogus",
				period: "month",
				mine: "yes",
				label: " etiket ",
				ancestor: "12a",
				cursor: "/rest/api/search?cursor=abc",
			}),
		).toEqual({
			query: "x",
			spaceKey: null,
			mode: "content",
			sort: "relevance",
			period: "month",
			mine: false,
			label: "etiket",
			ancestor: null,
			cursor: "/rest/api/search?cursor=abc",
		});
		expect(parseSearchRequest(null)).toBeNull();
	});
});
