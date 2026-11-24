/**
 * A picture a tool found (a Jira attachment, a picture in an issue's text)
 * as the model is sent it: a type every service reads, small enough to go.
 * One too large, or of another type, is redrawn as a JPEG.
 */
import { nativeImage } from "electron";
import type { PromptImage } from "../shared/claude.js";
import { isPromptImageType, MAX_PROMPT_IMAGE_DATA } from "../shared/claude.js";

/** The longest side a redrawn picture keeps: what the services read at full detail. */
const LONGEST_SIDE = 1568;

/** The type of a picture's bytes from their first ones; `null` when unknown. */
export function sniffImageType(bytes: Uint8Array): PromptImage["mediaType"] | null {
	const starts = (...values: number[]): boolean => values.every((value, i) => bytes[i] === value);
	if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
		return "image/webp";
	}
	return null;
}

/** The picture for the model, or why it cannot be sent. */
export function promptImageOf(bytes: Uint8Array, label: string): PromptImage | string {
	const type = sniffImageType(bytes);
	const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
	if (type !== null && isPromptImageType(type) && data.length <= MAX_PROMPT_IMAGE_DATA) {
		return { label, mediaType: type, data };
	}
	let image = nativeImage.createFromBuffer(Buffer.from(bytes));
	if (image.isEmpty()) return `${label} is a picture of a kind that cannot be shown to you.`;
	const { width, height } = image.getSize();
	const longest = Math.max(width, height);
	if (longest > LONGEST_SIDE) {
		const scale = LONGEST_SIDE / longest;
		image = image.resize({
			width: Math.max(1, Math.round(width * scale)),
			height: Math.max(1, Math.round(height * scale)),
			quality: "best",
		});
	}
	const jpeg = image.toJPEG(85).toString("base64");
	if (jpeg.length > MAX_PROMPT_IMAGE_DATA) return `${label} is too large to be shown to you.`;
	return { label, mediaType: "image/jpeg", data: jpeg };
}
