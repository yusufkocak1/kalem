/**
 * The assistant's Confluence look-ups, run on the connected site: searches
 * (inside pages or in titles) and page reads. An API model calls them as
 * tools; a CLI writes them in a `kalem-confluence` block, and the results
 * go back to it as the next question. They only read.
 */
import { DEFAULT_SEARCH } from "../shared/confluence-search.js";
import { storageToMarkdown, storageUsers } from "../shared/confluence-storage.js";
import type { ConfluenceRequest } from "../shared/confluence-tool.js";
import { pageText, requestOf, searchResultText } from "../shared/confluence-tool.js";
import type { ConfluenceClient, ConfluencePageInfo } from "./confluence-client.js";
import type { ToolDefinition, ToolStep } from "./workspace-tools.js";

export const CONFLUENCE_TOOLS: readonly ToolDefinition[] = [
	{
		name: "confluence_search",
		description:
			"Searches the user's Confluence. By default inside pages (title, text and labels): give 2-4 distinctive words, not a sentence; Confluence matches whole words, so also try stems, synonyms and the other language. Returns each page's id, title, address, place and the text around the words found.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: 'The words to find; "quotes" for an exact phrase.' },
				mode: {
					type: "string",
					enum: ["content", "title"],
					description: "`content` (default) searches inside pages; `title` only titles.",
				},
				space: { type: "string", description: "Only this space (its key); empty for all." },
			},
			required: ["query"],
		},
	},
	{
		name: "confluence_read_page",
		description:
			"Reads a Confluence page's or blog post's text as Markdown, by the id a search gave, with where it sits (the pages above it), who created and last changed it, and its labels. What Confluence fills in when the page is shown (Jira issue tables, included pages, diagrams, attached files, page lists) is marked ⟦like this⟧. A long page comes in parts; read on with `offset`.",
		parameters: {
			type: "object",
			properties: {
				page_id: { type: "string", description: "The page id." },
				offset: { type: "integer", description: "Where to go on reading, in characters." },
			},
			required: ["page_id"],
		},
	},
];

export const isConfluenceTool = (name: string): boolean =>
	CONFLUENCE_TOOLS.some((tool) => tool.name === name);

/** The most people a page's mentions are named by: each is a request. */
const MAX_NAMED_PEOPLE = 40;

/** A page's text for the model: its macros described, the people it mentions by name. */
export async function readingMarkdown(client: ConfluenceClient, storage: string): Promise<string> {
	const users = new Map<string, string>();
	await Promise.all(
		storageUsers(storage)
			.slice(0, MAX_NAMED_PEOPLE)
			.map(async (ref) => {
				const found = await client.user(ref).catch(() => null);
				const id = ref.accountId ?? ref.key ?? ref.username;
				if (found !== null && found.name !== "" && id !== undefined) users.set(id, found.name);
			}),
	);
	return storageToMarkdown(storage, { reading: { users } });
}

/** Where a page sits, who wrote it and its labels, a line each. */
export function aboutText(info: ConfluencePageInfo | null, labels: readonly string[]): string {
	const lines: string[] = [];
	if (info !== null) {
		if (info.type === "blogpost") lines.push("A blog post.");
		if (info.ancestors.length > 0) {
			lines.push(
				`Under: ${info.ancestors.map((page) => `${page.title || "?"} (id ${page.id})`).join(" › ")}`,
			);
		}
		const created = [info.createdBy, info.created?.slice(0, 10) ?? ""].filter(
			(part) => part !== "",
		);
		if (created.length > 0) lines.push(`Created: ${created.join(", ")}`);
		const changed = [
			`version ${info.version}`,
			info.modifiedBy,
			info.modified?.slice(0, 10) ?? "",
		].filter((part) => part !== "");
		lines.push(`Last changed: ${changed.join(", ")} (confluence_page_history shows the changes)`);
	}
	if (labels.length > 0) lines.push(`Labels: ${labels.join(", ")}`);
	return lines.join("\n");
}

/** The look-ups for one answer, on one site. */
export class ConfluenceLookups {
	readonly #client: ConfluenceClient;
	/** Pages read for this answer, so reading one again costs nothing. */
	readonly #pages = new Map<
		string,
		{ title: string; spaceKey: string; url: string; text: string; about: string }
	>();

	constructor(client: ConfluenceClient) {
		this.#client = client;
	}

	get site(): string {
		return this.#client.site;
	}

	/** Runs one request; what it found, or why it failed, as text for the model. */
	async run(request: ConfluenceRequest, step: (step: ToolStep) => void): Promise<string> {
		try {
			if (request.kind === "search") {
				step({ tool: `confluence_search_${request.mode}`, detail: request.query });
				const found = await this.#client.find({
					...DEFAULT_SEARCH,
					query: request.query,
					spaceKey: request.space,
					mode: request.mode,
				});
				return searchResultText(request, found, this.#client.site);
			}
			let page = this.#pages.get(request.id);
			if (page === undefined) {
				const content = await this.#client.page(request.id);
				const [text, info, labels] = await Promise.all([
					readingMarkdown(this.#client, content.storage),
					// What is around the page is a help: a page is read without it.
					Promise.resolve()
						.then(() => this.#client.pageInfo(request.id))
						.catch(() => null),
					Promise.resolve()
						.then(() => this.#client.labels(request.id))
						.catch(() => [] as string[]),
				]);
				page = {
					title: content.page.title,
					spaceKey: content.page.spaceKey,
					url: content.page.webUrl,
					text,
					about: aboutText(info, labels),
				};
				this.#pages.set(request.id, page);
			}
			step({ tool: "confluence_read_page", detail: page.title });
			return pageText({ id: request.id, ...page }, page.text, request.offset);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const what =
				request.kind === "search" ? `Search for "${request.query}"` : `Reading page ${request.id}`;
			return `${what} failed: ${message}`;
		}
	}

	/** A tool call of an API model. */
	runTool(name: string, input: unknown, step: (step: ToolStep) => void): Promise<string> {
		const request = requestOf(input, name === "confluence_read_page" ? "read" : "search");
		if (request === null)
			return Promise.resolve(
				`The ${name} call needs ${name === "confluence_read_page" ? "a page_id" : "a query"}.`,
			);
		return this.run(request, step);
	}

	/** A round of a CLI's requests, as the next question. */
	async runAll(
		requests: readonly ConfluenceRequest[],
		step: (step: ToolStep) => void,
	): Promise<string> {
		const results: string[] = [];
		for (const request of requests) results.push(await this.run(request, step));
		return `<confluence-results>\n${results.join("\n\n---\n\n")}\n</confluence-results>\n\nLook up more with another \`kalem-confluence\` block if you need to, or answer now from what you found (cite the pages you used as [Title](address)).`;
	}
}
