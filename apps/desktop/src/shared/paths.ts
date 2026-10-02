export function fileName(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] ?? path;
}

export function stripExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/** Lowercase extension without the dot. */
export function extension(path: string): string {
	const name = fileName(path);
	const dot = name.lastIndexOf(".");
	// kalem-locale-ok: file extensions are ASCII
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const MARKDOWN_EXTENSIONS: readonly string[] = ["md", "markdown"];
export const TEXT_EXTENSIONS: readonly string[] = ["txt"];

/** Files the editor opens and saves in place: Markdown and plain text. */
export function isEditablePath(path: string): boolean {
	const ext = extension(path);
	return MARKDOWN_EXTENSIONS.includes(ext) || TEXT_EXTENSIONS.includes(ext);
}

export function isWordPath(path: string): boolean {
	const ext = extension(path);
	return ext === "docx" || ext === "doc";
}

/**
 * Base URL for resolving document-relative links (used as `<base href>`).
 *
 *     C:\Docs\report.md   →  scheme://local/C%3A/Docs/
 *     /home/u/report.md   →  scheme://local/home/u/
 */
export function documentBaseUrl(scheme: string, documentPath: string): string {
	const normalized = documentPath.replace(/\\/g, "/");
	const folder = normalized.slice(0, normalized.lastIndexOf("/") + 1);
	const encoded = folder.split("/").map(encodeURIComponent).join("/");
	return `${scheme}://local/${encoded.replace(/^\//, "")}`;
}

/** Inverse of `documentBaseUrl`: an (encoded) URL pathname back to a file-system path. */
export function urlPathToFilePath(pathname: string, windows: boolean): string | null {
	let path: string;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (path.includes("\0")) return null;
	if (!windows) return path;
	if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
	return path.replace(/\//g, "\\");
}
