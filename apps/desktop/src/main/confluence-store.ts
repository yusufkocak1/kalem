import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConfluenceCredentials } from "./confluence-client.js";

/** OS-level encryption (Electron's `safeStorage`); `null` where none is available. */
export interface SecretBox {
	encrypt(text: string): Buffer | null;
	decrypt(data: Buffer): string;
}

/**
 * The Confluence login. The token is stored only encrypted; without OS
 * encryption it lives in memory until the app quits.
 */
export class ConfluenceStore {
	readonly #file: string;
	readonly #box: SecretBox;
	#memory: ConfluenceCredentials | null = null;
	#loaded = false;

	constructor(file: string, box: SecretBox) {
		this.#file = file;
		this.#box = box;
	}

	async get(): Promise<ConfluenceCredentials | null> {
		if (this.#loaded) return this.#memory;
		this.#loaded = true;
		try {
			const raw = JSON.parse(await readFile(this.#file, "utf8")) as Record<string, unknown>;
			if (typeof raw.site === "string" && typeof raw.token === "string") {
				this.#memory = {
					site: raw.site,
					username: typeof raw.username === "string" ? raw.username : "",
					token: this.#box.decrypt(Buffer.from(raw.token, "base64")),
				};
			}
		} catch {
			this.#memory = null;
		}
		return this.#memory;
	}

	async set(credentials: ConfluenceCredentials): Promise<void> {
		this.#memory = credentials;
		this.#loaded = true;
		const sealed = this.#box.encrypt(credentials.token);
		if (sealed === null) {
			await rm(this.#file, { force: true });
			return;
		}
		await mkdir(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		const { site, username } = credentials;
		await writeFile(temp, JSON.stringify({ site, username, token: sealed.toString("base64") }));
		await rename(temp, this.#file);
	}

	async clear(): Promise<void> {
		this.#memory = null;
		this.#loaded = true;
		await rm(this.#file, { force: true });
	}
}
