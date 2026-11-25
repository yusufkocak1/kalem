/**
 * Kalem extensions: what a package's `manifest.json` may say, and checking
 * it. Pure.
 */

export const EXTENSION_FILE_EXTENSION = ".kalem-ext";
export const MANIFEST_FILE = "manifest.json";
export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PACKAGE_FILES = 500;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}(?:\.[a-z0-9][a-z0-9-]{0,39}){1,2}$/;
const NAME_PATTERN = /^[a-z][a-zA-Z0-9-]{0,39}$/;
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const HOST_PATTERN =
	/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

export const SETTING_TYPES = ["string", "number", "boolean"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];
export type SettingValue = string | number | boolean;

export interface ExtensionSetting {
	readonly key: string;
	readonly type: SettingType;
	readonly title: string;
	readonly description: string;
	readonly default: SettingValue;
}

export interface ExtensionSecret {
	readonly key: string;
	readonly title: string;
	readonly description: string;
}

export interface ExtensionCommand {
	readonly id: string;
	readonly title: string;
}

export interface ExtensionPane {
	readonly id: string;
	readonly title: string;
}

export interface ExtensionPermissions {
	readonly http: readonly string[];
	readonly assistantTools: boolean;
	readonly process: boolean;
}

export interface ExtensionManifest {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly description: string;
	readonly publisher: string;
	readonly engine: string;
	readonly host: string | null;
	readonly ui: string | null;
	readonly permissions: ExtensionPermissions;
	readonly commands: readonly ExtensionCommand[];
	readonly settings: readonly ExtensionSetting[];
	readonly secrets: readonly ExtensionSecret[];
	readonly panes: readonly ExtensionPane[];
}

export type ManifestResult =
	| { readonly ok: true; readonly manifest: ExtensionManifest }
	| { readonly ok: false; readonly error: string };

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

const list = (raw: unknown): readonly unknown[] => (Array.isArray(raw) ? raw : []);

const text = (raw: unknown, max: number): string =>
	typeof raw === "string" ? raw.trim().slice(0, max) : "";

export function parseVersion(version: string): readonly [number, number, number] | null {
	const match = VERSION_PATTERN.exec(version.trim());
	if (match === null) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a) ?? [0, 0, 0];
	const right = parseVersion(b) ?? [0, 0, 0];
	for (let i = 0; i < 3; i++) {
		const diff = (left[i] as number) - (right[i] as number);
		if (diff !== 0) return Math.sign(diff);
	}
	return 0;
}

/** `*`, `1.2.3`, `>=1.2.3`, `^1.2.3`, `~1.2.3`, or several joined by spaces (all must hold). */
export function isValidRange(range: string): boolean {
	const parts = range.trim().split(/\s+/);
	return parts.every(
		(part) => part === "*" || parseVersion(part.replace(/^(?:>=|<=|>|<|\^|~|=)/, "")) !== null,
	);
}

export function satisfies(version: string, range: string): boolean {
	const current = parseVersion(version);
	if (current === null || !isValidRange(range)) return false;
	return range
		.trim()
		.split(/\s+/)
		.every((part) => {
			if (part === "*") return true;
			const operator = /^(>=|<=|>|<|\^|~|=)?/.exec(part)?.[1] ?? "=";
			const wanted = part.slice(operator === "=" && !part.startsWith("=") ? 0 : operator.length);
			const base = parseVersion(wanted) as readonly [number, number, number];
			const cmp = compareVersions(version, wanted);
			switch (operator) {
				case ">=":
					return cmp >= 0;
				case "<=":
					return cmp <= 0;
				case ">":
					return cmp > 0;
				case "<":
					return cmp < 0;
				case "^":
					return (
						cmp >= 0 &&
						(base[0] === 0 ? current[0] === 0 && current[1] === base[1] : current[0] === base[0])
					);
				case "~":
					return cmp >= 0 && current[0] === base[0] && current[1] === base[1];
				default:
					return cmp === 0;
			}
		});
}

/** A path inside the package: relative, forward slashes, no `..`. */
export function safeEntryPath(path: string): string | null {
	const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
	if (normalized === "" || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
	const parts = normalized.split("/");
	if (parts.some((part) => part === ".." || part === "." || part.includes("\0"))) return null;
	return normalized;
}

export const isToolName = (name: string): boolean => TOOL_NAME_PATTERN.test(name);

function parseSettingValue(type: SettingType, raw: unknown): SettingValue {
	if (type === "number") return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
	if (type === "boolean") return raw === true;
	return typeof raw === "string" ? raw.slice(0, 2000) : "";
}

export function coerceSetting(setting: ExtensionSetting, raw: unknown): SettingValue {
	if (setting.type === "number") {
		const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
		return typeof value === "number" && Number.isFinite(value) ? value : setting.default;
	}
	if (setting.type === "boolean") return typeof raw === "boolean" ? raw : setting.default;
	return typeof raw === "string" ? raw.slice(0, 2000) : setting.default;
}

function named<T extends { readonly key?: string; readonly id?: string }>(
	raw: unknown,
	max: number,
	parse: (item: Record<string, unknown>) => T | null,
): T[] {
	const seen = new Set<string>();
	const found: T[] = [];
	for (const item of list(raw).slice(0, max)) {
		const parsed = parse(record(item));
		if (parsed === null) continue;
		const name = parsed.key ?? parsed.id ?? "";
		if (seen.has(name)) continue;
		seen.add(name);
		found.push(parsed);
	}
	return found;
}

export function parseManifest(raw: unknown): ManifestResult {
	const source = record(raw);
	// kalem-locale-ok: ASCII protocol values
	const id = text(source.id, 100).toLowerCase();
	if (!ID_PATTERN.test(id)) {
		return {
			ok: false,
			error: `"id" must look like "publisher.name" (lower case): ${JSON.stringify(source.id)}`,
		};
	}
	const name = text(source.name, 60);
	if (name === "") return { ok: false, error: `"name" is missing.` };
	const version = text(source.version, 20);
	if (parseVersion(version) === null)
		return { ok: false, error: `"version" must be x.y.z: ${JSON.stringify(source.version)}` };
	const engines = record(source.engines);
	const engine = text(engines.kalem, 60) || "*";
	if (!isValidRange(engine))
		return { ok: false, error: `"engines.kalem" is not a version range: ${engine}` };

	const entry = (key: "host" | "ui"): string | null | undefined => {
		if (source[key] === undefined) return null;
		const path = typeof source[key] === "string" ? safeEntryPath(source[key] as string) : null;
		return path ?? undefined;
	};
	const host = entry("host");
	if (host === undefined) return { ok: false, error: `"host" must be a file in the package.` };
	const ui = entry("ui");
	if (ui === undefined) return { ok: false, error: `"ui" must be a file in the package.` };

	const permissions = record(source.permissions);
	const http: string[] = [];
	for (const item of list(permissions.http).slice(0, 50)) {
		// kalem-locale-ok: ASCII protocol values
		const value = typeof item === "string" ? item.trim().toLowerCase() : "";
		if (!HOST_PATTERN.test(value))
			return { ok: false, error: `"permissions.http" has a bad host: ${JSON.stringify(item)}` };
		if (!http.includes(value)) http.push(value);
	}

	const contributes = record(source.contributes);
	const commands = named(contributes.commands, 50, (item): ExtensionCommand | null => {
		const commandId = text(item.id, 40);
		const title = text(item.title, 80);
		return NAME_PATTERN.test(commandId) && title !== "" ? { id: commandId, title } : null;
	});
	const settings = named(contributes.settings, 50, (item): ExtensionSetting | null => {
		const key = text(item.key, 40);
		const type = SETTING_TYPES.find((known) => known === item.type) ?? "string";
		const title = text(item.title, 80) || key;
		if (!NAME_PATTERN.test(key)) return null;
		return {
			key,
			type,
			title,
			description: text(item.description, 300),
			default: parseSettingValue(type, item.default),
		};
	});
	const secrets = named(contributes.secrets, 20, (item): ExtensionSecret | null => {
		const key = text(item.key, 40);
		return NAME_PATTERN.test(key)
			? { key, title: text(item.title, 80) || key, description: text(item.description, 300) }
			: null;
	});
	const panes = named(contributes.panes, 5, (item): ExtensionPane | null => {
		const paneId = text(item.id, 40);
		const title = text(item.title, 40);
		return NAME_PATTERN.test(paneId) && title !== "" ? { id: paneId, title } : null;
	});
	if (panes.length > 0 && ui === null) return { ok: false, error: `A pane needs a "ui" file.` };
	if (commands.length > 0 && host === null)
		return { ok: false, error: `A command needs a "host" file.` };

	return {
		ok: true,
		manifest: {
			id,
			name,
			version,
			description: text(source.description, 500),
			publisher: text(source.publisher, 80) || (id.split(".")[0] as string),
			engine,
			host,
			ui,
			permissions: {
				http,
				assistantTools: permissions.assistantTools === true,
				process: permissions.process === true,
			},
			commands,
			settings,
			secrets,
			panes,
		},
	};
}

/** Whether the extension may reach `url`: http(s) to a host it was allowed, on its port if one was named. */
export function isAllowedUrl(url: string, hosts: readonly string[]): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
	if (parsed.username !== "" || parsed.password !== "") return false;
	// kalem-locale-ok: ASCII protocol values
	const hostname = parsed.hostname.toLowerCase();
	return hosts.some((allowed) => {
		const [pattern, port] = allowed.split(":") as [string, string | undefined];
		if (port !== undefined && parsed.port !== port) return false;
		if (pattern.startsWith("*.")) {
			const suffix = pattern.slice(1);
			return hostname.endsWith(suffix) && hostname.length > suffix.length;
		}
		return hostname === pattern;
	});
}

/** Whether the permissions of `next` ask for anything `granted` did not. */
export function asksForMore(granted: ExtensionPermissions, next: ExtensionPermissions): boolean {
	return (
		(next.assistantTools && !granted.assistantTools) ||
		(next.process && !granted.process) ||
		next.http.some((host) => !granted.http.includes(host))
	);
}

export const NO_PERMISSIONS: ExtensionPermissions = {
	http: [],
	assistantTools: false,
	process: false,
};
