import { open } from "node:fs/promises";
import type { DecodedText, LegacyEncoding } from "../shared/encoding.js";
import { decodeBytes } from "../shared/encoding.js";
import { isBinaryPath } from "../shared/paths.js";

/** Larger files are not opened as text: a text box that size is no longer usable. */
export const MAX_TEXT_FILE = 20 * 1024 * 1024;

/** A zero byte in the start of a file without a UTF-16 mark: not text. */
export function looksBinary(bytes: Uint8Array): boolean {
	const utf16 =
		(bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
	return !utf16 && bytes.subarray(0, 8000).includes(0);
}

export interface TextFile extends DecodedText {
	/** Modification time in ms. */
	readonly modified: number;
}

/** A file's text and how it is written; `null` when it is not text or larger than `maxBytes`. */
export async function readTextFile(
	path: string,
	legacyEncoding: LegacyEncoding = "windows-1254",
	maxBytes = MAX_TEXT_FILE,
): Promise<TextFile | null> {
	if (isBinaryPath(path)) return null;
	const file = await open(path, "r");
	try {
		const info = await file.stat();
		if (!info.isFile() || info.size > maxBytes) return null;
		const bytes = new Uint8Array(info.size);
		await file.read(bytes, 0, info.size, 0);
		if (looksBinary(bytes)) return null;
		return { ...decodeBytes(bytes, legacyEncoding), modified: info.mtimeMs };
	} finally {
		await file.close();
	}
}
