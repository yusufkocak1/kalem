import { extension, stripExtension } from "../shared/paths.js";

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
 * Files the operating system would run rather than show. "Open" hands a
 * downloaded attachment to the default app, so these are only downloaded.
 */
const RUNNABLE = new Set([
	"exe",
	"msi",
	"msix",
	"appx",
	"bat",
	"cmd",
	"com",
	"scr",
	"pif",
	"cpl",
	"msc",
	"lnk",
	"url",
	"reg",
	"ps1",
	"psm1",
	"vbs",
	"vbe",
	"js",
	"jse",
	"wsf",
	"wsh",
	"hta",
	"jar",
	"app",
	"command",
	"sh",
	"py",
	"pkg",
	"dmg",
	"iso",
	"appref-ms",
	"application",
	"settingcontent-ms",
]);

export function isRunnable(name: string): boolean {
	return RUNNABLE.has(extension(name));
}

/** The attachment's name as a file name on this computer. */
export function localFileName(name: string): string {
	const clean = name
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
		.replace(/^[.\s]+/, "")
		.trim();
	return clean === "" ? "attachment" : clean;
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
