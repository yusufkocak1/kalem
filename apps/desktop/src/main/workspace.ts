import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { SearchHit, WorkspaceEntry } from "../shared/bridge.js";
import { decodeBytes } from "../shared/encoding.js";
import { isEditablePath, isPackagePath } from "../shared/paths.js";

/** A folder this large is listed only in part; the pane says so. */
export const MAX_ENTRIES = 5000;
const MAX_DEPTH = 8;
const MAX_SEARCH_FILE_SIZE = 2 * 1024 * 1024;
export const MAX_HITS = 500;

const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "build", "out", "target", "vendor"]);

function skipFolder(name: string): boolean {
	// `notes.assets` holds a document's images and attachments, not documents.
	return name.startsWith(".") || SKIPPED_FOLDERS.has(name) || name.endsWith(".assets");
}

export interface Listing {
	readonly entries: readonly WorkspaceEntry[];
	readonly truncated: boolean;
}

/** Folders and documents under `root`, depth first, folders before files, by name. */
export async function listWorkspace(root: string, collator: Intl.Collator): Promise<Listing> {
	const entries: WorkspaceEntry[] = [];
	let truncated = false;

	const walk = async (folder: string, depth: number): Promise<boolean> => {
		let children: Dirent[];
		try {
			children = await readdir(folder, { withFileTypes: true });
		} catch {
			return false;
		}
		const folders = children
			.filter((child) => child.isDirectory() && !skipFolder(child.name))
			.sort((a, b) => collator.compare(a.name, b.name));
		const files = children
			.filter((child) => child.isFile() && isEditablePath(child.name))
			.sort((a, b) => collator.compare(a.name, b.name));

		let found = false;
		for (const child of folders) {
			if (entries.length >= MAX_ENTRIES) return found;
			const path = join(folder, child.name);
			const index = entries.length;
			entries.push({ path, name: child.name, depth, folder: true });
			// Folders without documents are left out.
			if (depth + 1 < MAX_DEPTH && (await walk(path, depth + 1))) found = true;
			else entries.splice(index);
		}
		for (const child of files) {
			if (entries.length >= MAX_ENTRIES) {
				truncated = true;
				return true;
			}
			entries.push({ path: join(folder, child.name), name: child.name, depth, folder: false });
			found = true;
		}
		return found;
	};

	await walk(root, 0);
	return { entries, truncated: truncated || entries.length >= MAX_ENTRIES };
}

/**
 * Lines containing `query` in the workspace's text documents. Matching folds
 * case with the interface language's rules (Turkish İ/ı) and ignores
 * nothing else. Packages are skipped: their text is inside a zip.
 */
export async function searchWorkspace(
	entries: readonly WorkspaceEntry[],
	root: string,
	query: string,
	locale: string,
): Promise<{ hits: SearchHit[]; truncated: boolean }> {
	const needle = query.trim().toLocaleLowerCase(locale);
	const hits: SearchHit[] = [];
	if (needle === "") return { hits, truncated: false };

	for (const entry of entries) {
		if (entry.folder || isPackagePath(entry.path)) continue;
		try {
			if ((await stat(entry.path)).size > MAX_SEARCH_FILE_SIZE) continue;
			const { text } = decodeBytes(new Uint8Array(await readFile(entry.path)));
			const lines = text.split(/\r\n|\r|\n/);
			for (const [i, line] of lines.entries()) {
				const column = line.toLocaleLowerCase(locale).indexOf(needle);
				if (column === -1) continue;
				hits.push({
					path: entry.path,
					relative: relative(root, entry.path).split(sep).join("/"),
					line: i + 1,
					column,
					text: line.length > 240 ? line.slice(Math.max(0, column - 80), column + 160) : line,
				});
				if (hits.length >= MAX_HITS) return { hits, truncated: true };
			}
		} catch {
			// Unreadable files are simply not searched.
		}
	}
	return { hits, truncated: false };
}
