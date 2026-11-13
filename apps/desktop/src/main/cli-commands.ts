/**
 * The slash commands Claude Code has on this computer, for the assistant's
 * command menu: the user's own (`~/.claude/commands`, `~/.claude/skills`),
 * a folder's (`.claude/commands`, `.claude/skills`), and those of the
 * plugins installed and turned on (`/plugin:command`). Only read: Claude
 * Code runs them when a question starts with one.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface CliCommand {
	/** What is typed after the slash: `review-pr`, `plugin:command`. */
	readonly name: string;
	readonly description: string;
	/** What it takes after its name, as its file says (`<issue number>`). */
	readonly argument?: string;
	/** Where it comes from: `user`, `project`, or the plugin's name. */
	readonly source: string;
}

/** At most this many commands are listed; a file is read up to this many bytes. */
const MAX_COMMANDS = 500;
const MAX_FILE = 64 * 1024;

/** A file's front matter (`key: value` lines between `---`), flat. */
export function frontMatter(text: string): Record<string, string> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (match === null) return {};
	const fields: Record<string, string> = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const pair = /^([\w-]+):\s*(.*)$/.exec(line);
		if (pair === null) continue;
		fields[pair[1] as string] = (pair[2] ?? "").replace(/^(["'])(.*)\1$/, "$2").trim();
	}
	return fields;
}

/** What a command file says it does: its description, or else its first line of text. */
function described(text: string, fields: Record<string, string>): string {
	if (fields.description !== undefined && fields.description !== "") return fields.description;
	const body = text.replace(/^---[\s\S]*?\n---/, "");
	const line = body.split(/\r?\n/).find((row) => row.trim() !== "" && !row.startsWith("#"));
	return (line ?? "").trim().slice(0, 200);
}

async function readText(path: string): Promise<string | null> {
	try {
		return (await readFile(path, "utf8")).slice(0, MAX_FILE);
	} catch {
		return null;
	}
}

async function entries(folder: string): Promise<{ name: string; folder: boolean }[]> {
	try {
		const found = await readdir(folder, { withFileTypes: true });
		return found.map((entry) => ({
			name: entry.name,
			folder: entry.isDirectory() || entry.isSymbolicLink(),
		}));
	} catch {
		return [];
	}
}

/** `commands/*.md`, in subfolders too, each by its file's name. */
async function commandsIn(folder: string, prefix: string, source: string): Promise<CliCommand[]> {
	const found: CliCommand[] = [];
	const walk = async (at: string, depth: number): Promise<void> => {
		for (const entry of await entries(at)) {
			const path = join(at, entry.name);
			if (entry.name.endsWith(".md")) {
				const text = await readText(path);
				if (text === null) continue;
				const fields = frontMatter(text);
				found.push({
					name: `${prefix}${basename(entry.name, ".md")}`,
					description: described(text, fields),
					...(fields["argument-hint"] ? { argument: fields["argument-hint"] } : {}),
					source,
				});
			} else if (entry.folder && depth < 3) await walk(path, depth + 1);
		}
	};
	await walk(folder, 0);
	return found;
}

/** `skills/<name>/SKILL.md`: a skill the user may call is a command too. */
async function skillsIn(folder: string, prefix: string, source: string): Promise<CliCommand[]> {
	const found: CliCommand[] = [];
	for (const entry of await entries(folder)) {
		if (!entry.folder) continue;
		const text = await readText(join(folder, entry.name, "SKILL.md"));
		if (text === null) continue;
		const fields = frontMatter(text);
		if (fields["user-invocable"] === "false") continue;
		found.push({
			name: `${prefix}${fields.name || entry.name}`,
			description: described(text, fields),
			...(fields["argument-hint"] ? { argument: fields["argument-hint"] } : {}),
			source,
		});
	}
	return found;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

async function readJson(path: string): Promise<unknown> {
	const text = await readText(path);
	if (text === null) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * The plugins installed (`plugins/installed_plugins.json`, either of its
 * forms) and not turned off in the settings, each with its folder.
 */
export async function installedPlugins(config: string): Promise<{ id: string; path: string }[]> {
	const installed = await readJson(join(config, "plugins", "installed_plugins.json"));
	const settings = await readJson(join(config, "settings.json"));
	const enabled =
		isRecord(settings) && isRecord(settings.enabledPlugins) ? settings.enabledPlugins : {};
	const plugins = isRecord(installed) && isRecord(installed.plugins) ? installed.plugins : {};
	const found: { id: string; path: string }[] = [];
	for (const [id, value] of Object.entries(plugins)) {
		if (enabled[id] === false) continue;
		const installs = Array.isArray(value) ? value : [value];
		const install = installs.find(
			(item): item is Record<string, unknown> =>
				isRecord(item) && typeof item.installPath === "string",
		);
		if (install !== undefined) found.push({ id, path: install.installPath as string });
	}
	return found;
}

/** Claude Code's configuration folder: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export const claudeConfigFolder = (): string =>
	process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/** Every command found, the first of a name kept: a folder's, the user's, then the plugins'. */
export async function cliCommands(
	folders: readonly string[],
	config = claudeConfigFolder(),
): Promise<CliCommand[]> {
	const lists: Promise<CliCommand[]>[] = [];
	for (const folder of folders) {
		lists.push(commandsIn(join(folder, ".claude", "commands"), "", "project"));
		lists.push(skillsIn(join(folder, ".claude", "skills"), "", "project"));
	}
	lists.push(commandsIn(join(config, "commands"), "", "user"));
	lists.push(skillsIn(join(config, "skills"), "", "user"));
	for (const plugin of await installedPlugins(config)) {
		const manifest = await readJson(join(plugin.path, ".claude-plugin", "plugin.json"));
		const name =
			isRecord(manifest) && typeof manifest.name === "string"
				? manifest.name
				: (plugin.id.split("@")[0] ?? plugin.id);
		lists.push(commandsIn(join(plugin.path, "commands"), `${name}:`, name));
		lists.push(skillsIn(join(plugin.path, "skills"), `${name}:`, name));
	}
	const seen = new Set<string>();
	const all: CliCommand[] = [];
	for (const command of (await Promise.all(lists)).flat()) {
		if (!/^[\w.:-]+$/.test(command.name) || seen.has(command.name)) continue;
		seen.add(command.name);
		all.push(command);
		if (all.length >= MAX_COMMANDS) break;
	}
	return all;
}
