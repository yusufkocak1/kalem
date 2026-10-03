import { constants } from "node:fs";
import {
	copyFile,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Attachment, ImageFile, OpenedFile } from "../shared/bridge.js";
import type { LegacyEncoding, TextFormat } from "../shared/encoding.js";
import { decodeBytes, encodeText } from "../shared/encoding.js";
import {
	assetsFolderName,
	fileNameKey,
	IMAGE_EXTENSIONS,
	relativeUrl,
	safeBaseName,
	safeExtension,
	uniqueFileName,
} from "../shared/images.js";

export const MAX_DOCUMENT_SIZE = 32 * 1024 * 1024;
export const MAX_IMAGE_SIZE = 64 * 1024 * 1024;

type FileErrorCode = "too-large" | "image-type" | "not-a-file";

export class FileError extends Error {
	readonly code: FileErrorCode;

	constructor(code: FileErrorCode, message: string) {
		super(message);
		this.name = "FileError";
		this.code = code;
	}
}

export async function readDocument(
	path: string,
	legacyEncoding: LegacyEncoding,
): Promise<OpenedFile> {
	const info = await stat(path);
	if (info.size > MAX_DOCUMENT_SIZE) {
		throw new FileError("too-large", `${basename(path)}: ${Math.round(info.size / 1048576)} MB`);
	}
	const { text, format } = decodeBytes(await readFile(path), legacyEncoding);
	return { path, name: basename(path), text, format, modified: info.mtimeMs };
}

export async function modifiedTime(path: string): Promise<number | null> {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return null;
	}
}

/**
 * Writes via a temp file + rename so an interrupted write never leaves the
 * user's document truncated.
 */
export async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
	let target = path;
	try {
		// Renaming over a symlink would replace the link itself.
		target = await realpath(path);
	} catch {
		// New file.
	}

	const temp = join(dirname(target), `.${basename(target)}.${process.pid}.kalem-tmp`);
	try {
		await writeFile(temp, bytes);
		await rename(temp, target);
	} catch (error) {
		await rm(temp, { force: true }).catch(() => {});
		// The folder may be read-only while the file itself is writable, or the
		// target may be locked against rename: fall back to a direct write.
		try {
			await writeFile(target, bytes);
		} catch {
			throw error;
		}
	}
}

export async function writeDocument(
	path: string,
	text: string,
	format: TextFormat,
): Promise<number> {
	await writeAtomic(path, encodeText(text, format));
	return (await stat(path)).mtimeMs;
}

/**
 * Writes an image into `<document>.assets/` next to the document and returns
 * the relative URL. The extension comes from the validated MIME type, never
 * from the (untrusted) file name.
 */
export async function writeImage(
	documentPath: string,
	image: ImageFile,
	folderName = assetsFolderName(basename(documentPath)),
): Promise<string> {
	// kalem-locale-ok: MIME types are ASCII
	const ext = IMAGE_EXTENSIONS[image.type.toLowerCase()];
	if (ext === undefined) throw new FileError("image-type", image.type);
	if (image.bytes.byteLength > MAX_IMAGE_SIZE) throw new FileError("too-large", image.name);

	const folder = join(dirname(documentPath), folderName);
	await mkdir(folder, { recursive: true });

	const taken = new Set((await readdir(folder)).map(fileNameKey));
	const base = safeBaseName(image.name);
	for (;;) {
		const name = uniqueFileName(base, ext, taken);
		try {
			// `wx`: never overwrite; two concurrent pastes may pick the same name.
			await writeFile(join(folder, name), image.bytes, { flag: "wx" });
			return relativeUrl(folderName, name);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(name));
		}
	}
}

/**
 * Copies any file into `<document>.assets/` so it can be linked from the
 * document and travels with it. The original is never moved or overwritten.
 */
export async function copyAttachment(
	documentPath: string,
	sourcePath: string,
	folderName = assetsFolderName(basename(documentPath)),
): Promise<Attachment> {
	const info = await stat(sourcePath);
	if (!info.isFile()) throw new FileError("not-a-file", basename(sourcePath));

	const original = basename(sourcePath);
	const folder = join(dirname(documentPath), folderName);

	// A file that already lives in the assets folder is linked as it is.
	if (fileNameKey(resolve(dirname(sourcePath))) === fileNameKey(resolve(folder))) {
		return { name: original, url: relativeUrl(folderName, original) };
	}

	await mkdir(folder, { recursive: true });
	const taken = new Set((await readdir(folder)).map(fileNameKey));
	const base = safeBaseName(original, "file");
	const ext = safeExtension(original);
	for (;;) {
		const name = uniqueFileName(base, ext, taken);
		try {
			await copyFile(sourcePath, join(folder, name), constants.COPYFILE_EXCL);
			return { name: original, url: relativeUrl(folderName, name) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			taken.add(fileNameKey(name));
		}
	}
}
