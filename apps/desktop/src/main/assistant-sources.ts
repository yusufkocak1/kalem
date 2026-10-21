/**
 * Files and folders the user adds to an assistant chat: their text files
 * read into the question, so any service can answer from them (a code
 * folder, an analysis written as .txt, Java sources…). A CLI, which can
 * read files itself, is given a folder's list of files only and reads
 * what it needs.
 */
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { isBinaryPath } from "../shared/paths.js";
import { readTextFile } from "./text-files.js";

/** How many sources a chat keeps. */
export const MAX_SOURCES = 20;
/** Files listed of all folders together; deeper or later ones are left out. */
export const MAX_LISTED = 2000;
const MAX_DEPTH = 12;
/** A file larger than this is listed but not read. */
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILE_TEXT = 100_000;

/** Characters of file text a question may carry: an API is sent it all, a CLI only the files added one by one. */
export const SOURCE_BUDGET = { api: 300_000, cli: 100_000 } as const;

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

const attribute = (value: string): string =>
	value.replace(
		/[&"<>]/g,
		(c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
	);

/** A file's text; `null` when it is not text, or too large to send. */
export async function readText(path: string): Promise<string | null> {
	return (await readTextFile(path, "windows-1254", MAX_FILE_BYTES))?.text ?? null;
}

interface Listed {
	readonly path: string;
	/** Below the folder, with `/`. */
	readonly relative: string;
}

/** A folder's files, depth first, by name; hidden and build folders are skipped. */
async function listFolder(
	root: string,
	room: number,
): Promise<{ files: Listed[]; truncated: boolean }> {
	const files: Listed[] = [];
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
			if (files.length >= room) {
				truncated = true;
				return;
			}
			const path = join(folder, child.name);
			if (child.isFile() && !isBinaryPath(child.name)) {
				files.push({ path, relative: relative(root, path).split(sep).join("/") });
			}
		}
		for (const child of children) {
			if (!child.isDirectory() || skipFolder(child.name)) continue;
			if (depth + 1 >= MAX_DEPTH) {
				truncated = true;
				continue;
			}
			await walk(join(folder, child.name), depth + 1);
			if (files.length >= room) return;
		}
	};
	await walk(root, 0);
	return { files, truncated };
}

export interface SourcesContext {
	/** The `<files>` block for the question; empty without sources. */
	readonly text: string;
	/** The folders a CLI is allowed to read: the folders added, and those of the files added. */
	readonly folders: readonly string[];
}

/**
 * The files and folders added to a chat, as the question carries them: each
 * folder's list of files, and the text of as many files as the budget
 * allows, the files added one by one first. With `listOnly` (a CLI) a
 * folder's files are only listed. Paths that are gone are left out.
 */
export async function collectSources(
	paths: readonly string[],
	options: { readonly budget: number; readonly listOnly: boolean },
): Promise<SourcesContext> {
	const files: string[] = [];
	const folders: string[] = [];
	for (const path of new Set(paths)) {
		try {
			const info = await stat(path);
			if (info.isDirectory()) folders.push(path);
			else if (info.isFile()) files.push(path);
		} catch {
			// A source that was moved or deleted is simply not sent.
		}
	}
	if (files.length === 0 && folders.length === 0) return { text: "", folders: [] };

	const parts: string[] = [];
	let room = options.budget;
	let left = 0;
	const read = async (path: string, name: string): Promise<void> => {
		let text: string | null;
		try {
			text = await readText(path);
		} catch {
			text = null;
		}
		if (text === null) return;
		const clipped =
			text.length <= MAX_FILE_TEXT
				? text
				: `${text.slice(0, MAX_FILE_TEXT)}\n[… ${text.length - MAX_FILE_TEXT} more characters left out]`;
		if (clipped.length > room) {
			left++;
			return;
		}
		room -= clipped.length;
		parts.push(`<file path="${attribute(name)}">\n${clipped.replace(/\n+$/, "")}\n</file>`);
	};

	for (const path of files) await read(path, path);
	let listed = 0;
	for (const folder of folders) {
		const listing = await listFolder(folder, Math.max(0, MAX_LISTED - listed));
		listed += listing.files.length;
		parts.push(
			`<folder path="${attribute(folder)}">\n${[
				`${basename(folder)}/`,
				...listing.files.map((file) => `  ${file.relative}`),
				...(listing.truncated ? ["  [… more files not listed]"] : []),
			].join("\n")}\n</folder>`,
		);
		if (!options.listOnly) {
			for (const file of listing.files) await read(file.path, file.path);
		}
	}
	if (left > 0) parts.push(`[${left} more files not included: too much text for one question]`);

	return {
		text: `<files>\n${parts.join("\n")}\n</files>`,
		folders: [...new Set([...folders, ...files.map((path) => dirname(path))])],
	};
}
