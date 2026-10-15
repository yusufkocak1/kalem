import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DIAGRAM_SUFFIX } from "../shared/diagram.js";
import { fileNameKey, relativeUrl, safeBaseName } from "../shared/images.js";
import { isPng } from "../shared/png-text.js";
import { MAX_IMAGE_SIZE } from "./files.js";

/** A diagram's file name for `title`: `<title>.diagram.png`, or `-2`, `-3`… when taken. */
export function diagramFileName(title: string, taken: ReadonlySet<string>): string {
	const base = safeBaseName(`${title}.png`, "diagram");
	for (let n = 1; ; n++) {
		const name = `${n === 1 ? base : `${base}-${n}`}${DIAGRAM_SUFFIX}`;
		if (!taken.has(fileNameKey(name))) return name;
	}
}

export function checkDiagramBytes(bytes: unknown): Uint8Array {
	if (!(bytes instanceof Uint8Array) || !isPng(bytes)) throw new Error("Invalid diagram image");
	if (bytes.byteLength > MAX_IMAGE_SIZE) throw new Error("The diagram image is too large");
	return bytes;
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

/** Writes a new diagram into the document's assets folder; resolves with its relative URL. */
export async function writeNewDiagram(
	contentPath: string,
	folderName: string,
	title: string,
	bytes: Uint8Array,
): Promise<string> {
	const folder = join(dirname(contentPath), folderName);
	await mkdir(folder, { recursive: true });
	const taken = new Set((await readdir(folder)).map(fileNameKey));
	for (;;) {
		const name = diagramFileName(title, taken);
		try {
			await writeFile(join(folder, name), bytes, { flag: "wx" });
			return relativeUrl(folderName, name);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(name));
		}
	}
}
