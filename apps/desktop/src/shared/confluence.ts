import { storageToMarkdown } from "./confluence-storage.js";
import { wikiToMarkdown } from "./confluence-wiki.js";

export { markdownToStorage } from "./confluence-storage.js";
export { markdownToWiki } from "./confluence-wiki.js";

/**
 * Confluence has two text formats: the XHTML "storage format" its editor and
 * REST API use, and the older wiki markup (`h1.`, `*bold*`, `{code}`).
 */
export type ConfluenceFormat = "storage" | "wiki";

export function detectConfluenceFormat(text: string): ConfluenceFormat {
	return /^\s*</.test(text) ? "storage" : "wiki";
}

export function confluenceToMarkdown(text: string): string {
	return detectConfluenceFormat(text) === "storage"
		? storageToMarkdown(text)
		: wikiToMarkdown(text);
}
