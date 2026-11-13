/**
 * Where the assistant's programs (`claude`, `copilot`) may be on this
 * computer. Nothing here starts them: these are the files worth trying,
 * most likely first, and `cli.ts` tries each until one answers.
 *
 * A program is looked for as a person would: where `PATH` says, where its
 * installers put it, in npm's global folders (those of Node's version
 * managers too), inside the editors and apps that bring their own copy, in
 * the `PATH` Windows keeps in the registry, among the running programs and,
 * last, folder by folder. A file dialog cannot stand in for this: where a
 * company's policy hides a drive, the user cannot browse to a program the
 * app itself can read and run.
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type CliProgram = "claude" | "copilot";

type Env = Readonly<Record<string, string | undefined>>;

/** One name in a folder. */
export interface Entry {
	readonly name: string;
	/** A folder itself; a link to one is `link`. */
	readonly directory: boolean;
	readonly file: boolean;
	readonly link: boolean;
}

/** What the search asks the computer; the tests answer with a made-up one. */
export interface Host {
	readonly platform: NodeJS.Platform;
	readonly arch: string;
	readonly env: Env;
	readonly home: string;
	isFile(path: string): Promise<boolean>;
	/** A folder's entries; none when it cannot be read. */
	list(path: string): Promise<readonly Entry[]>;
	/** A text file; null when it cannot be read. */
	read(path: string): Promise<string | null>;
	/** What a program printed; null when it failed. */
	run(command: string, args: readonly string[]): Promise<string | null>;
}

/** This computer. */
export function localHost(): Host {
	return {
		platform: process.platform,
		arch: process.arch,
		env: process.env,
		home: homedir(),
		isFile: async (path) => {
			try {
				return (await stat(path)).isFile();
			} catch {
				return false;
			}
		},
		list: async (path) => {
			try {
				const entries = await readdir(path, { withFileTypes: true });
				return entries.map((entry) => ({
					name: entry.name,
					directory: entry.isDirectory(),
					file: entry.isFile(),
					link: entry.isSymbolicLink(),
				}));
			} catch {
				return [];
			}
		},
		read: (path) => readFile(path, "utf8").catch(() => null),
		run: (command, args) =>
			new Promise((resolve) => {
				execFile(
					command,
					[...args],
					{ timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
					(error, stdout) => resolve(error || typeof stdout !== "string" ? null : stdout),
				);
			}),
	};
}

/** One file worth trying, and the kind of place it is in. */
export interface Place {
	readonly path: string;
	readonly source: PlaceSource;
}

export type PlaceSource =
	| "folders"
	| "npm"
	| "node"
	| "editor"
	| "app"
	| "registry"
	| "shell"
	| "running"
	| "scan";

function pathsOf(platform: NodeJS.Platform): typeof posix {
	return platform === "win32" ? win32 : posix;
}

/** Two paths are the same file: Windows does not tell letters' case apart. */
export function sameKey(path: string, platform: NodeJS.Platform): string {
	// kalem-locale-ok: file-system comparison; the Turkish rule would be wrong here
	return platform === "win32" ? path.toLowerCase() : path;
}

function unique(paths: readonly string[], platform: NodeJS.Platform): string[] {
	const seen = new Set<string>();
	return paths.filter((path) => {
		const key = sameKey(path, platform);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** An environment variable; on Windows whatever the case of its name. */
export function variable(env: Env, name: string, platform: NodeJS.Platform): string {
	const direct = env[name];
	if (direct !== undefined) return direct;
	if (platform !== "win32") return "";
	// kalem-locale-ok: environment variable names are ASCII
	const wanted = name.toUpperCase();
	for (const [key, value] of Object.entries(env)) {
		// kalem-locale-ok: environment variable names are ASCII
		if (key.toUpperCase() === wanted) return value ?? "";
	}
	return "";
}

/** The file names a program goes by: itself, and on Windows npm's link to it. */
export function programNames(program: string, platform: NodeJS.Platform): string[] {
	return platform === "win32" ? [`${program}.exe`, `${program}.cmd`] : [program];
}

/**
 * The user's folders. A company's Windows may call three places home: the
 * profile, and the network drive `HOME` or `HOMEDRIVE` point at.
 */
function homesOf(platform: NodeJS.Platform, env: Env, home: string): string[] {
	const found = [home];
	if (platform === "win32") {
		found.push(variable(env, "USERPROFILE", platform), variable(env, "HOME", platform));
		const drive = variable(env, "HOMEDRIVE", platform);
		const path = variable(env, "HOMEPATH", platform);
		if (drive !== "" && path !== "") found.push(`${drive}${path}`);
	} else found.push(env.HOME ?? "");
	return unique(
		found.filter((dir) => dir !== ""),
		platform,
	);
}

/**
 * The folders a program's file may be in, most likely first: `PATH`, then
 * the places installers and package managers use. A GUI app on macOS does
 * not get the shell's `PATH`, and a running app keeps the `PATH` it was
 * started with, so the other places matter.
 */
export function binFolders(
	program: string,
	platform: NodeJS.Platform,
	env: Env,
	home: string,
): string[] {
	const windows = platform === "win32";
	const paths = pathsOf(platform);
	const value = (name: string): string => variable(env, name, platform);
	const dirs = value("PATH")
		.split(windows ? ";" : ":")
		.map((dir) => dir.trim().replace(/^"(.*)"$/, "$1"))
		.filter((dir) => dir !== "" && paths.isAbsolute(dir));
	const under = (base: string, ...parts: string[]): void => {
		if (base !== "") dirs.push(paths.join(base, ...parts));
	};
	const homes = homesOf(platform, env, home);
	if (windows) {
		for (const dir of homes) {
			under(dir, ".local", "bin");
			under(dir, `.${program}`, "local");
			under(dir, `.${program}`, "local", "node_modules", ".bin");
			under(dir, `.${program}`, "bin");
		}
		under(value("APPDATA"), "npm");
		const local = value("LOCALAPPDATA");
		under(local, "Programs", program);
		// WinGet puts its command-line programs' links here.
		under(local, "Microsoft", "WinGet", "Links");
		under(local, "Programs", "nodejs");
		under(local, "pnpm");
		under(local, "Yarn", "bin");
		under(local, "Volta", "bin");
		under(local, "mise", "shims");
		for (const dir of homes) {
			under(dir, "AppData", "Roaming", "npm");
			under(dir, "AppData", "Local", "pnpm");
			under(dir, ".npm-global");
			under(dir, ".npm-global", "bin");
			under(dir, ".npm-packages");
			under(dir, ".bun", "bin");
			under(dir, ".volta", "bin");
			under(dir, "scoop", "shims");
		}
		// Only where a variable says so: a folder anyone may make is not guessed at.
		under(value("PNPM_HOME"));
		under(value("NPM_CONFIG_PREFIX"));
		under(value("NVM_SYMLINK"));
		under(value("VOLTA_HOME"), "bin");
		under(value("BUN_INSTALL"), "bin");
		under(value("ChocolateyInstall"), "bin");
		under(value("SCOOP"), "shims");
		under(value("SCOOP_GLOBAL"), "shims");
		for (const name of ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]) {
			under(value(name), "nodejs");
		}
	} else {
		for (const dir of homes) {
			under(dir, ".local", "bin");
			under(dir, `.${program}`, "local");
			under(dir, `.${program}`, "local", "node_modules", ".bin");
			under(dir, `.${program}`, "bin");
			under(dir, ".npm-global", "bin");
			under(dir, ".npm-packages", "bin");
			under(dir, ".bun", "bin");
			under(dir, ".volta", "bin");
			under(dir, ".yarn", "bin");
			under(dir, ".local", "share", "pnpm");
			under(dir, "Library", "pnpm");
			under(dir, ".asdf", "shims");
			under(dir, ".local", "share", "mise", "shims");
			under(dir, ".nodenv", "shims");
			under(dir, "n", "bin");
			under(dir, ".nix-profile", "bin");
		}
		under(value("PNPM_HOME"));
		under(value("NPM_CONFIG_PREFIX"), "bin");
		under(value("VOLTA_HOME"), "bin");
		under(value("BUN_INSTALL"), "bin");
		under(value("N_PREFIX"), "bin");
		dirs.push(
			"/opt/homebrew/bin",
			"/usr/local/bin",
			"/usr/bin",
			"/home/linuxbrew/.linuxbrew/bin",
			"/opt/local/bin",
			"/snap/bin",
			"/run/current-system/sw/bin",
		);
	}
	return unique(dirs, platform);
}

/**
 * The files a program may be, most likely first: `PATH`, then the places
 * its installers use. An override is the only place looked at (tests rely
 * on this).
 */
export function cliCandidates(
	program: CliProgram | "npm" | "node",
	platform: NodeJS.Platform,
	env: Env,
	home: string,
): string[] {
	const override =
		program === "claude" ? env.KALEM_CLAUDE : program === "copilot" ? env.KALEM_COPILOT : undefined;
	if (override) return [override];
	const paths = pathsOf(platform);
	const names = programNames(program, platform);
	return binFolders(program, platform, env, home).flatMap((dir) =>
		names.map((name) => paths.join(dir, name)),
	);
}

/** The npm package each CLI is installed from with `npm install -g`. */
export const NPM_PACKAGES: Readonly<Record<CliProgram, string>> = {
	claude: "@anthropic-ai/claude-code",
	copilot: "@github/copilot",
};

/**
 * The folder npm puts global programs' links in, from what `npm root -g`
 * prints: `<prefix>/lib/node_modules` gives `<prefix>/bin`, and on Windows
 * `<prefix>\node_modules` gives `<prefix>`.
 */
export function npmGlobalBin(root: string, platform: NodeJS.Platform): string {
	if (platform === "win32") return root.replace(/[\\/]+$/, "").replace(/[\\/]node_modules$/i, "");
	const prefix = posix.dirname(posix.dirname(root.replace(/\/+$/, "")));
	return posix.join(prefix, "bin");
}

/** The folder npm's global packages are in, for the folder that holds their links. */
function modulesOf(bin: string, platform: NodeJS.Platform): string | null {
	if (platform === "win32") return win32.join(bin, "node_modules");
	return posix.basename(bin) === "bin"
		? posix.join(posix.dirname(bin), "lib", "node_modules")
		: null;
}

/** The script a package's `package.json` runs as `program`, relative to the package. */
export function packageBin(manifest: unknown, program: string): string | null {
	if (typeof manifest !== "object" || manifest === null) return null;
	const bin = (manifest as { bin?: unknown }).bin;
	if (typeof bin === "string") return bin;
	if (typeof bin !== "object" || bin === null) return null;
	const script = (bin as Record<string, unknown>)[program];
	return typeof script === "string" ? script : null;
}

/**
 * The packages that hold a CLI's program built for one kind of computer;
 * npm installs the fitting one next to the CLI's own package. This
 * computer's kind first; the other processor too, for a Node of that kind.
 */
export function nativePackages(
	program: CliProgram,
	platform: NodeJS.Platform,
	arch: string,
): string[] {
	const base = NPM_PACKAGES[program];
	const arches = [arch, ...["x64", "arm64"].filter((other) => other !== arch)];
	if (platform === "win32" || platform === "darwin") {
		return arches.map((cpu) => `${base}-${platform}-${cpu}`);
	}
	return arches.flatMap((cpu) =>
		program === "claude"
			? [`${base}-linux-${cpu}`, `${base}-linux-${cpu}-musl`]
			: [`${base}-linux-${cpu}`, `${base}-linuxmusl-${cpu}`],
	);
}

/**
 * The files in a `node_modules` folder that start the CLI: the program
 * built for this computer (it needs no Node), then what the package itself
 * names. Claude Code's package names `bin/claude.exe`, which the install
 * replaces with that same program; where the install's script did not run
 * it stays a note that says so, and the first one is the only one that works.
 */
export async function packagePrograms(
	program: CliProgram,
	root: string,
	host: Host,
): Promise<string[]> {
	const paths = pathsOf(host.platform);
	const parts = NPM_PACKAGES[program].split("/");
	// One look tells whether anything of the publisher's is here at all.
	if ((await host.list(paths.join(root, parts[0] ?? ""))).length === 0) return [];
	const pkg = paths.join(root, ...parts);
	const exe = host.platform === "win32" ? `${program}.exe` : program;
	const files: string[] = [];
	for (const native of nativePackages(program, host.platform, host.arch)) {
		for (const base of [root, paths.join(pkg, "node_modules")]) {
			files.push(paths.join(base, ...native.split("/"), exe));
		}
	}
	const manifest = await host.read(paths.join(pkg, "package.json"));
	if (manifest !== null) {
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(manifest) as unknown;
		} catch {}
		const bin = packageBin(parsed, program);
		if (bin !== null) files.push(paths.join(pkg, bin));
	}
	const found: string[] = [];
	for (const file of unique(files, host.platform)) {
		if (await host.isFile(file)) found.push(file);
	}
	return found;
}

/** The `prefix` an npm configuration file sets: where global packages go. */
export function npmrcPrefix(
	text: string,
	env: Env,
	home: string,
	platform: NodeJS.Platform,
): string | null {
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*prefix\s*=\s*(.+?)\s*$/.exec(line);
		if (match?.[1] === undefined) continue;
		const value = match[1]
			.replace(/^(["'])(.*)\1$/, "$2")
			.replace(/\$\{([^}]+)\}/g, (_all, name: string) => variable(env, name, platform));
		if (value === "") continue;
		return /^~(?=$|[\\/])/.test(value) ? `${home}${value.slice(1)}` : value;
	}
	return null;
}

/** The folders npm's configuration files send global programs' links to. */
async function npmConfigFolders(host: Host, folders: readonly string[]): Promise<string[]> {
	const { platform, env, home } = host;
	const paths = pathsOf(platform);
	const windows = platform === "win32";
	const files = [
		variable(env, "NPM_CONFIG_USERCONFIG", platform),
		variable(env, "NPM_CONFIG_GLOBALCONFIG", platform),
		...homesOf(platform, env, home).map((dir) => paths.join(dir, ".npmrc")),
	];
	if (windows) {
		// A Node folder's own files: its `etc\npmrc`, and the one npm is shipped with.
		for (const dir of folders) {
			files.push(paths.join(dir, "etc", "npmrc"), paths.join(dir, "node_modules", "npm", "npmrc"));
		}
	} else files.push("/usr/local/etc/npmrc", "/opt/homebrew/etc/npmrc", "/etc/npmrc");
	const found: string[] = [];
	for (const file of unique(
		files.filter((path) => path !== ""),
		platform,
	)) {
		const text = await host.read(file);
		const prefix = text === null ? null : npmrcPrefix(text, env, home, platform);
		if (prefix !== null && paths.isAbsolute(prefix)) {
			found.push(windows ? paths.normalize(prefix) : paths.join(prefix, "bin"));
		}
	}
	return found;
}

/** Orders names that hold version numbers, newest first. */
export function newestFirst(a: string, b: string): number {
	const numbers = (name: string): number[] => (name.match(/\d+/g) ?? []).map(Number);
	const left = numbers(a);
	const right = numbers(b);
	for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
		const difference = (right[i] ?? -1) - (left[i] ?? -1);
		if (difference !== 0) return difference;
	}
	return a < b ? 1 : a > b ? -1 : 0;
}

/** At most this many folders are taken for one `*`: the newest versions. */
const NEWEST = 8;

/**
 * The folders a pattern names: each part a folder's name, with `*` for any
 * run of letters. The folders a `*` finds come newest version first.
 */
async function expand(host: Host, base: string, parts: readonly string[]): Promise<string[]> {
	if (base === "") return [];
	const paths = pathsOf(host.platform);
	let found = [base];
	for (const part of parts) {
		if (!part.includes("*")) {
			found = found.map((dir) => paths.join(dir, part));
			continue;
		}
		const wanted = new RegExp(
			`^${part
				.split("*")
				.map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
				.join(".*")}$`,
			"i",
		);
		const next: string[] = [];
		for (const dir of found) {
			const names = (await host.list(dir))
				.filter((entry) => (entry.directory || entry.link) && wanted.test(entry.name))
				.map((entry) => entry.name)
				.sort(newestFirst);
			for (const name of names.slice(0, NEWEST)) next.push(paths.join(dir, name));
		}
		found = next;
	}
	return found;
}

/** The folders of the Node versions that version managers keep, each with its own global programs. */
async function managerFolders(host: Host): Promise<string[]> {
	const { platform, env, home } = host;
	const paths = pathsOf(platform);
	const value = (name: string): string => variable(env, name, platform);
	const under = (base: string, ...parts: string[]): string =>
		base === "" ? "" : paths.join(base, ...parts);
	const homes = homesOf(platform, env, home);
	const patterns: [string, ...string[]][] = [];
	if (platform === "win32") {
		const roaming = value("APPDATA");
		const local = value("LOCALAPPDATA");
		for (const base of [value("NVM_HOME"), under(roaming, "nvm"), under(local, "nvm")]) {
			patterns.push([base, "v*"]);
		}
		for (const base of [value("FNM_DIR"), under(roaming, "fnm"), under(local, "fnm")]) {
			patterns.push([base, "node-versions", "*", "installation"]);
		}
		for (const base of [value("NVS_HOME"), under(local, "nvs")]) {
			patterns.push([base, "node", "*", "*"]);
		}
		patterns.push([under(local, "Volta"), "tools", "image", "node", "*"]);
		patterns.push([under(local, "mise"), "installs", "node", "*"]);
		for (const dir of [value("SCOOP"), ...homes.map((each) => paths.join(each, "scoop"))]) {
			patterns.push([dir, "apps", "nodejs*", "current"]);
			patterns.push([dir, "apps", "nodejs*", "current", "bin"]);
			patterns.push([dir, "persist", "nodejs*", "bin"]);
		}
	} else {
		for (const dir of homes) {
			patterns.push([paths.join(dir, ".nvm"), "versions", "node", "*", "bin"]);
			for (const fnm of [
				paths.join(dir, ".local", "share", "fnm"),
				paths.join(dir, ".fnm"),
				paths.join(dir, "Library", "Application Support", "fnm"),
			]) {
				patterns.push([fnm, "node-versions", "*", "installation", "bin"]);
			}
			patterns.push([paths.join(dir, ".volta"), "tools", "image", "node", "*", "bin"]);
			patterns.push([paths.join(dir, ".asdf"), "installs", "nodejs", "*", "bin"]);
			patterns.push([paths.join(dir, ".local", "share", "mise"), "installs", "node", "*", "bin"]);
			patterns.push([paths.join(dir, ".nodenv"), "versions", "*", "bin"]);
		}
		patterns.push([value("NVM_DIR"), "versions", "node", "*", "bin"]);
		patterns.push([value("FNM_DIR"), "node-versions", "*", "installation", "bin"]);
		patterns.push(["/usr/local/n", "versions", "node", "*", "bin"]);
	}
	const found: string[] = [];
	for (const [base, ...parts] of patterns) found.push(...(await expand(host, base, parts)));
	return unique(found, platform);
}

/**
 * A folder holds a desktop app, not a command-line program: Chromium's
 * files are next to it. Claude's desktop app is `Claude.exe`, which on
 * Windows is the same name as `claude.exe`; asking it for its version
 * would open its window.
 */
export function isAppFolder(entries: readonly Entry[]): boolean {
	const marks = new Set(["resources.pak", "chrome_100_percent.pak"]);
	// kalem-locale-ok: file names of Chromium, ASCII
	return entries.some((entry) => marks.has(entry.name.toLowerCase()));
}

/** Folders a search folder by folder does not go into, in lower case. */
const SKIPPED = new Set([
	"windows",
	"system volume information",
	"recovery",
	"perflogs",
	"msocache",
	"config.msi",
	"windowsapps",
	"winsxs",
	"temp",
	"tmp",
	"cache",
	"caches",
	"cachestorage",
	"code cache",
	"gpucache",
	"_cacache",
	"npm-cache",
	"crashpad",
	"dropbox",
	"google drive",
	"iclouddrive",
	"pictures",
	"music",
	"videos",
	"movies",
	".git",
	".svn",
	".hg",
	".cache",
	".trash",
]);

/** macOS asks the user before an app reads these; a search is no reason to ask. */
const ASKED_ON_MAC = new Set(["desktop", "documents", "downloads", "library"]);

function skipped(name: string, platform: NodeJS.Platform): boolean {
	// kalem-locale-ok: folder names compared as the file system does
	const lower = name.toLowerCase();
	if (SKIPPED.has(lower) || lower.startsWith("$") || lower.startsWith("onedrive")) return true;
	return platform === "darwin" && (lower.endsWith(".app") || ASKED_ON_MAC.has(lower));
}

/** How far a search folder by folder may still go. */
export class Budget {
	/** The folders already looked into, so none is read twice. */
	readonly seen: Set<string>;
	readonly #now: () => number;
	readonly #until: number;

	/** `ms` milliseconds from now; `seen` carries on from an earlier search. */
	constructor(ms: number, seen: Set<string> = new Set(), now: () => number = Date.now) {
		this.seen = seen;
		this.#now = now;
		this.#until = now() + ms;
	}

	/** False once the time is up. */
	alive(): boolean {
		return this.#now() < this.#until;
	}
}

/** How many folders are read at a time. */
const AT_ONCE = 24;

/**
 * Goes through a folder and the folders in it, `depth` levels down, nearer
 * ones first: the program's own file where it is not a desktop app's, and
 * the CLI's package in every `node_modules` on the way (which is not gone
 * into further). Links to folders are not followed.
 */
export async function* walk(
	program: CliProgram,
	host: Host,
	root: string,
	depth: number,
	budget: Budget,
): AsyncGenerator<string> {
	const paths = pathsOf(host.platform);
	// The program's name as it is written: the desktop apps' begin with a capital.
	const wanted = new Set(programNames(program, host.platform));
	let level = [root];
	for (let at = 0; at <= depth && level.length > 0; at += 1) {
		const next: string[] = [];
		for (let from = 0; from < level.length; from += AT_ONCE) {
			if (!budget.alive()) return;
			const dirs = level.slice(from, from + AT_ONCE).filter((dir) => {
				const key = sameKey(dir, host.platform);
				if (budget.seen.has(key)) return false;
				budget.seen.add(key);
				return true;
			});
			const lists = await Promise.all(dirs.map((dir) => host.list(dir)));
			for (const [index, entries] of lists.entries()) {
				const dir = dirs[index] ?? "";
				const app = isAppFolder(entries);
				for (const entry of entries) {
					if (entry.directory) {
						// kalem-locale-ok: folder name compared as the file system does
						if (entry.name.toLowerCase() === "node_modules") {
							yield* await packagePrograms(program, paths.join(dir, entry.name), host);
						} else if (at < depth && !skipped(entry.name, host.platform)) {
							next.push(paths.join(dir, entry.name));
						}
					} else if (!app && wanted.has(entry.name)) yield paths.join(dir, entry.name);
				}
			}
		}
		level = next;
	}
}

/** The editors built on VS Code keep their extensions in these folders of the user's. */
const EDITOR_HOMES = [
	".vscode",
	".vscode-insiders",
	".vscode-oss",
	".vscode-server",
	".vscode-server-insiders",
	".cursor",
	".cursor-server",
	".windsurf",
	".windsurf-server",
	".antigravity",
	".kiro",
	".trae",
	".positron",
];

/** Their data folders' names, where an extension keeps what it downloads. */
const EDITOR_DATA = ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"];

/** The extensions that bring the CLI with them, and the names of their folders. */
const EXTENSIONS: Readonly<Record<CliProgram, { readonly id: string; readonly folder: RegExp }>> = {
	claude: { id: "anthropic.claude-code", folder: /^anthropic\.claude-code-/i },
	copilot: { id: "github.copilot-chat", folder: /^github\.copilot(-chat)?-/i },
};

/**
 * The CLI an editor's extension brings: Claude Code's VS Code extension
 * holds the whole program, which is why the editor works on a computer
 * where `claude` is on no `PATH`.
 */
async function* editorPrograms(program: CliProgram, host: Host): AsyncGenerator<string> {
	const { platform, env, home } = host;
	const paths = pathsOf(platform);
	const exe = platform === "win32" ? `${program}.exe` : program;
	const homes = homesOf(platform, env, home);
	const stores = [
		variable(env, "VSCODE_EXTENSIONS", platform),
		...homes.flatMap((dir) => EDITOR_HOMES.map((editor) => paths.join(dir, editor, "extensions"))),
	];
	const budget = new Budget(5_000);
	for (const store of unique(
		stores.filter((dir) => dir !== ""),
		platform,
	)) {
		const names = (await host.list(store))
			.filter(
				(entry) => (entry.directory || entry.link) && EXTENSIONS[program].folder.test(entry.name),
			)
			.map((entry) => entry.name)
			.sort(newestFirst);
		for (const name of names.slice(0, 4)) {
			const folder = paths.join(store, name);
			yield paths.join(folder, "resources", "native-binary", exe);
			// Wherever else in the extension a later version may keep it.
			yield* walk(program, host, folder, 3, budget);
		}
	}
	const data =
		platform === "win32"
			? [variable(env, "APPDATA", platform)]
			: platform === "darwin"
				? homes.map((dir) => paths.join(dir, "Library", "Application Support"))
				: [
						variable(env, "XDG_CONFIG_HOME", platform),
						...homes.map((dir) => paths.join(dir, ".config")),
					];
	for (const base of unique(
		data.filter((dir) => dir !== ""),
		platform,
	)) {
		for (const editor of EDITOR_DATA) {
			const kept = paths.join(base, editor, "User", "globalStorage", EXTENSIONS[program].id);
			yield* walk(program, host, kept, 4, budget);
		}
	}
}

/** The copies that apps and installers keep outside any folder on `PATH`. */
async function* appPrograms(program: CliProgram, host: Host): AsyncGenerator<string> {
	const { platform, env, home } = host;
	const paths = pathsOf(platform);
	const windows = platform === "win32";
	const exe = windows ? `${program}.exe` : program;
	const homes = homesOf(platform, env, home);
	const local = variable(env, "LOCALAPPDATA", platform);
	if (program === "claude") {
		// Claude's desktop app downloads Claude Code for itself, one folder a version.
		const kept: [string, ...string[]][] = windows
			? [
					[variable(env, "APPDATA", platform), "Claude", "claude-code", "*"],
					[local, "Packages", "*Claude*", "LocalCache", "Roaming", "Claude", "claude-code", "*"],
				]
			: homes.flatMap((dir): [string, ...string[]][] => [
					[paths.join(dir, "Library", "Application Support", "Claude"), "claude-code", "*"],
					[paths.join(dir, ".config", "Claude"), "claude-code", "*"],
				]);
		for (const [base, ...parts] of kept) {
			for (const dir of await expand(host, base, parts)) yield paths.join(dir, exe);
		}
		// Its own installer keeps each version as one file.
		const shares = [
			variable(env, "XDG_DATA_HOME", platform),
			...homes.map((dir) => paths.join(dir, ".local", "share")),
		];
		for (const share of unique(
			shares.filter((dir) => dir !== ""),
			platform,
		)) {
			const versions = paths.join(share, "claude", "versions");
			const names = (await host.list(versions))
				.filter((entry) => entry.file || entry.link)
				.map((entry) => entry.name)
				.sort(newestFirst);
			for (const name of names.slice(0, 4)) yield paths.join(versions, name);
		}
	}
	if (windows && local !== "") {
		// WinGet's own folder of the package, where its link is missing.
		const budget = new Budget(3_000);
		const packages = paths.join(local, "Microsoft", "WinGet", "Packages");
		for (const dir of await expand(host, packages, [`*${program}*`])) {
			yield* walk(program, host, dir, 2, budget);
		}
	}
}

/** The values of text kind that `reg query` printed for a key, by name. */
export function registryValues(output: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of output.split(/\r?\n/)) {
		const match = /^\s+(\S.*?)\s+REG_(?:EXPAND_)?SZ(?:\s+(.*))?$/.exec(line);
		if (match?.[1] !== undefined) values[match[1]] = (match[2] ?? "").trim();
	}
	return values;
}

/**
 * The environment as Windows keeps it for new programs: the computer's
 * variables, then the user's, and both `Path`s joined. Names are in upper
 * case. `%NAME%` inside a value is filled in.
 */
export function registryEnvironment(
	machine: Readonly<Record<string, string>>,
	user: Readonly<Record<string, string>>,
	env: Env,
): Record<string, string> {
	const merged: Record<string, string> = {};
	// kalem-locale-ok: environment variable names are ASCII
	const upper = (name: string): string => name.toUpperCase();
	for (const [name, value] of Object.entries(env)) {
		if (value !== undefined) merged[upper(name)] = value;
	}
	const path: string[] = [];
	for (const values of [machine, user]) {
		for (const [name, value] of Object.entries(values)) {
			if (upper(name) === "PATH") path.push(value);
			else merged[upper(name)] = value;
		}
	}
	if (path.length > 0) merged.PATH = path.join(";");
	// A value may name another that names a third.
	for (let round = 0; round < 3; round += 1) {
		for (const [name, value] of Object.entries(merged)) {
			merged[name] = value.replace(/%([^%;\\/]+)%/g, (all, inner: string) => {
				const found = merged[upper(inner)];
				return found === undefined || upper(inner) === name ? all : found;
			});
		}
	}
	return merged;
}

function systemProgram(host: Host, ...parts: string[]): string {
	const root = variable(host.env, "SystemRoot", "win32") || "C:\\Windows";
	return win32.join(root, "System32", ...parts);
}

/**
 * The environment the registry holds, or null when it cannot be asked. A
 * running app keeps the `PATH` it was started with; one installed since is
 * only here. (`reg` prints in the console's code page, so a folder named
 * with other letters than English's may come out wrong; it is then simply
 * not found.)
 */
async function freshEnvironment(host: Host): Promise<Env | null> {
	const reg = systemProgram(host, "reg.exe");
	const machine = await host.run(reg, [
		"query",
		"HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
	]);
	const user = await host.run(reg, ["query", "HKCU\\Environment"]);
	if (machine === null && user === null) return null;
	return registryEnvironment(registryValues(machine ?? ""), registryValues(user ?? ""), host.env);
}

function powershell(host: Host, script: string): Promise<string | null> {
	const shell = systemProgram(host, "WindowsPowerShell", "v1.0", "powershell.exe");
	return host.run(shell, ["-NoProfile", "-NonInteractive", "-Command", script]);
}

/** The text of lines of character codes, as the scripts below print paths. */
export function fromCodes(output: string): string[] {
	const found: string[] = [];
	for (const line of output.split(/\r?\n/)) {
		const codes = line.trim().split(/\s+/).map(Number);
		if (line.trim() === "" || codes.some((code) => !Number.isInteger(code) || code < 1)) continue;
		found.push(String.fromCharCode(...codes));
	}
	return found;
}

/**
 * The program's file among the running programs of this user's session: a
 * CLI the editor has open is running from where it is installed. Paths are
 * printed as character codes, so the console's code page cannot spoil a
 * folder's name; the script keeps to what PowerShell's constrained mode
 * allows.
 */
async function runningPrograms(program: CliProgram, host: Host): Promise<string[]> {
	const output = await powershell(
		host,
		[
			"$ErrorActionPreference = 'SilentlyContinue'",
			"$session = (Get-Process -Id $PID).SessionId",
			`Get-Process -Name ${program} | Where-Object { $_.SessionId -eq $session -and $_.Path } | ForEach-Object { ($_.Path.ToCharArray() | ForEach-Object { [int]$_ }) -join ' ' }`,
		].join("; "),
	);
	if (output === null) return [];
	// Its name as written: `Claude.exe` is the desktop app.
	return unique(
		fromCodes(output).filter(
			(path) => win32.basename(path) === `${program}.exe` && !/\\WindowsApps\\/i.test(path),
		),
		"win32",
	);
}

/** The last line of what a program printed that is a full path. */
function lastPath(output: string | null, platform: NodeJS.Platform): string | null {
	const paths = pathsOf(platform);
	const lines = (output ?? "").split(/\r?\n/).map((line) => line.trim());
	return lines.filter((line) => line !== "" && paths.isAbsolute(line)).pop() ?? null;
}

/**
 * Where npm itself says its global packages are (`npm root -g`), or null.
 * npm is started as the script it is, with Node: its `npm.cmd` would need
 * the command prompt, which a company's policy may forbid. Outside
 * Windows the user's login shell is asked last, which knows the `PATH`
 * that nvm and the like set up.
 */
export async function npmGlobalRoot(host: Host): Promise<string | null> {
	const { platform, env, home } = host;
	const windows = platform === "win32";
	const paths = pathsOf(platform);
	const nodeName = windows ? "node.exe" : "node";
	const folders = binFolders("npm", platform, env, home);
	let anyNode: string | null | undefined;
	for (const dir of folders) {
		const script = windows
			? paths.join(dir, "node_modules", "npm", "bin", "npm-cli.js")
			: paths.join(dir, "npm");
		if (!(await host.isFile(script))) continue;
		let node: string | null = paths.join(dir, nodeName);
		if (!(await host.isFile(node))) {
			if (anyNode === undefined) {
				anyNode = null;
				for (const other of folders) {
					if (await host.isFile(paths.join(other, nodeName))) {
						anyNode = paths.join(other, nodeName);
						break;
					}
				}
			}
			node = anyNode;
		}
		if (node === null) continue;
		const root = lastPath(await host.run(node, [script, "root", "-g"]), platform);
		if (root !== null) return root;
	}
	if (windows) return null;
	return lastPath(await host.run(env.SHELL || "/bin/sh", ["-ilc", "npm root -g"]), platform);
}

/** Where the user's login shell finds the program: it knows the `PATH` its start-up files set. */
async function shellPrograms(program: CliProgram, host: Host): Promise<string[]> {
	const shell = host.env.SHELL || "/bin/sh";
	const output = await host.run(shell, ["-ilc", `command -v ${program}`]);
	if (output === null) return [];
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("/") && posix.basename(line) === program);
}

/**
 * Every place worth trying for a program, most likely first, short of
 * going through the disk folder by folder. Later places are only asked for
 * when the earlier ones did not answer, so the slower ones (the registry,
 * the running programs) usually never run.
 */
export async function* places(program: CliProgram, host: Host): AsyncGenerator<Place> {
	const given = new Set<string>();
	for await (const place of everyPlace(program, host)) {
		const key = sameKey(place.path, host.platform);
		if (given.has(key)) continue;
		given.add(key);
		yield place;
	}
}

async function* everyPlace(program: CliProgram, host: Host): AsyncGenerator<Place> {
	const { platform, env, home } = host;
	const paths = pathsOf(platform);
	const names = programNames(program, platform);
	const seen = new Set<string>();
	const fresh = (dirs: readonly string[]): string[] =>
		dirs.filter((dir) => {
			const key = sameKey(dir, platform);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	/** A folder of links, then the packages the links would lead to. */
	async function* inFolders(dirs: readonly string[], source: PlaceSource): AsyncGenerator<Place> {
		for (const dir of dirs) {
			for (const name of names) yield { path: paths.join(dir, name), source };
		}
		for (const dir of dirs) {
			const modules = modulesOf(dir, platform);
			if (modules === null) continue;
			for (const path of await packagePrograms(program, modules, host)) {
				yield { path, source: source === "folders" ? "npm" : source };
			}
		}
	}

	const folders = fresh(binFolders(program, platform, env, home));
	yield* inFolders(folders, "folders");
	yield* inFolders(fresh(await npmConfigFolders(host, folders)), "npm");
	yield* inFolders(fresh(await managerFolders(host)), "node");
	for await (const path of editorPrograms(program, host)) yield { path, source: "editor" };
	for await (const path of appPrograms(program, host)) yield { path, source: "app" };
	if (platform === "win32") {
		const registry = await freshEnvironment(host);
		if (registry !== null) {
			const later = { ...host, env: registry };
			const added = fresh(binFolders(program, platform, registry, home));
			yield* inFolders(added, "registry");
			yield* inFolders(fresh(await npmConfigFolders(later, added)), "registry");
			yield* inFolders(fresh(await managerFolders(later)), "registry");
		}
	}
	// Installed with npm somewhere all of that missed: npm knows.
	const root = await npmGlobalRoot(host);
	if (root !== null) yield* inFolders(fresh([npmGlobalBin(root, platform)]), "npm");
	if (platform === "win32") {
		for (const path of await runningPrograms(program, host)) yield { path, source: "running" };
	} else {
		for (const path of await shellPrograms(program, host)) yield { path, source: "shell" };
	}
}

/**
 * The places around a path the user gave: the file itself, or, for a
 * folder (Node's, npm's, a `node_modules`, the package's own), the program
 * in it.
 */
export async function* placesNear(
	program: CliProgram,
	path: string,
	host: Host,
): AsyncGenerator<string> {
	const paths = pathsOf(host.platform);
	yield path;
	for (const name of programNames(program, host.platform)) yield paths.join(path, name);
	if (host.platform !== "win32") yield paths.join(path, "bin", program);
	const modules = modulesOf(path, host.platform);
	const roots = [
		path,
		paths.join(path, "node_modules"),
		paths.join(path, "lib", "node_modules"),
		...(modules === null ? [] : [modules]),
		// The package's own folder, or its publisher's: the `node_modules` above it.
		paths.dirname(path),
		paths.dirname(paths.dirname(path)),
	];
	for (const root of unique(roots, host.platform)) {
		yield* await packagePrograms(program, root, host);
	}
	yield* walk(program, host, path, 2, new Budget(5_000));
}

/** A folder to go through, and how far down. */
export interface ScanRoot {
	readonly path: string;
	readonly depth: number;
}

/** The user's own folders and the installed programs': what is gone through unasked. */
export function ownRoots(host: Host): ScanRoot[] {
	const { platform, env, home } = host;
	const homes = homesOf(platform, env, home);
	const roots: ScanRoot[] = [];
	const add = (path: string, depth: number): void => {
		if (path !== "") roots.push({ path, depth });
	};
	if (platform === "win32") {
		// The data folders first: the home's walk then passes them by.
		add(variable(env, "LOCALAPPDATA", platform), 3);
		add(variable(env, "APPDATA", platform), 3);
		for (const dir of homes) add(dir, 4);
		for (const name of ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]) {
			add(variable(env, name, platform), 2);
		}
	} else {
		for (const dir of homes) add(dir, 3);
		add("/opt", 2);
		add("/usr/local", 2);
	}
	const seen = new Set<string>();
	return roots.filter((root) => {
		const key = sameKey(root.path, platform);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * The rest of this computer's own disks, for a search the user asked for:
 * Windows' shared data folder and each fixed drive from its top. Network
 * drives are left out.
 */
export async function sharedRoots(host: Host): Promise<ScanRoot[]> {
	if (host.platform !== "win32") return [];
	const { env, home } = host;
	// kalem-locale-ok: a drive letter
	const letter = (path: string): string => (/^[A-Za-z]:/.exec(path)?.[0] ?? "").toUpperCase();
	const output = await powershell(
		host,
		"Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID }",
	);
	let drives = (output ?? "")
		.split(/\r?\n/)
		.map((line) => letter(line.trim()))
		.filter((drive) => drive !== "");
	if (drives.length === 0) {
		// The disks could not be asked for: the ones this user's folders are on.
		drives = [
			variable(env, "SystemDrive", "win32"),
			variable(env, "USERPROFILE", "win32"),
			home,
			...binFolders("node", "win32", env, home),
		]
			.map(letter)
			.filter((drive) => drive !== "");
	}
	const roots: ScanRoot[] = [];
	const data = variable(env, "ProgramData", "win32");
	if (data !== "") roots.push({ path: data, depth: 2 });
	for (const drive of [...new Set(drives)]) roots.push({ path: `${drive}\\`, depth: 3 });
	return roots;
}

/**
 * Goes through the roots in turn, within one budget. What it finds is not
 * known to be the CLI: a file of that name lies in a folder nobody chose,
 * a download perhaps. The user is shown it before it is started.
 */
export async function* scan(
	program: CliProgram,
	host: Host,
	roots: readonly ScanRoot[],
	budget: Budget,
): AsyncGenerator<string> {
	for (const root of roots) {
		yield* walk(program, host, root.path, root.depth, budget);
		if (!budget.alive()) return;
	}
}
