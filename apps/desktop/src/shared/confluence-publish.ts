/**
 * Publishing a local document as a new Confluence page: its title (the
 * first heading, when it opens the document), and the files it shows or
 * links that live next to it (pictures, attached files, pictures pasted
 * as data). Those become the new page's attachments, each under a name of
 * its own; the page refers to them by that name. Pure: the main process
 * reads the files and talks to Confluence.
 */
import type { Heading, Image, Link, Root } from "@kalem-editor/core";
import { parse, serialize, visit } from "@kalem-editor/core";
import { linkedAttachment } from "./confluence-common.js";

/** A file of the document that goes to the page as an attachment. */
export interface PublishedFile {
	/** As the document writes it: a relative path, a `file:` address or a `data:` URL. */
	readonly url: string;
	/** The attachment's name on the page: the file's own, made unique. */
	readonly name: string;
	/** A picture (shown) or a linked file. */
	readonly image: boolean;
}

/** Extensions of pictures pasted as `data:` URLs. */
const DATA_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
};

/** Whether a URL names a file on this computer rather than something on the web. */
function isLocal(url: string): boolean {
	if (/^data:/i.test(url) || /^file:/i.test(url)) return true;
	return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("#") && !url.startsWith("//");
}

/** The file name of a local URL, without its folders, query or fragment. */
function fileNameOf(url: string): string {
	const path = url.split(/[?#]/)[0] ?? "";
	let decoded = path;
	try {
		decoded = decodeURIComponent(path);
	} catch {}
	return decoded.split(/[\\/]/).pop() ?? "";
}

/** A name not yet taken: `name.png`, then `name-2.png`… */
function unique(name: string, taken: Set<string>): string {
	const key = (value: string): string => value.toLocaleLowerCase("en");
	if (!taken.has(key(name))) {
		taken.add(key(name));
		return name;
	}
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	for (let n = 2; ; n++) {
		const candidate = `${stem}-${n}${extension}`;
		if (!taken.has(key(candidate))) {
			taken.add(key(candidate));
			return candidate;
		}
	}
}

export interface PublishPlan {
	/** The page's Markdown, its local files named by their attachments. */
	readonly markdown: string;
	/** The files to attach, once each. */
	readonly files: readonly PublishedFile[];
}

/**
 * The page's Markdown and the files to attach: every local picture and
 * every link to a local file (not to another document) is renamed to its
 * attachment. Files of the same name in different folders get names of
 * their own; the same file named twice is attached once.
 */
export function publishPlan(markdown: string): PublishPlan {
	const root = parse(markdown);
	const taken = new Set<string>();
	const byUrl = new Map<string, PublishedFile>();
	let pasted = 0;
	const fileFor = (url: string, image: boolean): PublishedFile | null => {
		const known = byUrl.get(url);
		if (known !== undefined) return known;
		let name: string;
		const data = /^data:([^;,]+)[;,]/i.exec(url);
		if (data !== null) {
			const extension = DATA_EXTENSIONS[(data[1] ?? "").toLocaleLowerCase("en")];
			if (extension === undefined) return null;
			pasted++;
			name = `image-${pasted}.${extension}`;
		} else {
			name = fileNameOf(url);
			if (name === "") return null;
			// A link to another document is a page of its own, not an attachment.
			if (!image && linkedAttachment(name) === null) return null;
		}
		const file = { url, name: unique(name, taken), image };
		byUrl.set(url, file);
		return file;
	};
	visit(root, ["image", "link"], (node) => {
		const target = node as Image | Link;
		if (!isLocal(target.url)) return;
		const file = fileFor(target.url, target.type === "image");
		// The page names the attachment; a space is written as `%20`, as Kalem's own pages do.
		if (file !== null) target.url = file.name.replace(/ /g, "%20");
	});
	return { markdown: serialize(root), files: [...byUrl.values()] };
}

/** The text of a heading, without its formatting. */
function headingText(heading: Heading): string {
	let text = "";
	visit(heading, ["text", "inlineCode"], (node) => {
		text += (node as { value: string }).value;
	});
	return text.trim();
}

/**
 * The title a document proposes: its first heading when the document
 * opens with a level-1 heading, else `fallback` (its file name). `rest` is
 * the document without that heading, for when the title is not repeated
 * on the page.
 */
export function proposedTitle(
	markdown: string,
	fallback: string,
): { readonly title: string; readonly fromHeading: boolean; readonly rest: string } {
	const root: Root = parse(markdown);
	const first = root.children[0];
	if (first?.type === "heading" && first.depth === 1) {
		const title = headingText(first);
		if (title !== "") {
			return {
				title,
				fromHeading: true,
				rest: serialize({ ...root, children: root.children.slice(1) }),
			};
		}
	}
	const name = fallback.replace(/\.(md|markdown|txt|kmd)$/i, "").trim();
	return { title: name, fromHeading: false, rest: markdown };
}
