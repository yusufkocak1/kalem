/**
 * What a file is by its first bytes, not by what the server said: a sign-in
 * page or an error page sent in place of a picture must not pass for one.
 */

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
	bytes.length >= offset + signature.length &&
	signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const SVG_START =
	/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i;

/** The picture's media type (`image/png`…) by its signature; `null` when it is not a picture. */
export function imageTypeOf(bytes: Uint8Array): string | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
	if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
	if (startsWith(bytes, ascii("ftyp"), 4)) {
		const brand = String.fromCharCode(...bytes.subarray(8, 12));
		if (brand === "avif" || brand === "avis") return "image/avif";
	}
	if (startsWith(bytes, ascii("BM")) && bytes.length >= 26) return "image/bmp";
	if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return "image/x-icon";
	const head = new TextDecoder().decode(bytes.subarray(0, 2048)).replace(/^﻿/, "");
	return SVG_START.test(head) ? "image/svg+xml" : null;
}
