/**
 * Where the tool panes are, as in an IDE: each pane (headings, files,
 * Confluence, Jira) sits in the left, right or bottom dock, or is hidden.
 * A dock shows one of its panes at a time. The left dock is the navigation
 * pane of earlier versions (`navigation`, `sidePane`, `navigationWidth`);
 * the others have their own settings. Pure: the renderer lays them out.
 */
import type { Settings } from "./bridge.js";

export const TOOL_PANES = ["outline", "files", "confluence", "jira", "notes"] as const;
export type BuiltinPane = (typeof TOOL_PANES)[number];
/** A pane an extension adds: `ext:<extension id>/<pane id>`. */
export type ExtensionPaneId = `ext:${string}`;
export type ToolPane = BuiltinPane | ExtensionPaneId;

const EXTENSION_PANE = /^ext:[a-z0-9][a-z0-9.-]{2,120}\/[a-z][a-zA-Z0-9-]{0,39}$/;

export const isExtensionPane = (value: unknown): value is ExtensionPaneId =>
	typeof value === "string" && EXTENSION_PANE.test(value);

export const extensionPaneId = (extension: string, pane: string): ExtensionPaneId =>
	`ext:${extension}/${pane}`;

/** The extension and its pane of an extension's pane id. */
export function splitExtensionPane(pane: ExtensionPaneId): { extension: string; pane: string } {
	const [extension, own] = pane.slice(4).split("/") as [string, string];
	return { extension, pane: own };
}

export const DOCKS = ["left", "right", "bottom"] as const;
export type Dock = (typeof DOCKS)[number];
export type PanePlace = Dock | "hidden";

export const PANE_PLACES: readonly PanePlace[] = ["left", "right", "bottom", "hidden"];

export type PanePlaces = Readonly<Record<BuiltinPane, PanePlace>> &
	Readonly<Partial<Record<ExtensionPaneId, PanePlace>>>;

/** Where a pane is; an extension's pane not placed yet is hidden. */
export const placeOf = (places: PanePlaces, pane: ToolPane): PanePlace =>
	(places as Readonly<Record<string, PanePlace | undefined>>)[pane] ?? "hidden";

/** Every pane the settings know of: Kalem's, then the extensions' that were placed. */
export const knownPanes = (places: PanePlaces): ToolPane[] => [
	...TOOL_PANES,
	...Object.keys(places).filter(isExtensionPane),
];

export const DEFAULT_PANE_PLACES: PanePlaces = {
	outline: "left",
	files: "left",
	confluence: "left",
	jira: "left",
	// The user's own notes sit beside the page, as Word's comments do.
	notes: "right",
};

/**
 * Where a pane can go. The notes are cards read beside the text, one under
 * the other: a short, wide strip under the page has no room for them.
 */
export function placesFor(pane: ToolPane): readonly PanePlace[] {
	return pane === "notes" ? PANE_PLACES.filter((place) => place !== "bottom") : PANE_PLACES;
}

export const isToolPane = (value: unknown): value is ToolPane =>
	TOOL_PANES.includes(value as BuiltinPane) || isExtensionPane(value);

export function parsePanePlaces(value: unknown): PanePlaces {
	const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const places: Record<string, PanePlace> = { ...DEFAULT_PANE_PLACES } as Record<string, PanePlace>;
	for (const pane of [...TOOL_PANES, ...Object.keys(raw).filter(isExtensionPane).slice(0, 50)]) {
		const place = raw[pane];
		if (placesFor(pane).includes(place as PanePlace)) places[pane] = place as PanePlace;
	}
	return places as PanePlaces;
}

/** A dock as the settings keep it: open or not, the pane it shows, its size in pixels. */
export interface DockState {
	readonly open: boolean;
	readonly pane: ToolPane;
	readonly size: number;
}

export function dockState(settings: Settings, dock: Dock): DockState {
	switch (dock) {
		case "left":
			return { open: settings.navigation, pane: settings.sidePane, size: settings.navigationWidth };
		case "right":
			return { open: settings.rightDock, pane: settings.rightPane, size: settings.rightWidth };
		case "bottom":
			return { open: settings.bottomDock, pane: settings.bottomPane, size: settings.bottomHeight };
	}
}

/** The settings that change a dock. */
export function dockPatch(dock: Dock, state: Partial<DockState>): Partial<Settings> {
	const { open, pane, size } = state;
	switch (dock) {
		case "left":
			return {
				...(open === undefined ? {} : { navigation: open }),
				...(pane === undefined ? {} : { sidePane: pane }),
				...(size === undefined ? {} : { navigationWidth: size }),
			};
		case "right":
			return {
				...(open === undefined ? {} : { rightDock: open }),
				...(pane === undefined ? {} : { rightPane: pane }),
				...(size === undefined ? {} : { rightWidth: size }),
			};
		case "bottom":
			return {
				...(open === undefined ? {} : { bottomDock: open }),
				...(pane === undefined ? {} : { bottomPane: pane }),
				...(size === undefined ? {} : { bottomHeight: size }),
			};
	}
}

/**
 * The panes a dock holds, in their order, leaving out those not set up
 * (Confluence and Jira without a connection).
 */
export function panesIn(
	settings: Settings,
	dock: Dock,
	available: (pane: ToolPane) => boolean,
): ToolPane[] {
	return knownPanes(settings.panePlaces).filter(
		(pane) => placeOf(settings.panePlaces, pane) === dock && available(pane),
	);
}

/** The pane a dock shows: the one it keeps, or else its first; `null` when it holds none. */
export function shownPane(
	settings: Settings,
	dock: Dock,
	available: (pane: ToolPane) => boolean,
): ToolPane | null {
	const panes = panesIn(settings, dock, available);
	const kept = dockState(settings, dock).pane;
	return panes.includes(kept) ? kept : (panes[0] ?? null);
}

/** Whether the pane is on the screen now: its dock open, and showing it. */
export function isPaneShown(
	settings: Settings,
	pane: ToolPane,
	available: (pane: ToolPane) => boolean,
): boolean {
	const place = placeOf(settings.panePlaces, pane);
	if (place === "hidden" || !available(pane)) return false;
	return dockState(settings, place).open && shownPane(settings, place, available) === pane;
}

/** The settings that bring a pane into view; a hidden one goes to the left dock (the notes to the right). */
export function revealPane(settings: Settings, pane: ToolPane): Partial<Settings> {
	const place = placeOf(settings.panePlaces, pane);
	const dock: Dock = place === "hidden" ? (pane === "notes" ? "right" : "left") : place;
	return {
		...(place === "hidden" ? { panePlaces: { ...settings.panePlaces, [pane]: dock } } : {}),
		...dockPatch(dock, { open: true, pane }),
	};
}

/** The settings that move a pane to another dock, or hide it; a moved pane is shown there. */
export function movePane(settings: Settings, pane: ToolPane, place: PanePlace): Partial<Settings> {
	if (!placesFor(pane).includes(place)) return {};
	const panePlaces = { ...settings.panePlaces, [pane]: place };
	if (place === "hidden") return { panePlaces };
	return { panePlaces, ...dockPatch(place, { open: true, pane }) };
}

/** A stripe button's click: shows the pane, or closes its dock when it already shows it. */
export function togglePane(
	settings: Settings,
	pane: ToolPane,
	available: (pane: ToolPane) => boolean,
): Partial<Settings> {
	const place = placeOf(settings.panePlaces, pane);
	if (place !== "hidden" && isPaneShown(settings, pane, available)) {
		return dockPatch(place, { open: false });
	}
	return revealPane(settings, pane);
}

export const MIN_DOCK_SIZE = 160;
export const MAX_DOCK_SIZE = 900;

export function clampDockSize(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.round(Math.min(MAX_DOCK_SIZE, Math.max(MIN_DOCK_SIZE, value)));
}

/** The settings that open, close or move a panel. */
const SIDE_KEYS: readonly (keyof Settings)[] = [
	"assistant",
	"assistantPlace",
	"panePlaces",
	"navigation",
	"sidePane",
	"rightDock",
	"rightPane",
	"bottomDock",
	"bottomPane",
];

/** The side the assistant's panel is on: a dock's, which shows one panel at a time. */
export const assistantDock = (settings: Settings): Dock => settings.assistantPlace;

/** Whether a dock is open with a pane in it (one not set up is counted: it is the dock's own). */
const dockShowsPane = (settings: Settings, dock: Dock): boolean =>
	dockState(settings, dock).open && panesIn(settings, dock, () => true).length > 0;

/**
 * One panel open on each side, the assistant's as a dock's: a change that
 * opens the assistant where a dock is open closes the dock, and one that
 * opens a dock (or moves a pane into it) where the assistant is open closes
 * the assistant. The patch, with what it closes.
 */
export function oneOnEachSide(before: Settings, patch: Partial<Settings>): Partial<Settings> {
	// A change elsewhere (the zoom, a colour) leaves the panels as they are.
	if (!SIDE_KEYS.some((key) => key in patch)) return patch;
	const next = { ...before, ...patch };
	if (!next.assistant) return patch;
	const side = assistantDock(next);
	if (!dockShowsPane(next, side)) return patch;
	// The assistant just came to this side: opened, or moved here open.
	const assistantCame =
		(patch.assistant === true && !before.assistant) ||
		(patch.assistantPlace !== undefined && patch.assistantPlace !== before.assistantPlace);
	return assistantCame
		? { ...patch, ...dockPatch(side, { open: false }) }
		: { ...patch, assistant: false };
}
