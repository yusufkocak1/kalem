import { describe, expect, it } from "vitest";
import {
	DEFAULT_FORMAT,
	decodeBytes,
	encodeText,
	formatLabel,
	toTextFormat,
	willConvertToUtf8,
} from "./encoding.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("decodeBytes", () => {
	it("reads plain UTF-8 as is", () => {
		const { text, format } = decodeBytes(utf8("# Başlık\n\nışık ğ ş\n"));
		expect(text).toBe("# Başlık\n\nışık ğ ş\n");
		expect(format).toEqual({ encoding: "utf-8", bom: false, lineEnding: "lf" });
	});

	it("normalizes CRLF to LF and remembers the original", () => {
		const { text, format } = decodeBytes(utf8("a\r\nb\r\n"));
		expect(text).toBe("a\nb\n");
		expect(format.lineEnding).toBe("crlf");
	});

	it("picks the majority line ending, LF on a tie", () => {
		expect(decodeBytes(utf8("a\r\nb\r\nc\n")).format.lineEnding).toBe("crlf");
		expect(decodeBytes(utf8("a\r\nb\n")).format.lineEnding).toBe("lf");
	});

	it("treats a lone CR as a line break", () => {
		expect(decodeBytes(utf8("a\rb\r")).text).toBe("a\nb\n");
	});

	it("strips the UTF-8 BOM", () => {
		const { text, format } = decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a")]));
		expect(text).toBe("a");
		expect(format.bom).toBe(true);
	});

	it("detects UTF-16 LE and BE from the BOM", () => {
		const le = new Uint8Array([0xff, 0xfe, 0x5f, 0x01, 0x0a, 0x00]); // ş\n
		const be = new Uint8Array([0xfe, 0xff, 0x01, 0x5f, 0x00, 0x0a]);
		expect(decodeBytes(le)).toEqual({
			text: "ş\n",
			format: { encoding: "utf-16le", bom: true, lineEnding: "lf" },
		});
		expect(decodeBytes(be).text).toBe("ş\n");
		expect(decodeBytes(be).format.encoding).toBe("utf-16be");
	});

	it("falls back to Windows-1254 instead of producing replacement characters", () => {
		const { text, format } = decodeBytes(new Uint8Array([0xfe, 0xf0, 0xfd]));
		expect(text).toBe("şğı");
		expect(format.encoding).toBe("windows-1254");
		expect(willConvertToUtf8(format)).toBe(true);
	});

	it("uses the legacy encoding given by the caller", () => {
		expect(decodeBytes(new Uint8Array([0xfe, 0xf0, 0xfd]), "windows-1252").text).toBe("þðý");
	});

	it("decodes an empty file", () => {
		expect(decodeBytes(new Uint8Array())).toEqual({ text: "", format: DEFAULT_FORMAT });
	});
});

describe("encodeText", () => {
	it("round-trips files byte for byte", () => {
		const samples = [
			utf8("# Başlık\n\nmetin\n"),
			utf8("a\r\nb\r\n\r\n- c\r\n"),
			new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a\r\nb")]),
			new Uint8Array([0xff, 0xfe, 0x5f, 0x01, 0x0d, 0x00, 0x0a, 0x00]),
			new Uint8Array([0xfe, 0xff, 0x01, 0x5f, 0x00, 0x0a]),
		];
		for (const bytes of samples) {
			const { text, format } = decodeBytes(bytes);
			expect(Array.from(encodeText(text, format))).toEqual(Array.from(bytes));
		}
	});

	it("does not double an existing CR when writing CRLF", () => {
		const format = { ...DEFAULT_FORMAT, lineEnding: "crlf" as const };
		expect(new TextDecoder().decode(encodeText("a\r\nb\nc", format))).toBe("a\r\nb\r\nc");
	});

	it("writes legacy-encoded files as UTF-8", () => {
		const { text, format } = decodeBytes(new Uint8Array([0xfe]));
		expect(Array.from(encodeText(text, format))).toEqual(Array.from(utf8("ş")));
	});
});

describe("toTextFormat", () => {
	it("keeps valid values and replaces invalid ones", () => {
		expect(toTextFormat({ encoding: "utf-16le", bom: true, lineEnding: "crlf" })).toEqual({
			encoding: "utf-16le",
			bom: true,
			lineEnding: "crlf",
		});
		expect(toTextFormat({ encoding: "latin9", bom: "yes", lineEnding: 3 })).toEqual(DEFAULT_FORMAT);
		expect(toTextFormat(null)).toEqual(DEFAULT_FORMAT);
	});
});

describe("formatLabel", () => {
	it("names the encoding and line ending", () => {
		expect(formatLabel(DEFAULT_FORMAT)).toBe("UTF-8 · LF");
		expect(formatLabel({ encoding: "utf-8", bom: true, lineEnding: "crlf" })).toBe(
			"UTF-8 BOM · CRLF",
		);
		expect(formatLabel({ encoding: "utf-16le", bom: true, lineEnding: "lf" })).toBe(
			"UTF-16 LE · LF",
		);
	});
});
