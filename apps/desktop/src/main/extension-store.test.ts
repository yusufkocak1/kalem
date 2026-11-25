import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionPackageError, ExtensionStore, readPackage } from "./extension-store.js";

const manifest = {
	id: "acme.hello",
	name: "Hello",
	version: "1.0.0",
	engines: { kalem: ">=3.0.0" },
	host: "host.js",
	contributes: {
		commands: [{ id: "greet", title: "Greet" }],
		settings: [{ key: "limit", type: "number", default: 5 }],
		secrets: [{ key: "token", title: "Token" }],
	},
};

async function zip(files: Record<string, string>): Promise<Uint8Array> {
	const archive = new JSZip();
	for (const [path, content] of Object.entries(files)) archive.file(path, content);
	return archive.generateAsync({ type: "uint8array" });
}

const box = {
	encrypt: (text: string) => Buffer.from(`sealed:${text}`),
	decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, ""),
};

let root = "";
afterEach(async () => {
	if (root !== "") await rm(root, { recursive: true, force: true });
});

describe("readPackage", () => {
	it("reads a package with its files in a folder", async () => {
		const pkg = await readPackage(
			await zip({ "hello/manifest.json": JSON.stringify(manifest), "hello/host.js": "export {}" }),
			"3.32.0",
		);
		expect(pkg.manifest.id).toBe("acme.hello");
		expect([...pkg.files.keys()].sort()).toEqual(["host.js", "manifest.json"]);
	});

	it("refuses what it cannot trust", async () => {
		await expect(readPackage(new Uint8Array([1, 2, 3]), "3.32.0")).rejects.toThrow(
			ExtensionPackageError,
		);
		await expect(
			readPackage(await zip({ "manifest.json": JSON.stringify(manifest) }), "3.32.0"),
		).rejects.toThrow(/host\.js/);
		await expect(
			readPackage(await zip({ "manifest.json": JSON.stringify(manifest), "host.js": "" }), "2.0.0"),
		).rejects.toThrow(/needs Kalem/);
	});
});

describe("ExtensionStore", () => {
	it("installs, keeps settings and secrets, and uninstalls", async () => {
		root = await mkdtemp(join(tmpdir(), "kalem-ext-"));
		const store = new ExtensionStore(root, box);
		const pkg = await readPackage(
			await zip({ "manifest.json": JSON.stringify(manifest), "host.js": "export {}" }),
			"3.32.0",
		);
		const installed = await store.install(pkg, "file");
		expect(installed.enabled).toBe(true);
		expect(await readFile(join(store.folderOf("acme.hello"), "host.js"), "utf8")).toBe("export {}");

		expect(await store.settingsOf("acme.hello")).toEqual({ limit: 5 });
		await store.setSetting("acme.hello", "limit", "12");
		await store.setSecret("acme.hello", "token", "abc");
		await expect(store.setSecret("acme.hello", "other", "x")).rejects.toThrow();

		const again = new ExtensionStore(root, box);
		expect(await again.settingsOf("acme.hello")).toEqual({ limit: 12 });
		expect(await again.secret("acme.hello", "token")).toBe("abc");
		expect(await readFile(join(root, "secrets.json"), "utf8")).not.toContain('"abc"');

		await again.setEnabled("acme.hello", false);
		expect((await again.get("acme.hello"))?.enabled).toBe(false);

		await again.setEnabled("acme.hello", true);
		await again.setBlocked("acme.hello", "Leaks the token.");
		expect(await again.get("acme.hello")).toMatchObject({
			enabled: false,
			blocked: "Leaks the token.",
		});
		await expect(again.setEnabled("acme.hello", true)).rejects.toThrow(/blocked/);

		await again.uninstall("acme.hello");
		expect(await again.list()).toEqual([]);
		await expect(stat(again.folderOf("acme.hello"))).rejects.toThrow();
		expect(await again.secret("acme.hello", "token")).toBeNull();
	});
});
