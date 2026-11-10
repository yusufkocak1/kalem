/**
 * The app's colours: a palette chosen from a few made ones, or the user's
 * own. A palette names five colours for each theme (the accent, the
 * window's background, the panels, the page and the text); the rest of
 * the app's colours (borders, hover, muted text, the text on the accent)
 * are worked out from them. Pure: the renderer puts the CSS in the page.
 */

export const PALETTE_TOKENS = ["accent", "desk", "surface", "page", "text"] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];

export type PaletteColors = Readonly<Record<PaletteToken, string>>;

export interface PaletteTheme {
	readonly light: PaletteColors;
	readonly dark: PaletteColors;
}

export const PALETTE_IDS = [
	"kalem",
	"ocean",
	"forest",
	"sunset",
	"violet",
	"graphite",
	"rose",
	"sand",
	"nord",
	"midnight",
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** The palette setting: one of the made ones, or the user's own colours. */
export type PaletteChoice = PaletteId | "custom";

/** The made palettes; Kalem's own is the app's colours as they always were. */
export const PALETTES: Readonly<Record<PaletteId, PaletteTheme>> = {
	kalem: {
		light: {
			accent: "#0f4e4a",
			desk: "#e9e7e3",
			surface: "#f6f5f2",
			page: "#ffffff",
			text: "#22201d",
		},
		dark: {
			accent: "#6fd3c6",
			desk: "#17161b",
			surface: "#201f26",
			page: "#1e1d23",
			text: "#e8e6e1",
		},
	},
	ocean: {
		light: {
			accent: "#1d5fa8",
			desk: "#e4e8ee",
			surface: "#f3f5f9",
			page: "#ffffff",
			text: "#1c2330",
		},
		dark: {
			accent: "#7fb4f0",
			desk: "#13161c",
			surface: "#1b2029",
			page: "#191d25",
			text: "#e3e8ef",
		},
	},
	forest: {
		light: {
			accent: "#2f6b34",
			desk: "#e6e9e1",
			surface: "#f4f6f0",
			page: "#ffffff",
			text: "#1f241d",
		},
		dark: {
			accent: "#8fd18f",
			desk: "#141813",
			surface: "#1c211b",
			page: "#1a1e19",
			text: "#e5e9e1",
		},
	},
	sunset: {
		light: {
			accent: "#b24c1c",
			desk: "#ede6de",
			surface: "#f9f4ee",
			page: "#ffffff",
			text: "#2a211b",
		},
		dark: {
			accent: "#f2a072",
			desk: "#1a1513",
			surface: "#241e1b",
			page: "#211b18",
			text: "#ede4dc",
		},
	},
	violet: {
		light: {
			accent: "#5b3fa8",
			desk: "#e9e6ef",
			surface: "#f6f4fa",
			page: "#ffffff",
			text: "#231f2c",
		},
		dark: {
			accent: "#b9a2f2",
			desk: "#16141c",
			surface: "#1f1c27",
			page: "#1c1a24",
			text: "#e9e6f0",
		},
	},
	graphite: {
		light: {
			accent: "#3b4350",
			desk: "#e7e7e7",
			surface: "#f4f4f4",
			page: "#ffffff",
			text: "#1f1f1f",
		},
		dark: {
			accent: "#c9d1dc",
			desk: "#151515",
			surface: "#1e1e1e",
			page: "#1b1b1b",
			text: "#e7e7e7",
		},
	},
	rose: {
		light: {
			accent: "#a8325e",
			desk: "#efe4e8",
			surface: "#fbf4f6",
			page: "#ffffff",
			text: "#2b1f24",
		},
		dark: {
			accent: "#f28fb3",
			desk: "#1b1418",
			surface: "#251c21",
			page: "#22191e",
			text: "#efe4e9",
		},
	},
	sand: {
		light: {
			accent: "#8a6116",
			desk: "#ebe4d6",
			surface: "#f8f3e8",
			page: "#fffdf8",
			text: "#2a241a",
		},
		dark: {
			accent: "#e5c27a",
			desk: "#191611",
			surface: "#221e17",
			page: "#1f1b15",
			text: "#ece5d8",
		},
	},
	nord: {
		light: {
			accent: "#3b6e8f",
			desk: "#e5e9f0",
			surface: "#eceff4",
			page: "#ffffff",
			text: "#2e3440",
		},
		dark: {
			accent: "#88c0d0",
			desk: "#242933",
			surface: "#2e3440",
			page: "#2b303b",
			text: "#e5e9f0",
		},
	},
	midnight: {
		light: {
			accent: "#2c3e9e",
			desk: "#e3e5ef",
			surface: "#f2f3f9",
			page: "#ffffff",
			text: "#1a1d2e",
		},
		dark: {
			accent: "#8c9eff",
			desk: "#0d1020",
			surface: "#151a2e",
			page: "#12162a",
			text: "#e2e5f5",
		},
	},
};

const HEX = /^#[0-9a-f]{6}$/;

/** A colour as `#rrggbb` in lower case; `null` for anything else. */
export function hexColor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const color = value.trim().toLowerCase(); // kalem-locale-ok: hex digits are ASCII
	return HEX.test(color) ? color : null;
}

/** The user's colours as stored; any colour missing or wrong is the Kalem palette's. */
export function parsePaletteCustom(value: unknown): PaletteTheme {
	const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const side = (name: "light" | "dark"): PaletteColors => {
		const colors =
			typeof raw[name] === "object" && raw[name] !== null
				? (raw[name] as Record<string, unknown>)
				: {};
		const out = { ...PALETTES.kalem[name] } as Record<PaletteToken, string>;
		for (const token of PALETTE_TOKENS) out[token] = hexColor(colors[token]) ?? out[token];
		return out;
	};
	return { light: side("light"), dark: side("dark") };
}

export function parsePaletteChoice(value: unknown): PaletteChoice {
	return value === "custom" || (PALETTE_IDS as readonly unknown[]).includes(value)
		? (value as PaletteChoice)
		: "kalem";
}

/** The colours a choice stands for. */
export function paletteColors(choice: PaletteChoice, custom: PaletteTheme): PaletteTheme {
	return choice === "custom" ? custom : PALETTES[choice];
}

/** How light a colour is to the eye, from 0 (black) to 1 (white), as WCAG counts it. */
export function luminance(hex: string): number {
	const channel = (offset: number): number => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Black or white, whichever reads better on the colour. */
export function textOn(hex: string): string {
	const light = luminance(hex);
	const onWhite = 1.05 / (light + 0.05);
	const onBlack = (light + 0.05) / 0.05;
	return onBlack >= onWhite ? "#16151a" : "#ffffff";
}

/** The app's colour variables for one theme, worked out from its five colours. */
function variables(colors: PaletteColors, dark: boolean): string {
	const mix = (a: string, share: number, b: string): string =>
		`color-mix(in srgb, ${a} ${share}%, ${b})`;
	const lines: [string, string][] = [
		["--app-accent", colors.accent],
		["--app-accent-text", textOn(colors.accent)],
		["--app-desk", colors.desk],
		["--app-surface", colors.surface],
		["--app-page", colors.page],
		[
			"--app-raised",
			dark ? mix(colors.surface, 92, "#ffffff") : mix(colors.page, 70, colors.surface),
		],
		["--app-text", colors.text],
		["--app-muted", mix(colors.text, 62, colors.surface)],
		["--app-border", mix(colors.text, dark ? 16 : 14, colors.surface)],
		["--app-hover", mix(colors.text, dark ? 9 : 7, "transparent")],
		["--app-pressed", mix(colors.accent, dark ? 18 : 13, "transparent")],
		["--app-info-bg", mix(colors.accent, dark ? 16 : 10, colors.surface)],
	];
	return lines.map(([name, value]) => `\t${name}: ${value};`).join("\n");
}

/**
 * The CSS that puts a palette on the app, for both themes; empty for the
 * Kalem palette, whose colours are the stylesheet's own.
 */
export function paletteCss(choice: PaletteChoice, custom: PaletteTheme): string {
	if (choice === "kalem") return "";
	const { light, dark } = paletteColors(choice, custom);
	// On the screen only: printing keeps the paper's own colours.
	return [
		"@media screen {",
		`:root {\n${variables(light, false)}\n}`,
		`${EDITOR_SURFACES} {\n${editorVariables(light, false)}\n}`,
		"}",
		"@media screen and (prefers-color-scheme: dark) {",
		`:root {\n${variables(dark, true)}\n}`,
		`${EDITOR_SURFACES} {\n${editorVariables(dark, true)}\n}`,
		"}",
	].join("\n");
}

/** The editor's own surfaces, whose colours its theme sets with no specificity (`:where`). */
const EDITOR_SURFACES =
	".kalem-theme, .kalem-doc, .kalem-editor, .kalem-ui, .kalem-bubble, .kalem-menu, .kalem-toolbar, .kalem-handle, .kalem-drop-line";

/** The editor's colour variables (links, check boxes, menus, the text) for the same palette. */
function editorVariables(colors: PaletteColors, dark: boolean): string {
	const mix = (a: string, share: number, b: string): string =>
		`color-mix(in srgb, ${a} ${share}%, ${b})`;
	const lines: [string, string][] = [
		["--kalem-fg", colors.text],
		["--kalem-fg-muted", mix(colors.text, 62, colors.page)],
		["--kalem-surface", dark ? mix(colors.surface, 92, "#ffffff") : colors.page],
		["--kalem-bg-subtle", mix(colors.text, dark ? 7 : 5, "transparent")],
		["--kalem-border", mix(colors.text, dark ? 16 : 12, colors.page)],
		["--kalem-accent", colors.accent],
		["--kalem-accent-fg", textOn(colors.accent)],
	];
	return lines.map(([name, value]) => `\t${name}: ${value};`).join("\n");
}
