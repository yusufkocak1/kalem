/** Writable image types. Matches the core `data:` whitelist; SVG is excluded on purpose. */
export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
};

/** `report.md` → `report.assets` */
export function assetsFolderName(documentFileName: string): string {
	return `${documentFileName.replace(/\.(md|markdown|txt)$/i, "")}.assets`;
}

/** Strips the extension, path separators and anything that is not a letter or digit. */
export function safeBaseName(name: string, fallback = "image"): string {
	const base = name
		.replace(/\.[^.\\/]*$/, "")
		.normalize("NFC")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return base === "" ? fallback : base;
}

/** Windows and macOS file systems are case-insensitive. */
export function fileNameKey(name: string): string {
	// kalem-locale-ok: file-system comparison; the Turkish rule would be wrong here
	return name.toLowerCase();
}

/** The extension of a file name if it is short and alphanumeric, lowercased; otherwise empty. */
export function safeExtension(name: string): string {
	const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
	// kalem-locale-ok: file extensions are ASCII
	return match === null ? "" : (match[1] as string).toLowerCase();
}

/** `ext` may be empty for files without an extension. */
export function uniqueFileName(base: string, ext: string, taken: ReadonlySet<string>): string {
	const suffix = ext === "" ? "" : `.${ext}`;
	let candidate = `${base}${suffix}`;
	for (let n = 2; taken.has(fileNameKey(candidate)); n++) candidate = `${base}-${n}${suffix}`;
	return candidate;
}

/** Joins path segments into a relative URL that is safe as a Markdown link target. */
export function relativeUrl(...segments: readonly string[]): string {
	return segments
		.map((segment) =>
			encodeURIComponent(segment).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`),
		)
		.join("/");
}

export interface DataUrl {
	readonly type: string;
	readonly bytes: Uint8Array;
}

export function parseDataUrl(url: string): DataUrl | null {
	const match = /^data:([^;,]+);base64,(.*)$/is.exec(url.trim());
	if (match === null) return null;
	// kalem-locale-ok: MIME types are ASCII
	const type = (match[1] as string).toLowerCase();
	try {
		const binary = atob((match[2] as string).replace(/\s+/g, ""));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return { type, bytes };
	} catch {
		return null;
	}
}

export function toDataUrl(type: string, bytes: Uint8Array): string {
	let binary = "";
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return `data:${type};base64,${btoa(binary)}`;
}

export function isEmbeddedImage(url: string): boolean {
	return /^data:image\//i.test(url);
}
