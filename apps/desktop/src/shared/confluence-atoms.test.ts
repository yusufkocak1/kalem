import { describe, expect, it } from "vitest";
import { describeAtom, displayUrl, jiraBaseFromLinks, jiraUrl } from "./confluence-atoms.js";

const place = {
	site: "https://wiki.example.com",
	spaceKey: "DEV",
	pageUrl: "https://wiki.example.com/display/DEV/Plan",
};

describe("describeAtom", () => {
	it("reads a Jira issue, leaving its address to the server's links", () => {
		expect(
			describeAtom(
				'<ac:structured-macro ac:name="jira" ac:schema-version="1" ac:macro-id="m1"><ac:parameter ac:name="server">System JIRA</ac:parameter><ac:parameter ac:name="serverId">abc-1</ac:parameter><ac:parameter ac:name="key">QR-48077</ac:parameter><ac:parameter ac:name="showSummary">false</ac:parameter></ac:structured-macro>',
				place,
			),
		).toEqual({
			type: "jira",
			title: "QR-48077",
			subtitle: "System JIRA",
			fields: [{ name: "showSummary", value: "false" }],
			url: null,
			copy: "QR-48077",
			jira: { serverId: "abc-1", key: "QR-48077", jql: "" },
		});
	});

	it("reads a mention by Server's user key or Cloud's account id", () => {
		expect(describeAtom('<ac:link><ri:user ri:userkey="8a1" /></ac:link>', place)).toMatchObject({
			type: "mention",
			user: { key: "8a1" },
			url: null,
		});
		expect(
			describeAtom('<ac:link><ri:user ri:account-id="557:x" /></ac:link>', place),
		).toMatchObject({ type: "mention", user: { accountId: "557:x" } });
		expect(describeAtom('<ac:link><ri:user ri:username="ayse" /></ac:link>', place)).toMatchObject({
			title: "ayse",
			url: "https://wiki.example.com/display/~ayse",
		});
	});

	it("reads a link to a page, in this space or another, with its anchor", () => {
		expect(
			describeAtom(
				'<ac:link ac:anchor="Kapsam"><ri:page ri:content-title="Sprint Planı" /><ac:plain-text-link-body><![CDATA[plan]]></ac:plain-text-link-body></ac:link>',
				place,
			),
		).toMatchObject({
			type: "page",
			title: "Sprint Planı",
			subtitle: "DEV",
			url: "https://wiki.example.com/display/DEV/Sprint+Plan%C4%B1#Kapsam",
			page: { spaceKey: "DEV", title: "Sprint Planı" },
		});
		expect(
			describeAtom(
				'<ac:link><ri:page ri:space-key="OPS" ri:content-title="Runbook" /></ac:link>',
				place,
			),
		).toMatchObject({ subtitle: "OPS", url: "https://wiki.example.com/display/OPS/Runbook" });
	});

	it("reads blog posts, spaces, dates and statuses", () => {
		expect(
			describeAtom(
				'<ac:link><ri:blog-post ri:content-title="Duyuru" ri:posting-day="2026-10-15" /></ac:link>',
				place,
			),
		).toMatchObject({
			type: "blog-post",
			url: "https://wiki.example.com/display/DEV/2026/10/15/Duyuru",
		});
		expect(describeAtom('<ac:link><ri:space ri:space-key="OPS" /></ac:link>', place)).toMatchObject(
			{
				type: "space",
				url: "https://wiki.example.com/display/OPS",
			},
		);
		expect(describeAtom('<time datetime="2026-10-15" />', place)).toMatchObject({
			type: "date",
			title: "2026-10-15",
			url: null,
		});
		expect(
			describeAtom(
				'<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">Onaylandı</ac:parameter></ac:structured-macro>',
				place,
			),
		).toMatchObject({ type: "status", title: "Onaylandı", colour: "Green", fields: [] });
	});

	it("sends other macros to the page in Confluence, or to an address they hold", () => {
		expect(describeAtom('<ac:structured-macro ac:name="toc" />', place)).toMatchObject({
			type: "macro",
			title: "toc",
			url: place.pageUrl,
		});
		expect(
			describeAtom(
				'<ac:structured-macro ac:name="widget"><ac:parameter ac:name="url">https://youtu.be/x</ac:parameter></ac:structured-macro>',
				place,
			),
		).toMatchObject({
			url: "https://youtu.be/x",
			fields: [{ name: "url", value: "https://youtu.be/x" }],
		});
		expect(describeAtom("<p>x</p>", place)).toBeNull();
	});
});

describe("addresses", () => {
	it("builds a page's address from its space and title", () => {
		expect(displayUrl("https://x/wiki", "DEV", "A b/c")).toBe("https://x/wiki/display/DEV/A+b%2Fc");
	});

	it("builds a Jira issue's or search's address", () => {
		expect(jiraUrl("https://jira.example.com/", { key: "QR-48077", jql: "" })).toBe(
			"https://jira.example.com/browse/QR-48077",
		);
		expect(jiraUrl("https://jira.example.com", { key: "", jql: "project = QR" })).toBe(
			"https://jira.example.com/issues/?jql=project%20%3D%20QR",
		);
		expect(jiraUrl("", { key: "QR-1", jql: "" })).toBeNull();
	});

	it("finds Jira among Server's application links, by its id or as the only one", () => {
		const links = {
			list: [
				{ application: { id: "abc-1", typeId: "jira", displayUrl: "https://jira.example.com" } },
				{ application: { id: "x", typeId: "bamboo", displayUrl: "https://ci.example.com" } },
			],
		};
		expect(jiraBaseFromLinks(links, "abc-1")).toBe("https://jira.example.com");
		expect(jiraBaseFromLinks(links, "")).toBe("https://jira.example.com");
		expect(
			jiraBaseFromLinks(
				{
					applinks: [
						{ id: "a", type: "jira", rpcUrl: "https://j1" },
						{ id: "b", type: "jira", rpcUrl: "https://j2" },
					],
				},
				"zz",
			),
		).toBeNull();
	});

	it("finds Jira among the Jira macro's servers, which any user may read", () => {
		const servers = [
			{ id: "j1", name: "Jira", url: "https://jira.example.com", selected: false },
			{ id: "j2", name: "Eski Jira", url: "https://old-jira.example.com", selected: true },
		];
		expect(jiraBaseFromLinks(servers, "j1", true)).toBe("https://jira.example.com");
		// An unknown id: the default one.
		expect(jiraBaseFromLinks(servers, "zz", true)).toBe("https://old-jira.example.com");
		expect(jiraBaseFromLinks([servers[0]], "", true)).toBe("https://jira.example.com");
	});
});
