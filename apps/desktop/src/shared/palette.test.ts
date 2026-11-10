import { describe, expect, it } from "vitest";
import {
	hexColor,
	PALETTE_IDS,
	PALETTES,
	paletteCss,
	parsePaletteCustom,
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
