#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import("esbuild").BuildOptions} */
const shared = {
	bundle: true,
	platform: "node",
	// Sandboxed preload scripts cannot be ES modules; main uses the same format.
	format: "cjs",
	target: "node22",
	external: ["electron"],
	sourcemap: true,
	legalComments: "none",
	logLevel: "warning",
};

export async function buildMain() {
	await Promise.all([
		build({
			...shared,
			entryPoints: [join(root, "src/main/main.ts")],
			outfile: join(root, "dist/main/main.cjs"),
		}),
		build({
			...shared,
			entryPoints: [join(root, "src/preload/preload.ts")],
			outfile: join(root, "dist/main/preload.cjs"),
		}),
	]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildMain();
