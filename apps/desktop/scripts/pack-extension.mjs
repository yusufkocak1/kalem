#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

/** A folder as a `.kalem-ext` package: its manifest and its bytes. */
export async function packFolder(folder) {
	const root = resolve(folder);
	const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
	const zip = new JSZip();
	async function add(dir) {
		for (const entry of (await readdir(dir)).sort()) {
			if (entry.startsWith(".") || entry === "node_modules") continue;
			const path = join(dir, entry);
			if ((await stat(path)).isDirectory()) await add(path);
			else
				zip.file(relative(root, path).split("\\").join("/"), await readFile(path), {
					date: new Date(0),
				});
		}
	}
	await add(root);
	const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
	return { manifest, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [folderArg, outArg] = process.argv.slice(2);
	if (folderArg === undefined) {
		process.stderr.write("Usage: pack-extension.mjs <extension folder> [out file]\n");
		process.exit(1);
	}
	const { manifest, bytes } = await packFolder(folderArg);
	const out = resolve(
		outArg ??
			`${manifest.id ?? basename(resolve(folderArg))}-${manifest.version ?? "0.0.0"}.kalem-ext`,
	);
	await writeFile(out, bytes);
	process.stdout.write(`${out}\n`);
}
