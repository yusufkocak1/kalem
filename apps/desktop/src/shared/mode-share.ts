/**
 * An assistant mode shared as a file, so that someone else gets the same
 * mode by importing it: one of the user's own, or one of Kalem's as the
 * user shaped it, with the MCP servers it uses. What looks like a secret
 * (a token, a password, a key) is left out of the file: its place says
 * what to fill in, as the ready-made servers do (`<GITHUB_TOKEN>`). Pure.
 */
import type { CustomMode } from "./custom-modes.js";
import { parseCustomModes } from "./custom-modes.js";
import type { McpServer } from "./mcp-servers.js";
import { MAX_SERVERS, parseMcpServers, serversNamed } from "./mcp-servers.js";
import type { Mode, ModeSettings, StoredMode } from "./mode-config.js";
import { isMode, parseModeSettings, resolveMode } from "./mode-config.js";

export const MODE_FILE_KIND = "kalem-assistant-mode";
export const MODE_FILE_VERSION = 1;
/** The end of a mode file's name. */
export const MODE_FILE_EXTENSION = ".kalem-mode.json";
/** At most this many modes of the user's (as the settings keep them). */
export const MAX_CUSTOM_MODES = 30;

/** A mode as its file holds it. */
export interface ModeFile {
	readonly kind: typeof MODE_FILE_KIND;
	readonly version: number;
	/** One of the user's modes, without its id (it gets one where it is imported) and always on. */
	readonly custom?: Omit<CustomMode, "id" | "enabled">;
	/** One of Kalem's modes as the user shaped it: only what differs from Kalem's defaults. */
	readonly kalem?: { readonly mode: Mode; readonly settings: StoredMode };
	/** The assistant's MCP servers the mode uses, secrets left out. */
	readonly servers: readonly McpServer[];
}

/** The settings a mode is shared from and imported into. */
export interface ModeSettingsPart {
	readonly assistantModes: ModeSettings;
	readonly assistantCustomModes: readonly CustomMode[];
	readonly assistantMcpServers: readonly McpServer[];
}

/** Names that hold a secret: their values are not written to a file. */
const SECRET = /token|secret|passw|pwd|api[-_]?key|apikey|auth|credential|cookie|session|bearer/i;
/** A value already left to fill in. */
const PLACEHOLDER = /^<[^<>]{1,80}>$/;
/** The places to fill in, in a server's values. */
const PLACEHOLDERS = /<[^<>\n]{1,80}>/g;

const hidden = (name: string, value: string): string =>
	value === "" || PLACEHOLDER.test(value) ? value : `<${name}>`;

function withoutSecrets(record: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [
			key,
			SECRET.test(key) ? hidden(key, value) : value,
		]),
	);
}

/** Arguments with a secret left out: `--token=…`, and the value after `--api-key`. */
function argsWithoutSecrets(args: readonly string[]): string[] {
	return args.map((arg, index) => {
		const flag = /^(--?[\w-]+)=(.*)$/.exec(arg);
		if (flag !== null && SECRET.test(flag[1] as string)) {
			const name = (flag[1] as string).replace(/^-+/, "");
			return `${flag[1]}=${hidden(name, flag[2] as string)}`;
		}
		const before = args[index - 1];
		if (before !== undefined && /^--?[\w-]+$/.test(before) && SECRET.test(before)) {
			return hidden(before.replace(/^-+/, ""), arg);
		}
		return arg;
	});
}

/** An address with a secret in its query (`?api_key=…`) left out. */
const urlWithoutSecret = (url: string): string =>
	url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (whole, mark: string, key: string, value: string) =>
		SECRET.test(key) ? `${mark}${key}=${hidden(key, value)}` : whole,
	);

/** A server as it goes in a file: on, with what looks like a secret left to fill in. */
export function shareableServer(server: McpServer): McpServer {
	return {
		...server,
		args: argsWithoutSecrets(server.args),
		env: withoutSecrets(server.env),
		url: urlWithoutSecret(server.url),
		headers: withoutSecrets(server.headers),
		enabled: true,
	};
}

/** What is left to fill in in servers: `<GITHUB_TOKEN>` and the like, each once. */
export function toFillIn(servers: readonly McpServer[]): string[] {
	const found = servers.flatMap((server) =>
		[...server.args, ...Object.values(server.env), server.url, ...Object.values(server.headers)]
			.flatMap((value) => value.match(PLACEHOLDERS) ?? [])
			.map((place) => `${server.name}: ${place}`),
	);
	return [...new Set(found)];
}

/** One of the user's modes as a file. */
export function exportCustomMode(mode: CustomMode, servers: readonly McpServer[]): ModeFile {
	const { id: _id, enabled: _enabled, ...custom } = mode;
	return {
		kind: MODE_FILE_KIND,
		version: MODE_FILE_VERSION,
		custom,
		servers: serversNamed(mode.mcp, servers).map(shareableServer),
	};
}

/** One of Kalem's modes, as the user shaped it, as a file. */
export function exportKalemMode(mode: Mode, settings: ModeSettingsPart): ModeFile {
	const used = resolveMode(mode, settings.assistantModes).mcp;
	return {
		kind: MODE_FILE_KIND,
		version: MODE_FILE_VERSION,
		kalem: { mode, settings: settings.assistantModes[mode] ?? {} },
		servers: serversNamed(used, settings.assistantMcpServers).map(shareableServer),
	};
}

/** A file's name for a mode: its name, without what file names may not hold. */
export function modeFileName(name: string): string {
	const safe = [...name]
		// What file names may not hold, and control characters.
		.map((char) => (/[\\/:*?"<>|]/.test(char) || char.charCodeAt(0) < 32 ? " " : char))
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
	return `${safe === "" ? "mode" : safe}${MODE_FILE_EXTENSION}`;
}

/** Why a file could not be read as a mode. */
export type ModeFileError = "json" | "kind" | "newer" | "empty";

/** A mode file read and validated: anything it holds that a mode cannot have is dropped. */
export function parseModeFile(
	text: string,
):
	| { readonly ok: true; readonly file: ModeFile }
	| { readonly ok: false; readonly error: ModeFileError } {
	let raw: unknown;
	try {
		raw = JSON.parse(text.replace(/^﻿/, ""));
	} catch {
		return { ok: false, error: "json" };
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, error: "kind" };
	}
	const file = raw as Record<string, unknown>;
	if (file.kind !== MODE_FILE_KIND) return { ok: false, error: "kind" };
	if (typeof file.version === "number" && file.version > MODE_FILE_VERSION) {
		return { ok: false, error: "newer" };
	}
	const servers = parseMcpServers(file.servers).map((server) => ({ ...server, enabled: true }));
	const custom =
		typeof file.custom === "object" && file.custom !== null
			? parseCustomModes([{ ...(file.custom as object), id: "custom-1", enabled: true }])[0]
			: undefined;
	if (custom !== undefined) {
		const { id: _id, enabled: _enabled, ...mode } = custom;
		return {
			ok: true,
			file: { kind: MODE_FILE_KIND, version: MODE_FILE_VERSION, custom: mode, servers },
		};
	}
	const kalem = file.kalem as { mode?: unknown; settings?: unknown } | null | undefined;
	if (typeof kalem === "object" && kalem !== null && isMode(kalem.mode)) {
		const settings = parseModeSettings({ [kalem.mode]: kalem.settings ?? {} })[kalem.mode] ?? {};
		return {
			ok: true,
			file: {
				kind: MODE_FILE_KIND,
				version: MODE_FILE_VERSION,
				kalem: { mode: kalem.mode, settings },
				servers,
			},
		};
	}
	return { ok: false, error: "empty" };
}

/** How the servers a file brings stand against the user's: new ones, and ones the user has by name. */
export function serversOf(
	file: ModeFile,
	have: readonly McpServer[],
): { readonly added: readonly McpServer[]; readonly kept: readonly McpServer[] } {
	const names = new Set(have.map((server) => server.name));
	return {
		added: file.servers.filter((server) => !names.has(server.name)),
		kept: file.servers.filter((server) => names.has(server.name)),
	};
}

/** The user's mode of the same name as the file's, if there is one. */
export function sameNamed(file: ModeFile, modes: readonly CustomMode[]): CustomMode | undefined {
	const name = file.custom?.name.trim().toLocaleLowerCase("tr");
	return name === undefined
		? undefined
		: modes.find((mode) => mode.name.trim().toLocaleLowerCase("tr") === name);
}

/** What an import changes, and where the mode went. */
export interface ModeImport {
	readonly patch: Partial<ModeSettingsPart>;
	/** The user's mode it became, or Kalem's mode it reshaped. */
	readonly custom?: string;
	readonly kalem?: Mode;
	/** The servers it added (the user's own of the same name are kept and used). */
	readonly added: readonly string[];
}

/**
 * Brings a mode file into the settings: a mode of its own is added (named
 * apart from the user's, or in place of the one of its name with
 * `replace`); one of Kalem's takes the place of how the user's is set up.
 * With `servers`, the servers it uses that the user has none of by name
 * are added. `null` when the user has as many modes as can be kept.
 */
export function importMode(
	file: ModeFile,
	settings: ModeSettingsPart,
	options: { readonly servers: boolean; readonly replace: boolean },
): ModeImport | null {
	const { added } = serversOf(file, settings.assistantMcpServers);
	const room = Math.max(0, MAX_SERVERS - settings.assistantMcpServers.length);
	const adding = options.servers ? added.slice(0, room) : [];
	const servers =
		adding.length === 0
			? {}
			: { assistantMcpServers: [...settings.assistantMcpServers, ...adding] };
	const names = adding.map((server) => server.name);
	if (file.kalem !== undefined) {
		return {
			patch: {
				assistantModes: { ...settings.assistantModes, [file.kalem.mode]: file.kalem.settings },
				...servers,
			},
			kalem: file.kalem.mode,
			added: names,
		};
	}
	const custom = file.custom;
	if (custom === undefined) return null;
	const modes = settings.assistantCustomModes;
	const same = options.replace ? sameNamed(file, modes) : undefined;
	if (same !== undefined) {
		return {
			patch: {
				assistantCustomModes: modes.map((mode) =>
					mode.id === same.id ? { ...custom, id: same.id, enabled: true } : mode,
				),
				...servers,
			},
			custom: same.id,
			added: names,
		};
	}
	if (modes.length >= MAX_CUSTOM_MODES) return null;
	const ids = new Set(modes.map((mode) => mode.id));
	let n = modes.length + 1;
	while (ids.has(`custom-${n}`)) n++;
	const taken = new Set(modes.map((mode) => mode.name.trim().toLocaleLowerCase("tr")));
	let name = custom.name;
	for (let k = 2; taken.has(name.trim().toLocaleLowerCase("tr")); k++) {
		name = `${custom.name.slice(0, 72)} (${k})`;
	}
	const id = `custom-${n}`;
	return {
		patch: {
			assistantCustomModes: [...modes, { ...custom, name, id, enabled: true }],
			...servers,
		},
		custom: id,
		added: names,
	};
}
