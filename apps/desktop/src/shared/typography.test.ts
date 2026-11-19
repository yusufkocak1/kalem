import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./bridge.js";
import { parseSetting } from "./settings-schema.js";
import {
	DEFAULT_TYPOGRAPHY,
	isDefaultTypography,
	LINE_SPACING_PRESETS,
	pickTypography,
	typographyVars,
} from "./typography.js";

describe("typographyVars", () => {
	it("carries each setting to the page as a CSS property", () => {
		expect(
			typographyVars({
				...DEFAULT_TYPOGRAPHY,
				lineSpacing: 1.15,
				paragraphSpacing: 0.5,
				documentFontSize: 18,
				documentFont: "serif",
			}),
		).toMatchObject({
			"--doc-leading": "1.15",
			"--doc-space": "0.5em",
			"--doc-size": "1.125em",
			"--doc-font": expect.stringContaining("Georgia"),
		});
	});

	it("leaves the theme's typeface for the default", () => {
		expect(typographyVars(DEFAULT_TYPOGRAPHY)["--doc-font"]).toBeNull();
	});
});

describe("typography settings", () => {
	it("are part of the defaults", () => {
		expect(pickTypography(DEFAULT_SETTINGS)).toEqual(DEFAULT_TYPOGRAPHY);
		expect(isDefaultTypography(DEFAULT_SETTINGS)).toBe(true);
	});

	it("keeps Word's spacings exact when read back", () => {
		for (const value of LINE_SPACING_PRESETS)
			expect(parseSetting("lineSpacing", value)).toBe(value);
	});

	it("keeps a stored value in its range", () => {
		expect(parseSetting("lineSpacing", 9)).toBe(3);
		expect(parseSetting("paragraphSpacing", -1)).toBe(0);
		expect(parseSetting("documentFont", "comic")).toBe("default");
	});
});
