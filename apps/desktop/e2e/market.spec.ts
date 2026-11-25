import { execFileSync } from "node:child_process";
import { cp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, normalize } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, tempDir } from "./launch.js";

const REGISTRY = join(import.meta.dirname, "..", "scripts", "extension-registry.mjs");
const SAMPLES = join(import.meta.dirname, "..", "extension-samples");

async function serve(folder: string) {
	const requested: string[] = [];
	const server = createServer(async (request, response) => {
		const path = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
		requested.push(path);
		try {
			const data = await readFile(join(folder, normalize(path).replace(/^([/\\])+/, "")));
			response.end(data);
		} catch {
			response.statusCode = 404;
			response.end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/index.json`,
		requested,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

test("the market installs and updates from a signed catalog, refuses what was changed, and obeys a block", async () => {
	const keys = await tempDir("keys");
	const publicKey = execFileSync(process.execPath, [REGISTRY, "keygen", keys], { encoding: "utf8" })
		.trim()
		.split("\n")
		.at(-1) as string;
	const source = await tempDir("catalog-source");
	await cp(join(SAMPLES, "hello-api"), join(source, "hello-api"), { recursive: true });
	await cp(join(SAMPLES, "graylog"), join(source, "graylog"), { recursive: true });
	const out = await tempDir("catalog");
	const build = (...extra: string[]) =>
		execFileSync(process.execPath, [
			REGISTRY,
			"build",
			source,
			out,
			"--key",
			join(keys, "private.pem"),
			"--name",
			"Acme",
			...extra,
		]);
	build();
	const server = await serve(out);
	cleanup.push(server.close);

	const { app, page, errors } = await launch();
	await clickMenu(app, "Extensions", "Manage Extensions…");
	const settings = page.locator('[data-block="extensions"]');
	await settings.getByRole("tab", { name: "Market" }).click();
	await expect(settings.locator(".ext-market")).toContainText("No catalogs yet");

	// A catalog with another key is not trusted.
	await expect(settings.locator(".ext-registry-editor")).toHaveAttribute("open", "");
	await settings.getByLabel("Name").fill("Wrong key");
	await settings.getByLabel("Address of index.json").fill(server.url);
	await settings
		.getByLabel("Public key")
		.fill("MCowBQYDK2VwAyEAN+3XazxLR7ME2uPajmicLCL2T/3/gtCGK1rOhZrTo7U=");
	await settings.getByRole("button", { name: "Add Catalog" }).click();
	await expect(settings.locator(".ext-market .ext-error")).toContainText(
		"signature does not match its key",
	);
	await settings.locator(".ext-registries li").getByRole("button", { name: "Remove" }).click();

	await settings.getByLabel("Name").fill("Acme");
	await settings.getByLabel("Address of index.json").fill(server.url);
	await settings.getByLabel("Public key").fill(publicKey);
	await settings.getByRole("button", { name: "Add Catalog" }).click();
	const hello = settings.locator('[data-market="kalem.hello-api"]');
	await expect(hello).toContainText("1.0.0 · Kalem");
	await expect(settings.locator("[data-market]")).toHaveCount(2);
	await expect(settings.locator('[data-market="kalem.graylog"]')).toContainText(
		"Give the assistant tools",
	);

	await settings.getByLabel("Search extensions").fill("graylog");
	await expect(settings.locator("[data-market]")).toHaveCount(1);
	await settings.getByLabel("Search extensions").fill("");

	await hello.getByRole("button", { name: "Install" }).click();
	const preview = settings.locator(".ext-preview");
	await expect(preview).toContainText("Install Hello API?");
	await preview.getByRole("button", { name: "Install", exact: true }).click();
	await expect(hello.getByRole("button", { name: "Installed" })).toBeDisabled();
	await settings.getByRole("tab", { name: "Installed" }).click();
	const card = settings.locator('.ext-card[data-extension="kalem.hello-api"]');
	await expect(card.locator(".ext-badge")).toHaveText("Running");
	await expect(card).toContainText("1.0.0 · Kalem · from Acme");

	// A changed package is refused: its hash is not the signed one.
	const graylogFile = join(out, "kalem.graylog-1.0.0.kalem-ext");
	await writeFile(graylogFile, Buffer.concat([await readFile(graylogFile), Buffer.from("x")]));
	await settings.getByRole("tab", { name: "Market" }).click();
	await settings
		.locator('[data-market="kalem.graylog"]')
		.getByRole("button", { name: "Install" })
		.click();
	await expect(settings.locator(".ext-status")).toContainText("its sha256 differs");
	await expect(preview).toBeHidden();

	// A new version: offered as an update, on the market and on the installed card.
	const manifestFile = join(source, "hello-api", "manifest.json");
	const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
	await writeFile(manifestFile, JSON.stringify({ ...manifest, version: "1.1.0" }));
	await cp(join(SAMPLES, "graylog"), join(source, "graylog"), { recursive: true });
	execFileSync("rm", ["-f", graylogFile]);
	build();
	await settings.getByRole("button", { name: "Refresh" }).click();
	await expect(hello.getByRole("button", { name: "Update to 1.1.0" })).toBeVisible();
	await settings.getByRole("tab", { name: "Installed" }).click();
	await card.getByRole("button", { name: "Update to 1.1.0" }).click();
	await expect(preview).toContainText("Update Hello API from 1.0.0 to 1.1.0?");
	await expect(preview).toContainText("It asks for nothing new");
	await preview.getByRole("button", { name: "Install", exact: true }).click();
	await expect(card).toContainText("1.1.0 · Kalem · from Acme");
	await expect(card.getByRole("button", { name: /Update to/ })).toHaveCount(0);

	// The catalog blocks it: it is turned off and stays off.
	const blocked = join(keys, "blocked.json");
	await writeFile(
		blocked,
		JSON.stringify([{ id: "kalem.hello-api", versions: "*", reason: "It leaks the token." }]),
	);
	build("--blocked", blocked);
	await settings.getByRole("tab", { name: "Market" }).click();
	await settings.getByRole("button", { name: "Refresh" }).click();
	await expect(settings.locator("[data-market]")).toHaveCount(1);
	await settings.getByRole("tab", { name: "Installed" }).click();
	await expect(card).toContainText("Blocked by its catalog: It leaks the token.");
	await expect(card.locator(".ext-badge")).toHaveText("Off");
	await expect(card.locator(".mode-switch-input")).not.toBeChecked();
	await expect(card.locator(".mode-switch-input")).toBeDisabled();
	expect(errors).toEqual([]);
});
