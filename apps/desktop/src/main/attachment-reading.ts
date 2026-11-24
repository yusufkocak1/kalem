/**
 * An attached file's content for the assistant, wherever it is attached
 * (a Jira issue, a Confluence page): text files and Word documents as text,
 * pictures as pictures the model sees. Other files cannot be read.
 */
import mammoth from "mammoth";
import type { PromptImage } from "../shared/claude.js";
import { attachmentKind, looksLikeText } from "../shared/jira-attachment-text.js";
import { promptImageOf } from "./tool-images.js";

/** The largest file the assistant downloads to read. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentContent =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "image"; readonly image: PromptImage }
	| { readonly kind: "none"; readonly why: string };

/** What the file holds; `about` names it in what is said of it. */
export async function attachmentContent(
	bytes: Uint8Array,
	filename: string,
	mimeType: string,
	about: string,
): Promise<AttachmentContent> {
	const kind = attachmentKind(filename, mimeType);
	if (kind === "image") {
		const image = promptImageOf(bytes, filename);
		return typeof image === "string" ? { kind: "none", why: image } : { kind: "image", image };
	}
	if (kind === "word") {
		try {
			const result = await mammoth.extractRawText({
				buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			});
			return { kind: "text", text: result.value.replace(/\n{3,}/g, "\n\n").trim() };
		} catch {
			return {
				kind: "none",
				why: `${about} could not be read as a Word document (an old .doc, or damaged).`,
			};
		}
	}
	if (kind === "text" || looksLikeText(bytes)) {
		return { kind: "text", text: new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "") };
	}
	return {
		kind: "none",
		why: `${about} is a binary file (PDF, spreadsheet, archive…): its content cannot be read as text here.`,
	};
}

/** A download's bytes, or why they could not be had. */
export async function downloadBytes(
	response: Response,
	filename: string,
	sizeText: (bytes: number) => string,
): Promise<Uint8Array | string> {
	if (!response.ok) return `The server answered HTTP ${response.status} for ${filename}.`;
	const length = Number(response.headers.get("content-length") ?? "");
	if (Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES) {
		return `${filename} is ${sizeText(length)}: too large to read here.`;
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	return bytes.length > MAX_ATTACHMENT_BYTES
		? `${filename} is ${sizeText(bytes.length)}: too large to read here.`
		: bytes;
}
