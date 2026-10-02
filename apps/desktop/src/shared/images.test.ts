import { describe, expect, it } from "vitest";
import {
	assetsFolderName,
	isEmbeddedImage,
	parseDataUrl,
	relativeUrl,
	safeBaseName,
	toDataUrl,
	uniqueFileName,
} from "./images.js";

describe("assetsFolderName", () => {
	it("replaces the document extension with .assets", () => {
		expect(assetsFolderName("rapor.md")).toBe("rapor.assets");
		expect(assetsFolderName("notlar.TXT")).toBe("notlar.assets");
		expect(assetsFolderName("Çeyrek Raporu.MARKDOWN")).toBe("Çeyrek Raporu.assets");
		expect(assetsFolderName("notlar.v2.md")).toBe("notlar.v2.assets");
	});
});

describe("safeBaseName", () => {
	it("drops the extension and separators, keeps Turkish letters", () => {
		expect(safeBaseName("Ekran Görüntüsü (3).png")).toBe("Ekran-Görüntüsü-3");
		expect(safeBaseName("şema_ığüöç.JPG")).toBe("şema-ığüöç");
	});

	it("does not let path traversal through", () => {
		expect(safeBaseName("../../etc/passwd")).toBe("etc-passwd");
		expect(safeBaseName("..\\..\\win.ini")).toBe("win");
	});

	it("names a nameless file", () => {
		expect(safeBaseName(".png")).toBe("image");
		expect(safeBaseName("???")).toBe("image");
	});

	it("truncates long names", () => {
		expect(safeBaseName(`${"a".repeat(200)}.png`)).toHaveLength(60);
	});
});

describe("uniqueFileName", () => {
	it("returns the name unchanged in an empty folder", () => {
		expect(uniqueFileName("foto", "png", new Set())).toBe("foto.png");
	});

	it("appends a counter on collision, ignoring case", () => {
		expect(uniqueFileName("Foto", "png", new Set(["foto.png"]))).toBe("Foto-2.png");
		expect(uniqueFileName("foto", "png", new Set(["foto.png", "foto-2.png"]))).toBe("foto-3.png");
	});
});

describe("relativeUrl", () => {
	it("encodes each segment and joins with slashes", () => {
		expect(relativeUrl("rapor.assets", "foto.png")).toBe("rapor.assets/foto.png");
		expect(relativeUrl("Çeyrek Raporu.assets", "şema (1).png")).toBe(
			"%C3%87eyrek%20Raporu.assets/%C5%9Fema%20%281%29.png",
		);
	});
});

describe("data URLs", () => {
	it("round-trips bytes", () => {
		const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
		const url = toDataUrl("image/png", bytes);
		expect(url.startsWith("data:image/png;base64,")).toBe(true);
		const parsed = parseDataUrl(url);
		expect(parsed?.type).toBe("image/png");
		expect(parsed?.bytes).toEqual(bytes);
	});

	it("lowercases the type and ignores whitespace", () => {
		const parsed = parseDataUrl("data:IMAGE/PNG;base64,QUJD\n");
		expect(parsed?.type).toBe("image/png");
		expect(Array.from(parsed?.bytes ?? [])).toEqual([65, 66, 67]);
	});

	it("rejects non-base64 and malformed URLs", () => {
		expect(parseDataUrl("data:image/png,raw")).toBeNull();
		expect(parseDataUrl("https://example.com/a.png")).toBeNull();
		expect(parseDataUrl("data:image/png;base64,***")).toBeNull();
	});

	it("recognizes embedded images", () => {
		expect(isEmbeddedImage("data:image/png;base64,AAAA")).toBe(true);
		expect(isEmbeddedImage("rapor.assets/a.png")).toBe(false);
		expect(isEmbeddedImage("data:text/html;base64,AAAA")).toBe(false);
	});
});
