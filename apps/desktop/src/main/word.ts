import mammoth from "mammoth";
import { IMAGE_EXTENSIONS } from "../shared/images.js";

export interface WordResult {
	readonly html: string;
	readonly warnings: readonly string[];
	readonly skippedImages: number;
}

export class WordError extends Error {
	readonly code: "legacy-format" | "invalid";

	constructor(code: "legacy-format" | "invalid", message: string) {
		super(message);
		this.name = "WordError";
		this.code = code;
	}
}

// Additions to mammoth's default map, which already covers "Heading 1…6".
const STYLE_MAP = [
	"p[style-name='Title'] => h1:fresh",
	"p[style-name='Subtitle'] => p:fresh",
	"p[style-name='Quote'] => blockquote > p:fresh",
	"p[style-name='Intense Quote'] => blockquote > p:fresh",
	"r[style-name='Strong'] => strong",
	"r[style-name='Emphasis'] => em",
	"r[style-name='Intense Emphasis'] => strong > em",
];

/** A paragraph, run or text of mammoth's reading of the document. */
interface WordElement {
	type?: string;
	value?: string;
	styleName?: string | null;
	numbering?: { readonly level?: string; readonly isOrdered?: boolean } | null;
	children?: WordElement[];
}

const HEADING_STYLE = /^(heading|başlık)\s*[1-9]$/i;

function firstText(element: WordElement): WordElement | null {
	if (element.type === "text") return element;
	for (const child of element.children ?? []) {
		const text = firstText(child);
		if (text !== null) return text;
	}
	return null;
}

/**
 * Writes Word's heading numbers ("6.1.9 Title") into the headings' text.
 * Word draws them from a numbered list the heading styles are in, so the
 * text alone has none, and the converted headings would lose them.
 */
export function numberHeadings<T>(document: T): T {
	const counters: number[] = [];
	const visit = (element: WordElement): void => {
		const level = Number(element.numbering?.level);
		if (
			element.type === "paragraph" &&
			element.numbering?.isOrdered === true &&
			HEADING_STYLE.test(element.styleName ?? "") &&
			Number.isInteger(level) &&
			level >= 0 &&
			level < 9
		) {
			const text = firstText(element);
			if (text !== null) {
				counters.length = level + 1;
				counters[level] = (counters[level] ?? 0) + 1;
				// A level Word skipped counts as 0, as Word shows it.
				const number = Array.from(counters, (count) => count ?? 0).join(".");
				text.value = `${number} ${text.value ?? ""}`;
			}
			return;
		}
		for (const child of element.children ?? []) visit(child);
	};
	visit(document as WordElement);
	return document;
}

/** Signature of legacy binary .doc files (OLE compound document). */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

/** Converts .docx bytes to HTML; images are embedded as `data:` URLs. */
export async function readWord(bytes: Uint8Array): Promise<WordResult> {
	if (OLE_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
		throw new WordError("legacy-format", ".doc");
	}

	let skippedImages = 0;
	const convertImage = mammoth.images.imgElement(async (image) => {
		// kalem-locale-ok: MIME types are ASCII
		const type = image.contentType.toLowerCase();
		if (IMAGE_EXTENSIONS[type] === undefined) {
			// EMF/WMF and the like cannot be drawn by the browser.
			skippedImages++;
			return { src: "" };
		}
		return { src: `data:${type};base64,${await image.readAsBase64String()}` };
	});

	try {
		const result = await mammoth.convertToHtml(
			{ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
			{ styleMap: STYLE_MAP, convertImage, transformDocument: numberHeadings },
		);
		const warnings = result.messages
			.map((message) => message.message)
			// Already reported through `skippedImages`.
			.filter((message) => !message.startsWith("Image of type"));
		return { html: result.value, warnings: [...new Set(warnings)], skippedImages };
	} catch (error) {
		throw new WordError("invalid", error instanceof Error ? error.message : String(error));
	}
}
