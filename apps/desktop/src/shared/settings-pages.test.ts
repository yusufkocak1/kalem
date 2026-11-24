import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./bridge.js";
import { stringsFor } from "./i18n.js";
import {
	changedKeys,
	pageOf,
	pageResetPatch,
	pageResettable,
	pageTitle,
	SETTING_PAGES,
	sameValue,
} from "./settings-pages.js";
import { resettable, SETTING_CATEGORIES, SETTING_DEFS } from "./settings-schema.js";

describe("settings pages", () => {
	it("lists every category of the schema once, and the assistant's own pages", () => {
		for (const category of SETTING_CATEGORIES) expect(SETTING_PAGES).toContain(category);
		expect(SETTING_PAGES).toContain("mcp");
		expect(SETTING_PAGES).toContain("assistantTools");
		expect(new Set(SETTING_PAGES).size).toBe(SETTING_PAGES.length);
	});

	it("puts every setting on a page that is listed", () => {
		for (const def of SETTING_DEFS) expect(SETTING_PAGES).toContain(pageOf(def.key));
	});

	it("shows the MCP servers and the tools on pages of their own", () => {
		expect(pageOf("assistantMcpServers")).toBe("mcp");
		expect(pageOf("assistantApprovals")).toBe("assistantTools");
		expect(pageOf("copilotTools")).toBe("assistantTools");
		expect(pageOf("assistantDocumentAuto")).toBe("assistant");
		// The assistant's panel is set up with the other panels.
		expect(pageOf("assistantPlace")).toBe("panels");
		expect(pageOf("assistant")).toBe("panels");
	});

	it("resets each setting a category reset would, on exactly one page", () => {
		const byPages = SETTING_PAGES.flatMap((page) => pageResettable(page)).sort();
		const byCategories = SETTING_CATEGORIES.flatMap((category) => resettable(category)).sort();
		expect(byPages).toEqual(byCategories);
	});

	it("resets a page to its defaults and nothing else", () => {
		const patch = pageResetPatch("assistantTools");
		// What the user approved is theirs: a reset leaves it.
		expect(Object.keys(patch)).toEqual(["copilotTools"]);
		expect(patch.copilotTools).toEqual(DEFAULT_SETTINGS.copilotTools);
	});

	it("names the assistant's pages as the assistant's", () => {
		const t = stringsFor("tr");
		expect(pageTitle(t, "mcp")).toBe(`${t.settingsCatAssistant} › ${t.mcpTitle}`);
		expect(pageTitle(t, "appearance")).toBe(t.settingsCatAppearance);
	});
});

describe("changed settings", () => {
	it("compares stored values whatever the order of their keys", () => {
		expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
		expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(sameValue([1, 2], [2, 1])).toBe(false);
		expect(sameValue([], {})).toBe(false);
	});

	it("finds the settings that differ from their defaults", () => {
		expect(changedKeys(DEFAULT_SETTINGS, ["palette", "panePlaces"])).toEqual([]);
		const settings = {
			...DEFAULT_SETTINGS,
			palette: DEFAULT_SETTINGS.palette === "ocean" ? "kalem" : "ocean",
			panePlaces: { ...DEFAULT_SETTINGS.panePlaces },
		} as typeof DEFAULT_SETTINGS;
		expect(changedKeys(settings, ["palette", "panePlaces"])).toEqual(["palette"]);
	});
});
