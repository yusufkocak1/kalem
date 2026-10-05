import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Version } from "../shared/bridge.js";
import { pathKey } from "./path-key.js";

/** Saves closer together than this share one version, so autosave does not flood the history. */
export const VERSION_INTERVAL = 10 * 60 * 1000;
export const MAX_VERSIONS = 50;

const VERSION_FILE = /^(\d+)\.md$/;

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

	async #times(folder: string): Promise<number[]> {
		const names = await readdir(folder).catch(() => [] as string[]);
		return names
			.map((name) => VERSION_FILE.exec(name)?.[1])
			.filter((time): time is string => time !== undefined)
			.map(Number)
			.sort((a, b) => b - a);
	}

	/** Records the text just saved to `path`. */
	async record(path: string, text: string, now = Date.now()): Promise<void> {
		const folder = this.#documentFolder(path);
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "document.json"), JSON.stringify({ path }), "utf8");

		const times = await this.#times(folder);
		const latest = times[0];
		if (latest !== undefined) {
			const previous = await readFile(join(folder, `${latest}.md`), "utf8").catch(() => null);
			if (previous === text) return;
			// Within the interval the newest version is replaced instead of added.
			if (now - latest < this.#interval) {
				await rm(join(folder, `${latest}.md`), { force: true });
				times.shift();
			}
		}
		await writeFile(join(folder, `${now}.md`), text, "utf8");

		for (const old of times.slice(MAX_VERSIONS - 1)) {
			await rm(join(folder, `${old}.md`), { force: true });
		}
	}

	/** Newest first. */
	async list(path: string): Promise<Version[]> {
		const folder = this.#documentFolder(path);
		const versions: Version[] = [];
		for (const time of await this.#times(folder)) {
			const info = await stat(join(folder, `${time}.md`)).catch(() => null);
			if (info !== null) versions.push({ id: String(time), time, size: info.size });
		}
		return versions;
	}

	async read(path: string, id: string): Promise<string> {
		if (!/^\d+$/.test(id)) throw new Error(`Invalid version id: ${id}`);
		return readFile(join(this.#documentFolder(path), `${id}.md`), "utf8");
	}
}
