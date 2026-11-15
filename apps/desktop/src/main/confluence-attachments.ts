import { extension, isProgramPath, stripExtension } from "../shared/paths.js";

/** Larger files are not read into memory for an upload; Confluence's own default limit is 100 MB. */
export const MAX_UPLOAD_MB = 250;

const MEDIA_TYPES: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	pdf: "application/pdf",
	txt: "text/plain",
	csv: "text/csv",
	md: "text/markdown",
	json: "application/json",
	xml: "application/xml",
	zip: "application/zip",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	mp4: "video/mp4",
	mp3: "audio/mpeg",
};

/** The type the upload is sent with; Confluence uses it to decide how to preview the file. */
export function mediaTypeOf(name: string): string {
	return MEDIA_TYPES[extension(name)] ?? "application/octet-stream";
}

/**
 * What "Open" hands to the default app: documents, pictures and media only.
 * Anything else (programs, scripts, macro-enabled files, disk images) is
 * only downloaded, to be opened by the user if they trust it.
 */
const OPENABLE = new Set(
	[
		"pdf txt csv md markdown log json xml yaml yml rtf",
		"doc docx xls xlsx ppt pptx odt ods odp vsdx drawio msg eml",
		"png jpg jpeg gif bmp webp tif tiff heic",
		"mp3 wav m4a ogg mp4 mov avi mkv webm",
		"zip 7z",
	]
		.join(" ")
		.split(" "),
);

export function opensDirectly(name: string): boolean {
	return OPENABLE.has(extension(name)) && !isProgramPath(name);
}

export function isRunnable(name: string): boolean {
	return isProgramPath(name);
}

const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

/** The attachment's name as a file name on this computer. */
export function localFileName(name: string): string {
	const clean = name
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "")
		.trim();
	if (clean === "") return "attachment";
	return RESERVED_NAME.test(clean) ? `_${clean}` : clean;
}

/** `name` or, when the page already has it, `name-2`, `name-3`… with the extension kept. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
	if (!taken.has(name)) return name;
	const ext = extension(name);
	const stem = ext === "" ? name : stripExtension(name);
	for (let n = 2; ; n++) {
		const candidate = ext === "" ? `${stem}-${n}` : `${stem}-${n}.${name.slice(stem.length + 1)}`;
		if (!taken.has(candidate)) return candidate;
	}
}
