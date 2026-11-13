import { describe, expect, it, vi } from "vitest";
import { stringsFor } from "../shared/i18n.js";
import type { ApprovalAnswer, ApprovalRequest } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { runTool, toolsFor } = await import("./assistant-tools.js");
await import("./assistant-external-tools.js");
await import("./assistant-jira-tools.js");
await import("./assistant-confluence-tools.js");
const { JiraError } = await import("./jira-client.js");
type ToolContext = import("./assistant-tools.js").ToolContext;

const SOURCE = {
	key: "QR-48204",
	fields: {
		summary: "Canli90 - Frontend",
		project: { key: "QR" },
		issuetype: { id: "10001", name: "Story" },
		customfield_10100: { id: "100", value: "Canlı" },
		customfield_10400: { name: "gone", displayName: "Gone" },
		status: { name: "Done" },
	},
	names: { customfield_10100: "Service", customfield_10400: "Reviewer" },
	editmeta: {
		fields: {
			customfield_10100: {
				name: "Service",
				required: true,
				schema: { type: "option", custom: "x:select" },
				allowedValues: [
					{ id: "100", value: "Canlı" },
					{ id: "101", value: "Ödeme" },
				],
			},
		},
	},
};

const CREATE_META = {
	values: [
		{ fieldId: "summary", name: "Summary", required: true, schema: { type: "string" } },
		{
			fieldId: "customfield_10100",
			name: "Service",
			required: true,
			schema: { type: "option", custom: "x:select" },
			allowedValues: [
				{ id: "100", value: "Canlı" },
				{ id: "101", value: "Ödeme" },
			],
		},
		{ fieldId: "customfield_10400", name: "Reviewer", required: false, schema: { type: "user" } },
	],
};

function fakeJira(refuseReviewer = false) {
	const created: Record<string, unknown>[] = [];
	const links: unknown[] = [];
	const updates: unknown[] = [];
	const client = {
		site: "https://jira.example.com",
		cloud: false,
		rawIssue: async () => SOURCE,
		issueTypes: async () => [{ id: "10001", name: "Story", subtask: false }],
		createMeta: async () => CREATE_META,
		editMeta: async () => SOURCE.editmeta,
		async createWithFields(fields: Record<string, unknown>) {
			if (refuseReviewer && "customfield_10400" in fields) {
				throw new JiraError(400, "HTTP 400", { customfield_10400: "User 'gone' does not exist." });
			}
			created.push(fields);
			return { key: "QR-48300", url: "https://jira.example.com/browse/QR-48300" };
		},
		linkTypes: async () => ({
			issueLinkTypes: [{ id: "2", name: "Cloners", outward: "clones", inward: "is cloned by" }],
		}),
		async link(body: unknown) {
			links.push(body);
		},
		async updateFields(key: string, fields: unknown) {
			updates.push({ key, fields });
		},
	};
	return { client, created, links, updates };
}

function context(jira: unknown, answers: ApprovalAnswer[], confluence: unknown = null) {
	const asked: Omit<ApprovalRequest, "id" | "chatId" | "scopes">[] = [];
	const ctx = {
		chatId: "c",
		t: stringsFor("en"),
		excluded: new Set<string>(),
		confluence: null,
		jira: null,
		jiraClient: jira,
		confluenceClient: confluence,
		connections: null,
		workspace: null,
		templates: null,
		document: null,
		step: () => {},
		emit: () => {},
		async approve(request: Omit<ApprovalRequest, "id" | "chatId" | "scopes">) {
			asked.push(request);
			return answers.shift() ?? { approved: false, scope: "once" };
		},
		readExternal: false,
	} as unknown as ToolContext;
	return { ctx, asked };
}

const YES: ApprovalAnswer = { approved: true, scope: "once" };

describe("jira_clone_issue", () => {
	it("copies the issue's fields, custom ones included, and links the copy", async () => {
		const jira = fakeJira();
		const { ctx, asked } = context(jira.client, [YES]);
		const result = await runTool(
			"jira_clone_issue",
			{ key: "QR-48204", summary: "Canli91 - Frontend" },
			ctx,
		);
		expect(result.isError).toBe(false);
		expect(jira.created[0]).toEqual({
			summary: "Canli91 - Frontend",
			customfield_10100: { id: "100" },
			customfield_10400: { name: "gone" },
			project: { key: "QR" },
			issuetype: { id: "10001" },
		});
		expect(jira.links[0]).toEqual({
			type: { name: "Cloners" },
			inwardIssue: { key: "QR-48300" },
			outwardIssue: { key: "QR-48204" },
		});
		expect(asked[0]?.lines.join("\n")).toContain("Service");
		expect(result.text).toContain("Created QR-48300");
	});

	it("leaves out a copied value Jira refuses, once", async () => {
		const jira = fakeJira(true);
		const { ctx } = context(jira.client, [YES]);
		const result = await runTool("jira_clone_issue", { key: "QR-48204", summary: "x" }, ctx);
		expect(jira.created[0]).not.toHaveProperty("customfield_10400");
		expect(result.text).toContain("Not copied, Jira refused them: Reviewer");
	});

	it("sends nothing when the user refuses", async () => {
		const jira = fakeJira();
		const { ctx } = context(jira.client, [{ approved: false, scope: "once" }]);
		const result = await runTool("jira_clone_issue", { key: "QR-48204", summary: "x" }, ctx);
		expect(jira.created).toEqual([]);
		expect(result.text).toContain("did not allow");
	});
});

describe("jira_update_issue and jira_get_fields", () => {
	it("sets a custom field by its name and choice", async () => {
		const jira = fakeJira();
		const { ctx, asked } = context(jira.client, [YES]);
		await runTool("jira_update_issue", { key: "QR-1", fields: { service: "Ödeme" } }, ctx);
		expect(asked[0]?.lines).toEqual(["Service: Ödeme"]);
		expect(jira.updates).toEqual([{ key: "QR-1", fields: { customfield_10100: { id: "101" } } }]);
	});

	it("says which choices there are, and changes nothing, for an unknown one", async () => {
		const jira = fakeJira();
		const { ctx, asked } = context(jira.client, [YES]);
		const result = await runTool(
			"jira_update_issue",
			{ key: "QR-1", fields: { Service: "X" } },
			ctx,
		);
		expect(result.text).toContain("Canlı, Ödeme");
		expect(asked).toEqual([]);
		expect(jira.updates).toEqual([]);
	});

	it("shows the custom fields' values", async () => {
		const { ctx } = context(fakeJira().client, []);
		const result = await runTool("jira_get_fields", { key: "QR-48204" }, ctx);
		expect(result.text).toContain("Service [customfield_10100]: Canlı");
	});
});

describe("Confluence tools", () => {
	const page = {
		page: {
			site: "https://wiki.example.com",
			id: "42",
			title: "Plan",
			spaceKey: "DEV",
			version: 3,
			webUrl: "https://wiki.example.com/pages/42",
		},
		storage: "<p>Hello</p>",
	};

	it("comments under a page after asking", async () => {
		const addComment = vi.fn(async () => "7");
		const { ctx, asked } = context(null, [YES], { page: async () => page, addComment });
		const result = await runTool("confluence_add_comment", { page_id: "42", comment: "Hi" }, ctx);
		expect(asked[0]?.title).toContain("Plan");
		expect(addComment).toHaveBeenCalledWith("42", expect.stringContaining("Hi"));
		expect(result.text).toContain("Commented");
	});

	it("copies a page under the same parent", async () => {
		const create = vi.fn(async () => "43");
		const update = vi.fn(async (remote: typeof page.page) => ({ ...remote, version: 2 }));
		const confluence = {
			page: async (id: string) =>
				id === "42"
					? page
					: { page: { ...page.page, id, title: "Plan 2", version: 1 }, storage: "" },
			ancestors: async () => ["1", "9"],
			create,
			update,
		};
		const { ctx } = context(null, [YES], confluence);
		await runTool("confluence_copy_page", { page_id: "42", title: "Plan 2" }, ctx);
		expect(create).toHaveBeenCalledWith("DEV", "9", "Plan 2");
		expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: "43" }), "<p>Hello</p>");
	});

	it("are offered only while connected", () => {
		const { ctx } = context(null, []);
		const names = toolsFor(ctx).map((tool) => tool.definition.name);
		expect(names).not.toContain("jira_clone_issue");
		expect(names).not.toContain("confluence_cql");
	});
});
