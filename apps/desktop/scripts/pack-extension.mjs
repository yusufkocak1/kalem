#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import JSZip from "jszip";

const [folderArg, outArg] = process.argv.slice(2);
if (folderArg === undefined) {
	process.stderr.write("Usage: pack-extension.mjs <extension folder> [out file]\n");
	process.exit(1);
}
const folder = resolve(folderArg);
const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
const zip = new JSZip();

async function add(dir) {
	for (const entry of await readdir(dir)) {
		if (entry.startsWith(".") || entry === "node_modules") continue;
		const path = join(dir, entry);
		if ((await stat(path)).isDirectory()) await add(path);
		else zip.file(relative(folder, path).split("\\").join("/"), await readFile(path));
	}
}
await add(folder);

const out = resolve(
	outArg ?? `${manifest.id ?? basename(folder)}-${manifest.version ?? "0.0.0"}.kalem-ext`,
);
await writeFile(out, await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
process.stdout.write(`${out}\n`);
