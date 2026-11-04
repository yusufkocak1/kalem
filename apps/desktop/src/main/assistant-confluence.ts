/**
 * The assistant's Confluence look-ups, run on the connected site: searches
 * (inside pages or in titles) and page reads. An API model calls them as
 * tools; a CLI writes them in a `kalem-confluence` block, and the results
 * go back to it as the next question. They only read.
 */
import { DEFAULT_SEARCH } from "../shared/confluence-search.js";
import { storageToMarkdown } from "../shared/confluence-storage.js";
import type { ConfluenceRequest } from "../shared/confluence-tool.js";
import { pageText, requestOf, searchResultText } from "../shared/confluence-tool.js";
import type { ConfluenceClient } from "./confluence-client.js";
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
			"Reads a Confluence page's text as Markdown, by the page id a search gave. A long page comes in parts; read on with `offset`.",
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

/** The look-ups for one answer, on one site. */
export class ConfluenceLookups {
	readonly #client: ConfluenceClient;
	/** Pages read for this answer, so reading one again costs nothing. */
	readonly #pages = new Map<
		string,
		{ title: string; spaceKey: string; url: string; text: string }
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
				page = {
					title: content.page.title,
					spaceKey: content.page.spaceKey,
					url: content.page.webUrl,
					text: storageToMarkdown(content.storage),
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
