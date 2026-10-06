import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import { extension, urlPathToFilePath } from "../shared/paths.js";

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
			privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
		},
	]);
}

/** Images of a Confluence page tab: `kalem-doc://confluence/<page id>/<file name>`. */
export const CONFLUENCE_HOST = "confluence";

export type AttachmentLoader = (pageId: string, name: string) => Promise<Response | null>;

async function serveAttachment(url: URL, load: AttachmentLoader): Promise<Response> {
	const match = /^\/(\d+)\/([^/]+)$/.exec(url.pathname);
	if (match === null) return new Response(null, { status: 404 });
	let name: string;
	try {
		name = decodeURIComponent(match[2] as string);
	} catch {
		return new Response(null, { status: 404 });
	}
	if (!SERVED_EXTENSIONS.has(extension(name))) return new Response(null, { status: 403 });
	try {
		const response = await load(match[1] as string, name);
		return response ?? new Response(null, { status: 404 });
	} catch {
		return new Response(null, { status: 404 });
	}
}

/** Must run after the app is ready. */
export function handleDocumentScheme(loadAttachment: AttachmentLoader): void {
	protocol.handle(DOCUMENT_SCHEME, async (request) => {
		if (request.method !== "GET") return new Response(null, { status: 405 });

		const url = new URL(request.url);
		if (url.hostname === CONFLUENCE_HOST) return serveAttachment(url, loadAttachment);
		const path = urlPathToFilePath(new URL(request.url).pathname, process.platform === "win32");
		if (path === null || !SERVED_EXTENSIONS.has(extension(path))) {
			return new Response(null, { status: 403 });
		}
		try {
			return await net.fetch(pathToFileURL(path).href);
		} catch {
			return new Response(null, { status: 404 });
		}
	});
}
