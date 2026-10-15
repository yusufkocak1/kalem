import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PNG_1X1 } from "../main/sample-docx.test-helper.js";
import { crc32, isPng, readPngText, withPngText } from "./png-text.js";

/** Every chunk's CRC, as a PNG decoder checks it. */
function crcsValid(png: Uint8Array): boolean {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	for (let offset = 8; offset < png.length; ) {
		const length = view.getUint32(offset);
		const crc = view.getUint32(offset + 8 + length);
		if (crc !== crc32(png.subarray(offset + 4, offset + 8 + length))) return false;
		offset += 12 + length;
	}
	return true;
}

describe("PNG text", () => {
	it("computes the PNG CRC", () => {
		const bytes = new TextEncoder().encode("IEND ve Türkçe ğüşıöç");
		expect(crc32(bytes)).toBe(zlibCrc32(bytes));
		expect(crc32(deflateSync(bytes))).toBe(zlibCrc32(deflateSync(bytes)));
	});

	it("keeps text in a PNG and reads it back", () => {
		const png = new Uint8Array(PNG_1X1);
		expect(isPng(png)).toBe(true);
		expect(readPngText(png, "kalem-diagram")).toBeNull();

		const text = JSON.stringify({ nodes: [{ text: "Başla → Karar?" }] });
		const tagged = withPngText(png, "kalem-diagram", text);
		expect(readPngText(tagged, "kalem-diagram")).toBe(text);
		expect(readPngText(tagged, "other")).toBeNull();
		expect(crcsValid(tagged)).toBe(true);
		// Before the image data, so streaming readers see it early.
		const asText = Buffer.from(tagged).toString("latin1");
		expect(asText.indexOf("iTXt")).toBeLessThan(asText.indexOf("IDAT"));

		// Writing again replaces it instead of adding a second one.
		const again = withPngText(tagged, "kalem-diagram", "{}");
		expect(readPngText(again, "kalem-diagram")).toBe("{}");
		expect(again.length).toBe(png.length + 12 + "kalem-diagram".length + 5 + "{}".length);
	});

	it("rejects what is not a PNG", () => {
		expect(() => withPngText(new Uint8Array([1, 2, 3]), "k", "v")).toThrow("Not a PNG");
		expect(readPngText(new Uint8Array([1, 2, 3]), "k")).toBeNull();
	});
});
