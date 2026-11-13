/**
 * The assistant's further Confluence tools: the spaces, a page's child
 * pages, its comments and labels, CQL searches; and the writes beyond
 * publishing: a comment, labels, a page copied under a new title. A write
 * is shown to the user in full and asked every time.
 */
import { markdownToStorage, storageToMarkdown } from "../shared/confluence-storage.js";
import { format } from "../shared/i18n.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import type { ConfluenceClient } from "./confluence-client.js";

const REFUSED = "The user did not allow it: nothing was sent. Do not try again unless they ask.";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

const clientOf = (ctx: ToolContext): ConfluenceClient => ctx.confluenceClient as ConfluenceClient;

const connected = (ctx: ToolContext): boolean => ctx.confluenceClient !== null;

/** A page id the model gave, or one in a page's address. */
function pageIdOf(input: Record<string, unknown>, key = "page_id"): string | null {
	const given = text(input, key);
	if (/^\d+$/.test(given)) return given;
	const match = /[?&]pageId=(\d+)|\/pages\/(\d+)/.exec(given);
	return match === null ? null : (match[1] ?? match[2] ?? null);
}

const preview = (markdown: string): string =>
	markdown
		.slice(0, 6000)
		.split("\n")
		.map((line) => `+ ${line}`)
		.join("\n");

/** A label as Confluence keeps it: lower case, no spaces. */
const labelOf = (label: string): string =>
	label
		.trim()
		.toLocaleLowerCase("tr")
		.replace(/\s+/g, "-")
		.replace(/[!#&()*,.:;<>?@[\]^]/g, "");

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "confluence_list_spaces",
			description:
				"Lists the Confluence spaces the user can see (key and name); `query` narrows them.",
			parameters: {
				type: "object",
				properties: { query: { type: "string", description: "Words in the key or name." } },
				required: [],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			ctx.readExternal = true;
			const wanted = fold(text(input, "query"));
			const spaces = (await clientOf(ctx).spaces()).filter(
				(space) =>
					wanted === "" || fold(space.key).includes(wanted) || fold(space.name).includes(wanted),
			);
			ctx.step({ tool: "confluence_list_spaces", detail: text(input, "query") });
			if (spaces.length === 0) return "No space found.";
			const shown = spaces.slice(0, 200);
			return `${spaces.length} spaces${spaces.length > shown.length ? `, the first ${shown.length}` : ""}:\n${shown.map((space) => `- ${space.key}: ${space.name}`).join("\n")}`;
		},
	},
	{
		definition: {
			name: "confluence_child_pages",
			description:
				"Lists a Confluence page's child pages (id and title), or a space's top-level pages when given `space` instead of `page_id`.",
			parameters: {
				type: "object",
				properties: {
					page_id: { type: "string", description: "The page id." },
					space: { type: "string", description: "A space key, for its top-level pages." },
				},
				required: [],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const confluence = clientOf(ctx);
			const id = pageIdOf(input);
			const space = text(input, "space");
			if (id === null && space === "") return "Give a page_id, or a space key.";
			ctx.readExternal = true;
			const pages =
				id === null ? await confluence.rootPages(space) : await confluence.childPages(id);
			ctx.step({ tool: "confluence_child_pages", detail: id ?? space });
			if (pages.length === 0)
				return id === null ? `${space} has no pages.` : `Page ${id} has no child pages.`;
			return `${id === null ? `Top-level pages of ${space}` : `Child pages of ${id}`} (${pages.length}):\n${pages
				.map(
					(page) =>
						`- ${page.title} (page id ${page.id}${page.hasChildren === true ? ", has children" : ""})`,
				)
				.join("\n")}`;
		},
	},
	{
		definition: {
			name: "confluence_page_comments",
			description:
				"Reads the comments under a Confluence page (who, when, the text as Markdown) and the page's labels.",
			parameters: {
				type: "object",
				properties: { page_id: { type: "string", description: "The page id." } },
				required: ["page_id"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const confluence = clientOf(ctx);
			const id = pageIdOf(input);
			if (id === null) return "Give a page id.";
			ctx.readExternal = true;
			const [comments, labels] = await Promise.all([
				confluence.comments(id),
				confluence.labels(id).catch(() => [] as string[]),
			]);
			ctx.step({ tool: "confluence_page_comments", detail: id });
			const lines = [`Labels: ${labels.length === 0 ? "(none)" : labels.join(", ")}`];
			if (comments.length === 0) lines.push("No comments.");
			else {
				lines.push(`Comments (${comments.length}):`);
				for (const comment of comments) {
					const body = storageToMarkdown(comment.storage)
						.replace(/\n{2,}/g, "\n")
						.trim();
					lines.push(
						`- ${comment.author || "?"}${comment.created === null ? "" : `, ${comment.created.slice(0, 10)}`}: ${body.slice(0, 2000)}`,
					);
				}
			}
			return lines.join("\n");
		},
	},
	{
		definition: {
			name: "confluence_cql",
			description:
				'Searches Confluence with CQL, as it is written: e.g. `space = DEV AND type = page AND label = "api"`, `ancestor = 12345`, `contributor = currentUser() ORDER BY lastmodified DESC`, `type = blogpost AND created > now("-30d")`. Returns each result\'s id, type, title, space, address and an excerpt.',
			parameters: {
				type: "object",
				properties: {
					cql: { type: "string", description: "The CQL query." },
					limit: { type: "integer", description: "How many results, at most 50 (default 25)." },
				},
				required: ["cql"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const cql = text(input, "cql").slice(0, 2000);
			if (cql === "") return "Give a CQL query.";
			ctx.readExternal = true;
			const limit = typeof input.limit === "number" ? input.limit : 25;
			const results = await clientOf(ctx).searchCql(cql, limit);
			ctx.step({ tool: "confluence_cql", detail: cql });
			if (results.length === 0) return `CQL \`${cql}\`: nothing found.`;
			return `CQL \`${cql}\`: ${results.length} results.\n${results
				.map(
					(result) =>
						`- ${result.title} (${result.type}${result.id === "" ? "" : `, id ${result.id}`}${result.space === "" ? "" : `, ${result.space}`}${result.modified === null ? "" : `, ${result.modified.slice(0, 10)}`}) ${result.url}${result.excerpt === "" ? "" : `\n  ${result.excerpt.slice(0, 300)}`}`,
				)
				.join("\n")}`;
		},
	},
	{
		definition: {
			name: "confluence_add_comment",
			description:
				"Adds a comment (Markdown) under a Confluence page; the user sees it and is asked every time.",
			parameters: {
				type: "object",
				properties: {
					page_id: { type: "string", description: "The page id." },
					comment: { type: "string", description: "The comment, in Markdown." },
				},
				required: ["page_id", "comment"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const confluence = clientOf(ctx);
			const id = pageIdOf(input);
			const comment = typeof input.comment === "string" ? input.comment : "";
			if (id === null) return "Give a page id.";
			if (comment.trim() === "") return "Give the comment's text.";
			const page = await confluence.page(id);
			const answer = await ctx.approve({
				tool: "confluence_add_comment",
				risk: "external",
				permission: "confluence",
				title: format(ctx.t.approvalConfluenceComment, page.page.title),
				lines: [page.page.webUrl],
				preview: preview(comment),
			});
			if (!answer.approved) return REFUSED;
			await confluence.addComment(id, markdownToStorage(comment));
			ctx.step({ tool: "confluence_add_comment", detail: page.page.title });
			return `Commented on "${page.page.title}" (${page.page.webUrl}).`;
		},
	},
	{
		definition: {
			name: "confluence_add_labels",
			description: "Adds labels to a Confluence page; the user is asked every time.",
			parameters: {
				type: "object",
				properties: {
					page_id: { type: "string", description: "The page id." },
					labels: { type: "array", items: { type: "string" } },
				},
				required: ["page_id", "labels"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const confluence = clientOf(ctx);
			const id = pageIdOf(input);
			if (id === null) return "Give a page id.";
			const given = Array.isArray(input.labels)
				? input.labels
				: typeof input.labels === "string"
					? input.labels.split(/[,;]/)
					: [];
			const labels = [
				...new Set(
					given
						.filter((label): label is string => typeof label === "string")
						.map(labelOf)
						.filter((label) => label !== ""),
				),
			].slice(0, 20);
			if (labels.length === 0) return "Give at least one label.";
			const page = await confluence.page(id);
			const answer = await ctx.approve({
				tool: "confluence_add_labels",
				risk: "external",
				permission: "confluence",
				title: format(ctx.t.approvalConfluenceLabels, page.page.title),
				lines: [labels.join(", ")],
			});
			if (!answer.approved) return REFUSED;
			await confluence.addLabels(id, labels);
			ctx.step({ tool: "confluence_add_labels", detail: page.page.title });
			return `Added to "${page.page.title}": ${labels.join(", ")}.`;
		},
	},
	{
		definition: {
			name: "confluence_copy_page",
			description:
				"Copies a Confluence page's content as a new page with another title: in the same space and under the same parent by default, or in `space` under `parent_id`. The user is asked every time.",
			parameters: {
				type: "object",
				properties: {
					page_id: { type: "string", description: "The page to copy." },
					title: { type: "string", description: "The new page's title." },
					space: { type: "string", description: "Another space's key." },
					parent_id: { type: "string", description: "The new page's parent page id." },
				},
				required: ["page_id", "title"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const confluence = clientOf(ctx);
			const id = pageIdOf(input);
			const title = text(input, "title");
			if (id === null || title === "") return "Give the page id and the new title.";
			ctx.readExternal = true;
			const source = await confluence.page(id);
			const space = text(input, "space") || source.page.spaceKey;
			let parent = pageIdOf(input, "parent_id");
			if (parent === null && space === source.page.spaceKey) {
				parent = (await confluence.ancestors(id).catch(() => [] as string[])).at(-1) ?? null;
			}
			const answer = await ctx.approve({
				tool: "confluence_copy_page",
				risk: "external",
				permission: "confluence",
				title: format(ctx.t.approvalConfluenceCopy, source.page.title, title, space),
				lines: [
					source.page.webUrl,
					...(parent === null ? [] : [format(ctx.t.approvalConfluenceParent, parent)]),
				],
			});
			if (!answer.approved) return REFUSED;
			const newId = await confluence.create(space, parent, title);
			const created = await confluence.page(newId);
			const saved = await confluence.update(created.page, source.storage);
			ctx.step({ tool: "confluence_copy_page", detail: saved.title });
			return `Created "${saved.title}" (page id ${newId}, ${saved.webUrl}) as a copy of "${source.page.title}". Attachments are not copied.`;
		},
	},
];

registerTools(TOOLS);
