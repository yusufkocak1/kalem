import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FORMAT } from "../shared/encoding.js";
import { modifiedTime, readDocument, writeAtomic, writeDocument, writeImage } from "./files.js";
import { PNG_1X1 } from "./sample-docx.test-helper.js";

let folder: string;

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), "kalem-files-"));
});

afterEach(async () => {
	await rm(folder, { recursive: true, force: true });
});

describe("readDocument / writeDocument", () => {
	it("round-trips a CRLF file with a BOM byte for byte", async () => {
		const path = join(folder, "rapor.md");
		const original = Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf]),
			Buffer.from("# Başlık\r\n\r\nışık\r\n", "utf8"),
		]);
		await writeFile(path, original);

		const file = await readDocument(path, "windows-1254");
		expect(file.name).toBe("rapor.md");
		expect(file.text).toBe("# Başlık\n\nışık\n");
		expect(file.format).toEqual({ encoding: "utf-8", bom: true, lineEnding: "crlf" });

		await writeDocument(path, file.text, file.format);
		expect(await readFile(path)).toEqual(original);
	});

	it("reports the modification time it wrote", async () => {
		const path = join(folder, "a.md");
		const modified = await writeDocument(path, "metin\n", DEFAULT_FORMAT);
		expect(modified).toBe(await modifiedTime(path));
		expect(await modifiedTime(join(folder, "missing.md"))).toBeNull();
	});

	it("leaves no temp file behind", async () => {
		await writeDocument(join(folder, "a.md"), "metin\n", DEFAULT_FORMAT);
		expect(await readdir(folder)).toEqual(["a.md"]);
	});

	it("replaces existing content completely", async () => {
		const path = join(folder, "a.md");
		await writeFile(path, "a much longer previous version\n");
		await writeAtomic(path, new TextEncoder().encode("kısa\n"));
		expect(await readFile(path, "utf8")).toBe("kısa\n");
	});

	it("writes through a symlink instead of replacing it", async () => {
		const target = join(folder, "target.md");
		const link = join(folder, "link.md");
		await writeFile(target, "eski\n");
		try {
			await symlink(target, link);
		} catch {
			// Creating symlinks needs a privilege on Windows; nothing to test without it.
			return;
		}
		await writeDocument(link, "yeni\n", DEFAULT_FORMAT);
		expect(await readFile(target, "utf8")).toBe("yeni\n");
	});
});

describe("writeImage", () => {
	const png = (name: string) => ({ name, type: "image/png", bytes: new Uint8Array(PNG_1X1) });

	it("writes into <document>.assets and returns a relative URL", async () => {
		const documentPath = join(folder, "Çeyrek Raporu.md");
		const url = await writeImage(documentPath, png("Ekran Görüntüsü.png"));

		expect(url).toBe("%C3%87eyrek%20Raporu.assets/Ekran-G%C3%B6r%C3%BCnt%C3%BCs%C3%BC.png");
		const written = await readFile(join(folder, "Çeyrek Raporu.assets", "Ekran-Görüntüsü.png"));
		expect(written).toEqual(PNG_1X1);
	});

	it("never overwrites an existing image", async () => {
		const documentPath = join(folder, "a.md");
		const urls = await Promise.all([
			writeImage(documentPath, png("foto.png")),
			writeImage(documentPath, png("foto.png")),
			writeImage(documentPath, png("FOTO.png")),
		]);
		expect(new Set(urls).size).toBe(3);
		expect(await readdir(join(folder, "a.assets"))).toHaveLength(3);
	});

	it("takes the extension from the MIME type, not the file name", async () => {
		const url = await writeImage(join(folder, "a.md"), png("fatura.exe"));
		expect(url).toBe("a.assets/fatura.png");
	});

	it("cannot be made to write outside the assets folder", async () => {
		const url = await writeImage(join(folder, "a.md"), png("../../kacak.png"));
		expect(url).toBe("a.assets/kacak.png");
		expect((await readdir(folder)).sort()).toEqual(["a.assets"]);
	});

	it("rejects types that are not whitelisted images", async () => {
		const svg = { name: "x.svg", type: "image/svg+xml", bytes: new Uint8Array([60]) };
		await expect(writeImage(join(folder, "a.md"), svg)).rejects.toMatchObject({
			code: "image-type",
		});
	});
});
