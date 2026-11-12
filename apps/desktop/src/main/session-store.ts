import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WindowBounds } from "./settings.js";

/**
 * What was open when the app closed, to open it again as it was (as
 * Notepad++ does): each window's place and tabs in order, which tab was
 * active, and where each was scrolled. A tab is its file, its Confluence
 * page, or, when it had unsaved text, its draft (kept in the drafts
 * folder under the tab's id).
 */
export interface SessionTabEntry {
	readonly id: string;
	/** The tab's text is its draft: unsaved when the app closed. */
	readonly draft: boolean;
	readonly path: string | null;
	readonly page: { readonly site: string; readonly id: string } | null;
	readonly scroll: number;
}

export interface SessionWindow {
	readonly bounds: WindowBounds | null;
	readonly active: string | null;
	readonly tabs: readonly SessionTabEntry[];
}

export interface StoredSession {
	readonly windows: readonly SessionWindow[];
}

const TAB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_WINDOWS = 20;
const MAX_TABS = 200;

const record = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const number = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

function parseBounds(raw: unknown): WindowBounds | null {
	const value = record(raw);
	const width = number(value.width);
	const height = number(value.height);
	if (width === null || height === null) return null;
	return {
		width: Math.max(480, Math.round(width)),
		height: Math.max(360, Math.round(height)),
		x: number(value.x),
		y: number(value.y),
		maximized: value.maximized === true,
	};
}

function parseTab(raw: unknown): SessionTabEntry | null {
	const value = record(raw);
	const id = typeof value.id === "string" ? value.id : "";
	if (!TAB_ID.test(id)) return null;
	const path = typeof value.path === "string" && value.path !== "" ? value.path : null;
	const pageValue = record(value.page);
	const page =
		typeof pageValue.site === "string" &&
		pageValue.site !== "" &&
		typeof pageValue.id === "string" &&
		/^\d+$/.test(pageValue.id)
			? { site: pageValue.site, id: pageValue.id }
			: null;
	const draft = value.draft === true;
	// A tab with nothing to open it from is not kept.
	if (!draft && path === null && page === null) return null;
	return { id, draft, path, page, scroll: Math.max(0, number(value.scroll) ?? 0) };
}

/** The file may be from another version or hand-edited: every field is checked. */
export function parseSession(raw: unknown): StoredSession {
	const windows = Array.isArray(record(raw).windows) ? (record(raw).windows as unknown[]) : [];
	return {
		windows: windows.slice(0, MAX_WINDOWS).flatMap((item) => {
			const value = record(item);
			const seen = new Set<string>();
			const tabs = (Array.isArray(value.tabs) ? value.tabs : [])
				.slice(0, MAX_TABS)
				.map(parseTab)
				.filter((tab): tab is SessionTabEntry => {
					if (tab === null || seen.has(tab.id)) return false;
					seen.add(tab.id);
					return true;
				});
			if (tabs.length === 0) return [];
			const active =
				typeof value.active === "string" && seen.has(value.active) ? value.active : null;
			return [{ bounds: parseBounds(value.bounds), active, tabs }];
		}),
	};
}

/** `session.json` in the app's data folder; written as the app closes, taken once as it opens. */
export class SessionStore {
	readonly #file: string;

	constructor(file: string) {
		this.#file = file;
	}

	/** The session left by the last close, removed so that it is opened once. */
	take(): StoredSession | null {
		try {
			const session = parseSession(JSON.parse(readFileSync(this.#file, "utf8")));
			this.clear();
			return session.windows.length > 0 ? session : null;
		} catch {
			return null;
		}
	}

	// Synchronous: it is written while the app is quitting.
	write(session: StoredSession): void {
		try {
			mkdirSync(dirname(this.#file), { recursive: true });
			const temp = `${this.#file}.tmp`;
			writeFileSync(temp, `${JSON.stringify({ version: 1, ...session }, null, "\t")}\n`, "utf8");
			renameSync(temp, this.#file);
		} catch (error) {
			console.warn("The session could not be kept:", error);
		}
	}

	clear(): void {
		rmSync(this.#file, { force: true });
	}
}
