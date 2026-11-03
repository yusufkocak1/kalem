/**
 * What the Files pane does to files and folders: create, rename and watch.
 * Every path stays inside one of the folders the pane shows, and a name is
 * one name, never a path.
 */
import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { pathKey } from "./path-key.js";

export type WorkspaceFileProblem = "invalid-name" | "exists" | "outside" | "missing";

export class WorkspaceFileError extends Error {
	readonly problem: WorkspaceFileProblem;

	constructor(problem: WorkspaceFileProblem, message: string) {
		super(message);
		this.problem = problem;
	}
}

/** Names Windows keeps for devices, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** A new name for a file or folder, trimmed; throws when it is not one usable name. */
export function checkName(raw: string): string {
	const name = raw.trim();
	if (
		name === "" ||
		name === "." ||
		name === ".." ||
		name.length > 255 ||
		/[\\/:*?"<>|\0]/.test(name) ||
		/[. ]$/.test(name) ||
		RESERVED.test(name)
	) {
		throw new WorkspaceFileError("invalid-name", name);
	}
	return name;
}

/** Whether `path` is one of `roots` or inside one. */
export function isInside(path: string, roots: readonly string[]): boolean {
	const key = pathKey(path);
	return roots.some((root) => {
		const top = pathKey(root);
		return key === top || key.startsWith(top.endsWith(sep) ? top : top + sep);
	});
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Creates an empty file or a folder named `name` in `parent`; returns its path. */
export async function createEntry(
	parent: string,
	name: string,
	kind: "file" | "folder",
	roots: readonly string[],
): Promise<string> {
	if (!isInside(parent, roots)) throw new WorkspaceFileError("outside", parent);
	const path = join(parent, checkName(name));
	if (await exists(path)) throw new WorkspaceFileError("exists", path);
	if (kind === "folder") await mkdir(path);
	else await writeFile(path, "", { flag: "wx" });
	return path;
}

/** Renames a file or folder within its folder; returns the new path. */
export async function renameEntry(
	path: string,
	name: string,
	roots: readonly string[],
): Promise<string> {
	// A root itself is not renamed: it is the folder the user opened.
	if (!isInside(path, roots) || roots.some((root) => pathKey(root) === pathKey(path))) {
		throw new WorkspaceFileError("outside", path);
	}
	if (!(await exists(path))) throw new WorkspaceFileError("missing", path);
	const target = join(dirname(path), checkName(name));
	if (target === path) return path;
	// Only the case changes: the same file on Windows and macOS, so no "exists".
	const sameFile = pathKey(target) === pathKey(path);
	if (!sameFile && (await exists(target))) throw new WorkspaceFileError("exists", target);
	await rename(path, target);
	return target;
}

/** The new path of `path` once `from` was renamed to `to`; `null` when it is not under `from`. */
export function movedPath(path: string, from: string, to: string): string | null {
	const key = pathKey(path);
	const fromKey = pathKey(from);
	if (key === fromKey) return to;
	if (!key.startsWith(fromKey + sep)) return null;
	return join(to, path.slice(from.length + 1));
}

/** Folders whose changes the pane does not show, so they do not refresh it. */
const IGNORED = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor"]);

/** What in a `.git` folder says the branch, the staged files or the remote changed. */
const GIT_STATE = new Set([
	"HEAD",
	"index",
	"MERGE_HEAD",
	"FETCH_HEAD",
	"CHERRY_PICK_HEAD",
	"packed-refs",
	"refs",
	"rebase-merge",
	"rebase-apply",
]);

/**
 * How soon a change below an open folder refreshes the pane: files that
 * come, go or are renamed soon; the text of a file changing (its Git mark
 * may change) or Git's own state (a commit, a branch switch, a fetch made
 * in a terminal) a little later; `null` for what the pane does not show.
 */
export function refreshDelay(type: string, file: string): number | null {
	const parts = file.split(/[\\/]/);
	if (parts[0] === ".git") return GIT_STATE.has(parts[1] ?? "") ? 800 : null;
	if (parts.some((part) => IGNORED.has(part) || part.endsWith(".assets"))) return null;
	return type === "rename" ? 400 : 1500;
}

/**
 * Watches the open folders, all the way down, and calls `changed` once
 * things settle: a pause gathers each burst of changes into one call.
 */
export class WorkspaceWatcher {
	readonly #changed: () => void;
	#watchers: FSWatcher[] = [];
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** When the waiting call is due. */
	#due = 0;

	constructor(changed: () => void) {
		this.#changed = changed;
	}

	watch(roots: readonly string[]): void {
		this.close();
		for (const root of roots) {
			try {
				const watcher = watch(root, { recursive: true }, (type, file) => {
					const delay = refreshDelay(type, file ?? "");
					if (delay === null) return;
					// A sooner call is not put off by a later one.
					const due = Date.now() + delay;
					if (this.#timer !== undefined && this.#due <= due) return;
					clearTimeout(this.#timer);
					this.#due = due;
					this.#timer = setTimeout(() => {
						this.#timer = undefined;
						this.#changed();
					}, delay);
				});
				watcher.on("error", () => watcher.close());
				this.#watchers.push(watcher);
			} catch {
				// A folder that cannot be watched is refreshed by hand.
			}
		}
	}

	close(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		for (const watcher of this.#watchers) watcher.close();
		this.#watchers = [];
	}
}
