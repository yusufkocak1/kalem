import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Draft, DraftRequest } from "../shared/bridge.js";
import { toTextFormat } from "../shared/encoding.js";

// The id becomes a file name, so its shape is fixed.
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseDraft(id: string, raw: unknown): Draft | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (typeof value.text !== "string") return null;
	return {
		id,
		path: typeof value.path === "string" && value.path !== "" ? value.path : null,
		name: typeof value.name === "string" ? value.name : "",
		text: value.text,
		format: toTextFormat(value.format),
		time: typeof value.time === "number" ? value.time : 0,
	};
}

/**
 * Recovery drafts of unsaved documents. A draft is removed on save and on a
 * clean close, so any file found at startup means the last session crashed.
 */
export class DraftStore {
	readonly #folder: string;

	constructor(folder: string) {
		this.#folder = folder;
	}

	#file(id: string): string {
		if (!DRAFT_ID.test(id)) throw new Error(`Invalid draft id: ${id}`);
		return join(this.#folder, `${id}.json`);
	}

	async write(
		id: string,
		request: DraftRequest & { path: string | null },
		time: number,
	): Promise<void> {
		const file = this.#file(id);
		await mkdir(this.#folder, { recursive: true });
		const temp = `${file}.tmp`;
		await writeFile(temp, JSON.stringify({ ...request, time }), "utf8");
		await rename(temp, file);
	}

	async delete(id: string): Promise<void> {
		await rm(this.#file(id), { force: true });
	}

	/** All readable drafts, oldest first. */
	async list(): Promise<Draft[]> {
		let names: string[];
		try {
			names = await readdir(this.#folder);
		} catch {
			return [];
		}

		const drafts: Draft[] = [];
		for (const name of names) {
			const id = name.replace(/\.json$/, "");
			if (!name.endsWith(".json") || !DRAFT_ID.test(id)) continue;
			try {
				const raw: unknown = JSON.parse(await readFile(join(this.#folder, name), "utf8"));
				const draft = parseDraft(id, raw);
				if (draft !== null) drafts.push(draft);
			} catch {
				// Corrupt draft: nothing to recover.
			}
		}
		return drafts.sort((a, b) => a.time - b.time);
	}
}
