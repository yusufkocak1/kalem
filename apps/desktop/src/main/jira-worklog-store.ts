import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type Defaults = Record<string, string>;

/**
 * What the user chose last when logging work, by Jira site: Tempo's work
 * attributes ("Servis", "Faturalandırılacak Şirket"…), so they are not
 * chosen again each time.
 */
export class WorklogDefaultsStore {
	readonly #file: string;
	#sites: Record<string, Defaults> | null = null;

	constructor(file: string) {
		this.#file = file;
	}

	async #load(): Promise<Record<string, Defaults>> {
		if (this.#sites !== null) return this.#sites;
		const sites: Record<string, Defaults> = {};
		try {
			const raw: unknown = JSON.parse(await readFile(this.#file, "utf8"));
			for (const [site, values] of Object.entries(
				typeof raw === "object" && raw !== null ? raw : {},
			)) {
				if (typeof values !== "object" || values === null) continue;
				const kept: Defaults = {};
				for (const [key, value] of Object.entries(values)) {
					if (typeof value === "string") kept[key.slice(0, 200)] = value.slice(0, 1000);
				}
				sites[site] = kept;
			}
		} catch {
			// None yet, or unreadable: start empty.
		}
		this.#sites = sites;
		return sites;
	}

	async get(site: string): Promise<Defaults> {
		return { ...((await this.#load())[site] ?? {}) };
	}

	async set(site: string, values: Readonly<Defaults>): Promise<void> {
		const sites = await this.#load();
		sites[site] = Object.fromEntries(
			Object.entries(values).filter(([, value]) => value.trim() !== ""),
		);
		await mkdir(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		await writeFile(temp, JSON.stringify(sites, null, "\t"));
		await rename(temp, this.#file);
	}
}
