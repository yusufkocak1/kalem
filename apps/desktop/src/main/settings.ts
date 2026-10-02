import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings, Theme } from "../shared/bridge.js";
import { clampZoom, DEFAULT_SETTINGS } from "../shared/bridge.js";
import type { Lang } from "../shared/i18n.js";

export const MAX_RECENT_FILES = 12;

export interface WindowBounds {
	readonly width: number;
	readonly height: number;
	readonly x: number | null;
	readonly y: number | null;
	readonly maximized: boolean;
}

export interface StoredState {
	readonly settings: Settings;
	readonly recentFiles: readonly string[];
	readonly window: WindowBounds | null;
	/** Whether the welcome document has been shown once. */
	readonly welcomed: boolean;
}

const THEMES: readonly Theme[] = ["system", "light", "dark"];
const LANGUAGES: readonly Lang[] = ["tr", "en"];

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBounds(raw: unknown): WindowBounds | null {
	const value = asRecord(raw);
	const width = asNumber(value.width);
	const height = asNumber(value.height);
	if (width === null || height === null) return null;
	return {
		width: Math.max(480, Math.round(width)),
		height: Math.max(360, Math.round(height)),
		x: asNumber(value.x),
		y: asNumber(value.y),
		maximized: asBoolean(value.maximized, false),
	};
}

/** The file may be hand-edited, truncated or written by another version: validate every field. */
export function parseStoredState(raw: unknown): StoredState {
	const root = asRecord(raw);
	const s = asRecord(root.settings);
	const d = DEFAULT_SETTINGS;

	const recentFiles = Array.isArray(root.recentFiles)
		? root.recentFiles.filter((p): p is string => typeof p === "string" && p !== "")
		: [];

	return {
		settings: {
			theme: THEMES.includes(s.theme as Theme) ? (s.theme as Theme) : d.theme,
			language: LANGUAGES.includes(s.language as Lang) ? (s.language as Lang) : null,
			zoom: clampZoom(asNumber(s.zoom) ?? d.zoom),
			fullWidth: asBoolean(s.fullWidth, d.fullWidth),
			navigation: asBoolean(s.navigation, d.navigation),
			autoSave: asBoolean(s.autoSave, d.autoSave),
			spellCheck: asBoolean(s.spellCheck, d.spellCheck),
		},
		recentFiles: [...new Set(recentFiles)].slice(0, MAX_RECENT_FILES),
		window: parseBounds(root.window),
		welcomed: asBoolean(root.welcomed, false),
	};
}

export class SettingsStore {
	readonly #file: string;
	#state: StoredState;

	constructor(file: string) {
		this.#file = file;
		this.#state = this.#read();
	}

	#read(): StoredState {
		try {
			return parseStoredState(JSON.parse(readFileSync(this.#file, "utf8")));
		} catch {
			return parseStoredState(null);
		}
	}

	get state(): StoredState {
		return this.#state;
	}

	get settings(): Settings {
		return this.#state.settings;
	}

	update(patch: Partial<StoredState>): void {
		this.#state = parseStoredState({ ...this.#state, ...patch });
		this.#write();
	}

	updateSettings(patch: Partial<Settings>): void {
		this.update({ settings: { ...this.#state.settings, ...patch } });
	}

	// Synchronous on purpose: the last write happens while the app is quitting.
	#write(): void {
		try {
			mkdirSync(dirname(this.#file), { recursive: true });
			const temp = `${this.#file}.tmp`;
			writeFileSync(temp, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8");
			renameSync(temp, this.#file);
		} catch (error) {
			console.warn("Settings could not be saved:", error);
		}
	}
}
