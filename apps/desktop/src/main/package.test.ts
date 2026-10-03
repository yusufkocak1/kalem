import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FORMAT } from "../shared/encoding.js";
import { PackageError, PackageStore, pack, unpack } from "./package.js";
import { relocateLinks } from "./relocate.js";
import { PNG_1X1 } from "./sample-docx.test-helper.js";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "kalem-package-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
	const zip = new JSZip();
	for (const [name, content] of Object.entries(files)) zip.file(name, content);
	return zip.generateAsync({ type: "uint8array" });
}

async function entries(bytes: Uint8Array): Promise<string[]> {
	const zip = await JSZip.loadAsync(bytes);
	return Object.values(zip.files)
		.filter((entry) => !entry.dir)
		.map((entry) => entry.name)
		.sort();
}

describe("unpack", () => {
	it("extracts a TextBundle and reports its text file", async () => {
		const bytes = await zipOf({ "text.md": "# Hi\n", "assets/a.png": PNG_1X1, "info.json": "{}" });
		expect(await unpack(bytes, join(root, "out"))).toBe("text.md");
		expect(await readFile(join(root, "out", "assets", "a.png"))).toEqual(Buffer.from(PNG_1X1));
	});

	it("accepts a .textpack that wraps the bundle in a folder", async () => {
		const bytes = await zipOf({
			"Notes.textbundle/text.markdown": "x\n",
			"Notes.textbundle/assets/a.png": PNG_1X1,
		});
		expect(await unpack(bytes, join(root, "out"))).toBe("text.markdown");
		expect(await readdir(join(root, "out", "assets"))).toEqual(["a.png"]);
	});

	it("refuses entries that would land outside the folder", async () => {
		// JSZip will not write such names, so a harmless name of the same length is
		// written and then swapped in the raw bytes, as a hostile archive would have it.
		const hostile: [string, string][] = [
			["zz/evil.txt", "../evil.txt"],
			["assets/zz/zz/evil.txt", "assets/../../evil.txt"],
			["zabs.txt", "/abs.txt"],
			["zz/abs.txt", "C:/abs.txt"],
		];
		for (const [harmless, name] of hostile) {
			const zipped = Buffer.from(await zipOf({ "text.md": "x", [harmless]: "evil" }));
			const from = Buffer.from(harmless);
			const to = Buffer.from(name);
			for (let at = zipped.indexOf(from); at !== -1; at = zipped.indexOf(from, at + 1)) {
				to.copy(zipped, at);
			}
			await expect(unpack(zipped, join(root, "out"))).rejects.toMatchObject({
				code: "unsafe-entry",
			});
		}
		expect(await readdir(root)).not.toContain("evil.txt");
	});

	it("refuses a zip without a text file and a file that is not a zip", async () => {
		await expect(unpack(await zipOf({ "assets/a.png": PNG_1X1 }), root)).rejects.toBeInstanceOf(
			PackageError,
		);
		await expect(unpack(new TextEncoder().encode("# not a zip"), root)).rejects.toMatchObject({
			code: "not-a-package",
		});
	});
});

describe("pack", () => {
	it("keeps only the files the text links to", async () => {
		const folder = join(root, "work");
		await mkdir(join(folder, "assets"), { recursive: true });
		await writeFile(join(folder, "assets", "used one.png"), PNG_1X1);
		await writeFile(join(folder, "assets", "unused.png"), PNG_1X1);
		await writeFile(join(folder, "assets", "doc.pdf"), "pdf");
		const text = "![a](assets/used%20one.png)\n\n[doc](assets/doc.pdf#page=2) [web](https://x.y)\n";
		await writeFile(join(folder, "text.md"), text);

		expect(await entries(await pack(folder, "text.md", text))).toEqual([
			"assets/doc.pdf",
			"assets/used one.png",
			"info.json",
			"text.md",
		]);
	});
});

describe("relocateLinks", () => {
	beforeEach(async () => {
		await mkdir(join(root, "old", "notes.assets"), { recursive: true });
		await writeFile(join(root, "old", "notes.assets", "a b.png"), PNG_1X1);
		await writeFile(join(root, "shared.pdf"), "pdf");
		await mkdir(join(root, "new"), { recursive: true });
	});

	it("copies linked files next to the new location and rewrites the links", async () => {
		const result = await relocateLinks(
			"![a](notes.assets/a%20b.png)\n\n[pdf](../shared.pdf#p2) [web](https://x.y) [top](#top)\n",
			join(root, "old", "notes.md"),
			join(root, "new", "copy.md"),
			"copy.assets",
		);
		expect(result.changed).toBe(true);
		// `../shared.pdf` still reaches the same file from the new folder.
		expect(result.text).toBe(
			"![a](copy.assets/a-b.png)\n\n[pdf](../shared.pdf#p2) [web](https://x.y) [top](#top)\n",
		);
		expect(await readdir(join(root, "new", "copy.assets"))).toEqual(["a-b.png"]);
	});

	it("copies everything into a contained destination", async () => {
		const result = await relocateLinks(
			"[pdf](../shared.pdf#p2)\n",
			join(root, "old", "notes.md"),
			join(root, "new", "text.md"),
			"assets",
			true,
		);
		expect(result.text).toBe("[pdf](assets/shared.pdf#p2)\n");
		expect(await readdir(join(root, "new", "assets"))).toEqual(["shared.pdf"]);
	});

	it("links a file inside the new folder relatively instead of copying it", async () => {
		const result = await relocateLinks(
			"[pdf](shared.pdf)\n",
			join(root, "old", "notes.md"),
			join(root, "notes.md"),
			"notes.assets",
		);
		expect(result.text).toBe("[pdf](shared.pdf)\n");
		const nested = await relocateLinks(
			"[pdf](../shared.pdf)\n",
			join(root, "old", "notes.md"),
			join(root, "notes.md"),
			"notes.assets",
		);
		expect(nested.text).toBe("[pdf](shared.pdf)\n");
	});

	it("does nothing when the folder stays the same or the file is missing", async () => {
		const same = await relocateLinks(
			"![a](x.png)\n",
			join(root, "a.md"),
			join(root, "b.md"),
			"b.assets",
		);
		expect(same).toEqual({ text: "![a](x.png)\n", changed: false });
		const missing = await relocateLinks(
			"![a](nope.png)\n",
			join(root, "old", "notes.md"),
			join(root, "new", "notes.md"),
			"notes.assets",
		);
		expect(missing.changed).toBe(false);
	});
});

describe("PackageStore", () => {
	it("saves a Markdown document as a package and opens it again", async () => {
		const store = new PackageStore(join(root, "work"));
		const packagePath = join(root, "new", "Notlar.kmd");
		await mkdir(join(root, "new"));
		await mkdir(join(root, "old", "notes.assets"), { recursive: true });
		await writeFile(join(root, "old", "notes.assets", "a.png"), PNG_1X1);

		const saved = await store.save(
			packagePath,
			"# Notlar\n\n![a](notes.assets/a.png)\n",
			DEFAULT_FORMAT,
			join(root, "old", "notes.md"),
		);
		expect(saved.changed).toBe(true);
		expect(saved.text).toBe("# Notlar\n\n![a](assets/a.png)\n");
		expect(await entries(await readFile(packagePath))).toEqual([
			"assets/a.png",
			"info.json",
			"text.md",
		]);
		const info = JSON.parse(
			await (await JSZip.loadAsync(await readFile(packagePath))).file("info.json")!.async("string"),
		);
		expect(info).toMatchObject({ version: 2, type: "net.daringfireball.markdown" });

		const other = new PackageStore(join(root, "work2"));
		const opened = await other.open(packagePath, "windows-1254");
		expect(opened.text).toBe("# Notlar\n\n![a](assets/a.png)\n");
		expect(opened.base).toBe(other.contentPath(packagePath));
		expect(await readFile(join(opened.base as string, "..", "assets", "a.png"))).toEqual(
			Buffer.from(PNG_1X1),
		);

		await other.release(packagePath);
		expect(other.contentPath(packagePath)).toBeNull();
		expect(await readdir(join(root, "work2"))).toEqual([]);
	});

	it("leaves the working folder untouched when a package cannot be opened", async () => {
		const store = new PackageStore(join(root, "work"));
		const broken = join(root, "broken.kmd");
		await writeFile(broken, "not a zip");
		await expect(store.open(broken, "windows-1254")).rejects.toBeInstanceOf(PackageError);
		expect(store.contentPath(broken)).toBeNull();
	});
});
