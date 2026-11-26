/**
 * Extension catalogs: an `index.json` listing packages with their sha256,
 * signed (`index.json.sig`, ed25519) by the catalog's owner. Kalem trusts
 * a catalog by its public key, and a package by the hash the signed index
 * gives. Pure.
 */
import type { ExtensionPermissions } from "./extensions.js";
import { compareVersions, NO_PERMISSIONS, parseVersion, satisfies } from "./extensions.js";

export const INDEX_VERSION = 1;
export const MAX_INDEX_BYTES = 5 * 1024 * 1024;
export const MAX_REGISTRIES = 10;
const MAX_ICON_CHARS = 100_000;

export interface Registry {
	readonly name: string;
	/** Where `index.json` is; `index.json.sig` is next to it. */
	readonly url: string;
	/** The owner's ed25519 public key, base64 (SPKI DER). */
	readonly publicKey: string;
}

export interface RegistryEntry {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly description: string;
	readonly publisher: string;
	readonly engine: string;
	readonly permissions: ExtensionPermissions;
	readonly url: string;
	readonly sha256: string;
	readonly size: number;
	readonly homepage: string;
	/** Its picture, as a data: address (svg or png). */
	readonly icon: string;
}

export interface BlockedEntry {
	readonly id: string;
	/** A version range (`*` for all). */
	readonly versions: string;
	readonly reason: string;
}

export interface RegistryIndex {
	readonly name: string;
	readonly entries: readonly RegistryEntry[];
	readonly blocked: readonly BlockedEntry[];
}

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

const text = (raw: unknown, max: number): string =>
	typeof raw === "string" ? raw.trim().slice(0, max) : "";

const ID = /^[a-z0-9][a-z0-9-]{0,39}(?:\.[a-z0-9][a-z0-9-]{0,39}){1,2}$/;

export function parseRegistries(raw: unknown): Registry[] {
	const found: Registry[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		const source = record(item);
		const url = text(source.url, 1000);
		const publicKey = text(source.publicKey, 200).replace(/\s+/g, "");
		const name = text(source.name, 60) || url;
		if (!/^https?:\/\//i.test(url) || !/^[A-Za-z0-9+/=]{40,200}$/.test(publicKey)) continue;
		if (found.some((each) => each.url === url)) continue;
		found.push({ name, url, publicKey });
		if (found.length >= MAX_REGISTRIES) break;
	}
	return found;
}

/** Kalem's own catalog, there for everyone unless they turn it off. */
export const KALEM_REGISTRY: Registry = {
	name: "Kalem Eklentileri",
	url: "https://yusufkocak1.github.io/kalem-extensions/index.json",
	publicKey: "MCowBQYDK2VwAyEAefVQwZSxeRXlfROTZMXbOEQHRId/rGxZKMWl4flq4NI=",
};

/** The catalogs the market reads: Kalem's own first while it is on, then the user's. */
export function activeRegistries(own: readonly Registry[], kalemCatalog: boolean): Registry[] {
	const rest = own.filter((each) => each.url !== KALEM_REGISTRY.url);
	return kalemCatalog ? [KALEM_REGISTRY, ...rest] : rest;
}

/** The address of a file the index names: absolute, or next to the index. */
export function resolveUrl(target: string, index: string): string {
	return new URL(target, index).toString();
}

export function parseIndex(raw: unknown, indexUrl: string): RegistryIndex {
	const source = record(raw);
	const entries: RegistryEntry[] = [];
	for (const item of Array.isArray(source.extensions) ? source.extensions.slice(0, 2000) : []) {
		const entry = record(item);
		const id = text(entry.id, 100);
		const version = text(entry.version, 20);
		// kalem-locale-ok: hex digits
		const sha256 = text(entry.sha256, 64).toLowerCase();
		const url = text(entry.url, 1000);
		if (
			!ID.test(id) ||
			parseVersion(version) === null ||
			!/^[0-9a-f]{64}$/.test(sha256) ||
			url === ""
		)
			continue;
		let resolved: string;
		try {
			resolved = resolveUrl(url, indexUrl);
		} catch {
			continue;
		}
		if (!/^https?:/i.test(resolved)) continue;
		const permissions = record(entry.permissions);
		const strings = (value: unknown): string[] =>
			Array.isArray(value)
				? value.filter((each): each is string => typeof each === "string").slice(0, 50)
				: [];
		entries.push({
			id,
			name: text(entry.name, 60) || id,
			version,
			description: text(entry.description, 500),
			publisher: text(entry.publisher, 80) || (id.split(".")[0] as string),
			engine: text(entry.engine, 60) || "*",
			permissions: {
				...NO_PERMISSIONS,
				http: strings(permissions.http),
				httpFromSettings: strings(permissions.httpFromSettings),
				assistantTools: permissions.assistantTools === true,
				process: permissions.process === true,
				files: permissions.files === true,
			},
			url: resolved,
			sha256,
			size: typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : 0,
			homepage: /^https?:\/\//i.test(text(entry.homepage, 500)) ? text(entry.homepage, 500) : "",
			icon:
				typeof entry.icon === "string" &&
				entry.icon.length <= MAX_ICON_CHARS &&
				/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/=]+$/.test(entry.icon)
					? entry.icon
					: "",
		});
	}
	const blocked: BlockedEntry[] = [];
	for (const item of Array.isArray(source.blocked) ? source.blocked.slice(0, 500) : []) {
		const entry = record(item);
		const id = text(entry.id, 100);
		if (!ID.test(id)) continue;
		blocked.push({
			id,
			versions: text(entry.versions, 60) || "*",
			reason: text(entry.reason, 300),
		});
	}
	return { name: text(source.name, 60), entries, blocked };
}

/** The newest version of each extension that runs on this Kalem. */
export function latestCompatible(index: RegistryIndex, appVersion: string): RegistryEntry[] {
	const best = new Map<string, RegistryEntry>();
	for (const entry of index.entries) {
		if (
			!satisfies(appVersion, entry.engine) ||
			blockedReason(index, entry.id, entry.version) !== null
		)
			continue;
		const known = best.get(entry.id);
		if (known === undefined || compareVersions(entry.version, known.version) > 0)
			best.set(entry.id, entry);
	}
	return [...best.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Why a version is blocked; `null` when it is not. */
export function blockedReason(index: RegistryIndex, id: string, version: string): string | null {
	const entry = index.blocked.find((each) => each.id === id && satisfies(version, each.versions));
	return entry === undefined ? null : entry.reason || "Blocked by the catalog.";
}
