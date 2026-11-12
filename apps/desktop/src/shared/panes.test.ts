import { describe, expect, it } from "vitest";
import type { Settings } from "./bridge.js";
import { DEFAULT_SETTINGS } from "./bridge.js";
import {
	clampDockSize,
	dockState,
	isPaneShown,
	movePane,
	panesIn,
	parsePanePlaces,
	placesFor,
	revealPane,
	shownPane,
	togglePane,
} from "./panes.js";

const all = () => true;
/** Confluence and Jira are not set up. */
const local = (pane: string) => pane !== "confluence" && pane !== "jira";
const apply = (settings: Settings, patch: Partial<Settings>): Settings => ({
	...settings,
	...patch,
});

describe("panes in docks", () => {
	it("keeps every pane in the left dock by default, the navigation pane of before", () => {
		const settings = DEFAULT_SETTINGS;
		expect(panesIn(settings, "left", all)).toEqual(["outline", "files", "confluence", "jira"]);
		expect(panesIn(settings, "left", local)).toEqual(["outline", "files"]);
		expect(dockState(settings, "left")).toEqual({ open: true, pane: "outline", size: 248 });
		expect(isPaneShown(settings, "outline", all)).toBe(true);
	});

	it("leaves out the panes that are not set up, and shows the dock's first one instead", () => {
		const settings = apply(DEFAULT_SETTINGS, { sidePane: "jira" });
		expect(shownPane(settings, "left", all)).toBe("jira");
		expect(shownPane(settings, "left", local)).toBe("outline");
		expect(isPaneShown(settings, "jira", local)).toBe(false);
	});

	it("moves a pane to another dock and shows it there, or hides it", () => {
		let settings = apply(DEFAULT_SETTINGS, movePane(DEFAULT_SETTINGS, "jira", "right"));
		expect(settings.panePlaces.jira).toBe("right");
		expect(dockState(settings, "right")).toMatchObject({ open: true, pane: "jira" });
		expect(isPaneShown(settings, "jira", all)).toBe(true);
		settings = apply(settings, movePane(settings, "outline", "bottom"));
		expect(dockState(settings, "bottom")).toMatchObject({ open: true, pane: "outline" });
		expect(shownPane(settings, "left", all)).toBe("files");
		settings = apply(settings, movePane(settings, "files", "hidden"));
		expect(panesIn(settings, "left", all)).toEqual(["confluence"]);
		expect(shownPane(settings, "bottom", local)).toBe("outline");
		// The notes are in the right dock from the start.
		expect(shownPane(settings, "right", local)).toBe("notes");
	});

	it("keeps the notes beside the page: left or right, never at the bottom", () => {
		expect(placesFor("notes")).toEqual(["left", "right", "hidden"]);
		expect(placesFor("files")).toContain("bottom");
		expect(movePane(DEFAULT_SETTINGS, "notes", "bottom")).toEqual({});
		expect(movePane(DEFAULT_SETTINGS, "notes", "left")).toMatchObject({
			navigation: true,
			sidePane: "notes",
		});
		expect(parsePanePlaces({ notes: "bottom" }).notes).toBe("right");
		// Hidden, it comes back on the right.
		const hidden = apply(DEFAULT_SETTINGS, movePane(DEFAULT_SETTINGS, "notes", "hidden"));
		expect(apply(hidden, revealPane(hidden, "notes"))).toMatchObject({
			rightDock: true,
			rightPane: "notes",
		});
	});

	it("brings a pane into view, a hidden one in the left dock", () => {
		const hidden = apply(DEFAULT_SETTINGS, {
			navigation: false,
			panePlaces: { ...DEFAULT_SETTINGS.panePlaces, files: "hidden" },
		});
		const shown = apply(hidden, revealPane(hidden, "files"));
		expect(shown.panePlaces.files).toBe("left");
		expect(shown).toMatchObject({ navigation: true, sidePane: "files" });
	});

	it("toggles a dock from its stripe button", () => {
		const right = apply(DEFAULT_SETTINGS, movePane(DEFAULT_SETTINGS, "files", "right"));
		const closed = apply(right, togglePane(right, "files", all));
		expect(closed.rightDock).toBe(false);
		const open = apply(closed, togglePane(closed, "files", all));
		expect(open).toMatchObject({ rightDock: true, rightPane: "files" });
	});

	it("reads hand-edited places and sizes", () => {
		expect(parsePanePlaces({ jira: "bottom", files: "top", nope: "left" })).toEqual({
			outline: "left",
			files: "left",
			confluence: "left",
			jira: "bottom",
			notes: "right",
		});
		expect(parsePanePlaces(null).outline).toBe("left");
		expect(clampDockSize(5000, 240)).toBe(900);
		expect(clampDockSize("x", 240)).toBe(240);
	});
});
