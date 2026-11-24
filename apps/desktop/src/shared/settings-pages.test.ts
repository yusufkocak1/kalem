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
import { resettable, SETTING_CATEGORIES, SETTING_DEFS, settingDef } from "./settings-schema.js";

describe("settings pages", () => {
	it("lists each page once, and every page shows something", () => {
		expect(new Set(SETTING_PAGES).size).toBe(SETTING_PAGES.length);
		const shown = new Set(SETTING_DEFS.map((def) => pageOf(def.key)));
		for (const page of SETTING_PAGES) expect(shown.has(page)).toBe(true);
	});

	it("puts a setting where a person looks for it, not only by its category", () => {
		expect(pageOf("language")).toBe("general");
		expect(pageOf("restoreSession")).toBe("general");
		expect(pageOf("theme")).toBe("appearance");
		expect(pageOf("ribbonSimple")).toBe("window");
		expect(pageOf("zoom")).toBe("documentView");
		expect(pageOf("autoSave")).toBe("editor");
		expect(pageOf("defaultTemplate")).toBe("page");
		expect(pageOf("confluenceReviewBeforeSave")).toBe("connections");
		expect(pageOf("gitAutoFetch")).toBe("git");
		// The assistant's permissions still name the category: what was always allowed is kept.
		expect(settingDef("language").category).toBe("appearance");
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

	it("names a page with its group, one on its own by itself", () => {
		const t = stringsFor("tr");
		expect(pageTitle(t, "mcp")).toBe(`${t.settingsCatAssistant} › ${t.mcpTitle}`);
		expect(pageTitle(t, "appearance")).toBe("Arayüz › Tema ve Renkler");
		expect(pageTitle(t, "general")).toBe("Genel");
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
