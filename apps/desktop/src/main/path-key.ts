import { resolve } from "node:path";

/** Windows and macOS file systems are case-insensitive. */
export function pathKey(path: string): string {
	const full = resolve(path);
	// kalem-locale-ok: file-system comparison; the Turkish rule would be wrong here
	return process.platform === "linux" ? full : full.toLowerCase();
}
