/**
 * Installed extensions on disk: their files, whether each is on, the
 * permissions the user granted, their settings and (encrypted) secrets.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import type {
	ExtensionManifest,
	ExtensionPermissions,
	SettingValue,
} from "../shared/extensions.js";
import {
	coerceSetting,
	MANIFEST_FILE,
	MAX_PACKAGE_BYTES,
	MAX_PACKAGE_FILES,
	parseManifest,
	safeEntryPath,
	satisfies,
} from "../shared/extensions.js";
import type { SecretBox } from "./confluence-store.js";

export type ExtensionSource = "file" | "registry";

export interface InstalledExtension {
	readonly manifest: ExtensionManifest;
	readonly enabled: boolean;
	readonly source: ExtensionSource;
	readonly granted: ExtensionPermissions;
	readonly installedAt: number;
	/** The catalog it came from (its index's address). */
	readonly registry: string | null;
	/** Why its catalog blocked it; it stays off while this is set. */
	readonly blocked: string | null;
}

interface StoredEntry {
	enabled: boolean;
	source: ExtensionSource;
	registry: string | null;
	blocked: string | null;
	granted: ExtensionPermissions;
	installedAt: number;
	settings: Record<string, SettingValue>;
}

/** A package read and checked, waiting for the user to allow it. */
export interface InspectedPackage {
	readonly token: string;
	readonly manifest: ExtensionManifest;
	readonly files: ReadonlyMap<string, Uint8Array>;
}

export class ExtensionPackageError extends Error {}

export async function readPackage(
	bytes: Uint8Array,
	appVersion: string,
): Promise<InspectedPackage> {
	if (bytes.byteLength > MAX_PACKAGE_BYTES)
		throw new ExtensionPackageError("The package is too large.");
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(bytes);
	} catch {
		throw new ExtensionPackageError("The file is not an extension package (zip).");
	}
	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	if (entries.length > MAX_PACKAGE_FILES)
		throw new ExtensionPackageError("The package has too many files.");

	const manifestEntry = entries.find(
		(entry) => /(?:^|\/)manifest\.json$/.test(entry.name) && entry.name.split("/").length <= 2,
	);
	if (manifestEntry === undefined)
		throw new ExtensionPackageError(`The package has no ${MANIFEST_FILE}.`);
	const root = manifestEntry.name.slice(0, -MANIFEST_FILE.length);

	const files = new Map<string, Uint8Array>();
	let total = 0;
	for (const entry of entries) {
		if (!entry.name.startsWith(root)) continue;
		const path = safeEntryPath(entry.name.slice(root.length));
		if (path === null)
			throw new ExtensionPackageError(`A file of the package is outside it: ${entry.name}`);
		const data = await entry.async("uint8array");
		total += data.byteLength;
		if (total > MAX_PACKAGE_BYTES * 3)
			throw new ExtensionPackageError("The package is too large unpacked.");
		files.set(path, data);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(files.get(MANIFEST_FILE)));
	} catch {
		throw new ExtensionPackageError(`${MANIFEST_FILE} is not valid JSON.`);
	}
	const parsed = parseManifest(raw);
	if (!parsed.ok) throw new ExtensionPackageError(parsed.error);
	const { manifest } = parsed;
	for (const entry of [manifest.host, manifest.ui, manifest.icon]) {
		if (entry !== null && !files.has(entry))
			throw new ExtensionPackageError(`${entry} is not in the package.`);
	}
	if (!satisfies(appVersion, manifest.engine)) {
		throw new ExtensionPackageError(`It needs Kalem ${manifest.engine}; this is ${appVersion}.`);
	}
	return { token: randomUUID(), manifest, files };
}

export class ExtensionStore {
	readonly #root: string;
	readonly #box: SecretBox;
	#state: Record<string, StoredEntry> | null = null;
	#manifests = new Map<string, ExtensionManifest>();
	#secrets: Record<string, Record<string, string>> | null = null;
	readonly #memorySecrets = new Map<string, string>();

	constructor(root: string, box: SecretBox) {
		this.#root = root;
		this.#box = box;
	}

	get root(): string {
		return this.#root;
	}

	folderOf(id: string): string {
		return join(this.#root, "packages", id);
	}

	async list(): Promise<InstalledExtension[]> {
		const state = await this.#load();
		const found: InstalledExtension[] = [];
		for (const [id, entry] of Object.entries(state)) {
			const manifest = await this.#manifest(id);
			if (manifest === null) continue;
			found.push({
				manifest,
				enabled: entry.enabled,
				source: entry.source,
				granted: entry.granted,
				installedAt: entry.installedAt,
				registry: entry.registry,
				blocked: entry.blocked,
			});
		}
		return found.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, "tr"));
	}

	async get(id: string): Promise<InstalledExtension | null> {
		return (await this.list()).find((extension) => extension.manifest.id === id) ?? null;
	}

	async install(
		pkg: InspectedPackage,
		source: ExtensionSource,
		registry: string | null = null,
	): Promise<InstalledExtension> {
		const { manifest } = pkg;
		const folder = this.folderOf(manifest.id);
		const staging = `${folder}.new-${pkg.token}`;
		await rm(staging, { recursive: true, force: true });
		for (const [path, data] of pkg.files) {
			const target = join(staging, ...path.split("/"));
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, data);
		}
		await rm(folder, { recursive: true, force: true });
		await mkdir(dirname(folder), { recursive: true });
		await rename(staging, folder);

		const state = await this.#load();
		const previous = state[manifest.id];
		state[manifest.id] = {
			enabled: true,
			source,
			registry: source === "registry" ? registry : null,
			blocked: null,
			granted: manifest.permissions,
			installedAt: Date.now(),
			settings: previous?.settings ?? {},
		};
		this.#manifests.set(manifest.id, manifest);
		await this.#save();
		return (await this.get(manifest.id)) as InstalledExtension;
	}

	async uninstall(id: string): Promise<void> {
		const state = await this.#load();
		delete state[id];
		this.#manifests.delete(id);
		await this.#save();
		await rm(this.folderOf(id), { recursive: true, force: true });
		const secrets = await this.#loadSecrets();
		if (secrets[id] !== undefined) {
			delete secrets[id];
			await this.#saveSecrets();
		}
		for (const key of [...this.#memorySecrets.keys()]) {
			if (key.startsWith(`${id}\n`)) this.#memorySecrets.delete(key);
		}
	}

	/** Marks it blocked by its catalog (and turns it off), or not. */
	async setBlocked(id: string, reason: string | null): Promise<void> {
		const entry = (await this.#load())[id];
		if (entry === undefined || entry.blocked === reason) return;
		entry.blocked = reason;
		if (reason !== null) entry.enabled = false;
		await this.#save();
	}

	async setEnabled(id: string, enabled: boolean): Promise<void> {
		const state = await this.#load();
		const entry = state[id];
		if (entry === undefined) return;
		if (enabled && entry.blocked !== null)
			throw new Error(`It was blocked by its catalog: ${entry.blocked}`);
		entry.enabled = enabled;
		await this.#save();
	}

	async settingsOf(id: string): Promise<Record<string, SettingValue>> {
		const manifest = await this.#manifest(id);
		const stored = (await this.#load())[id]?.settings ?? {};
		const values: Record<string, SettingValue> = {};
		for (const setting of manifest?.settings ?? []) {
			values[setting.key] = Object.hasOwn(stored, setting.key)
				? coerceSetting(setting, stored[setting.key])
				: setting.default;
		}
		return values;
	}

	async setSetting(id: string, key: string, value: unknown): Promise<void> {
		const manifest = await this.#manifest(id);
		const setting = manifest?.settings.find((known) => known.key === key);
		const entry = (await this.#load())[id];
		if (setting === undefined || entry === undefined)
			throw new Error(`There is no setting "${key}".`);
		entry.settings[key] = coerceSetting(setting, value);
		await this.#save();
	}

	async secret(id: string, key: string): Promise<string | null> {
		const memory = this.#memorySecrets.get(`${id}\n${key}`);
		if (memory !== undefined) return memory;
		const sealed = (await this.#loadSecrets())[id]?.[key];
		if (sealed === undefined) return null;
		try {
			return this.#box.decrypt(Buffer.from(sealed, "base64"));
		} catch {
			return null;
		}
	}

	async hasSecret(id: string, key: string): Promise<boolean> {
		return (await this.secret(id, key)) !== null;
	}

	/** Keeps a secret encrypted; without OS encryption, only until the app quits. `null` forgets it. */
	async setSecret(id: string, key: string, value: string | null): Promise<void> {
		const manifest = await this.#manifest(id);
		if (!manifest?.secrets.some((known) => known.key === key))
			throw new Error(`There is no secret "${key}".`);
		const secrets = await this.#loadSecrets();
		const own = secrets[id] ?? {};
		this.#memorySecrets.delete(`${id}\n${key}`);
		delete own[key];
		if (value !== null && value !== "") {
			const sealed = this.#box.encrypt(value);
			if (sealed === null) this.#memorySecrets.set(`${id}\n${key}`, value);
			else own[key] = sealed.toString("base64");
		}
		secrets[id] = own;
		await this.#saveSecrets();
	}

	async #manifest(id: string): Promise<ExtensionManifest | null> {
		const known = this.#manifests.get(id);
		if (known !== undefined) return known;
		try {
			const raw = JSON.parse(await readFile(join(this.folderOf(id), MANIFEST_FILE), "utf8"));
			const parsed = parseManifest(raw);
			if (!parsed.ok || parsed.manifest.id !== id) return null;
			this.#manifests.set(id, parsed.manifest);
			return parsed.manifest;
		} catch {
			return null;
		}
	}

	async #load(): Promise<Record<string, StoredEntry>> {
		if (this.#state !== null) return this.#state;
		this.#state = {};
		try {
			const raw = JSON.parse(await readFile(join(this.#root, "state.json"), "utf8")) as Record<
				string,
				unknown
			>;
			for (const [id, value] of Object.entries(raw.extensions ?? {})) {
				const entry = value as Partial<StoredEntry>;
				const granted = entry.granted;
				this.#state[id] = {
					enabled: entry.enabled !== false,
					source: entry.source === "registry" ? "registry" : "file",
					registry: typeof entry.registry === "string" ? entry.registry : null,
					blocked: typeof entry.blocked === "string" ? entry.blocked : null,
					granted: {
						http: Array.isArray(granted?.http)
							? granted.http.filter((host) => typeof host === "string")
							: [],
						httpFromSettings: Array.isArray(granted?.httpFromSettings)
							? granted.httpFromSettings.filter((key) => typeof key === "string")
							: [],
						assistantTools: granted?.assistantTools === true,
						process: granted?.process === true,
						files: granted?.files === true,
					},
					installedAt: typeof entry.installedAt === "number" ? entry.installedAt : 0,
					settings:
						typeof entry.settings === "object" && entry.settings !== null
							? { ...entry.settings }
							: {},
				};
			}
		} catch {
			// No extensions yet.
		}
		return this.#state;
	}

	async #save(): Promise<void> {
		await this.#write("state.json", { extensions: this.#state ?? {} });
	}

	async #loadSecrets(): Promise<Record<string, Record<string, string>>> {
		if (this.#secrets !== null) return this.#secrets;
		try {
			this.#secrets = JSON.parse(await readFile(join(this.#root, "secrets.json"), "utf8"));
		} catch {
			this.#secrets = {};
		}
		return this.#secrets as Record<string, Record<string, string>>;
	}

	async #saveSecrets(): Promise<void> {
		await this.#write("secrets.json", this.#secrets ?? {});
	}

	async #write(name: string, value: unknown): Promise<void> {
		await mkdir(this.#root, { recursive: true });
		const file = join(this.#root, name);
		const temp = `${file}.tmp`;
		await writeFile(temp, JSON.stringify(value, null, 1));
		await rename(temp, file);
	}
}
