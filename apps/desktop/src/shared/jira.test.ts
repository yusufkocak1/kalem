import { describe, expect, it } from "vitest";
import { withoutRequests } from "./confluence-tool.js";
import {
	issueKey,
	issueKeyFromUrl,
	issueOf,
	issueText,
	normalizeJiraSite,
	searchJql,
	searchText,
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
