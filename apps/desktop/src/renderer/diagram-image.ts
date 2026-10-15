import type { Diagram } from "../shared/diagram.js";
import {
	DIAGRAM_KEYWORD,
	diagramSvg,
	parseDiagram,
	serializeDiagram,
	svgMarkup,
} from "../shared/diagram.js";
import { readPngText, withPngText } from "../shared/png-text.js";

/** Canvases larger than this fail to draw in Chromium. */
const MAX_PIXELS = 16_000;

/**
 * The diagram as a PNG, its data inside. Drawn at its real size: Markdown
 * has no way to give an image a display size, so a larger picture would
 * show larger in every viewer and on Confluence.
 */
export async function diagramToPng(diagram: Diagram): Promise<Uint8Array> {
	const { svg, width, height } = diagramSvg(diagram);
	const scale = Math.min(1, MAX_PIXELS / Math.max(width, height));
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup(svg))}`;
	await image.decode();

	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const context = canvas.getContext("2d");
	if (context === null) throw new Error("Canvas is not available");
	context.scale(scale, scale);
	context.drawImage(image, 0, 0, width, height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (blob === null) throw new Error("The diagram could not be drawn");
	const png = new Uint8Array(await blob.arrayBuffer());
	return withPngText(png, DIAGRAM_KEYWORD, serializeDiagram(diagram));
}

/** The diagram kept in an image, `null` when the image is not a Kalem diagram. */
export async function diagramFromImage(src: string): Promise<Diagram | null> {
	const response = await fetch(src, { cache: "no-store" });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const text = readPngText(new Uint8Array(await response.arrayBuffer()), DIAGRAM_KEYWORD);
	return text === null ? null : parseDiagram(text);
}
