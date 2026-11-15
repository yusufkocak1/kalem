import { stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathKey } from "./path-key.js";

export async function findRepoRoot(folder: string): Promise<string | null> {
	let current = resolve(folder);
	for (let depth = 0; depth < 64; depth++) {
		const found = await stat(`${current}${sep}.git`).catch(() => null);
		if (found !== null) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
}

export function isTrustedRepo(repo: string, trusted: readonly string[]): boolean {
	const key = pathKey(repo);
	return trusted.some((folder) => {
		const base = pathKey(folder);
		return key === base || key.startsWith(base.endsWith(sep) ? base : base + sep);
	});
}
