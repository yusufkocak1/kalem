import { describe, expect, it } from "vitest";
import { withoutRequests } from "./confluence-tool.js";
import {
	cleanJiraHtml,
	groupByParent,
	htmlText,
	issueKey,
	issueKeyFromUrl,
	issueOf,
	issueRowOf,
	issueText,
	issueTypeKind,
	looksLikeHtml,
	normalizeJiraSite,
	remoteLinksOf,
	searchJql,
	searchText,
	typeCounts,
} from "./jira.js";
import { jiraRequestOf, jiraRequests } from "./jira-tool.js";

const RAW = {
	key: "DEV-7",
	fields: {
		summary: "Giriş zaman aşımı",
		status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
		issuetype: { name: "Bug" },
		priority: { name: "High" },
		assignee: { displayName: "Ayşe Balcı" },
		reporter: { displayName: "Mehmet" },
		created: "2026-10-30T09:00:00.000+0300",
		updated: "2026-11-01T10:00:00.000+0300",
		duedate: "2026-11-10",
		resolution: null,
		labels: ["giris", "oturum"],
		components: [{ name: "Web" }],
		fixVersions: [{ name: "2.9" }],
		description: "Oturum *30 sn* sonra düşüyor.\n\n* Chrome\n* Edge",
		project: { key: "DEV", name: "Geliştirme" },
		parent: { key: "DEV-1", fields: { summary: "Oturum işleri", status: { name: "To Do" } } },
		subtasks: [
			{
				key: "DEV-8",
				fields: {
					summary: "Zaman aşımını ayarla",
					status: { name: "Done", statusCategory: { key: "done" } },
					issuetype: { name: "Sub-task" },
				},
			},
		],
		issuelinks: [
			{
				type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
				outwardIssue: { key: "DEV-9", fields: { summary: "Sürüm", status: { name: "To Do" } } },
			},
			{
				type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
				inwardIssue: { key: "OPS-2", fields: { summary: "Sunucu", status: { name: "Open" } } },
			},
		],
		comment: {
			total: 1,
			comments: [
				{
					author: { displayName: "Can" },
					created: "2026-11-01T11:00:00.000+0300",
					body: "Bende de *oluyor*.",
				},
			],
		},
	},
};

describe("Jira issues", () => {
	it("reads keys and the addresses that name an issue", () => {
		expect(issueKey(" dev-7 ")).toBe("DEV-7");
		expect(issueKey("DEV-0")).toBeNull();
		expect(issueKey("not a key")).toBeNull();
		expect(issueKeyFromUrl("https://jira.example.com/browse/DEV-7")).toBe("DEV-7");
		expect(
			issueKeyFromUrl("https://acme.atlassian.net/jira/software/projects/DEV/issues/DEV-12"),
		).toBe("DEV-12");
		expect(
			issueKeyFromUrl(
				"https://jira.example.com/secure/RapidBoard.jspa?rapidView=1&selectedIssue=ops-3",
			),
		).toBe("OPS-3");
		expect(issueKeyFromUrl("https://example.com/docs")).toBeNull();
		expect(issueKeyFromUrl("javascript:alert(1)//browse/DEV-1")).toBeNull();
	});

	it("turns the search box into JQL", () => {
		expect(searchJql("dev-7")).toBe("key = DEV-7");
		expect(searchJql("https://jira.example.com/browse/DEV-7")).toBe("key = DEV-7");
		expect(searchJql("project = DEV AND status != Done")).toBe("project = DEV AND status != Done");
		expect(searchJql('giriş "hata"')).toBe('text ~ "giriş \\"hata\\"" ORDER BY updated DESC');
		expect(searchJql("")).toBe("ORDER BY updated DESC");
	});

	it("finds a site's root in a page's address", () => {
		expect(normalizeJiraSite("jira.example.com/browse/DEV-7")).toBe("https://jira.example.com");
		expect(normalizeJiraSite("https://tools.example.com/jira/browse/DEV-7")).toBe(
			"https://tools.example.com/jira",
		);
		expect(normalizeJiraSite("https://acme.atlassian.net/wiki/spaces/DEV")).toBe(
			"https://acme.atlassian.net",
		);
	});

	it("reads an issue's fields, description, sub-tasks, links and comments", () => {
		const issue = issueOf(RAW, "https://jira.example.com");
		expect(issue).toMatchObject({
			key: "DEV-7",
			summary: "Giriş zaman aşımı",
			status: "In Progress",
			statusCategory: "indeterminate",
			type: "Bug",
			assignee: "Ayşe Balcı",
			url: "https://jira.example.com/browse/DEV-7",
			project: "Geliştirme",
			labels: ["giris", "oturum"],
			components: ["Web"],
			fixVersions: ["2.9"],
			resolution: "",
			parent: { key: "DEV-1", summary: "Oturum işleri" },
			subtasks: [{ key: "DEV-8", statusCategory: "done" }],
			links: [
				{ relation: "blocks", issue: { key: "DEV-9" } },
				{ relation: "is blocked by", issue: { key: "OPS-2" } },
			],
			commentTotal: 1,
		});
		// Wiki markup becomes Markdown.
		expect(issue?.description).toContain("**30 sn**");
		expect(issue?.description).toMatch(/[-*] Chrome/);
		expect(issue?.comments[0]).toMatchObject({ author: "Can" });
		expect(issue?.comments[0]?.body).toContain("**oluyor**");

		const text = issueText(issue as NonNullable<typeof issue>);
		expect(text).toContain("Issue DEV-7: Giriş zaman aşımı");
		expect(text).toContain("Assignee: Ayşe Balcı");
		expect(text).toContain("- blocks: DEV-9 Sürüm [To Do]");
		expect(text).toContain("- Can, 2026-11-01: Bende de **oluyor**.");
	});

	it("reads a Cloud v3 description written as an Atlassian document", () => {
		const issue = issueOf(
			{
				key: "A-1",
				fields: {
					description: {
						type: "doc",
						content: [
							{ type: "paragraph", content: [{ type: "text", text: "Birinci" }] },
							{ type: "paragraph", content: [{ type: "text", text: "İkinci" }] },
						],
					},
				},
			},
			"https://acme.atlassian.net",
		);
		expect(issue?.description).toBe("Birinci\n\nİkinci");
	});

	it("writes a search's issues for the model", () => {
		const text = searchText(
			{
				jql: "project = DEV",
				issues: [
					{
						key: "DEV-7",
						summary: "Giriş",
						status: "Open",
						statusCategory: "new",
						type: "Bug",
						assignee: "",
						priority: "",
						updated: null,
						parent: null,
					},
				],
				total: 1,
				next: null,
			},
			"https://jira.example.com",
		);
		expect(text).toContain("Jira search `project = DEV`: 1 issues.");
		expect(text).toContain(
			"- DEV-7 Giriş (Bug, Open, unassigned) https://jira.example.com/browse/DEV-7",
		);
	});
});

describe("a search's issues as a tree", () => {
	const ref = (key: string) => ({
		key,
		summary: key,
		status: "",
		statusCategory: "" as const,
		type: "",
	});
	const row = (key: string, parent: string | null = null) => ({
		...ref(key),
		assignee: "",
		priority: "",
		updated: null,
		parent: parent === null ? null : ref(parent),
	});

	it("puts sub-tasks under their parent, in the search's order", () => {
		const groups = groupByParent([
			row("QR-49185", "QR-26028"),
			row("QR-48152"),
			row("QR-26028"),
			row("QR-49186", "QR-26028"),
			row("QR-48819", "QR-26073"),
		]);
		expect(
			groups.map((group) => [
				group.parent.key,
				group.row === null ? "not found" : "found",
				group.children.map((child) => child.key),
			]),
		).toEqual([
			["QR-26028", "found", ["QR-49185", "QR-49186"]],
			["QR-48152", "found", []],
			// Its parent was not in the results: it still heads its sub-task.
			["QR-26073", "not found", ["QR-48819"]],
		]);
	});

	it("reads a sub-task's parent from the search", () => {
		expect(
			issueRowOf({ key: "QR-2", fields: { parent: { key: "QR-1", fields: { summary: "Üst" } } } })
				?.parent,
		).toMatchObject({ key: "QR-1", summary: "Üst" });
	});
});

describe("Jira fields kept as HTML", () => {
	const JEDITOR =
		'<div class="jePanel_warning" style="border:1px solid #d4a19e">\\\n<p dir="auto"><b>HATA</b>:</p><p>SSR kay&#305;tlar&#305; &amp; PNR</p>\\\n</div><ul>\\\n<li>Birinci</li><li>İkinci</li></ul>';

	it("tells an HTML editor plug-in's HTML from wiki markup", () => {
		expect(looksLikeHtml(JEDITOR)).toBe(true);
		expect(looksLikeHtml("<p>Merhaba</p>")).toBe(true);
		expect(looksLikeHtml("h1. Başlık\n*kalın* <b>")).toBe(false);
		expect(looksLikeHtml("a < b and c > d")).toBe(false);
	});

	it("joins the lines it continued with a backslash, and reads its text for the assistant", () => {
		expect(cleanJiraHtml(JEDITOR)).not.toContain("\\");
		expect(htmlText(JEDITOR)).toBe("HATA:\nSSR kayıtları & PNR\n\n- Birinci\n- İkinci");
	});

	it("keeps the HTML (Jira's rendering when it has one) and gives the model its text", () => {
		const issue = issueOf(
			{
				key: "QR-1",
				fields: {
					description: JEDITOR,
					comment: {
						total: 1,
						comments: [{ author: { name: "can" }, body: "<p>Tamam <b>oldu</b></p>" }],
					},
				},
				renderedFields: { description: "<div>Jira'nın çizdiği</div>", comment: { comments: [{}] } },
			},
			"https://jira.example.com",
		);
		expect(issue?.descriptionHtml).toBe("<div>Jira'nın çizdiği</div>");
		expect(issue?.description).toBe("Jira'nın çizdiği");
		expect(issue?.comments[0]).toMatchObject({
			body: "Tamam oldu",
			html: "<p>Tamam <b>oldu</b></p>",
		});
	});

	it("reads the issue's links outside Jira", () => {
		expect(
			remoteLinksOf([
				{
					relationship: "mentioned in",
					application: { type: "com.atlassian.confluence", name: "Confluence" },
					object: {
						url: "https://wiki.example.com/pages/viewpage.action?pageId=42",
						title: "Analiz Dokümanı",
					},
				},
				{
					application: { type: "com.atlassian.confluence" },
					object: { url: "https://wiki.example.com/x/AbC" },
				},
				{ object: { url: "javascript:alert(1)", title: "x" } },
			]),
		).toEqual([
			{
				relation: "mentioned in",
				title: "Analiz Dokümanı",
				url: "https://wiki.example.com/pages/viewpage.action?pageId=42",
				pageId: null,
			},
			{
				relation: "wiki page",
				title: "https://wiki.example.com/x/AbC",
				url: "https://wiki.example.com/x/AbC",
				pageId: null,
			},
		]);
		expect(remoteLinksOf({ errorMessages: ["x"] })).toEqual([]);
	});
});

describe("Jira requests of a CLI", () => {
	it("reads issue, JQL and word requests", () => {
		expect(jiraRequestOf({ issue: "dev-7" })).toEqual({ kind: "issue", key: "DEV-7" });
		expect(jiraRequestOf({ key: "https://jira.example.com/browse/DEV-7" }, "issue")).toEqual({
			kind: "issue",
			key: "DEV-7",
		});
		expect(jiraRequestOf({ jql: "project = DEV" })).toEqual({
			kind: "search",
			jql: "project = DEV",
		});
		expect(jiraRequestOf({ query: "giriş" }, "search")).toEqual({
			kind: "search",
			jql: 'text ~ "giriş" ORDER BY updated DESC',
		});
		expect(jiraRequestOf({ query: "" })).toBeNull();
		expect(jiraRequestOf({ key: "nope" }, "issue")).toBeNull();
	});

	it("finds them in a reply's blocks and hides the blocks", () => {
		const reply =
			'Bakıyorum.\n\n```kalem-jira\n[{ "issue": "DEV-7" }, { "jql": "project = DEV" }]\n```\n';
		expect(jiraRequests(reply)).toEqual([
			{ kind: "issue", key: "DEV-7" },
			{ kind: "search", jql: "project = DEV" },
		]);
		expect(withoutRequests(reply).trim()).toBe("Bakıyorum.");
	});
});

describe("issue types", () => {
	it("knows the common types, in English and Turkish", () => {
		expect(issueTypeKind("Bug")).toBe("bug");
		expect(issueTypeKind("Hata")).toBe("bug");
		expect(issueTypeKind("Story")).toBe("story");
		expect(issueTypeKind("Task")).toBe("task");
		expect(issueTypeKind("Görev")).toBe("task");
		expect(issueTypeKind("Sub-task")).toBe("subtask");
		expect(issueTypeKind("Alt Görev")).toBe("subtask");
		expect(issueTypeKind("Epic")).toBe("epic");
		expect(issueTypeKind("New Feature")).toBe("feature");
		expect(issueTypeKind("İyileştirme")).toBe("improvement");
		expect(issueTypeKind("IMPROVEMENT")).toBe("improvement");
		expect(issueTypeKind("Değişiklik")).toBe("other");
		expect(issueTypeKind("Spike")).toBe("other");
		expect(issueTypeKind("")).toBe("other");
	});

	it("counts the types among rows, most first", () => {
		const row = (key: string, type: string) => ({
			key,
			summary: "",
			status: "",
			statusCategory: "" as const,
			type,
			assignee: "",
			priority: "",
			updated: null,
			parent: null,
		});
		expect(
			typeCounts([row("A-1", "Task"), row("A-2", "Bug"), row("A-3", "Bug"), row("A-4", "")]),
		).toEqual([
			{ type: "Bug", count: 2 },
			{ type: "Task", count: 1 },
		]);
	});
});
