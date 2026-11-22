import { describe, expect, it } from "vitest";
import {
	contrast,
	fitAccent,
	hexColor,
	PALETTE_IDS,
	PALETTES,
	paletteCss,
	parsePaletteCustom,
	systemAccentCss,
	textOn,
} from "./palette.js";

describe("colour palettes", () => {
	it("adds nothing for Kalem's own colours, which the stylesheet has", () => {
		expect(paletteCss("kalem", PALETTES.kalem)).toBe("");
	});

	it("sets both themes' colours for another palette", () => {
		const css = paletteCss("ocean", PALETTES.kalem);
		expect(css).toContain("--app-accent: #1d5fa8;");
		expect(css).toContain("@media screen and (prefers-color-scheme: dark)");
		// The editor's links and check boxes follow it too.
		expect(css).toContain("--kalem-accent: #1d5fa8;");
		expect(css).toContain("--app-accent: #7fb4f0;");
	});

	it("uses the user's own colours for a custom palette", () => {
		const custom = parsePaletteCustom({ light: { accent: "#AA0000" }, dark: { page: "#101010" } });
		expect(custom.light.accent).toBe("#aa0000");
		expect(custom.light.page).toBe(PALETTES.kalem.light.page);
		expect(custom.dark.page).toBe("#101010");
		expect(paletteCss("custom", custom)).toContain("--app-accent: #aa0000;");
	});

	it("keeps out what is not a colour", () => {
		expect(hexColor("red")).toBeNull();
		expect(hexColor("#fff")).toBeNull();
		expect(hexColor("#12345g")).toBeNull();
		const custom = parsePaletteCustom({ light: { accent: "url(x)" } });
		expect(custom.light.accent).toBe(PALETTES.kalem.light.accent);
		expect(parsePaletteCustom("nonsense")).toEqual(PALETTES.kalem);
	});

	it("writes on the accent in whichever of black and white reads better", () => {
		expect(textOn("#0f4e4a")).toBe("#ffffff");
		expect(textOn("#6fd3c6")).toBe("#16151a");
		for (const id of PALETTE_IDS) {
			expect(textOn(PALETTES[id].light.accent), id).toBe("#ffffff");
			expect(textOn(PALETTES[id].dark.accent), id).toBe("#16151a");
		}
	});
});

describe("the system's accent", () => {
	it("is darkened on a light theme and lightened on a dark one until it reads on the page", () => {
		const { light, dark } = PALETTES.kalem;
		// Windows' yellow is too light for a light page, and its navy too dark for a dark one.
		const yellow = fitAccent("#ffb900", light, false);
		expect(contrast(yellow, light.page)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(yellow, light.surface)).toBeGreaterThanOrEqual(4.5);
		const navy = fitAccent("#002050", dark, true);
		expect(contrast(navy, dark.page)).toBeGreaterThanOrEqual(4.5);
		// One that reads already stays as it is.
		expect(fitAccent("#0063b1", light, false)).toBe("#0063b1");
	});

	it("puts its variables over the palette's, for both themes, and nothing without one", () => {
		const css = systemAccentCss("#0078d4", "kalem", PALETTES.kalem);
		expect(css).toContain("--app-accent: #");
		expect(css).toContain("--kalem-accent: #");
		expect(css).toContain("prefers-color-scheme: dark");
		expect(systemAccentCss(null, "kalem", PALETTES.kalem)).toBe("");
	});
});
