import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "@kalem-editor/core";
import JSZip from "jszip";
import type { OpenedFile } from "../shared/bridge.js";
import type { LegacyEncoding, TextFormat } from "../shared/encoding.js";
import { decodeBytes, encodeText } from "../shared/encoding.js";
import { MAX_DOCUMENT_SIZE, writeAtomic } from "./files.js";
import { pathKey } from "./path-key.js";
import { isLocalUrl, relocateLinks, splitUrl, urlNodes } from "./relocate.js";

/**
 * A Kalem package (`.kmd`) is a TextBundle in a zip, the same layout as a
 * `.textpack`: `text.md`, an `assets/` folder and `info.json`.
 * See https://textbundle.org/spec/
 */
export const PACKAGE_ASSETS = "assets";
const TEXT_NAME = "text.md";

const MAX_PACKAGE_SIZE = 1024 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

/** Already-compressed formats are stored as they are; deflating them only costs time. */
const STORED =
	/\.(png|jpe?g|gif|webp|avif|zip|7z|gz|rar|pdf|docx|xlsx|pptx|mp3|mp4|m4a|mov|webm)$/i;

type PackageErrorCode = "not-a-package" | "no-text" | "unsafe-entry" | "too-large";

export class PackageError extends Error {
	readonly code: PackageErrorCode;

	constructor(code: PackageErrorCode, message: string) {
		super(message);
		this.name = "PackageError";
		this.code = code;
	}
}

const INFO = {
	version: 2,
	type: "net.daringfireball.markdown",
	transient: false,
	creatorIdentifier: "dev.kalem.desktop",
};

/** A zip entry name as a safe relative path, or `null` for one that must not be written. */
function safeEntryPath(name: string): string | null {
	const path = name.replace(/\\/g, "/");
	if (path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
	const segments = path.split("/");
	if (segments.some((segment) => segment === ".." || segment.includes("\0"))) return null;
	return segments.filter((segment) => segment !== "" && segment !== ".").join("/");
}

/** The text file at the bundle root; `.textpack` exports often wrap the bundle in a folder. */
function findText(paths: readonly string[]): { prefix: string; text: string } | null {
	const atRoot = (prefix: string): string | undefined =>
		paths.find(
			(path) => path.startsWith(prefix) && /^text\.[^/]+$/i.test(path.slice(prefix.length)),
		);

	const direct = atRoot("");
	if (direct !== undefined) return { prefix: "", text: direct };
	const folders = new Set(paths.map((path) => path.split("/")[0]));
	if (folders.size !== 1) return null;
	const prefix = `${[...folders][0]}/`;
	const nested = atRoot(prefix);
	return nested === undefined ? null : { prefix, text: nested };
}

/** Unpacks a package into `folder` and returns the text file's name inside it. */
export async function unpack(bytes: Uint8Array, folder: string): Promise<string> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(bytes);
	} catch {
		throw new PackageError("not-a-package", "This file is not a Kalem package.");
	}

	const entries = Object.values(zip.files).filter(
		(entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"),
	);
	if (entries.length > MAX_ENTRIES) throw new PackageError("too-large", "Too many files.");

	const paths = new Map<string, JSZip.JSZipObject>();
	for (const entry of entries) {
		// JSZip quietly rewrites `../` names; the name as written in the archive is what counts.
		const raw = (entry as { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
		const path = safeEntryPath(raw) === null ? null : safeEntryPath(entry.name);
		if (path === null) throw new PackageError("unsafe-entry", raw);
		if (path !== "") paths.set(path, entry);
	}
	const layout = findText([...paths.keys()]);
	if (layout === null) throw new PackageError("no-text", "The package has no text file.");

	// The declared size is checked before inflating, so a zip bomb never reaches memory.
	let total = 0;
	for (const entry of paths.values()) {
		const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
			?.uncompressedSize;
		total += typeof declared === "number" ? declared : 0;
	}
	if (total > MAX_PACKAGE_SIZE) throw new PackageError("too-large", "The package is too large.");

	const root = resolve(folder);
	await mkdir(root, { recursive: true });
	for (const [path, entry] of paths) {
		if (!path.startsWith(layout.prefix)) continue;
		const target = resolve(root, path.slice(layout.prefix.length));
		if (!target.startsWith(root + sep)) throw new PackageError("unsafe-entry", entry.name);
		const content = await entry.async("uint8array");
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, content);
	}
	return layout.text.slice(layout.prefix.length);
}

/** Zips the text file, `info.json` and every local file the text links to inside `folder`. */
export async function pack(folder: string, textName: string, text: string): Promise<Uint8Array> {
	const zip = new JSZip();
	zip.file("info.json", `${JSON.stringify(INFO, null, 2)}\n`);
	zip.file(textName, await readFile(join(folder, textName)));

	const root = resolve(folder);
	const added = new Set<string>();
	for (const node of urlNodes(parse(text))) {
		if (!isLocalUrl(node.url)) continue;
		const parts = splitUrl(node.url);
		if (parts === null || parts.path === "") continue;
		const file = resolve(root, parts.path);
		const name = relative(root, file).split(sep).join("/");
		if (!file.startsWith(root + sep) || added.has(name) || name === textName) continue;
		try {
			if (!(await stat(file)).isFile()) continue;
		} catch {
			continue;
		}
		added.add(name);
		zip.file(name, await readFile(file), { compression: STORED.test(name) ? "STORE" : "DEFLATE" });
	}
	return zip.generateAsync({
		type: "uint8array",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});
}

interface WorkFolder {
	readonly folder: string;
	readonly textName: string;
}

/**
 * Open packages are edited in an unpacked working folder; saving packs that
 * folder back into the package file. Working folders live under one root that
 * is cleared at startup.
 */
export class PackageStore {
	readonly #root: string;
	readonly #open = new Map<string, WorkFolder>();

	constructor(root: string) {
		this.#root = root;
	}

	async clear(): Promise<void> {
		await rm(this.#root, { recursive: true, force: true });
	}

	/** The path links in an open package resolve against, or `null` if it is not open. */
	contentPath(packagePath: string): string | null {
		const work = this.#open.get(pathKey(packagePath));
		return work === undefined ? null : join(work.folder, work.textName);
	}

	/** The package's working folder, created empty for a package that is about to be written. */
	async workFolder(packagePath: string): Promise<WorkFolder> {
		const key = pathKey(packagePath);
		const existing = this.#open.get(key);
		if (existing !== undefined) return existing;
		const work = { folder: join(this.#root, randomUUID()), textName: TEXT_NAME };
		await mkdir(join(work.folder, PACKAGE_ASSETS), { recursive: true });
		this.#open.set(key, work);
		return work;
	}

	async open(packagePath: string, legacyEncoding: LegacyEncoding): Promise<OpenedFile> {
		const info = await stat(packagePath);
		const previous = this.#open.get(pathKey(packagePath));
		const folder = join(this.#root, randomUUID());
		try {
			const textName = await unpack(await readFile(packagePath), folder);
			const textPath = join(folder, textName);
			if ((await stat(textPath)).size > MAX_DOCUMENT_SIZE) {
				throw new PackageError("too-large", textName);
			}
			const { text, format } = decodeBytes(await readFile(textPath), legacyEncoding);
			this.#open.set(pathKey(packagePath), { folder, textName });
			if (previous !== undefined) await rm(previous.folder, { recursive: true, force: true });
			return {
				path: packagePath,
				name: basename(packagePath),
				text,
				format,
				modified: info.mtimeMs,
				base: textPath,
			};
		} catch (error) {
			await rm(folder, { recursive: true, force: true });
			throw error;
		}
	}

	/**
	 * Writes the text into the working folder, pulls in local files linked from
	 * `from` (the path links resolved against before this save) and packs it.
	 */
	async save(
		packagePath: string,
		text: string,
		format: TextFormat,
		from: string | null,
	): Promise<{ modified: number; text: string; changed: boolean; base: string }> {
		const work = await this.workFolder(packagePath);
		const base = join(work.folder, work.textName);
		const relocated =
			from === null
				? { text, changed: false }
				: await relocateLinks(text, from, base, PACKAGE_ASSETS, true);
		await writeFile(base, encodeText(relocated.text, format));
		await writeAtomic(packagePath, await pack(work.folder, work.textName, relocated.text));
		return { modified: (await stat(packagePath)).mtimeMs, ...relocated, base };
	}

	async release(packagePath: string): Promise<void> {
		const key = pathKey(packagePath);
		const work = this.#open.get(key);
		this.#open.delete(key);
		if (work !== undefined) await rm(work.folder, { recursive: true, force: true });
	}
}
