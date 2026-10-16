import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AssistantConfig, Connection, ProviderId } from "../shared/providers.js";
import { isProvider, PROVIDER_INFO, PROVIDERS } from "../shared/providers.js";
import type { SecretBox } from "./confluence-store.js";

interface Stored {
	provider: ProviderId;
	connections: Partial<Record<ProviderId, Connection>>;
	/** Keys by service, as typed; written to disk only encrypted. */
	keys: Partial<Record<ProviderId, string>>;
}

/**
 * Which service the assistant uses, and each service's address, model and
 * key. Keys are stored only encrypted; without OS encryption they live in
 * memory until the app quits.
 */
export class AssistantStore {
	readonly #file: string;
	readonly #box: SecretBox;
	#state: Stored | null = null;

	constructor(file: string, box: SecretBox) {
		this.#file = file;
		this.#box = box;
	}

	async #load(): Promise<Stored> {
		if (this.#state !== null) return this.#state;
		const state: Stored = { provider: "claude-code", connections: {}, keys: {} };
		try {
			const raw = JSON.parse(await readFile(this.#file, "utf8")) as Record<string, unknown>;
			if (isProvider(raw.provider)) state.provider = raw.provider;
			const connections = (typeof raw.connections === "object" && raw.connections) || {};
			for (const [id, value] of Object.entries(connections as Record<string, unknown>)) {
				if (!isProvider(id) || typeof value !== "object" || value === null) continue;
				const { baseUrl, model, key } = value as Record<string, unknown>;
				state.connections[id] = {
					baseUrl: typeof baseUrl === "string" ? baseUrl : PROVIDER_INFO[id].baseUrl,
					model: typeof model === "string" ? model : PROVIDER_INFO[id].defaultModel,
				};
				if (typeof key === "string" && key !== "") {
					try {
						state.keys[id] = this.#box.decrypt(Buffer.from(key, "base64"));
					} catch {
						// Encrypted for another user or computer: asked for again.
					}
				}
			}
		} catch {
			// No settings yet.
		}
		this.#state = state;
		return state;
	}

	async #save(state: Stored): Promise<void> {
		const connections: Record<string, Connection & { key?: string }> = {};
		for (const [id, connection] of Object.entries(state.connections)) {
			const key = state.keys[id as ProviderId];
			const sealed = key === undefined ? null : this.#box.encrypt(key);
			connections[id] = {
				...connection,
				...(sealed === null ? {} : { key: sealed.toString("base64") }),
			};
		}
		await mkdir(dirname(this.#file), { recursive: true });
		const temp = `${this.#file}.tmp`;
		await writeFile(temp, JSON.stringify({ provider: state.provider, connections }, null, 2));
		await rename(temp, this.#file);
	}

	connection(state: Stored, id: ProviderId): Connection {
		return (
			state.connections[id] ?? {
				baseUrl: PROVIDER_INFO[id].baseUrl,
				model: PROVIDER_INFO[id].defaultModel,
			}
		);
	}

	/** The service in use, with its address, model and key. */
	async active(): Promise<{ provider: ProviderId; connection: Connection; key: string | null }> {
		const state = await this.#load();
		return {
			provider: state.provider,
			connection: this.connection(state, state.provider),
			key: state.keys[state.provider] ?? null,
		};
	}

	async key(id: ProviderId): Promise<string | null> {
		return (await this.#load()).keys[id] ?? null;
	}

	async config(): Promise<AssistantConfig> {
		const state = await this.#load();
		const connections = Object.fromEntries(
			PROVIDERS.map((id) => [
				id,
				{ ...this.connection(state, id), hasKey: state.keys[id] !== undefined },
			]),
		) as AssistantConfig["connections"];
		return { provider: state.provider, connections, encrypted: this.#box.encrypt("") !== null };
	}

	async update(
		provider: ProviderId,
		connection: Connection,
		key: string | null | undefined,
	): Promise<AssistantConfig> {
		const state = await this.#load();
		state.provider = provider;
		state.connections[provider] = connection;
		if (key === null || key === "") delete state.keys[provider];
		else if (key !== undefined) state.keys[provider] = key;
		await this.#save(state);
		return this.config();
	}
}
