/**
 * How a document is set on the page: line spacing, the room between
 * paragraphs, above headings and between list items, the typeface, the
 * text size and the page's width. They change how the document looks in
 * Kalem (and when printed), never its Markdown. Pure.
 */

export const DOCUMENT_FONTS = ["default", "sans", "serif", "word", "mono"] as const;
export type DocumentFont = (typeof DOCUMENT_FONTS)[number];

/** Each typeface's CSS font stack; `null` for the theme's own. */
export const FONT_STACKS: Readonly<Record<DocumentFont, string | null>> = {
	default: null,
	sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
	serif: 'Cambria, Georgia, "Times New Roman", serif',
	word: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
	mono: '"Cascadia Mono", Consolas, "Courier New", monospace',
};

export interface Typography {
	/** Line height, as a multiple of the text size. */
	readonly lineSpacing: number;
	/** The room under a paragraph, in em. */
	readonly paragraphSpacing: number;
	/** The room above a heading, in em. */
	readonly headingSpacing: number;
	/** The room under a list item, in em. */
	readonly listSpacing: number;
	readonly documentFont: DocumentFont;
	/** The text size at 100% zoom, in pixels. */
	readonly documentFontSize: number;
	/** The page's width (not full width), in em of the page. */
	readonly pageWidth: number;
}

export const TYPOGRAPHY_KEYS = [
	"lineSpacing",
	"paragraphSpacing",
	"headingSpacing",
	"listSpacing",
	"documentFont",
	"documentFontSize",
	"pageWidth",
] as const satisfies readonly (keyof Typography)[];

export const DEFAULT_TYPOGRAPHY: Typography = {
	lineSpacing: 1.65,
	paragraphSpacing: 1,
	headingSpacing: 1.8,
	listSpacing: 0.25,
	documentFont: "default",
	documentFontSize: 16,
	pageWidth: 50,
};

/** Each number's range and step, for the controls and for reading a stored value. */
export const TYPOGRAPHY_RANGES = {
	lineSpacing: { min: 1, max: 3, step: 0.05 },
	paragraphSpacing: { min: 0, max: 3, step: 0.05 },
	headingSpacing: { min: 0, max: 4, step: 0.1 },
	listSpacing: { min: 0, max: 1.5, step: 0.05 },
	documentFontSize: { min: 10, max: 28, step: 1 },
	pageWidth: { min: 36, max: 100, step: 1 },
} as const;

/** Word's line spacing choices, and Kalem's own. */
export const LINE_SPACING_PRESETS = [1, 1.15, 1.5, 1.65, 2] as const;

/** The base text size of the page the sizes are relative to. */
const PAGE_SIZE = 16;

/** Rounds away the binary noise of steps (1.15000000002). */
function clean(value: number): string {
	return String(Math.round(value * 1000) / 1000);
}

/**
 * The CSS custom properties that carry `typography` to the page; `null`
 * removes one (the theme's own is used).
 */
export function typographyVars(typography: Typography): Record<string, string | null> {
	return {
		"--doc-leading": clean(typography.lineSpacing),
		"--doc-space": `${clean(typography.paragraphSpacing)}em`,
		"--doc-heading-space": `${clean(typography.headingSpacing)}em`,
		"--doc-list-space": `${clean(typography.listSpacing)}em`,
		"--doc-size": `${clean(typography.documentFontSize / PAGE_SIZE)}em`,
		"--doc-width": `${clean(typography.pageWidth)}em`,
		"--doc-font": FONT_STACKS[typography.documentFont],
	};
}

/** Whether every value is the default. */
export function isDefaultTypography(typography: Typography): boolean {
	return TYPOGRAPHY_KEYS.every((key) => typography[key] === DEFAULT_TYPOGRAPHY[key]);
}

/** Only the typography of `settings`. */
export function pickTypography(settings: Typography): Typography {
	const picked: Record<string, unknown> = {};
	for (const key of TYPOGRAPHY_KEYS) picked[key] = settings[key];
	return picked as unknown as Typography;
}
