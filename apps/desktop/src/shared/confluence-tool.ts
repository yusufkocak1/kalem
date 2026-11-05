/**
 * The assistant's Confluence look-ups: what it is told about them, the
 * requests a CLI writes in a `kalem-confluence` block (an API calls them
 * as tools instead), and how what was found is written back to it. Pure:
 * the main process runs the searches and reads the pages.
 */
import type { ConfluenceSearchResults, SearchMode, TextPart } from "./confluence-search.js";

/** The code fence language of a CLI's Confluence requests. */
export const CONFLUENCE_FENCE = "kalem-confluence";

export type ConfluenceRequest =
	| {
			readonly kind: "search";
			readonly query: string;
			readonly mode: SearchMode;
			/** A space key; `null` for every space. */
			readonly space: string | null;
	  }
	| {
			readonly kind: "read";
			readonly id: string;
			/** Where to go on reading a long page, in characters. */
			readonly offset: number;
	  };

/** Requests one round may make; more are left out. */
export const MAX_REQUESTS = 6;
/** Rounds of requests one answer may take; the last must answer with what it has. */
export const MAX_ROUNDS = 6;
/** Characters of one page sent at a time. */
export const PAGE_CHUNK = 24_000;
/** Results of one search written out. */
const SHOWN_HITS = 15;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** One request as a model writes it, as a tool call's input or in a block; `null` when it is none. */
export function requestOf(raw: unknown, kind?: "search" | "read"): ConfluenceRequest | null {
	if (!isRecord(raw)) return null;
	const query =
		typeof raw.search === "string" ? raw.search : typeof raw.query === "string" ? raw.query : "";
	const id =
		typeof raw.read === "string" || typeof raw.read === "number"
			? String(raw.read)
			: typeof raw.page_id === "string" || typeof raw.page_id === "number"
				? String(raw.page_id)
				: "";
	if ((kind === undefined || kind === "read") && /^\d{1,20}$/.test(id.trim())) {
		const offset = Number(raw.offset ?? raw.start ?? 0);
		return {
			kind: "read",
			id: id.trim(),
			offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
		};
	}
	if ((kind === undefined || kind === "search") && query.trim() !== "") {
		const space = typeof raw.space === "string" ? raw.space.trim() : "";
		return {
			kind: "search",
			query: query.trim().slice(0, 300),
			mode: raw.mode === "title" ? "title" : "content",
			space: /^[\w~.-]{1,255}$/.test(space) ? space : null,
		};
	}
	return null;
}

const BLOCK = new RegExp(
	`^ {0,3}(\`{3,}|~{3,})[ \\t]*${CONFLUENCE_FENCE}[ \\t]*\\n([\\s\\S]*?)\\n {0,3}\\1[\`~]*[ \\t]*$`,
	"gm",
);

/** The requests in a reply's `kalem-confluence` blocks: a JSON object, or an array of them. */
export function confluenceRequests(reply: string): ConfluenceRequest[] {
	const requests: ConfluenceRequest[] = [];
	for (const match of reply.matchAll(BLOCK)) {
		let data: unknown;
		try {
			data = JSON.parse(match[2] ?? "");
		} catch {
			continue;
		}
		for (const item of Array.isArray(data) ? data : [data]) {
			const request = requestOf(item);
			if (request !== null) requests.push(request);
		}
	}
	return requests.slice(0, MAX_REQUESTS);
}

/** The reply without its `kalem-confluence` blocks, which say nothing to the reader. */
export function withoutRequests(reply: string): string {
	return reply.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n");
}

/** A page's address that every Confluence takes. */
export const pageAddress = (site: string, id: string): string =>
	`${site}/pages/viewpage.action?pageId=${id}`;

const marked = (parts: readonly TextPart[]): string =>
	parts.map((part) => (part.hit ? `«${part.text}»` : part.text)).join("");

/** What a search found, for the model: each page's id, title, place, date and the text around the words. */
export function searchResultText(
	request: Extract<ConfluenceRequest, { kind: "search" }>,
	found: ConfluenceSearchResults,
	site: string,
): string {
	const head = `Search (${request.mode === "content" ? "inside pages" : "titles"}${request.space === null ? "" : `, space ${request.space}`}) for "${request.query}": ${found.total ?? found.hits.length} pages${(found.total ?? 0) > SHOWN_HITS ? `, the first ${Math.min(SHOWN_HITS, found.hits.length)} below` : ""}.`;
	if (found.hits.length === 0) {
		return `${head}\nNothing found. Try other words: fewer, shorter (a word's stem), synonyms, or the other language.`;
	}
	const lines = found.hits.slice(0, SHOWN_HITS).map((hit, index) => {
		const place = [hit.spaceName, ...hit.path].filter((part) => part !== "").join(" › ");
		const excerpt = marked(hit.excerpt).trim();
		return [
			`${index + 1}. ${hit.title} (page id ${hit.id})`,
			`   ${pageAddress(site, hit.id)}`,
			...(place === "" ? [] : [`   in: ${place}`]),
			...(hit.modified === null ? [] : [`   changed: ${hit.modified.slice(0, 10)}`]),
			...(excerpt === "" ? [] : [`   text: ${excerpt}`]),
		].join("\n");
	});
	return `${head}\n${lines.join("\n")}`;
}

/** A page's text for the model, a part at a time. */
export function pageText(
	page: {
		readonly id: string;
		readonly title: string;
		readonly spaceKey: string;
		readonly url: string;
	},
	markdown: string,
	offset: number,
): string {
	const text = markdown.trim();
	const part = text.slice(offset, offset + PAGE_CHUNK);
	const end = offset + part.length;
	const more =
		end < text.length
			? `\n[… ${text.length - end} more characters: read again with offset ${end} for the rest]`
			: "";
	const range =
		offset === 0 && end >= text.length ? "" : ` (characters ${offset}-${end} of ${text.length})`;
	return `Page "${page.title}" (page id ${page.id}, space ${page.spaceKey})${range}\n${page.url}\n\n${part === "" ? "[No text past this point.]" : part}${more}`;
}

/** What the model is told about Confluence; `site` is `null` when the app is not connected to one. */
/**
 * How the model reaches Confluence: an API's tools, Claude Code's tools from
 * Kalem's MCP server, or (a CLI without them) requests written in a block.
 */
export type LookupWay = "tools" | "mcp" | "block";

export function confluenceInstructions(site: string | null, way: LookupWay): string {
	if (site === null) {
		return `## Confluence
The user is not connected to Confluence. If they ask you to find something in Confluence, tell them to connect first ("File" → "Open from Confluence"), then ask again.`;
	}
	const how =
		way === "mcp"
			? `Look things up with Kalem's tools \`mcp__kalem__confluence_search\` (inside pages by default, or in titles) and \`mcp__kalem__confluence_read_page\` (a page's text, by the id a search gave). They use the app's own connection to the site. Do not use WebFetch, curl, Bash or any other tool for Confluence: the site is behind the user's sign-in, often on a company network, and only these tools reach it.`
			: way === "block"
				? `To look something up, reply with ONLY a \`${CONFLUENCE_FENCE}\` code block holding a JSON array of requests, and nothing else:

\`\`\`${CONFLUENCE_FENCE}
[
  { "search": "izin talebi onay", "mode": "content" },
  { "search": "İzin Süreci", "mode": "title", "space": "IK" },
  { "read": "123456" }
]
\`\`\`

Kalem runs them and sends you what they found in <confluence-results>; then ask again, or answer. At most ${MAX_REQUESTS} requests a round and ${MAX_ROUNDS} rounds. "search" looks inside pages ("mode": "content", the default: title, text and labels) or in titles ("mode": "title"); "space" (a space key) is optional. "read" takes a page id from the results and returns the page's text; a long page comes in parts: add "offset" to read on. Do not use your own tools (WebFetch, Bash…) for Confluence: they cannot reach it.`
				: `Look things up with the tools: \`confluence_search\` (inside pages by default, or in titles) and \`confluence_read_page\` (a page's text, by the id a search gave).`;
	return `## Confluence
The user is connected to the Confluence site ${site}. When they ask you to find, look up, check or summarise something in Confluence (for example "bunu Confluence'tan bul", "Confluence'ta … var mı?"), or the answer is likely written there (their team's processes, decisions, designs, runbooks), search it yourself instead of saying you cannot.

${how}

How to search well:
- Search inside pages with 2-4 distinctive words, not the whole question. Confluence matches whole words: also try a shorter stem (Turkish suffixes: "onaylanması" → "onay"), synonyms, an abbreviation or the English term, and an exact "phrase" when you know one. Search titles when the user names a page.
- Look at several results before choosing; then read the 1-4 most promising pages. Do not answer from the excerpts alone when the answer needs the page.
- Answer from what you read: say what the pages say, and cite each page you used as a Markdown link, [Title](address). When pages disagree, or the answer is not there, say so and say what you searched for.`;
}
