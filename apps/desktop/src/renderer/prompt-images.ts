/**
 * The document's pictures for the assistant: each one shown in the document,
 * scaled down to what a model looks at and encoded again, so a screenshot
 * pasted from Word reaches it as a picture instead of base64 text.
 */
import type { PromptImage } from "../shared/claude.js";
import { isPromptImageType, MAX_PROMPT_IMAGES } from "../shared/claude.js";

/** A model sees no more of a picture than this on its longer side. */
const MAX_SIDE = 1568;

/** A picture of the document, and the URL the document has it at. */
export interface DocumentImage extends PromptImage {
	readonly src: string;
}

function base64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

/**
 * The picture's file. Read rather than drawn from the page: a picture drawn
 * from the document's own URL could not be read back. An embedded one is
 * decoded here, as the page may not fetch `data:` URLs.
 */
async function load(url: string): Promise<Blob | null> {
	const embedded = /^data:([^;,]+);base64,(.*)$/s.exec(url);
	if (embedded !== null) {
		const binary = atob(embedded[2] ?? "");
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return new Blob([bytes], { type: embedded[1] ?? "" });
	}
	const response = await fetch(url);
	return response.ok ? response.blob() : null;
}

async function encode(url: string): Promise<Omit<PromptImage, "label"> | null> {
	try {
		const file = await load(url);
		if (file === null) return null;
		const image = await createImageBitmap(file);
		const { width, height } = image;
		const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
		const canvas = new OffscreenCanvas(
			Math.max(1, Math.round(width * scale)),
			Math.max(1, Math.round(height * scale)),
		);
		const context = canvas.getContext("2d");
		if (context === null) return null;
		// Transparent screenshots read as dark text on white.
		context.fillStyle = "#fff";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		image.close();
		const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
		if (!isPromptImageType(blob.type)) return null;
		return { mediaType: blob.type, data: base64(new Uint8Array(await blob.arrayBuffer())) };
	} catch {
		return null;
	}
}

/**
 * The pictures in `images`, in order, once each. One embedded in the text is
 * named `image-N`, the name the prompt gives it in place of its base64.
 */
export async function documentImages(
	images: readonly HTMLImageElement[],
): Promise<DocumentImage[]> {
	const found: DocumentImage[] = [];
	const seen = new Set<string>();
	for (const image of images) {
		const src = image.getAttribute("src") ?? "";
		if (src === "" || seen.has(src)) continue;
		seen.add(src);
		// A picture another site does not let the app read is left out.
		const encoded = await encode(image.src);
		if (encoded === null) continue;
		const label = src.startsWith("data:") ? `image-${found.length + 1}` : src;
		found.push({ src, label, ...encoded });
		if (found.length === MAX_PROMPT_IMAGES) break;
	}
	return found;
}
