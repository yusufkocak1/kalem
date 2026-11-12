import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LocalNote } from "../shared/local-notes.js";
import { parseNotes } from "../shared/local-notes.js";

/** A file's key compares as the file system does: case-insensitively on Windows and macOS. */
function normalKey(key: string): string {
	if (!key.startsWith("file:") || process.platform === "linux") return key;
	// kalem-locale-ok: file-system comparison; the Turkish rule would be wrong here
	return key.toLowerCase();
}

/**
 * The user's own notes on documents (see `shared/local-notes.ts`), in one
 * file of the app's data folder, by document. Nothing here is ever written
 * next to a document or sent anywhere.
 */
export class LocalNotesStore {
	readonly #file: string;
	#docs: Record<string, LocalNote[]> | null = null;
	#writing: Promise<void> = Promise.resolve();

	constructor(file: string) {
		this.#file = file;
	}

	async #load(): Promise<Record<string, LocalNote[]>> {
		if (this.#docs !== null) return this.#docs;
		const docs: Record<string, LocalNote[]> = {};
		try {
			const raw: unknown = JSON.parse(await readFile(this.#file, "utf8"));
			const stored =
				typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).docs : null;
			for (const [key, notes] of Object.entries(
				typeof stored === "object" && stored !== null ? stored : {},
			)) {
				const parsed = parseNotes(notes);
				if (parsed.length > 0) docs[normalKey(key)] = parsed;
			}
		} catch {
			// None yet, or unreadable: start empty.
		}
		this.#docs = docs;
		return docs;
	}

	async get(key: string): Promise<LocalNote[]> {
		return [...((await this.#load())[normalKey(key)] ?? [])];
	}

	async set(key: string, raw: unknown): Promise<void> {
		const docs = await this.#load();
		const notes = parseNotes(raw);
		if (notes.length === 0) delete docs[normalKey(key)];
		else docs[normalKey(key)] = notes;
		// One write at a time, the latest state last.
		this.#writing = this.#writing.then(() => this.#write()).catch(() => {});
		await this.#writing;
	}

	async #write(): Promise<void> {
		await mkdir(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		await writeFile(temp, JSON.stringify({ version: 1, docs: this.#docs ?? {} }, null, "\t"));
		await rename(temp, this.#file);
	}
}
