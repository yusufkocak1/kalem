#!/usr/bin/env node
// Renders resources/icon.svg to the PNG electron-builder turns into .ico/.icns.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const resources = join(dirname(fileURLToPath(import.meta.url)), "..", "resources");
const svg = await readFile(join(resources, "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(
	`<style>html,body{margin:0;background:transparent}</style>${svg.replace("<svg ", '<svg width="1024" height="1024" ')}`,
);
await page.screenshot({ path: join(resources, "icon.png"), omitBackground: true });
await browser.close();
