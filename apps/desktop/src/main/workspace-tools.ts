/**
 * The folders added to an assistant chat as a workspace: the question
 * carries only a short overview of them, and the model asks for what it
 * needs with three tools: list files, search their text, read a file (or a
 * part of it). A code folder no longer fills the question; only what the
 * model reads does.
 *
 * Each folder's files are indexed once (paths, sizes, times) and the index
 * is reused for a while, so a search does not walk the folder again.
 */
import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { isBinaryPath } from "../shared/paths.js";
import { readTextFile } from "./text-files.js";
import { isInside } from "./workspace-files.js";

const SKIPPED_FOLDERS = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"vendor",
	"bin",
	"obj",
	"coverage",
	"__pycache__",
]);

const skipFolder = (name: string): boolean =>
	name.startsWith(".") || SKIPPED_FOLDERS.has(name) || name.endsWith(".assets");

/** Files indexed in one folder; deeper or later ones are left out. */
export const MAX_INDEXED = 50_000;
const MAX_DEPTH = 24;
/** How long an index is used before the folder is walked again. */
const INDEX_LIFETIME = 15_000;
/** Files larger than this are not searched; they can still be read in parts. */
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_HITS = 80;
const MAX_LISTED = 300;
/** Lines one read returns when no range is asked for. */
const READ_LINES = 400;
/** Characters one tool result may carry. */
const MAX_RESULT = 40_000;

export interface IndexedFile {
	/** Below the folder, with `/`. */
	readonly path: string;
	readonly size: number;
}

export interface FolderIndex {
	readonly root: string;
	readonly files: readonly IndexedFile[];
	readonly truncated: boolean;
	readonly made: number;
}

async function indexFolder(root: string): Promise<FolderIndex> {
	const files: IndexedFile[] = [];
	let truncated = false;
	const walk = async (folder: string, depth: number): Promise<void> => {
		let children: Dirent[];
		try {
			children = await readdir(folder, { withFileTypes: true });
		} catch {
			return;
		}
		children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const child of children) {
			if (!child.isFile() || isBinaryPath(child.name)) continue;
			if (files.length >= MAX_INDEXED) {
				truncated = true;
				return;
			}
			const path = join(folder, child.name);
			let size = 0;
			try {
				size = (await stat(path)).size;
			} catch {
				continue;
			}
			files.push({ path: relative(root, path).split(sep).join("/"), size });
		}
		for (const child of children) {
			if (!child.isDirectory() || skipFolder(child.name)) continue;
			if (depth + 1 >= MAX_DEPTH) {
				truncated = true;
				continue;
			}
			await walk(join(folder, child.name), depth + 1);
			if (files.length >= MAX_INDEXED) return;
		}
	};
	await walk(root, 0);
	return { root, files, truncated, made: Date.now() };
}

/** The indexes of the folders chats use, kept between questions. */
export class WorkspaceIndexes {
	readonly #indexes = new Map<string, Promise<FolderIndex>>();

	get(root: string): Promise<FolderIndex> {
		const kept = this.#indexes.get(root);
		const fresh = kept?.then((index) => Date.now() - index.made < INDEX_LIFETIME);
		return (async () => {
			if (kept !== undefined && (await fresh)) return kept;
			const made = indexFolder(root);
			this.#indexes.set(root, made);
			// A folder that is gone is not kept.
			made.catch(() => this.#indexes.delete(root));
			return made;
		})();
	}
}

/** A `*`/`**`/`?` pattern on paths with `/`, case folded. */
export function globMatcher(pattern: string): (path: string) => boolean {
	let source = "";
	const glob = pattern.trim().replace(/\\/g, "/");
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i] as string;
		if (char === "*") {
			if (glob[i + 1] === "*") {
				source += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
				i += glob[i + 2] === "/" ? 2 : 1;
			} else source += "[^/]*";
		} else if (char === "?") source += "[^/]";
		else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	// Without a folder in it, the pattern is a name anywhere.
	const anywhere = !glob.includes("/");
	const regex = new RegExp(`^${anywhere ? "(?:.*/)?" : ""}${source}$`, "i");
	return (path) => regex.test(path);
}

// --- The tools -------------------------------------------------------------------

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: {
		readonly type: "object";
		readonly properties: Record<string, unknown>;
		readonly required: readonly string[];
	};
}

export const WORKSPACE_TOOLS: readonly ToolDefinition[] = [
	{
		name: "list_files",
		description:
			"Lists files of the workspace, with their sizes. Use it to find where things are. Narrow it with a folder and/or a glob pattern (e.g. `**/*.java`, `src/**/User*`).",
		parameters: {
			type: "object",
			properties: {
				folder: {
					type: "string",
					description: "A folder of the workspace, as its paths are shown; empty for all of it.",
				},
				pattern: { type: "string", description: "A glob pattern on paths; empty for every file." },
			},
			required: [],
		},
	},
	{
		name: "search",
		description:
			"Searches the text of the workspace's files and returns matching lines as `path:line: text`. Use it before reading, to find the files and lines that matter.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "The text to find (case-insensitive)." },
				regex: { type: "boolean", description: "Treat the query as a regular expression." },
				pattern: {
					type: "string",
					description: "Only files whose path matches this glob pattern (e.g. `**/*.ts`).",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "read_file",
		description: `Reads a file of the workspace with line numbers. Without a range, the first ${READ_LINES} lines; ask for the lines you need in a long file.`,
		parameters: {
			type: "object",
			properties: {
				path: { type: "string", description: "The file's path, as the workspace shows it." },
				start_line: { type: "integer", description: "The first line, from 1." },
				end_line: { type: "integer", description: "The last line." },
			},
			required: ["path"],
		},
	},
];

/** What a tool did, for the chat to show. */
export interface ToolStep {
	readonly tool: string;
	/** A path, a search, a pattern. */
	readonly detail: string;
}

const clip = (text: string): string =>
	text.length <= MAX_RESULT
		? text
		: `${text.slice(0, MAX_RESULT)}\n[… ${text.length - MAX_RESULT} more characters left out; ask for less]`;

/** The tools working on a chat's folders. */
export class Workspace {
	readonly roots: readonly string[];
	readonly #indexes: WorkspaceIndexes;

	constructor(roots: readonly string[], indexes: WorkspaceIndexes) {
		this.roots = roots;
		this.#indexes = indexes;
	}

	/** How a file of `root` is named to the model: with several folders, from the folder's name. */
	#shown(root: string, path: string): string {
		return this.roots.length > 1 ? `${basename(root)}/${path}` : path;
	}

	/** The folder and the path below it that the model means; `null` when it is none of them. */
	#resolve(raw: string): { root: string; path: string } | null {
		const given = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
		if (isAbsolute(raw.trim())) {
			const absolute = normalize(raw.trim());
			const root = this.roots.find((folder) => isInside(absolute, [folder]));
			return root === undefined
				? null
				: { root, path: relative(root, absolute).split(sep).join("/") };
		}
		let root = this.roots[0];
		let path = given;
		if (this.roots.length > 1) {
			const [first, ...rest] = given.split("/");
			root = this.roots.find((folder) => basename(folder) === first);
			path = rest.join("/");
		}
		if (root === undefined) return null;
		const absolute = normalize(join(root, path));
		if (!isInside(absolute, [root])) return null;
		return { root, path: relative(root, absolute).split(sep).join("/") };
	}

	async #all(): Promise<FolderIndex[]> {
		return Promise.all(this.roots.map((root) => this.#indexes.get(root)));
	}

	/** A few lines that tell the model what the workspace holds, without its files. */
	async overview(): Promise<string> {
		const parts: string[] = [];
		for (const index of await this.#all()) {
			const folders = new Map<string, number>();
			const kinds = new Map<string, number>();
			let top = 0;
			for (const file of index.files) {
				const slash = file.path.indexOf("/");
				if (slash === -1) top++;
				else {
					const folder = file.path.slice(0, slash);
					folders.set(folder, (folders.get(folder) ?? 0) + 1);
				}
				const kind = extname(file.path) || basename(file.path);
				kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
			}
			const common = [...kinds.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 8)
				.map(([kind, count]) => `${kind} ${count}`)
				.join(", ");
			const topFiles = index.files
				.filter((file) => !file.path.includes("/"))
				.slice(0, 30)
				.map((file) => file.path);
			parts.push(
				[
					`<workspace-folder name="${basename(index.root)}" path="${index.root}">`,
					`${index.files.length}${index.truncated ? "+" : ""} files (${common})`,
					`folders: ${
						[...folders.entries()]
							.slice(0, 40)
							.map(([folder, count]) => `${folder}/ (${count})`)
							.join(", ") || "none"
					}`,
					`files at the top (${top}): ${topFiles.join(", ")}${top > topFiles.length ? ", …" : ""}`,
					"</workspace-folder>",
				].join("\n"),
			);
		}
		return parts.join("\n");
	}

	/** Runs a tool; a mistake is said in the result, for the model to correct. */
	async run(name: string, input: unknown, step?: (step: ToolStep) => void): Promise<string> {
		const args = (typeof input === "object" && input !== null ? input : {}) as Record<
			string,
			unknown
		>;
		const text = (key: string): string => (typeof args[key] === "string" ? args[key] : "");
		try {
			switch (name) {
				case "list_files":
					step?.({ tool: name, detail: [text("folder"), text("pattern")].join(" ").trim() });
					return clip(await this.#list(text("folder"), text("pattern")));
				case "search":
					step?.({ tool: name, detail: text("query") });
					return clip(await this.#search(text("query"), args.regex === true, text("pattern")));
				case "read_file": {
					const from = typeof args.start_line === "number" ? args.start_line : undefined;
					const to = typeof args.end_line === "number" ? args.end_line : undefined;
					const lines = from === undefined ? "" : `:${from}${to === undefined ? "" : `-${to}`}`;
					step?.({ tool: name, detail: `${text("path")}${lines}` });
					return clip(await this.#read(text("path"), from, to));
				}
				default:
					return `There is no tool named ${name}.`;
			}
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	async #list(folder: string, pattern: string): Promise<string> {
		const within = folder === "" ? null : this.#resolve(folder);
		if (folder !== "" && within === null) return `"${folder}" is not a folder of the workspace.`;
		const matches = pattern === "" ? () => true : globMatcher(pattern);
		const lines: string[] = [];
		let more = 0;
		for (const index of await this.#all()) {
			if (within !== null && within.root !== index.root) continue;
			const prefix = within === null || within.path === "" ? "" : `${within.path}/`;
			for (const file of index.files) {
				if (!file.path.startsWith(prefix) || !matches(file.path)) continue;
				if (lines.length >= MAX_LISTED) more++;
				else lines.push(`${this.#shown(index.root, file.path)} (${file.size} B)`);
			}
		}
		if (lines.length === 0) return "No files match.";
		return `${lines.join("\n")}${more > 0 ? `\n[… ${more} more; narrow it with a folder or a pattern]` : ""}`;
	}

	async #search(query: string, regex: boolean, pattern: string): Promise<string> {
		if (query.trim() === "") return "Give a query.";
		let test: (line: string) => boolean;
		if (regex) {
			let compiled: RegExp;
			try {
				compiled = new RegExp(query, "i");
			} catch (error) {
				return `Not a regular expression: ${error instanceof Error ? error.message : String(error)}`;
			}
			test = (line) => compiled.test(line);
		} else {
			const needle = query.toLocaleLowerCase("en");
			// Turkish İ/ı fold either way, so both are tried.
			const turkish = query.toLocaleLowerCase("tr");
			test = (line) => {
				return (
					line.toLocaleLowerCase("en").includes(needle) ||
					line.toLocaleLowerCase("tr").includes(turkish)
				);
			};
		}
		const matches = pattern === "" ? () => true : globMatcher(pattern);
		const hits: string[] = [];
		let files = 0;
		for (const index of await this.#all()) {
			for (const file of index.files) {
				if (file.size > MAX_SEARCH_BYTES || !matches(file.path)) continue;
				let text: string;
				try {
					const read = await readTextFile(
						join(index.root, file.path),
						"windows-1254",
						MAX_SEARCH_BYTES,
					);
					if (read === null) continue;
					text = read.text;
				} catch {
					continue;
				}
				let found = false;
				for (const [i, line] of text.split(/\r\n|\r|\n/).entries()) {
					if (!test(line)) continue;
					found = true;
					const shown = line.length > 200 ? `${line.trim().slice(0, 200)}…` : line.trim();
					hits.push(`${this.#shown(index.root, file.path)}:${i + 1}: ${shown}`);
					if (hits.length >= MAX_HITS) {
						return `${hits.join("\n")}\n[… stopped at ${MAX_HITS} matches; search for something narrower]`;
					}
				}
				if (found) files++;
			}
		}
		if (hits.length === 0) return "No matches.";
		return `${hits.length} matches in ${files} files:\n${hits.join("\n")}`;
	}

	async #read(raw: string, from?: number, to?: number): Promise<string> {
		const target = this.#resolve(raw);
		if (target === null || target.path === "") return `"${raw}" is not a file of the workspace.`;
		const absolute = join(target.root, target.path);
		let read: Awaited<ReturnType<typeof readTextFile>>;
		try {
			// A link inside the folder that leads out of it is not followed.
			if (!isInside(await realpath(absolute), [await realpath(target.root)])) {
				return `"${raw}" is not a file of the workspace.`;
			}
			read = await readTextFile(absolute, "windows-1254", MAX_READ_BYTES);
		} catch {
			return `"${raw}" cannot be read; list the files to see what is there.`;
		}
		if (read === null) return `"${raw}" is not a text file, or it is too large.`;
		const lines = read.text.split(/\r\n|\r|\n/);
		const first = Math.max(1, Math.floor(from ?? 1));
		const last = Math.min(lines.length, Math.floor(to ?? first + READ_LINES - 1));
		if (first > lines.length) return `The file has ${lines.length} lines.`;
		const width = String(last).length;
		const body = lines
			.slice(first - 1, last)
			.map((line, i) => `${String(first + i).padStart(width)}  ${line}`)
			.join("\n");
		const shown = this.#shown(target.root, target.path);
		const rest = last < lines.length ? `\n[lines ${last + 1}-${lines.length} not shown]` : "";
		return `${shown} (lines ${first}-${last} of ${lines.length})\n${body}${rest}`;
	}
}

/** What the model is told about working with a workspace. */
export const WORKSPACE_INSTRUCTIONS = `The user gave you a workspace: the folders below. Their files are NOT in the message. When the question needs them, look them up with the tools: \`search\` to find where something is, \`list_files\` to see what is there, \`read_file\` to read a file or only the lines you need. Read only what the answer needs, and do not guess at code you have not read. When you name code, give its path and line.`;
