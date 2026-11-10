import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/bridge.js";
import { MAX_RECENT_FILES, parseStoredState, SettingsStore } from "./settings.js";

describe("parseStoredState", () => {
	it("returns defaults for missing or malformed input", () => {
		for (const raw of [null, undefined, 42, "x", [], {}]) {
			expect(parseStoredState(raw)).toEqual({
				settings: DEFAULT_SETTINGS,
				recentFiles: [],
				window: null,
				welcomed: false,
				workspaces: [],
				lastUpdateCheck: null,
			});
		}
	});

	it("keeps valid values", () => {
		const state = parseStoredState({
			settings: { theme: "dark", language: "tr", zoom: 130, fullWidth: true, autoSave: true },
			recentFiles: ["C:\\a.md", "C:\\b.md"],
			window: { width: 900, height: 700, x: 10, y: 20, maximized: true },
			welcomed: true,
		});
		expect(state.settings).toEqual({
			...DEFAULT_SETTINGS,
			theme: "dark",
			language: "tr",
			zoom: 130,
			fullWidth: true,
			autoSave: true,
		});
		expect(state.recentFiles).toEqual(["C:\\a.md", "C:\\b.md"]);
		expect(state.window).toEqual({ width: 900, height: 700, x: 10, y: 20, maximized: true });
		expect(state.welcomed).toBe(true);
	});

	it("replaces invalid fields one by one", () => {
		const { settings } = parseStoredState({
			settings: { theme: "neon", language: "de", zoom: 9999, navigation: "yes", spellCheck: false },
		});
		expect(settings.theme).toBe("system");
		expect(settings.language).toBeNull();
		expect(settings.zoom).toBe(200);
		expect(settings.navigation).toBe(true);
		expect(settings.spellCheck).toBe(false);
	});

	it("reads where the panes dock, and the docks' state", () => {
		const { settings } = parseStoredState({
			settings: {
				sidePane: "jira",
				panePlaces: { jira: "right", outline: "bottom", files: "sideways" },
				rightDock: true,
				rightPane: "jira",
				rightWidth: 10,
				bottomPane: "nothing",
				bottomHeight: 320,
			},
		});
		expect(settings.sidePane).toBe("jira");
		expect(settings.panePlaces).toEqual({
			outline: "bottom",
			files: "left",
			confluence: "left",
			jira: "right",
		});
		expect(settings).toMatchObject({
			rightDock: true,
			rightPane: "jira",
			rightWidth: 160,
			bottomDock: false,
			bottomPane: "outline",
			bottomHeight: 320,
		});
	});

	it("keeps well-formed Confluence favorites once each", () => {
		const favorite = { site: "https://wiki.example.com", id: "42", title: "Plan" };
		const state = parseStoredState({
			settings: {
				confluenceFavorites: [
					favorite,
					favorite,
					{ ...favorite, site: "https://other.example.com" },
					{ site: "https://wiki.example.com", id: "../x", title: "bad" },
					{ site: "https://wiki.example.com", id: "7" },
					"junk",
				],
			},
		});
		expect(state.settings.confluenceFavorites).toEqual([
			favorite,
			{ ...favorite, site: "https://other.example.com" },
			{ site: "https://wiki.example.com", id: "7", title: "" },
		]);
		expect(
			parseStoredState({ settings: { confluenceFavorites: "x" } }).settings.confluenceFavorites,
		).toEqual([]);
	});

	it("keeps well-formed Jira favorites once each", () => {
		const favorite = {
			site: "https://jira.example.com",
			key: "QR-1",
			summary: "Giriş",
			type: "Bug",
		};
		const state = parseStoredState({
			settings: {
				jiraFavorites: [
					favorite,
					favorite,
					{ ...favorite, site: "https://other.example.com" },
					{ ...favorite, key: "qr-1" },
					{ site: "https://jira.example.com", key: "QR-2" },
					"junk",
				],
			},
		});
		expect(state.settings.jiraFavorites).toEqual([
			favorite,
			{ ...favorite, site: "https://other.example.com" },
			{ site: "https://jira.example.com", key: "QR-2", summary: "", type: "" },
		]);
		expect(parseStoredState({}).settings.jiraFavorites).toEqual([]);
	});

	it("deduplicates and caps the recent list", () => {
		const many = Array.from({ length: 40 }, (_, i) => `C:\\${i}.md`);
		const { recentFiles } = parseStoredState({ recentFiles: ["a.md", "a.md", 7, "", ...many] });
		expect(recentFiles).toHaveLength(MAX_RECENT_FILES);
		expect(recentFiles.slice(0, 2)).toEqual(["a.md", "C:\\0.md"]);
	});

	it("drops window bounds without a size and enforces a minimum", () => {
		expect(parseStoredState({ window: { x: 5, y: 5 } }).window).toBeNull();
		expect(parseStoredState({ window: { width: 10, height: 10 } }).window).toMatchObject({
			width: 480,
			height: 360,
			x: null,
			y: null,
		});
	});
});

describe("SettingsStore", () => {
	let folder: string;

	beforeEach(async () => {
		folder = await mkdtemp(join(tmpdir(), "kalem-settings-"));
	});

	afterEach(async () => {
		await rm(folder, { recursive: true, force: true });
	});

	it("persists updates across instances", async () => {
		const file = join(folder, "nested", "settings.json");
		const store = new SettingsStore(file);
		expect(store.settings).toEqual(DEFAULT_SETTINGS);

		store.updateSettings({ theme: "dark", zoom: 120 });
		store.update({ recentFiles: ["C:\\a.md"], welcomed: true });

		const reopened = new SettingsStore(file);
		expect(reopened.settings.theme).toBe("dark");
		expect(reopened.settings.zoom).toBe(120);
		expect(reopened.state.recentFiles).toEqual(["C:\\a.md"]);
		expect(reopened.state.welcomed).toBe(true);
		expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ welcomed: true });
	});

	it("validates values coming through update", () => {
		const store = new SettingsStore(join(folder, "settings.json"));
		store.updateSettings({ zoom: 5 });
		expect(store.settings.zoom).toBe(50);
	});

	it("starts with defaults when the file is corrupt", async () => {
		const file = join(folder, "settings.json");
		await writeFile(file, "{ not json");
		expect(new SettingsStore(file).settings).toEqual(DEFAULT_SETTINGS);
	});
});
