import { setTextMeasure } from "../shared/diagram.js";

/**
 * The fonts a diagram may be shown in: Segoe UI on Windows, Arial (or
 * Helvetica) elsewhere and in Confluence, the system's sans-serif when
 * neither is there. A line is as wide as it is in the widest of them, so
 * the text stays inside its shape wherever the picture is opened.
 */
const FONTS = ['"Segoe UI"', "Arial", "Helvetica", "sans-serif"];
const MAX_KEPT = 20_000;

/** Diagrams measure their text in the real fonts, not from an estimate. */
export function measureDiagramText(): void {
	const context = document.createElement("canvas").getContext("2d");
	if (context === null) return;
	const kept = new Map<string, number>();
	setTextMeasure((text, fontSize) => {
		const key = `${fontSize}|${text}`;
		const known = kept.get(key);
		if (known !== undefined) return known;
		let width = 0;
		for (const font of FONTS) {
			context.font = `${fontSize}px ${font}`;
			width = Math.max(width, context.measureText(text).width);
		}
		if (kept.size >= MAX_KEPT) kept.clear();
		kept.set(key, width);
		return width;
	});
}
