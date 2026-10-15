import { constants } from "node:fs";
import { copyFile, mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DIAGRAM_SUFFIX, diagramDataName, parseDiagram } from "../shared/diagram.js";
import { fileNameKey, relativeUrl, safeBaseName } from "../shared/images.js";
import { isPng } from "../shared/png-text.js";
import { MAX_IMAGE_SIZE } from "./files.js";

const MAX_DATA_SIZE = 16 * 1024 * 1024;

/**
 * A diagram's picture name for `title`: `<title>.diagram.png`, or `-2`, `-3`…
 * when the picture or its data file (`<title>.diagram.json`) is taken.
 */
export function diagramFileName(title: string, taken: ReadonlySet<string>): string {
	const base = safeBaseName(`${title}.png`, "diagram");
	for (let n = 1; ; n++) {
		const name = `${n === 1 ? base : `${base}-${n}`}${DIAGRAM_SUFFIX}`;
		if (!taken.has(fileNameKey(name)) && !taken.has(fileNameKey(diagramDataName(name))))
			return name;
	}
}

export function checkDiagramBytes(bytes: unknown): Uint8Array {
	if (!(bytes instanceof Uint8Array) || !isPng(bytes)) throw new Error("Invalid diagram image");
	if (bytes.byteLength > MAX_IMAGE_SIZE) throw new Error("The diagram image is too large");
	return bytes;
}

/** The diagram's data as written to its file; it must read back as a diagram. */
export function checkDiagramData(data: unknown): string {
	if (typeof data !== "string" || data.length > MAX_DATA_SIZE || parseDiagram(data) === null) {
		throw new Error("Invalid diagram data");
	}
	return data;
}

/**
 * The file a diagram URL of the document points to. Only a PNG in the
 * document's folder (or below it) can be rewritten from the diagram editor.
 */
export function diagramPath(contentPath: string, url: string): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/") || url.startsWith("\\")) {
		throw new Error("Not a diagram of this document");
	}
	let path: string;
	try {
		path = decodeURIComponent(url.replace(/[?#].*$/, ""));
	} catch {
		throw new Error("Not a diagram of this document");
	}
	const folder = dirname(contentPath);
	const target = resolve(folder, path);
	const inside = relative(folder, target);
	if (inside === "" || inside.startsWith("..") || isAbsolute(inside) || !/\.png$/i.test(target)) {
		throw new Error("Not a diagram of this document");
	}
	return target;
}

/** Writes the picture and its data file over the diagram at `picturePath`. */
export async function writeDiagram(
	picturePath: string,
	bytes: Uint8Array,
	data: string,
): Promise<void> {
	await writeFile(diagramDataName(picturePath), data, "utf8");
	await writeFile(picturePath, bytes);
}

/**
 * Writes a new diagram (picture and data file) into the document's assets
 * folder; resolves with the picture's relative URL. Never overwrites.
 */
export async function writeNewDiagram(
	contentPath: string,
	folderName: string,
	title: string,
	bytes: Uint8Array,
	data: string,
): Promise<string> {
	const folder = join(dirname(contentPath), folderName);
	await mkdir(folder, { recursive: true });
	const taken = new Set((await readdir(folder)).map(fileNameKey));
	for (;;) {
		const name = diagramFileName(title, taken);
		try {
			await writeFile(join(folder, diagramDataName(name)), data, { encoding: "utf8", flag: "wx" });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(diagramDataName(name)));
			continue;
		}
		try {
			await writeFile(join(folder, name), bytes, { flag: "wx" });
			return relativeUrl(folderName, name);
		} catch (error) {
			await unlink(join(folder, diagramDataName(name))).catch(() => {});
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(name));
		}
	}
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/**
 * Copies a diagram into `folder` with its data file, under a free name that
 * stays a diagram's (`<name>.diagram.png`); returns the picture's new name.
 */
export async function copyDiagramInto(folder: string, picture: string): Promise<string> {
	await mkdir(folder, { recursive: true });
	const taken = new Set((await readdir(folder)).map(fileNameKey));
	const title = basename(picture).slice(0, -DIAGRAM_SUFFIX.length);
	const data = diagramDataName(picture);
	const hasData = await isFile(data);
	for (;;) {
		const name = diagramFileName(title, taken);
		try {
			await copyFile(picture, join(folder, name), constants.COPYFILE_EXCL);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(name));
			continue;
		}
		if (hasData) {
			// Its name was free when chosen; a file appearing since is replaced, not lost.
			await copyFile(data, join(folder, diagramDataName(name)));
		}
		return name;
	}
}
