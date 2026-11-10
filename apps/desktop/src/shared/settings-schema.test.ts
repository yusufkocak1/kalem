import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./bridge.js";
import { stringsFor } from "./i18n.js";
import {
	findSettings,
	foldSearch,
	matchesQuery,
	parseSetting,
	parseSettings,
	resetPatch,
	SETTING_CATEGORIES,
	SETTING_DEFS,
	SETTINGS_SCHEMA,
	valueLabel,
} from "./settings-schema.js";

const en = stringsFor("en");
const tr = stringsFor("tr");

describe("SETTINGS_SCHEMA", () => {
	it("describes every setting, under its own name, in a known category", () => {
		expect(Object.keys(SETTINGS_SCHEMA).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) {
			expect(def.key).toBe(key);
			expect(SETTING_CATEGORIES).toContain(def.category);
		}
	});

	it("takes every default as valid", () => {
		expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
		for (const def of SETTING_DEFS) {
			if (def.type === "enum") expect(def.values).toContainEqual(DEFAULT_SETTINGS[def.key]);
			if (def.type === "number") {
				const value = DEFAULT_SETTINGS[def.key] as number;
				expect(value).toBeGreaterThanOrEqual(def.min);
				expect(value).toBeLessThanOrEqual(def.max);
			}
		}
	});

	it("names every label and value in both languages", () => {
		for (const def of SETTING_DEFS) {
			for (const t of [en, tr]) {
				if (def.label !== null) expect(t[def.label]).toBeTruthy();
				if (def.type === "enum") {
					for (const value of def.values) expect(valueLabel(t, def, value)).not.toBe("");
				}
			}
		}
	});

	it("keeps programs' paths and the user's lists from the assistant", () => {
		for (const key of ["claudePath", "copilotPath", "confluenceFavorites", "jiraFavorites"]) {
			expect(SETTINGS_SCHEMA[key as keyof typeof SETTINGS_SCHEMA].assistant).toBe("hidden");
		}
	});
});

describe("parseSetting", () => {
	it("falls back to the default for a value of another kind", () => {
		expect(parseSetting("theme", "neon")).toBe("system");
		expect(parseSetting("autoSave", "yes")).toBe(false);
		expect(parseSetting("zoom", "120")).toBe(100);
		expect(parseSetting("language", "de")).toBeNull();
		expect(parseSetting("landscape", 1)).toBe(false);
	});

	it("rounds and bounds numbers", () => {
		expect(parseSetting("zoom", 9999)).toBe(200);
		expect(parseSetting("zoom", 124)).toBe(120);
		expect(parseSetting("assistantWidth", 10)).toBe(280);
		expect(parseSetting("rightWidth", 300.6)).toBe(301);
		expect(parseSetting("bottomHeight", Number.NaN)).toBe(DEFAULT_SETTINGS.bottomHeight);
	});

	it("cuts long text and reads shaped values with their own parsers", () => {
		expect(parseSetting("confluenceSpace", "x".repeat(300))).toHaveLength(255);
		expect(parseSetting("panePlaces", { jira: "bottom", files: "nowhere" })).toEqual({
			...DEFAULT_SETTINGS.panePlaces,
			jira: "bottom",
		});
		expect(parseSetting("jiraFavorites", [{ site: "s", key: "bad" }])).toEqual([]);
	});
});

describe("findSettings", () => {
	const keys = (t: typeof en, query: string): string[] =>
		findSettings(t, query).map((def) => def.key);

	it("finds a setting by its name, its values or its keywords, in either language", () => {
		expect(keys(tr, "koyu")).toEqual(["theme"]);
		expect(keys(en, "dark")).toEqual(["theme"]);
		expect(keys(tr, "KOYU TEMA")).toEqual(["theme"]);
		expect(keys(en, "landscape")).toContain("landscape");
		expect(keys(tr, "yazım")).toEqual(["spellCheck"]);
		expect(keys(tr, "jira")).toContain("panePlaces");
	});

	it("matches Turkish letters without their dots and accents", () => {
		expect(foldSearch("IŞIK Güncelleme")).toBe("isik guncelleme");
		expect(keys(tr, "guncelleme")).toEqual(["checkUpdates"]);
		expect(keys(tr, "kagit")).toEqual(["pageSize"]);
		expect(matchesQuery(foldSearch("Tam Genişlik"), "genis tam")).toBe(true);
	});

	it("leaves out hidden settings unless asked", () => {
		expect(keys(en, "")).not.toContain("claudePath");
		expect(findSettings(en, "", { includeHidden: true }).map((def) => def.key)).toContain(
			"claudePath",
		);
	});

	it("puts the settings whose name has the words first", () => {
		expect(keys(en, "width")[0]).toBe("fullWidth");
	});
});

describe("resetPatch", () => {
	it("puts a category's shown settings back, and leaves the others", () => {
		expect(resetPatch("appearance")).toEqual({
			theme: DEFAULT_SETTINGS.theme,
			language: DEFAULT_SETTINGS.language,
			zoom: DEFAULT_SETTINGS.zoom,
			fullWidth: DEFAULT_SETTINGS.fullWidth,
		});
		const panels = resetPatch("panels");
		expect(panels.panePlaces).toEqual(DEFAULT_SETTINGS.panePlaces);
		expect(panels).not.toHaveProperty("sidePane");
		expect(resetPatch("assistant")).not.toHaveProperty("claudePath");
		expect(resetPatch("connections")).toEqual({});
	});
});
