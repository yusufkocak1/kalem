/**
 * The assistant's writes to Jira and Confluence: issues made from the
 * document's requirements, comments, status changes, pages published.
 * Each is shown to the user in full and asked every time; nothing goes to
 * a server without a click, whatever was allowed before.
 */
import { markdownToStorage } from "../shared/confluence-storage.js";
import { markdownToWiki } from "../shared/confluence-wiki.js";
import { format } from "../shared/i18n.js";
import { fieldMetasOf } from "../shared/jira-write.js";
import { FIELDS_HELP, resolveFields, typeIdOf } from "./assistant-jira-tools.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import type { ConfluenceClient } from "./confluence-client.js";
import type { JiraClient } from "./jira-client.js";
import { errorMessage } from "./windows.js";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string) : "";

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

const preview = (markdown: string): string =>
	markdown
		.slice(0, 6000)
		.split("\n")
		.map((line) => `+ ${line}`)
		.join("\n");

const REFUSED = "The user did not allow it: nothing was sent. Do not try again unless they ask.";

interface IssueRequest {
	readonly type: string;
	readonly summary: string;
	readonly description: string;
	readonly parent?: string;
	/** Other fields, by name or id, as the model gave them. */
	readonly fields?: Record<string, unknown>;
}

function issueRequests(raw: unknown): IssueRequest[] {
	return (Array.isArray(raw) ? raw : []).slice(0, 30).flatMap((item): IssueRequest[] => {
		if (typeof item !== "object" || item === null) return [];
		const issue = item as Record<string, unknown>;
		const summary = typeof issue.summary === "string" ? issue.summary.trim() : "";
		if (summary === "") return [];
		return [
			{
				type:
					typeof issue.type === "string" && issue.type.trim() !== "" ? issue.type.trim() : "Story",
				summary: summary.slice(0, 254),
				description:
					typeof issue.description === "string" ? issue.description.slice(0, 30_000) : "",
				...(typeof issue.parent === "string" && issue.parent.trim() !== ""
					? { parent: issue.parent.trim() }
					: {}),
				...(typeof issue.fields === "object" &&
				issue.fields !== null &&
				!Array.isArray(issue.fields) &&
				Object.keys(issue.fields).length > 0
					? { fields: issue.fields as Record<string, unknown> }
					: {}),
			},
		];
	});
}

/** An issue with fields beyond the summary and description, set as its create screen takes them. */
async function createWithFields(
	jira: JiraClient,
	project: string,
	issue: IssueRequest,
): Promise<{ key: string; url: string }> {
	const key = project.toLocaleUpperCase("en");
	const type = await typeIdOf(jira, key, issue.type);
	if (typeof type === "string") throw new Error(type);
	const metas = fieldMetasOf(await jira.createMeta(key, type.id));
	const resolved = resolveFields(metas, issue.fields ?? {}, jira.cloud);
	if (resolved.errors.length > 0) throw new Error(resolved.errors.join(" "));
	return jira.createWithFields({
		project: { key },
		issuetype: { id: type.id },
		summary: issue.summary,
		...(issue.description.trim() === "" ? {} : { description: markdownToWiki(issue.description) }),
		...(issue.parent === undefined ? {} : { parent: { key: issue.parent } }),
		...resolved.fields,
	});
}

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "jira_create_issues",
			description: `Creates Jira issues (for example a story for each requirement of the document); the user sees them all, picks which to create, and is asked every time. Each issue: {"type":"Story"|"Task"|"Bug"|"Sub-task"…,"summary":"…","description":"Markdown","parent"?:"ABC-1","fields"?:{…}}; ${FIELDS_HELP} When Jira asks for required fields (custom ones like Service), jira_create_fields lists them and their choices. Returns the new keys: write them back into the document with document_edit when the user wants.`,
			parameters: {
				type: "object",
				properties: {
					project: { type: "string", description: "The project's key, e.g. ABC." },
					issues: { type: "array", items: { type: "object" } },
				},
				required: ["project", "issues"],
			},
		},
		risk: "external",
		available: (ctx) => ctx.jiraClient !== null,
		async run(input, ctx) {
			const jira = ctx.jiraClient as JiraClient;
			const project = text(input, "project").trim();
			const issues = issueRequests(input.issues);
			if (project === "" || issues.length === 0)
				return "Give the project's key and at least one issue with a summary.";
			const answer = await ctx.approve({
				tool: "jira_create_issues",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraCreate, issues.length, project, jira.site),
				lines: [],
				items: issues.map(
					(issue) =>
						`${issue.type}: ${issue.summary}${issue.parent === undefined ? "" : ` (↑ ${issue.parent})`}${
							issue.fields === undefined
								? ""
								: ` — ${Object.entries(issue.fields)
										.map(
											([name, value]) =>
												`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
										)
										.join(", ")}`
						}`,
				),
				preview: preview(
					issues.map((issue) => `## ${issue.summary}\n${issue.description}`).join("\n\n"),
				),
			});
			if (!answer.approved) return REFUSED;
			const picked = answer.selected ?? issues.map((_issue, index) => index);
			const lines: string[] = [];
			for (const index of picked) {
				const issue = issues[index];
				if (issue === undefined) continue;
				try {
					const made =
						issue.fields === undefined
							? await jira.createIssue({ project, ...issue })
							: await createWithFields(jira, project, issue);
					lines.push(`Created ${made.key}: ${issue.summary} (${made.url})`);
					ctx.step({ tool: "jira_create_issues", detail: made.key });
				} catch (error) {
					lines.push(`Not created: ${issue.summary} — ${errorMessage(error)}`);
				}
			}
			const skipped = issues.length - picked.length;
			return `${lines.join("\n")}${skipped > 0 ? `\nThe user left out ${skipped} of them.` : ""}`;
		},
	},
	{
		definition: {
			name: "jira_add_comment",
			description:
				"Adds a comment (Markdown) to a Jira issue; the user sees it and is asked every time.",
			parameters: {
				type: "object",
				properties: { key: { type: "string" }, comment: { type: "string" } },
				required: ["key", "comment"],
			},
		},
		risk: "external",
		available: (ctx) => ctx.jiraClient !== null,
		async run(input, ctx) {
			const jira = ctx.jiraClient as JiraClient;
			const key = text(input, "key").trim().toLocaleUpperCase("en");
			const comment = text(input, "comment");
			if (comment.trim() === "") return "Give the comment's text.";
			const answer = await ctx.approve({
				tool: "jira_add_comment",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraComment, key),
				lines: [],
				preview: preview(comment),
			});
			if (!answer.approved) return REFUSED;
			await jira.addComment(key, comment);
			ctx.step({ tool: "jira_add_comment", detail: key });
			return `Commented on ${key}.`;
		},
	},
	{
		definition: {
			name: "jira_transition",
			description:
				"Moves a Jira issue to another status (by the status's name or the step's name); the user is asked every time.",
			parameters: {
				type: "object",
				properties: { key: { type: "string" }, status: { type: "string" } },
				required: ["key", "status"],
			},
		},
		risk: "external",
		available: (ctx) => ctx.jiraClient !== null,
		async run(input, ctx) {
			const jira = ctx.jiraClient as JiraClient;
			const key = text(input, "key").trim().toLocaleUpperCase("en");
			const wanted = fold(text(input, "status"));
			const steps = await jira.transitions(key);
			const step =
				steps.find((each) => fold(each.to) === wanted || fold(each.name) === wanted) ??
				steps.find((each) => fold(each.to).includes(wanted) || fold(each.name).includes(wanted));
			if (step === undefined) {
				return `${key} cannot go to "${text(input, "status")}" now. Its steps: ${steps.map((each) => `${each.name} → ${each.to}`).join(", ") || "none"}.`;
			}
			if (step.needs.length > 0)
				return `That step asks for ${step.needs.join(", ")}: the user takes it in Jira.`;
			const answer = await ctx.approve({
				tool: "jira_transition",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraTransition, key),
				lines: [`${key}: ${step.name} → ${step.to}`],
			});
			if (!answer.approved) return REFUSED;
			await jira.transition(key, step.id);
			ctx.step({ tool: "jira_transition", detail: `${key} → ${step.to}` });
			return `${key} is now ${step.to}.`;
		},
	},
	{
		definition: {
			name: "confluence_publish",
			description:
				'Publishes Markdown to Confluence: adds it to the end of a page (page_id, "mode":"append", the default), replaces a page\'s whole content ("mode":"replace"), or creates a new page (title, space, parent_id). The user sees it and is asked every time.',
			parameters: {
				type: "object",
				properties: {
					markdown: { type: "string" },
					page_id: { type: "string" },
					mode: { type: "string", enum: ["append", "replace"] },
					title: { type: "string", description: "A new page's title." },
					space: { type: "string", description: "A new page's space key." },
					parent_id: { type: "string", description: "A new page's parent page id." },
				},
				required: ["markdown"],
			},
		},
		risk: "external",
		available: (ctx) => ctx.confluenceClient !== null,
		async run(input, ctx: ToolContext) {
			const confluence = ctx.confluenceClient as ConfluenceClient;
			const markdown = text(input, "markdown");
			if (markdown.trim() === "") return "Give the Markdown to publish.";
			const pageId = text(input, "page_id").trim();
			const replace = text(input, "mode") === "replace";
			if (pageId !== "") {
				const content = await confluence.page(pageId);
				const answer = await ctx.approve({
					tool: "confluence_publish",
					risk: "external",
					permission: "confluence",
					title: format(
						replace ? ctx.t.approvalConfluenceReplace : ctx.t.approvalConfluenceAppend,
						content.page.title,
					),
					lines: [content.page.webUrl],
					preview: preview(markdown),
				});
				if (!answer.approved) return REFUSED;
				const storage = markdownToStorage(markdown);
				const saved = await confluence.update(
					content.page,
					replace ? storage : `${content.storage}${storage}`,
				);
				ctx.step({ tool: "confluence_publish", detail: saved.title });
				return `Published to "${saved.title}" (${saved.webUrl}), version ${saved.version}.`;
			}
			const title = text(input, "title").trim();
			const space = text(input, "space").trim() || ctx.settings().confluenceSpace;
			if (title === "" || space === "")
				return "A new page needs a title and a space key (or give page_id).";
			const parent = text(input, "parent_id").trim() || null;
			const answer = await ctx.approve({
				tool: "confluence_publish",
				risk: "external",
				permission: "confluence",
				title: format(ctx.t.approvalConfluenceCreate, title, space),
				lines: parent === null ? [] : [format(ctx.t.approvalConfluenceParent, parent)],
				preview: preview(markdown),
			});
			if (!answer.approved) return REFUSED;
			const id = await confluence.create(space, parent, title);
			const created = await confluence.page(id);
			const saved = await confluence.update(created.page, markdownToStorage(markdown));
			ctx.step({ tool: "confluence_publish", detail: saved.title });
			return `Created "${saved.title}" (page id ${id}, ${saved.webUrl}).`;
		},
	},
];

registerTools(TOOLS);
