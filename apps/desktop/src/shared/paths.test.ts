import { describe, expect, it } from "vitest";
import {
	documentBaseUrl,
	extension,
	fileName,
	isEditablePath,
	isWordPath,
	stripExtension,
	urlPathToFilePath,
} from "./paths.js";

describe("names and extensions", () => {
	it("finds the last segment with either separator", () => {
		expect(fileName("C:\\Belgeler\\rapor.md")).toBe("rapor.md");
		expect(fileName("/home/u/rapor.md")).toBe("rapor.md");
		expect(fileName("rapor.md")).toBe("rapor.md");
	});

	it("strips the extension but not a leading dot", () => {
		expect(stripExtension("rapor.md")).toBe("rapor");
		expect(stripExtension("notlar.v2.md")).toBe("notlar.v2");
		expect(stripExtension(".gitignore")).toBe(".gitignore");
		expect(stripExtension("adsiz")).toBe("adsiz");
	});

	it("reads the extension case-insensitively", () => {
		expect(extension("C:\\a\\Rapor.DOCX")).toBe("docx");
		expect(extension("BENİOKU.MD")).toBe("md");
		expect(extension("klasor.v2/dosya")).toBe("");
	});

	it("tells document types apart", () => {
		expect(isEditablePath("a.md")).toBe(true);
		expect(isEditablePath("a.MARKDOWN")).toBe(true);
		expect(isEditablePath("Notlar.TXT")).toBe(true);
		expect(isEditablePath("a.docx")).toBe(false);
		expect(isEditablePath("a.txt.exe")).toBe(false);
		expect(isWordPath("a.docx")).toBe(true);
		expect(isWordPath("a.doc")).toBe(true);
		expect(isWordPath("a.md")).toBe(false);
	});
});

describe("documentBaseUrl", () => {
	const SCHEME = "kalem-doc";

	it("converts Windows and POSIX paths", () => {
		expect(documentBaseUrl(SCHEME, "C:\\Belgeler\\rapor.md")).toBe(
			"kalem-doc://local/C%3A/Belgeler/",
		);
		expect(documentBaseUrl(SCHEME, "/home/u/rapor.md")).toBe("kalem-doc://local/home/u/");
	});

	it("encodes spaces, Turkish letters and special characters", () => {
		expect(documentBaseUrl(SCHEME, "C:\\Yeni Klasör\\a#b\\x.md")).toBe(
			"kalem-doc://local/C%3A/Yeni%20Klas%C3%B6r/a%23b/",
		);
	});

	it("resolves relative URLs back to the same file path", () => {
		const cases: [string, string, boolean, string][] = [
			[
				"C:\\Belgeler\\rapor.md",
				"rapor.assets/a%20b.png",
				true,
				"C:\\Belgeler\\rapor.assets\\a b.png",
			],
			["C:\\Yeni Klasör\\x.md", "../ortak/ş.png", true, "C:\\ortak\\ş.png"],
			["/home/u/rapor.md", "resim/a.png", false, "/home/u/resim/a.png"],
			["\\\\sunucu\\ortak\\a.md", "b.png", true, "\\\\sunucu\\ortak\\b.png"],
		];
		for (const [documentPath, relative, windows, expected] of cases) {
			const url = new URL(relative, documentBaseUrl(SCHEME, documentPath));
			expect(urlPathToFilePath(url.pathname, windows)).toBe(expected);
		}
	});
});

describe("urlPathToFilePath", () => {
	it("rejects malformed encoding and NUL bytes", () => {
		expect(urlPathToFilePath("/C%3A/a%ZZ.png", true)).toBeNull();
		expect(urlPathToFilePath("/home/u/a%00.png", false)).toBeNull();
	});
});
