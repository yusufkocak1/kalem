import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./bridge.js";
import { stringsFor } from "./i18n.js";
import {
	changedKeys,
	migratePermissions,
	pageOf,
	pageResetPatch,
	pageResettable,
	pageTitle,
	permissionLabel,
	SETTING_PAGES,
	sameValue,
} from "./settings-pages.js";
import {
	parsePermissions,
	resettable,
	SETTING_CATEGORIES,
	SETTING_DEFS,
	settingDef,
} from "./settings-schema.js";

describe("settings pages", () => {
	it("lists each page once, and every page shows something", () => {
		expect(new Set(SETTING_PAGES).size).toBe(SETTING_PAGES.length);
		const shown = new Set(SETTING_DEFS.map((def) => pageOf(def.key)));
		// The extensions page lists the installed extensions, not settings of the schema.
		for (const page of SETTING_PAGES.filter((each) => each !== "extensions")) {
			expect(shown.has(page)).toBe(true);
		}
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
		expect(pageOf("proxyMode")).toBe("proxy");
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

describe("what the assistant is allowed, a page at a time", () => {
	it("allows a page the old categories covered whole, and nothing more", () => {
		// Appearance and the editor were allowed always: Theme & Colours, Window & Ribbon,
		// Document View and Editing hold only their settings.
		const pages = migratePermissions(["settings:appearance", "settings:editor", "document"]);
		expect(pages).toEqual(
			expect.arrayContaining([
				"document",
				"settings/appearance",
				"settings/window",
				"settings/documentView",
				"settings/editor",
			]),
		);
		// General has the language (appearance) and the session (system): not both were allowed.
		expect(pages).not.toContain("settings/general");
		// Confluence & Jira has the review before saving (editor) and the connections: asked again.
		expect(pages).not.toContain("settings/connections");
	});

	it("allows a page brought together from two categories when both were allowed", () => {
		expect(migratePermissions(["settings:appearance", "settings:system"])).toContain(
			"settings/general",
		);
	});

	it("keeps the modes' and the MCP servers' own permissions, and what is already a page's", () => {
		expect(migratePermissions(["settings:mcp", "settings:modes", "settings/git"])).toEqual(
			expect.arrayContaining(["settings/mcp", "settings/modes", "settings/git"]),
		);
		expect(migratePermissions(["settings/panels", "commands"])).toEqual([
			"settings/panels",
			"commands",
		]);
	});

	it("keeps a page permission when the settings are read again", () => {
		expect(parsePermissions(["settings/documentView", "settings/appearance", "x y"])).toEqual([
			"settings/documentView",
			"settings/appearance",
		]);
	});

	it("names a page permission by the page, as the window does", () => {
		const t = stringsFor("tr");
		expect(permissionLabel(t, "settings/documentView")).toBe("Ayarlar: Doküman › Belge Görünümü");
		expect(permissionLabel(t, "settings/mcp")).toBe(
			`Ayarlar: ${t.settingsCatAssistant} › ${t.mcpTitle}`,
		);
		expect(permissionLabel(t, "document")).toBe(t.permissionDocument);
	});
});
