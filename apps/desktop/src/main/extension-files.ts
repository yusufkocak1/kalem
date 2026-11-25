/** Files an extension with the `files` permission reads and writes (`kalem.fs`). */
import { cp, mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export const MAX_READ_BYTES = 20 * 1024 * 1024;

/** An absolute path; a relative one is taken from `base` (the first open folder). */
export function resolvePath(raw: unknown, base: string | null): string {
	if (typeof raw !== "string" || raw.trim() === "" || raw.includes("\0"))
		throw new Error("Give a path.");
	const path = raw.trim();
	if (isAbsolute(path)) return resolve(path);
	if (base === null) throw new Error(`"${path}" is relative, and no folder is open.`);
	return resolve(base, path);
}

export async function fileCall(
	method: string,
	args: readonly unknown[],
	base: string | null,
): Promise<unknown> {
	const [first, second] = args;
	switch (method) {
		case "fs.readText": {
			const path = resolvePath(first, base);
			const info = await stat(path);
			if (info.size > MAX_READ_BYTES) throw new Error(`${path} is too large to read.`);
			return readFile(path, "utf8");
		}
		case "fs.writeText": {
			const path = resolvePath(first, base);
			await mkdir(dirname(path), { recursive: true });
			const temp = `${path}.kalem-tmp`;
			await writeFile(temp, typeof second === "string" ? second : String(second ?? ""));
			await rename(temp, path);
			return null;
		}
		case "fs.exists":
			return stat(resolvePath(first, base))
				.then(() => true)
				.catch(() => false);
		case "fs.stat": {
			const info = await stat(resolvePath(first, base)).catch(() => null);
			return info === null
				? null
				: { type: info.isDirectory() ? "folder" : "file", size: info.size, modified: info.mtimeMs };
		}
		case "fs.list": {
			const entries = await readdir(resolvePath(first, base), { withFileTypes: true });
			return entries.slice(0, 5000).map((entry) => ({
				name: entry.name,
				type: entry.isDirectory() ? "folder" : "file",
			}));
		}
		case "fs.mkdir":
			await mkdir(resolvePath(first, base), { recursive: true });
			return null;
		case "fs.copy":
			await cp(resolvePath(first, base), resolvePath(second, base), {
				recursive: true,
				force: true,
			});
			return null;
		case "fs.readRange":
			return readRange(resolvePath(first, base), second);
		case "fs.resolve":
			return resolvePath(first, base);
		default:
			throw new Error(`Unknown call: ${method}`);
	}
}

const MAX_RANGE_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

/**
 * Whole lines of a file from a byte offset, for following a log: `{ start, length }`, or
 * `{ tail }` for the last bytes. A line cut at the end is left out unless it is the file's last;
 * one cut at the start too, for `tail` or `align`.
 */
export async function readRange(
	path: string,
	options: unknown,
): Promise<{ text: string; start: number; end: number; size: number }> {
	const input = (options ?? {}) as {
		start?: unknown;
		length?: unknown;
		tail?: unknown;
		align?: unknown;
	};
	const handle = await open(path, "r");
	try {
		const { size } = await handle.stat();
		const limit = Math.min(
			MAX_RANGE_BYTES,
			Math.max(1, Number(input.length ?? input.tail) || 256 * 1024),
		);
		const tail = input.tail !== undefined;
		let start = tail
			? Math.max(0, size - limit)
			: Math.min(size, Math.max(0, Math.floor(Number(input.start) || 0)));
		const length = Math.min(limit, size - start);
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, start);
		let from = 0;
		let to = bytesRead;
		if ((tail || input.align === true) && start > 0) {
			const first = buffer.indexOf(NEWLINE);
			from = first === -1 ? to : first + 1;
		}
		if (start + to < size) {
			const last = buffer.lastIndexOf(NEWLINE, to - 1);
			to = last < from ? from : last + 1;
		}
		start += from;
		return {
			text: buffer.subarray(from, to).toString("utf8"),
			start,
			end: start + (to - from),
			size,
		};
	} finally {
		await handle.close();
	}
}
