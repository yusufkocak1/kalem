import { constants } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Node, Root } from "@kalem-editor/core";
import { parse, serialize } from "@kalem-editor/core";
import {
	fileNameKey,
	relativeUrl,
	safeBaseName,
	safeExtension,
	uniqueFileName,
} from "../shared/images.js";
import { pathKey } from "./path-key.js";

interface UrlNode {
	url: string;
}

/** A link target that points at a file next to the document, not at the web or an anchor. */
export function isLocalUrl(url: string): boolean {
	return (
		url !== "" &&
		!/^[a-z][a-z0-9+.-]*:/i.test(url) &&
		!url.startsWith("#") &&
		!url.startsWith("/") &&
		!url.startsWith("\\")
	);
}

/** `img/a%20b.png?x#y` → path `img/a b.png`, suffix `?x#y`. */
export function splitUrl(url: string): { path: string; suffix: string } | null {
	const cut = url.search(/[?#]/);
	const raw = cut === -1 ? url : url.slice(0, cut);
	try {
		return { path: decodeURIComponent(raw), suffix: cut === -1 ? "" : url.slice(cut) };
	} catch {
		return null;
	}
}

export function urlNodes(root: Root): UrlNode[] {
	const out: UrlNode[] = [];
	const walk = (node: Node): void => {
		if ("url" in node && typeof node.url === "string") out.push(node as UrlNode);
		if ("children" in node) for (const child of node.children as Node[]) walk(child);
	};
	walk(root);
	return out;
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

function isInside(folder: string, path: string): boolean {
	const rel = relative(folder, path);
	return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`) && !/^[a-z]:/i.test(rel);
}

function urlFrom(folder: string, path: string): string {
	return relativeUrl(...relative(folder, path).split(sep));
}

/**
 * Makes the document's local links work from a new location.
 *
 * `from` and `to` are the paths the links are resolved against before and
 * after the move. A link that already resolves at the destination is left
 * alone (with `contained`, only if it is inside the destination folder); a
 * file inside the destination folder is linked relatively; anything
 * else is copied into `assetsFolder` next to `to`. Web links, anchors and
 * missing files are untouched.
 */
export async function relocateLinks(
	markdown: string,
	from: string,
	to: string,
	assetsFolder: string,
	/** Every linked file must end up inside the destination folder (a package). */
	contained = false,
): Promise<{ text: string; changed: boolean }> {
	const source = dirname(from);
	const target = dirname(to);
	if (pathKey(source) === pathKey(target)) return { text: markdown, changed: false };

	const root = parse(markdown);
	const copies = new Map<string, string>();
	let changed = false;

	for (const node of urlNodes(root)) {
		if (!isLocalUrl(node.url)) continue;
		const parts = splitUrl(node.url);
		if (parts === null || parts.path === "") continue;
		const there = resolve(target, parts.path);
		if ((!contained || isInside(target, there)) && (await isFile(there))) continue;

		const file = resolve(source, parts.path);
		if (!(await isFile(file))) continue;

		let url: string;
		if (isInside(target, file)) {
			url = urlFrom(target, file);
		} else {
			const key = pathKey(file);
			const copied = copies.get(key) ?? (await copyInto(join(target, assetsFolder), file));
			copies.set(key, copied);
			url = relativeUrl(assetsFolder, copied);
		}
		node.url = url + parts.suffix;
		changed = true;
	}
	return changed ? { text: serialize(root), changed } : { text: markdown, changed };
}

/** Copies a file into `folder` under a free, safe name and returns that name. */
export async function copyInto(folder: string, file: string): Promise<string> {
	await mkdir(folder, { recursive: true });
	const taken = new Set((await readdir(folder)).map(fileNameKey));
	const name = basename(file);
	const base = safeBaseName(name, "file");
	const ext = safeExtension(name);
	for (;;) {
		const candidate = uniqueFileName(base, ext, taken);
		try {
			await copyFile(file, join(folder, candidate), constants.COPYFILE_EXCL);
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(candidate));
		}
	}
}
