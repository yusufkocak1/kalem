/**
 * The folders added to an assistant chat as a workspace: the question
 * carries only a short overview of them, and the model asks for what it
 * needs with three tools: list files, search their text, read a file (or a
 * part of it). A code folder no longer fills the question; only what the
 * model reads does.
 *
 * Each folder's files are indexed once (paths, sizes, times) and the index
 * is reused, so a search does not walk the folder again: an older index is
 * still answered with while a new one is made behind it.
 */
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { ProposedEdit } from "../shared/claude.js";
import { encodeText, willConvertToUtf8 } from "../shared/encoding.js";
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
/** How long an index is used as it is; after that the folder is walked again, behind it. */
const INDEX_LIFETIME = 15_000;
/** How long an older index is still answered with while the new one is made. */
const STALE_LIFETIME = 10 * 60_000;
/** Files asked about (stat, read) at the same time. */
const PARALLEL_FILES = 64;
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
	readonly modified: number;
}

export interface FolderIndex {
	readonly root: string;
	/** Listed by Git, with its ignore rules. */
	readonly git: boolean;
	readonly files: readonly IndexedFile[];
	readonly truncated: boolean;
	readonly made: number;
}

/** `work` for each item, `limit` at a time; the results in the items' order. */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await work(items[index] as T, index);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

/** Runs a program; its output, or `null` when it is missing or fails. */
function output(
	command: string,
	args: readonly string[],
	cwd: string,
	maxBuffer = 64 * 1024 * 1024,
): Promise<{ stdout: string; code: number } | null> {
	return new Promise((resolve) => {
		execFile(
			command,
			[...args],
			{ cwd, timeout: 30_000, windowsHide: true, maxBuffer, env: { ...process.env, LC_ALL: "C" } },
			(error, stdout) => {
				if (error === null) resolve({ stdout, code: 0 });
				else if (typeof error.code === "number") resolve({ stdout, code: error.code });
				else resolve(null);
			},
		);
	});
}

/**
 * In a Git repository, the files Git sees: tracked, and new ones its
 * ignore rules (`.gitignore`, `info/exclude`, the global one) let through.
 * `null` outside a repository or without Git.
 */
async function gitFiles(root: string): Promise<IndexedFile[] | null> {
	const listed = await output(
		"git",
		["-c", "core.quotepath=off", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		root,
	);
	if (listed === null || listed.code !== 0) return null;
	const paths = [...new Set(listed.stdout.split("\0"))]
		.filter((path) => path !== "" && !isBinaryPath(path))
		.slice(0, MAX_INDEXED);
	// Many at a time: one by one, a large repository took seconds.
	const found = await mapLimit(paths, PARALLEL_FILES, async (path) => {
		try {
			const info = await stat(join(root, path));
			return info.isFile() ? { path, size: info.size, modified: info.mtimeMs } : null;
		} catch {
			// Deleted but still in the index: not there to read.
			return null;
		}
	});
	const files = found.filter((file): file is IndexedFile => file !== null);
	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return files;
}

async function indexFolder(root: string): Promise<FolderIndex> {
	const tracked = await gitFiles(root);
	if (tracked !== null) {
		return {
			root,
			git: true,
			files: tracked,
			truncated: tracked.length >= MAX_INDEXED,
			made: Date.now(),
		};
	}
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
		const own = children.filter((child) => child.isFile() && !isBinaryPath(child.name));
		if (files.length + own.length > MAX_INDEXED) truncated = true;
		const stats = await mapLimit(
			own.slice(0, Math.max(0, MAX_INDEXED - files.length)),
			PARALLEL_FILES,
			async (child) => {
				const path = join(folder, child.name);
				try {
					const info = await stat(path);
					return {
						path: relative(root, path).split(sep).join("/"),
						size: info.size,
						modified: info.mtimeMs,
					};
				} catch {
					return null;
				}
			},
		);
		for (const file of stats) if (file !== null) files.push(file);
		if (files.length >= MAX_INDEXED) return;
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
	return { root, git: false, files, truncated, made: Date.now() };
}

/** Whether `rg` runs here; asked once. */
let ripgrep: Promise<boolean> | null = null;

/**
 * What ripgrep can look for in place of words to find, sure to be in every
 * file that has them: the longest run of ASCII without `i` or `I`. ASCII is
 * the same bytes in UTF-8 and the legacy encodings, and those two letters
 * fold to `ı` and `İ` the Turkish way, which ripgrep does not do. `null`
 * when there is no such run.
 */
export function ripgrepNeedle(query: string): string | null {
	const runs = query.match(/[\x20-\x48\x4a-\x68\x6a-\x7e]+/g) ?? [];
	const longest = runs.reduce((a, b) => (b.trim().length > a.trim().length ? b : a), "");
	return longest.trim() === "" ? null : longest;
}

/**
 * The files of the folder that may contain `query`, found by ripgrep: far
 * faster than reading every file. Each is then searched the way Kalem
 * searches, so ripgrep only needs to find too many, never too few. `null`
 * when ripgrep is not installed, or cannot be trusted with the query (a
 * pattern that is not ASCII, or that ripgrep reads differently): the files
 * are then all read.
 */
async function ripgrepFiles(
	index: FolderIndex,
	query: string,
	regex: boolean,
	pattern: string,
): Promise<Set<string> | null> {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the printable ASCII range
	if (regex && !/^[\x20-\x7e]*$/.test(query)) return null;
	const needle = regex ? query : ripgrepNeedle(query);
	if (needle === null) return null;
	ripgrep ??= output("rg", ["--version"], index.root).then((found) => found?.code === 0);
	if (!(await ripgrep)) return null;
	const found = await output(
		"rg",
		[
			"--files-with-matches",
			"--ignore-case",
			"--hidden",
			"--no-messages",
			"--max-filesize",
			"1M",
			"--glob",
			"!.git",
			// Outside Git the index leaves these out; inside, Git's rules apply to both.
			...(index.git ? [] : [...SKIPPED_FOLDERS].flatMap((name) => ["--glob", `!${name}`])),
			// A pattern on names alone means the same to ripgrep: it need not search the rest.
			...(pattern !== "" && !pattern.includes("/") && !pattern.includes("\\")
				? ["--iglob", pattern.trim()]
				: []),
			...(regex ? [] : ["--fixed-strings"]),
			"--regexp",
			needle,
			".",
		],
		index.root,
	);
	// 1: nothing found; 2 or a failure: a pattern ripgrep does not read, or another problem.
	if (found === null || found.code > 1) return null;
	return new Set(
		found.stdout
			.split(/\r?\n/)
			.filter((line) => line !== "")
			.map((line) => line.replace(/\\/g, "/").replace(/^\.\//, "")),
	);
}

/** Characters of file text kept in memory for searches, across all folders. */
const TEXT_CACHE_LIMIT = 64 * 1024 * 1024;

/** The indexes of the folders chats use, and their files' text, kept between questions. */
export class WorkspaceIndexes {
	readonly #indexes = new Map<string, Promise<FolderIndex>>();
	/** By absolute path; the oldest goes first when there is too much. */
	readonly #texts = new Map<string, { modified: number; size: number; text: string | null }>();
	#textSize = 0;

	/** A file's text for a search, from memory while the file on disk has not changed. */
	async text(path: string): Promise<string | null> {
		let file: { size: number; mtimeMs: number };
		try {
			file = await stat(path);
		} catch {
			return null;
		}
		if (file.size > MAX_SEARCH_BYTES) return null;
		const kept = this.#texts.get(path);
		if (kept !== undefined && kept.modified === file.mtimeMs && kept.size === file.size) {
			// Used again: it goes to the end, last to be dropped.
			this.#texts.delete(path);
			this.#texts.set(path, kept);
			return kept.text;
		}
		let text: string | null = null;
		try {
			text = (await readTextFile(path, "windows-1254", MAX_SEARCH_BYTES))?.text ?? null;
		} catch {
			text = null;
		}
		if (kept !== undefined) {
			this.#texts.delete(path);
			this.#textSize -= kept.text?.length ?? 0;
		}
		this.#texts.set(path, { modified: file.mtimeMs, size: file.size, text });
		this.#textSize += text?.length ?? 0;
		for (const [old, entry] of this.#texts) {
			if (this.#textSize <= TEXT_CACHE_LIMIT) break;
			this.#texts.delete(old);
			this.#textSize -= entry.text?.length ?? 0;
		}
		return text;
	}

	/** Folders being walked again while their older index is still answered with. */
	readonly #renewing = new Map<string, Promise<FolderIndex>>();

	get(root: string): Promise<FolderIndex> {
		const kept = this.#indexes.get(root);
		if (kept === undefined) return this.#make(root);
		return (async () => {
			let index: FolderIndex;
			try {
				index = await kept;
			} catch {
				return this.#make(root);
			}
			const age = Date.now() - index.made;
			if (age < INDEX_LIFETIME) return index;
			// Old, not too old: answered with now, and walked again behind it for the next question.
			if (age < STALE_LIFETIME) {
				this.#renew(root);
				return index;
			}
			return this.#renewing.get(root) ?? this.#make(root);
		})();
	}

	/** Forgets the index of the folder `path` is in: a file was written there. */
	forget(path: string): void {
		for (const root of [...this.#indexes.keys()]) {
			if (isInside(path, [root])) this.#indexes.delete(root);
		}
	}

	#make(root: string): Promise<FolderIndex> {
		const made = indexFolder(root);
		this.#indexes.set(root, made);
		// A folder that is gone is not kept.
		made.catch(() => {
			if (this.#indexes.get(root) === made) this.#indexes.delete(root);
		});
		return made;
	}

	#renew(root: string): void {
		if (this.#renewing.has(root)) return;
		const made = indexFolder(root);
		this.#renewing.set(root, made);
		made
			.then(
				(index) => {
					this.#indexes.set(root, Promise.resolve(index));
				},
				() => this.#indexes.delete(root),
			)
			.finally(() => this.#renewing.delete(root));
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

/** Changes the model may propose; the user applies them, Kalem never writes on its own. */
export const EDIT_TOOL: ToolDefinition = {
	name: "propose_edit",
	description:
		"Proposes a change to a file of the workspace; nothing is written until the user applies it. `old_text` must be copied exactly from the file (read it first) and occur in it once; give a few lines around the change so it is unique. To propose a new file, leave `old_text` empty and give its whole text as `new_text`. One call per change.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "The file's path, as the workspace shows it." },
			old_text: { type: "string", description: "The exact text to replace; empty for a new file." },
			new_text: { type: "string", description: "What replaces it." },
			summary: { type: "string", description: "A short line saying what the change does." },
		},
		required: ["path", "old_text", "new_text"],
	},
};

/** A proposal as the main process keeps it until it is applied. */
export interface KeptEdit extends ProposedEdit {
	readonly absolute: string;
}

/** Why a proposed change cannot be applied as it is; `null` when it can. */
async function editProblem(edit: KeptEdit): Promise<string | null> {
	let file: Awaited<ReturnType<typeof readTextFile>>;
	try {
		file = await readTextFile(edit.absolute, "windows-1254", MAX_READ_BYTES);
	} catch {
		return edit.oldText === "" ? null : `${edit.path} cannot be read.`;
	}
	if (edit.oldText === "") return `${edit.path} already exists.`;
	if (file === null) return `${edit.path} is not a text file.`;
	if (willConvertToUtf8(file.format)) {
		return `${edit.path} is written in ${file.format.encoding}; changing it here would turn it into UTF-8.`;
	}
	const count = file.text.split(edit.oldText).length - 1;
	if (count === 0) return `The text to replace is not in ${edit.path} (any more).`;
	if (count > 1)
		return `The text to replace occurs ${count} times in ${edit.path}; give more lines around it.`;
	return null;
}

/** Writes a proposed change, once the user applied it; throws with the reason when it no longer fits. */
export async function applyEdit(edit: KeptEdit): Promise<void> {
	const problem = await editProblem(edit);
	if (problem !== null) throw new Error(problem);
	if (edit.oldText === "") {
		await mkdir(dirname(edit.absolute), { recursive: true });
		await writeFile(edit.absolute, edit.newText, { flag: "wx" });
		return;
	}
	const file = await readTextFile(edit.absolute, "windows-1254", MAX_READ_BYTES);
	if (file === null) throw new Error(`${edit.path} is not a text file.`);
	await writeFile(
		edit.absolute,
		encodeText(
			file.text.replace(edit.oldText, () => edit.newText),
			file.format,
		),
	);
}

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
	/** Takes the changes the model proposes; without it, `propose_edit` is refused. */
	readonly #propose: ((edit: KeptEdit) => void) | undefined;
	#proposed = 0;

	constructor(
		roots: readonly string[],
		indexes: WorkspaceIndexes,
		propose?: (edit: KeptEdit) => void,
	) {
		this.roots = roots;
		this.#indexes = indexes;
		this.#propose = propose;
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
				case "propose_edit":
					if (this.#propose === undefined) break;
					step?.({ tool: name, detail: text("path") });
					return await this.#proposeEdit(
						text("path"),
						typeof args.old_text === "string" ? args.old_text : "",
						typeof args.new_text === "string" ? args.new_text : "",
						text("summary"),
					);
			}
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
		return `There is no tool named ${name}.`;
	}

	async #proposeEdit(
		raw: string,
		oldText: string,
		newText: string,
		summary: string,
	): Promise<string> {
		const target = this.#resolve(raw);
		if (target === null || target.path === "") return `"${raw}" is not a file of the workspace.`;
		const absolute = join(target.root, target.path);
		// A link inside the folder that leads out of it is not followed; a new file's folder is checked.
		let real: string;
		try {
			real = await realpath(absolute);
		} catch {
			real = join(await realpath(target.root).catch(() => target.root), target.path);
		}
		if (!isInside(real, [await realpath(target.root).catch(() => target.root)])) {
			return `"${raw}" is not a file of the workspace.`;
		}
		const edit: KeptEdit = {
			id: `edit-${Date.now().toString(36)}-${++this.#proposed}`,
			path: this.#shown(target.root, target.path),
			absolute,
			// The files' text is read with LF line endings; the model may send CRLF.
			oldText: oldText.replace(/\r\n?/g, "\n"),
			newText: newText.replace(/\r\n?/g, "\n"),
			summary: summary.slice(0, 300),
		};
		if (edit.oldText === edit.newText) return "The new text is the same as the old.";
		const problem = await editProblem(edit);
		if (problem !== null) return `Not proposed: ${problem}`;
		this.#propose?.(edit);
		return `Proposed (${edit.id}): the user sees the change and decides whether to apply it. Do not repeat it in your answer; say what it does.`;
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
		/** Whether the file's whole text can have a matching line: most files are passed over at once. */
		let mayHave: (text: string) => boolean;
		if (regex) {
			let compiled: RegExp;
			let whole: RegExp;
			try {
				compiled = new RegExp(query, "i");
				whole = new RegExp(query, "im");
			} catch (error) {
				return `Not a regular expression: ${error instanceof Error ? error.message : String(error)}`;
			}
			test = (line) => compiled.test(line);
			// A look around may see past a line's end, so such a pattern is tried line by line.
			mayHave = query.includes("(?") ? () => true : (text) => whole.test(text);
		} else {
			const needle = query.toLocaleLowerCase("en");
			// Turkish İ/ı fold either way, so both are tried.
			const turkish = query.toLocaleLowerCase("tr");
			test = (line) =>
				line.toLocaleLowerCase("en").includes(needle) ||
				line.toLocaleLowerCase("tr").includes(turkish);
			// Sigma lowers differently at a word's end, which a line's end can be.
			mayHave = /[σςΣ]/.test(query)
				? () => true
				: (text) =>
						text.toLocaleLowerCase("en").includes(needle) ||
						text.toLocaleLowerCase("tr").includes(turkish);
		}
		const matches = pattern === "" ? () => true : globMatcher(pattern);
		const hits: string[] = [];
		let files = 0;
		for (const index of await this.#all()) {
			// ripgrep, when installed, finds the files that have it; the index says which count.
			const candidates = await ripgrepFiles(index, query, regex, pattern);
			const searched = index.files.filter(
				(file) =>
					file.size <= MAX_SEARCH_BYTES &&
					matches(file.path) &&
					(candidates === null || candidates.has(file.path)),
			);
			// Read many at a time, a batch after another, until there are enough matches.
			for (let start = 0; start < searched.length; start += PARALLEL_FILES) {
				const batch = searched.slice(start, start + PARALLEL_FILES);
				const texts = await mapLimit(batch, PARALLEL_FILES, async (file) => {
					const text = await this.#indexes.text(join(index.root, file.path));
					return text === null || !mayHave(text) ? null : text;
				});
				for (const [i, text] of texts.entries()) {
					if (text === null) continue;
					const file = batch[i] as IndexedFile;
					let found = false;
					for (const [n, line] of text.split(/\r\n|\r|\n/).entries()) {
						if (!test(line)) continue;
						found = true;
						const shown = line.length > 200 ? `${line.trim().slice(0, 200)}…` : line.trim();
						hits.push(`${this.#shown(index.root, file.path)}:${n + 1}: ${shown}`);
						if (hits.length >= MAX_HITS) {
							return `${hits.join("\n")}\n[… stopped at ${MAX_HITS} matches; search for something narrower]`;
						}
					}
					if (found) files++;
				}
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
export const WORKSPACE_INSTRUCTIONS = `The user gave you a workspace: the folders below. Their files are NOT in the message. When the question needs them, look them up with the tools: \`search\` to find where something is, \`list_files\` to see what is there, \`read_file\` to read a file or only the lines you need. When several look-ups do not depend on each other (searches for different names, files you already know you need), make them together in one turn rather than one after another. Read only what the answer needs, and do not guess at code you have not read. When you name code, give its path and line. When the user asks you to change files of the workspace, propose each change with \`propose_edit\` (after reading the file); the user reviews and applies them.`;

/**
 * Whether a reply wrote a tool call out as text instead of making it: some
 * models (often small local ones) take the tools but cannot call them, and
 * print `{"name": "search", …}` or `<tool_call>` at the user. Their answer
 * is then worthless, and the files are sent the old way instead.
 */
export function looksLikeToolText(reply: string): boolean {
	const names = "search|read_file|list_files|propose_edit";
	return (
		/<\/?tool_call>|<\|python_tag\|>/.test(reply) ||
		new RegExp(`"(?:name|function|tool)"\\s*:\\s*"(?:${names})"`).test(reply) ||
		// The whole reply is a call: a line of code inside an answer is not.
		new RegExp(`^\\s*(?:${names})\\s*\\(\\s*[{"'a-z_][^\\n]*\\)\\s*$`).test(reply)
	);
}
