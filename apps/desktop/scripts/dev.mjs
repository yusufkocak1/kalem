#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { createServer } from "vite";
import { buildMain } from "./build-main.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const server = await createServer({ root });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (url === undefined) throw new Error("Vite did not report a local address");

await buildMain();

// Set by Electron-based hosts such as VS Code; it would start the app as plain Node.
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
const child = spawn(String(electron), [root, ...process.argv.slice(2)], {
	stdio: "inherit",
	env: { ...env, KALEM_DEV_URL: url },
});

child.on("exit", (code) => {
	void server.close().then(() => process.exit(code ?? 0));
});
