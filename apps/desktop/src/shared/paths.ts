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
	// Windows drops trailing dots and spaces: "setup.exe." runs as "setup.exe".
	const name = fileName(path).replace(/[. ]+$/, "");
	const dot = name.lastIndexOf(".");
	// kalem-locale-ok: file extensions are ASCII
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const MARKDOWN_EXTENSIONS: readonly string[] = ["md", "markdown"];
export const TEXT_EXTENSIONS: readonly string[] = ["txt"];
/** Zipped TextBundles: Kalem's own `.kmd` and the standard `.textpack`. */
/** Files the Confluence import offers: storage format (XHTML) and wiki markup. */
export const CONFLUENCE_EXTENSIONS = {
	storage: ["xml", "xhtml", "html", "htm"],
	wiki: ["txt", "wiki", "confluence"],
} as const;
export const PACKAGE_EXTENSIONS: readonly string[] = ["kmd", "textpack"];

export function isPackagePath(path: string): boolean {
	return PACKAGE_EXTENSIONS.includes(extension(path));
}

/**
 * Files the Markdown editor opens and saves in place: Markdown and packages.
 * Every other text file (.txt, .java, .json…) opens in the text editor as it
 * is, never turned into Markdown.
 */
export function isEditablePath(path: string): boolean {
	const ext = extension(path);
	return MARKDOWN_EXTENSIONS.includes(ext) || PACKAGE_EXTENSIONS.includes(ext);
}

/**
 * Files a tab shows as plain text, never read as Markdown: anything that is
 * neither a Markdown document, a package nor a Word file (which is imported).
 */
export function opensAsText(path: string): boolean {
	return !isEditablePath(path) && !isWordPath(path);
}

/** Files that are never text, so they are not opened to find out. */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set(
	(
		"png jpg jpeg gif webp bmp ico tif tiff psd svgz heic avif mp3 mp4 m4a wav ogg webm mov avi mkv flac " +
		"zip gz tgz bz2 xz 7z rar jar war ear class dll exe so dylib o a lib bin dat db sqlite iso dmg msi " +
		"pdf doc docx xls xlsx ppt pptx odt ods odp kmd textpack woff woff2 ttf otf eot pyc lnk"
	).split(" "),
);

export function isBinaryPath(path: string): boolean {
	return BINARY_EXTENSIONS.has(extension(path));
}

/** Files that run a program when the system opens them: these are only shown in their folder. */
/** Files the operating system runs (or mounts, or loads code from) rather than shows. */
const PROGRAM_EXTENSIONS: ReadonlySet<string> = new Set(
	[
		"exe com bat cmd msi msix msixbundle appx appxbundle msp mst scr pif cpl msc lnk url reg inf scf",
		"ps1 psm1 psd1 ps1xml psc1 vbs vbe js jse wsf wsh wsc hta jar chm hlp gadget",
		"xll xla xlam ppa ppam application appref-ms settingcontent-ms library-ms searchconnector-ms",
		"diagcab diagcfg diagpkg iso img vhd vhdx",
		"app command sh bash zsh csh ksh py pyw pl rb php desktop appimage run bin pkg dmg mpkg",
	]
		.join(" ")
		.split(" "),
);

export function isProgramPath(path: string): boolean {
	return PROGRAM_EXTENSIONS.has(extension(path));
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

/**
 * The network share a Windows path is on, as `\\server\share` in lower case;
 * `null` for a drive path. Device paths (`\\?\`, `\\.\`) are shares of nothing.
 */
export function uncShare(path: string): string | null {
	const match = /^[\\/]{2}([^\\/?.][^\\/]*)[\\/]+([^\\/]+)/.exec(path);
	if (match === null) return null;
	// kalem-locale-ok: host and share names compare as Windows does, without the Turkish rule
	return `\\\\${(match[1] as string).toLowerCase()}\\${(match[2] as string).toLowerCase()}`;
}

export function isDevicePath(path: string): boolean {
	return /^[\\/]{2}[?.][\\/]/.test(path);
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
	path = path.replace(/\//g, "\\");
	if (isDevicePath(path)) return null;
	// A drive path, or a share (checked by the caller); never a stream (`a.png:x`) or a drive-relative path.
	if (/^[A-Za-z]:\\/.test(path)) return path.slice(2).includes(":") ? null : path;
	return uncShare(path) !== null && !path.includes(":") ? path : null;
}
