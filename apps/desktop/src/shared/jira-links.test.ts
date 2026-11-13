import { describe, expect, it } from "vitest";
import { linkCardOf } from "./jira-links.js";

describe("linkCardOf", () => {
	it("takes a Confluence page's title from the link text, without the site's name", () => {
		expect(
			linkCardOf(
				"https://wiki.thy.com/pages/viewpage.action?pageId=123",
				"TK PNRı Olmayan Bilette PNR Alanının Dolu Gelmesi - Doğrudan Satış ve Çağrı Merkezi Çözümleri Müdürlüğü - Confluence",
			),
		).toEqual({
			kind: "confluence",
			title: "TK PNRı Olmayan Bilette PNR Alanının Dolu Gelmesi",
			subtitle: "Doğrudan Satış ve Çağrı Merkezi Çözümleri Müdürlüğü",
			pageId: "123",
		});
	});

	it("makes a title from the address when the text is the address", () => {
		const url = "https://wiki.x.com/display/QR/TK+PNR%C4%B1+Olmayan+Bilette";
		expect(linkCardOf(url, url)).toMatchObject({
			title: "TK PNRı Olmayan Bilette",
			subtitle: "QR",
		});
		expect(
			linkCardOf("https://x.atlassian.net/wiki/spaces/DEV/pages/42/Sprint+Plan", ""),
		).toMatchObject({ title: "Sprint Plan", subtitle: "DEV", pageId: "42" });
		expect(linkCardOf("https://wiki.x.com/pages/viewpage.action?pageId=9", "")).toMatchObject({
			title: "",
			pageId: "9",
		});
	});

	it("knows pull requests and commits", () => {
		expect(
			linkCardOf(
				"https://bitbucket.x.com/projects/QR/repos/quickres/pull-requests/12/overview",
				"",
			),
		).toMatchObject({ kind: "pullRequest", title: "#12", subtitle: "QR/quickres" });
		expect(linkCardOf("https://github.com/a/b/commit/0123456789abcdef", "")).toMatchObject({
			kind: "commit",
			title: "0123456789",
		});
	});

	it("leaves other links alone", () => {
		expect(linkCardOf("https://example.com/page", "a page")).toBeNull();
		expect(linkCardOf("mailto:a@b.c", "")).toBeNull();
	});
});
