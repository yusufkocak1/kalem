import { extension, isBinaryPath, isEditablePath, isWordPath } from "../shared/paths.js";
import type { IconName } from "./icons.js";

/** The colour family a file's icon is drawn in. */
export type FileTone =
	| "markdown"
	| "word"
	| "data"
	| "code"
	| "sheet"
	| "image"
	| "pdf"
	| "plain"
	| "other";

export interface FileType {
	readonly icon: IconName;
	readonly tone: FileTone;
	/** How a click opens it: in the editor (as a document or as plain text), or in the system's app. */
	readonly opens: "document" | "text" | "system";
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(" "));

const DATA = words(
	"json jsonc geojson webmanifest yaml yml xml xsd xsl xslt plist html htm xhtml toml ini env properties",
);
const CODE = words(
	"js mjs cjs jsx ts mts cts tsx java kt kts scala groovy py rb php go rs c h cc cpp hpp cs fs swift dart lua r pl sh bash zsh ps1 psm1 bat cmd sql css scss sass less vue svelte gradle",
);
const SHEET = words("csv tsv xls xlsx ods");
const IMAGE = words("png jpg jpeg gif webp bmp ico tif tiff svg heic avif");
const ARCHIVE = words("zip gz tgz bz2 xz 7z rar jar war ear");

/** A file's icon and colour, from its name. */
export function fileType(path: string): FileType {
	const ext = extension(path);
	const opens =
		isEditablePath(path) || isWordPath(path) ? "document" : isBinaryPath(path) ? "system" : "text";
	if (ext === "md" || ext === "markdown") return { icon: "file", tone: "markdown", opens };
	if (ext === "kmd" || ext === "textpack") return { icon: "attachments", tone: "markdown", opens };
	if (ext === "docx" || ext === "doc" || ext === "odt")
		return { icon: "word", tone: "word", opens };
	if (ext === "pdf") return { icon: "pdf", tone: "pdf", opens };
	if (IMAGE.has(ext)) return { icon: "image", tone: "image", opens };
	if (SHEET.has(ext)) return { icon: "sheet", tone: "sheet", opens };
	if (DATA.has(ext)) return { icon: "braces", tone: "data", opens };
	if (CODE.has(ext)) return { icon: "code", tone: "code", opens };
	if (ARCHIVE.has(ext)) return { icon: "archive", tone: "other", opens };
	return {
		icon: opens === "system" ? "attach" : "file",
		tone: opens === "system" ? "other" : "plain",
		opens,
	};
}
