import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatSummary, StoredChat } from "../shared/chats.js";
import { chatSummary, MAX_CHATS, parseChat } from "../shared/chats.js";

/** The assistant's chats, newest first; the oldest go beyond {@link MAX_CHATS}. */
export class ChatStore {
	readonly #file: string;
	#chats: StoredChat[] | null = null;
	#writing: Promise<void> = Promise.resolve();

	constructor(file: string) {
		this.#file = file;
	}

	async #load(): Promise<StoredChat[]> {
		if (this.#chats !== null) return this.#chats;
		let chats: StoredChat[] = [];
		try {
			const raw = JSON.parse(await readFile(this.#file, "utf8")) as { chats?: unknown };
			chats = (Array.isArray(raw.chats) ? raw.chats : [])
				.map(parseChat)
				.filter((chat): chat is StoredChat => chat !== null);
		} catch {
			// No chats yet.
		}
		this.#chats = chats.sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
		return this.#chats;
	}

	/** Writes one after another, so an older state never lands last. */
	#save(chats: StoredChat[]): Promise<void> {
		this.#writing = this.#writing
			.catch(() => {})
			.then(async () => {
				await mkdir(dirname(this.#file), { recursive: true });
				const temp = `${this.#file}.tmp`;
				await writeFile(temp, JSON.stringify({ chats }));
				await rename(temp, this.#file);
			});
		return this.#writing;
	}

	async list(): Promise<ChatSummary[]> {
		return (await this.#load()).map(chatSummary);
	}

	async get(id: string): Promise<StoredChat | null> {
		return (await this.#load()).find((chat) => chat.id === id) ?? null;
	}

	async put(chat: StoredChat): Promise<void> {
		const chats = [chat, ...(await this.#load()).filter((other) => other.id !== chat.id)]
			.sort((a, b) => b.updated - a.updated)
			.slice(0, MAX_CHATS);
		this.#chats = chats;
		await this.#save(chats);
	}

	async delete(id: string): Promise<void> {
		const chats = (await this.#load()).filter((chat) => chat.id !== id);
		this.#chats = chats;
		await this.#save(chats);
	}
}
