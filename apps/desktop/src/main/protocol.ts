import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { DIAGRAM_DATA_SUFFIX, DIAGRAM_SUFFIX } from "../shared/diagram.js";
import { imageTypeOf } from "../shared/image-type.js";
import { extension, uncShare, urlPathToFilePath } from "../shared/paths.js";

/**
 * Serves images next to the open document. The renderer points `<base href>`
 * at the document's folder using this scheme, so relative Markdown image URLs
 * resolve without rewriting `src` in the editor DOM.
 */
export const DOCUMENT_SCHEME = "kalem-doc";

// Only image files are served: a hostile document must not be able to read
// arbitrary files through `![](../../secret)`.
const SERVED_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"bmp",
	"ico",
	"svg",
]);

/** Must run before the app is ready. */
export function registerDocumentScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: DOCUMENT_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				stream: true,
				corsEnabled: true,
			},
		},
	]);
}

/** Images and other displayable files, and the data files the diagram editor reads. */
function served(name: string): boolean {
	// kalem-locale-ok: file extensions are ASCII
	return SERVED_EXTENSIONS.has(extension(name)) || name.toLowerCase().endsWith(DIAGRAM_DATA_SUFFIX);
}

/** Images of a Confluence page tab: `kalem-doc://confluence/<page id>/<file name>`. */
export const CONFLUENCE_HOST = "confluence";

export const JIRA_HOST = "jira";

/** Files next to the document: `kalem-doc://local/<path>`. */
export const LOCAL_HOST = "local";

export type AttachmentLoader = (pageId: string, name: string) => Promise<Response | null>;

/** A picture JEditor serves on Jira: `kalem-doc://jira/jeditor?<its query>`. */
export const JEDITOR_PATH = "/jeditor";

export type EditorImageLoader = (query: string) => Promise<Response | null>;

/** Larger answers are not read into memory to be shown as a picture. */
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

const notFound = (): Response => new Response(null, { status: 404 });

/**
 * The picture in a server's answer, as a clean answer of its own; `null`
 * when it is not one. Atlassian answers a request it does not take with its
 * sign-in page, or an error page, with status 200: drawn as a picture,
 * that is a broken image with no word of why. The type comes from the
 * bytes, so a picture sent as `application/octet-stream` is still shown.
 */
export async function imageResponse(response: Response): Promise<Response | null> {
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		return null;
	}
	const length = Number(response.headers.get("Content-Length") ?? "0");
	if (length > MAX_IMAGE_BYTES) {
		await response.body?.cancel().catch(() => {});
		return null;
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
	// kalem-locale-ok: media types are ASCII
	const declared = (response.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase();
	const type = imageTypeOf(bytes) ?? (declared?.startsWith("image/") ? declared : null);
	if (type === null) return null;
	const headers = new Headers({ "Content-Type": type, "Content-Length": String(bytes.length) });
	const cache = response.headers.get("Cache-Control");
	if (cache !== null) headers.set("Cache-Control", cache);
	return new Response(bytes, { status: 200, headers });
}

async function serveAttachment(url: URL, load: AttachmentLoader): Promise<Response> {
	const match = /^\/(\d+)\/([^/]+)$/.exec(url.pathname);
	if (match === null) return notFound();
	let name: string;
	try {
		name = decodeURIComponent(match[2] as string);
	} catch {
		return notFound();
	}
	if (!served(name)) return new Response(null, { status: 403 });
	try {
		const response = await load(match[1] as string, name);
		if (response === null) return notFound();
		// The diagram editor's data file is JSON, read with `fetch`; everything else is a picture.
		// kalem-locale-ok: file names' suffixes are ASCII
		if (name.toLowerCase().endsWith(DIAGRAM_DATA_SUFFIX)) return response;
		return (await imageResponse(response)) ?? notFound();
	} catch {
		return notFound();
	}
}

async function serveEditorImage(url: URL, load: EditorImageLoader): Promise<Response> {
	const query = url.search.replace(/^\?/, "");
	if (query === "") return notFound();
	try {
		const response = await load(query);
		return (response === null ? null : await imageResponse(response)) ?? notFound();
	} catch {
		return notFound();
	}
}

/**
 * A diagram is rewritten in place when it is edited; kept in the image
 * cache, the document would go on showing the old drawing. The diagram
 * editor reads its data back with `fetch`, from the app's own page.
 */
function uncached(url: URL, response: Response): Response {
	// kalem-locale-ok: URL paths
	const path = url.pathname.toLowerCase();
	if (!(path.endsWith(DIAGRAM_SUFFIX) || path.endsWith(DIAGRAM_DATA_SUFFIX)) || !response.ok) {
		return response;
	}
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "no-store");
	headers.set("Access-Control-Allow-Origin", "*");
	return new Response(response.body, { status: response.status, headers });
}

/** Must run after the app is ready. */
export interface DocumentSchemeOptions {
	readonly loadAttachment: AttachmentLoader;
	readonly loadJiraAttachment: AttachmentLoader;
	readonly loadJiraEditorImage: EditorImageLoader;
	/** The network shares open documents are on (`\\server\share`, lower case): only these are read. */
	openShares(): ReadonlySet<string>;
}

export function handleDocumentScheme(options: DocumentSchemeOptions): void {
	protocol.handle(DOCUMENT_SCHEME, async (request) => {
		const url = new URL(request.url);
		return uncached(url, await serve(request, url, options));
	});
}

/** The file a `kalem-doc://local/…` address names, when it may be read; `null` otherwise. */
export function servedPath(
	url: URL,
	windows: boolean,
	openShares: ReadonlySet<string>,
): string | null {
	if (url.hostname !== LOCAL_HOST) return null;
	const path = urlPathToFilePath(url.pathname, windows);
	if (path === null || !served(path)) return null;
	// A share no open document is on would be asked for with the user's Windows login.
	const share = windows ? uncShare(path) : null;
	if (share !== null && !openShares.has(share)) return null;
	return path;
}

async function serve(
	request: Request,
	url: URL,
	options: DocumentSchemeOptions,
): Promise<Response> {
	if (request.method !== "GET") return new Response(null, { status: 405 });
	if (url.hostname === CONFLUENCE_HOST) return serveAttachment(url, options.loadAttachment);
	if (url.hostname === JIRA_HOST && url.pathname === JEDITOR_PATH) {
		return serveEditorImage(url, options.loadJiraEditorImage);
	}
	if (url.hostname === JIRA_HOST) return serveAttachment(url, options.loadJiraAttachment);
	const path = servedPath(url, process.platform === "win32", options.openShares());
	if (path === null) return new Response(null, { status: 403 });
	try {
		return await net.fetch(pathToFileURL(path).href);
	} catch {
		return new Response(null, { status: 404 });
	}
}
