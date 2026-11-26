/**
 * Reads the extension catalogs: each index is trusted only when its
 * signature checks out with the catalog's key, and each package only
 * when its sha256 is the one the signed index gives.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { net } from "electron";
import type { Registry, RegistryEntry, RegistryIndex } from "../shared/extension-registry.js";
import { MAX_INDEX_BYTES, parseIndex } from "../shared/extension-registry.js";
import { MAX_PACKAGE_BYTES } from "../shared/extensions.js";
import { networkLog } from "./network-log.js";

const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 60_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const tracedFetch: Fetch = networkLog.trace("extensions", (url: string, init?: RequestInit) =>
	net.fetch(url, init),
);

export class RegistryError extends Error {}

/** Whether `signature` (base64) is the key's ed25519 signature of `data`. */
export function verifySignature(data: Uint8Array, signature: string, publicKey: string): boolean {
	try {
		const key = createPublicKey({
			key: Buffer.from(publicKey, "base64"),
			format: "der",
			type: "spki",
		});
		if (key.asymmetricKeyType !== "ed25519") return false;
		return verify(null, data, key, Buffer.from(signature.trim(), "base64"));
	} catch {
		return false;
	}
}

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

async function readLimited(response: Response, limit: number, what: string): Promise<Uint8Array> {
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new RegistryError(`${what}: the server answered ${response.status}.`);
	}
	if (Number(response.headers.get("content-length") ?? 0) > limit) {
		await response.body?.cancel().catch(() => {});
		throw new RegistryError(`${what} is too large.`);
	}
	const data = new Uint8Array(await response.arrayBuffer());
	if (data.byteLength > limit) throw new RegistryError(`${what} is too large.`);
	return data;
}

export class RegistryClient {
	readonly #fetch: Fetch;
	readonly #cache = new Map<string, { at: number; index: RegistryIndex }>();

	constructor(fetch: Fetch = tracedFetch) {
		this.#fetch = fetch;
	}

	async index(registry: Registry, force = false): Promise<RegistryIndex> {
		const key = `${registry.url}\n${registry.publicKey}`;
		const cached = this.#cache.get(key);
		if (!force && cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached.index;
		// Asked of the server each time: a catalog published minutes ago is not left in the HTTP cache,
		// and the list and its signature are never of two different publishes.
		const init: RequestInit = { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-cache" };
		const [data, signature] = await Promise.all([
			this.#fetch(registry.url, init).then((response) =>
				readLimited(response, MAX_INDEX_BYTES, "The catalog"),
			),
			this.#fetch(`${registry.url}.sig`, init).then((response) =>
				readLimited(response, 4096, "The catalog's signature"),
			),
		]);
		if (!verifySignature(data, new TextDecoder().decode(signature), registry.publicKey)) {
			throw new RegistryError("The catalog's signature does not match its key: it is not trusted.");
		}
		let raw: unknown;
		try {
			raw = JSON.parse(new TextDecoder().decode(data));
		} catch {
			throw new RegistryError("The catalog is not valid JSON.");
		}
		const index = parseIndex(raw, registry.url);
		this.#cache.set(key, { at: Date.now(), index });
		return index;
	}

	/** The package's bytes, once they are the ones the signed index names. */
	async download(entry: RegistryEntry): Promise<Uint8Array> {
		const data = await this.#fetch(entry.url, { signal: AbortSignal.timeout(5 * TIMEOUT_MS) }).then(
			(response) => readLimited(response, MAX_PACKAGE_BYTES, "The package"),
		);
		if (sha256(data) !== entry.sha256) {
			throw new RegistryError(
				"The package is not the one the catalog names (its sha256 differs): it was not installed.",
			);
		}
		return data;
	}
}
