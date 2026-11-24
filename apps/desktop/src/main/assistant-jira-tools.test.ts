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

function context(
	jira: unknown,
	answers: ApprovalAnswer[],
	confluence: unknown = null,
	policies: Record<string, string> = {},
) {
	const asked: Omit<ApprovalRequest, "id" | "chatId" | "scopes">[] = [];
	const ctx = {
		chatId: "c",
		t: stringsFor("en"),
		excluded: new Set<string>(),
		settings: () => ({ assistantToolPolicies: policies }),
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
		const { ctx, asked } = context(null, [YES], confluence);
		await runTool("confluence_copy_page", { page_id: "42", title: "Plan 2" }, ctx);
		// The parent by its title, not its id (keşif testi: "41 sayfasının altında").
		expect(asked[0]?.lines).toContain("Under the page “Plan 2”");
		expect(create).toHaveBeenCalledWith("DEV", "9", "Plan 2");
		expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: "43" }), "<p>Hello</p>");
	});

	it("names a new page's parent by its title, or its id when it cannot be read", async () => {
		const confluence = {
			page: async (id: string) => {
				if (id !== "41") throw new Error("HTTP 404");
				return { page: { ...page.page, id, title: "Ana Sayfa" }, storage: "" };
			},
			create: async () => "50",
		};
		const answers: ApprovalAnswer[] = [{ approved: false, scope: "once" }];
		const known = context(null, [...answers], confluence);
		await runTool(
			"confluence_publish",
			{ markdown: "# Yeni", title: "Yeni", space: "DEV", parent_id: "41" },
			known.ctx,
		);
		expect(known.asked[0]?.lines).toEqual(["Under the page “Ana Sayfa”"]);
		const unknown = context(null, [...answers], confluence);
		await runTool(
			"confluence_publish",
			{ markdown: "# Yeni", title: "Yeni", space: "DEV", parent_id: "77" },
			unknown.ctx,
		);
		expect(unknown.asked[0]?.lines).toEqual(["Under the page 77"]);
	});

	/** Keşif testi: a result without a type read "Sprint Planı (, id 42, …)". */
	it("lists CQL results without empty parts", async () => {
		const confluence = {
			searchCql: async () => [
				{
					id: "42",
					type: "",
					title: "Sprint Planı",
					space: "Geliştirme",
					url: "https://wiki.example.com/pages/42",
					excerpt: "",
					modified: "2026-10-01T09:00:00.000Z",
				},
				{
					id: "",
					type: "page",
					title: "Taslak",
					space: "",
					url: "https://wiki.example.com/x",
					excerpt: "",
					modified: null,
				},
			],
		};
		const { ctx } = context(null, [], confluence);
		const result = await runTool("confluence_cql", { cql: "type = page" }, ctx);
		expect(result.text).toContain(
			"- Sprint Planı (id 42, Geliştirme, 2026-10-01) https://wiki.example.com/pages/42",
		);
		expect(result.text).toContain("- Taslak (page) https://wiki.example.com/x");
	});

	it("are offered only while connected", () => {
		const { ctx } = context(null, []);
		const names = toolsFor(ctx).map((tool) => tool.definition.name);
		expect(names).not.toContain("jira_clone_issue");
		expect(names).not.toContain("confluence_cql");
	});
});

describe("the tools as the user set them", () => {
	it("leaves out a tool turned off, and refuses its call", async () => {
		const jira = fakeJira();
		const { ctx } = context(jira.client, [YES], null, { jira_clone_issue: "off" });
		expect(toolsFor(ctx).map((tool) => tool.definition.name)).not.toContain("jira_clone_issue");
		const result = await runTool("jira_clone_issue", { key: "QR-1" }, ctx);
		expect(result.isError).toBe(true);
		expect(jira.created).toEqual([]);
	});

	it("asks before a tool that only reads, when set so", async () => {
		const { ctx, asked } = context(fakeJira().client, [{ approved: false, scope: "once" }], null, {
			jira_get_fields: "ask",
		});
		const result = await runTool("jira_get_fields", { key: "QR-48204" }, ctx);
		expect(asked[0]).toMatchObject({ tool: "jira_get_fields", everyTime: true });
		expect(result.text).toContain("did not allow");
	});
});

/** Keşif testi: the card said "QR-1: Start Test → Test", the step's name where the status goes. */
describe("jira_transition", () => {
	function transitions(status: string | null) {
		const moved: string[] = [];
		const client = {
			site: "https://jira.example.com",
			cloud: false,
			transitions: async () => [
				{ id: "11", name: "Start Test", to: "Test", toCategory: "indeterminate", needs: [] },
				{ id: "21", name: "Done", to: "Done", toCategory: "done", needs: [] },
			],
			row: async () => {
				if (status === null) throw new Error("HTTP 404");
				return { key: "QR-1", summary: "", status, statusCategory: "indeterminate", type: "Bug" };
			},
			async transition(_key: string, id: string) {
				moved.push(id);
			},
		};
		return { client, moved };
	}

	it("shows the status it is in, the one it goes to and the step's name", async () => {
		const jira = transitions("In Progress");
		const { ctx, asked } = context(jira.client, [YES]);
		const result = await runTool("jira_transition", { key: "qr-1", status: "test" }, ctx);
		expect(asked[0]?.lines).toEqual(["QR-1: In Progress → Test (Start Test)"]);
		expect(jira.moved).toEqual(["11"]);
		expect(result.text).toBe("QR-1 is now Test.");
	});

	it("leaves out a step's name that is the status's own", async () => {
		const jira = transitions("Test");
		const { ctx, asked } = context(jira.client, [YES]);
		await runTool("jira_transition", { key: "QR-1", status: "Done" }, ctx);
		expect(asked[0]?.lines).toEqual(["QR-1: Test → Done"]);
	});

	it("still asks when the issue's status cannot be read", async () => {
		const jira = transitions(null);
		const { ctx, asked } = context(jira.client, [{ approved: false, scope: "once" }]);
		await runTool("jira_transition", { key: "QR-1", status: "Test" }, ctx);
		expect(asked[0]?.lines).toEqual(["QR-1: → Test (Start Test)"]);
		expect(jira.moved).toEqual([]);
	});
});

describe("jira_get_attachment", () => {
	const RAW_ISSUE = {
		key: "QR-1",
		fields: {
			summary: "x",
			attachment: [
				{ id: "7", filename: "notes.md", mimeType: "text/markdown", size: 12 },
				{ id: "8", filename: "shot.png", mimeType: "image/png", size: 99 },
				{ id: "9", filename: "spec.pdf", mimeType: "application/pdf", size: 99 },
			],
		},
	};
	function attachmentJira() {
		const downloaded: string[] = [];
		const client = {
			site: "https://jira.example.com",
			cloud: false,
			rawIssue: async () => RAW_ISSUE,
			async attachment(id: string, name: string) {
				downloaded.push(`${id}/${name}`);
				return id === "9"
					? new Response(new Uint8Array([37, 80, 68, 70, 0, 1]))
					: new Response("# Notlar\nçalışıyor");
			},
		};
		return { client, downloaded };
	}

	it("lists the attachments without a name", async () => {
		const { ctx } = context(attachmentJira().client, []);
		const result = await runTool("jira_get_attachment", { key: "QR-1" }, ctx);
		expect(result.text).toContain("Attachments of QR-1 (3)");
		expect(result.text).toContain("notes.md");
	});

	it("reads a text attachment", async () => {
		const jira = attachmentJira();
		const { ctx } = context(jira.client, []);
		const result = await runTool("jira_get_attachment", { key: "QR-1", name: "notes" }, ctx);
		expect(result.isError).toBe(false);
		expect(result.text).toContain("# Notlar\nçalışıyor");
		expect(jira.downloaded).toEqual(["7/notes.md"]);
	});

	it("says images and binary files cannot be read", async () => {
		const jira = attachmentJira();
		const { ctx } = context(jira.client, []);
		expect((await runTool("jira_get_attachment", { key: "QR-1", name: "8" }, ctx)).text).toContain(
			"is an image",
		);
		expect(
			(await runTool("jira_get_attachment", { key: "QR-1", name: "spec.pdf" }, ctx)).text,
		).toContain("binary file");
		expect(jira.downloaded).toEqual(["9/spec.pdf"]);
	});
});
