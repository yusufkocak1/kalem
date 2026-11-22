import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Version } from "../shared/bridge.js";
import { pathKey } from "./path-key.js";

/** Saves closer together than this share one version, so autosave does not flood the history. */
export const VERSION_INTERVAL = 10 * 60 * 1000;
export const MAX_VERSIONS = 50;

/** `<time>.md` for a save, `<time>.assistant.md` for the text before the assistant changed it. */
const VERSION_FILE = /^(\d+)(\.assistant)?\.md$/;

interface Entry {
	readonly time: number;
	/** Its file's name without `.md`: the version's id. */
	readonly id: string;
	readonly assistant: boolean;
}

/**
 * Earlier saved states of each document, kept under the app's data folder.
 * A document's versions live in a folder named after a hash of its path.
 */
export class VersionStore {
	readonly #folder: string;
	readonly #interval: number;

	constructor(folder: string, interval = VERSION_INTERVAL) {
		this.#folder = folder;
		this.#interval = interval;
	}

	#documentFolder(path: string): string {
		const hash = createHash("sha256").update(pathKey(path)).digest("hex").slice(0, 24);
		return join(this.#folder, hash);
	}

	async #entries(folder: string): Promise<Entry[]> {
		const names = await readdir(folder).catch(() => [] as string[]);
		return names
			.map((name) => {
				const found = VERSION_FILE.exec(name);
				if (found === null) return null;
				const assistant = found[2] !== undefined;
				return {
					time: Number(found[1]),
					id: `${found[1]}${assistant ? ".assistant" : ""}`,
					assistant,
				};
			})
			.filter((entry): entry is Entry => entry !== null)
			.sort((a, b) => b.time - a.time);
	}

	/** Records the text just saved to `path`. */
	async record(path: string, text: string, now = Date.now()): Promise<void> {
		const folder = this.#documentFolder(path);
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "document.json"), JSON.stringify({ path }), "utf8");

		const entries = await this.#entries(folder);
		const latest = entries[0];
		if (latest !== undefined) {
			const previous = await readFile(join(folder, `${latest.id}.md`), "utf8").catch(() => null);
			if (previous === text) return;
			// Within the interval the newest save is replaced instead of added; a
			// point before the assistant's change is kept.
			if (!latest.assistant && now - latest.time < this.#interval) {
				await rm(join(folder, `${latest.id}.md`), { force: true });
				entries.shift();
			}
		}
		await writeFile(join(folder, `${now}.md`), text, "utf8");
		await this.#trim(folder, entries);
	}

	/**
	 * Keeps the text as it was before the assistant changed it, as a version
	 * of its own: the history's way back to it, whatever is saved after.
	 */
	async checkpoint(path: string, text: string, now = Date.now()): Promise<void> {
		const folder = this.#documentFolder(path);
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "document.json"), JSON.stringify({ path }), "utf8");
		const entries = await this.#entries(folder);
		const latest = entries[0];
		if (latest !== undefined) {
			const previous = await readFile(join(folder, `${latest.id}.md`), "utf8").catch(() => null);
			// The same text kept already: nothing changed since.
			if (previous === text) return;
		}
		await writeFile(join(folder, `${now}.assistant.md`), text, "utf8");
		await this.#trim(folder, entries);
	}

	/** At most MAX_VERSIONS: the oldest go (`entries` are those before the one just written). */
	async #trim(folder: string, entries: readonly Entry[]): Promise<void> {
		for (const old of entries.slice(MAX_VERSIONS - 1)) {
			await rm(join(folder, `${old.id}.md`), { force: true });
		}
	}

	/** Newest first. */
	async list(path: string): Promise<Version[]> {
		const folder = this.#documentFolder(path);
		const versions: Version[] = [];
		for (const entry of await this.#entries(folder)) {
			const info = await stat(join(folder, `${entry.id}.md`)).catch(() => null);
			if (info === null) continue;
			versions.push({
				id: entry.id,
				time: entry.time,
				size: info.size,
				...(entry.assistant ? { kind: "assistant" as const } : {}),
			});
		}
		return versions;
	}

	async read(path: string, id: string): Promise<string> {
		if (!/^\d+(\.assistant)?$/.test(id)) throw new Error(`Invalid version id: ${id}`);
		return readFile(join(this.#documentFolder(path), `${id}.md`), "utf8");
	}
}
