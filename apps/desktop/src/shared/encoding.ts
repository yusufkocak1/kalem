export type LineEnding = "lf" | "crlf";
export type LegacyEncoding = "windows-1254" | "windows-1252";
export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | LegacyEncoding;

/** How a file is written on disk, apart from its text. */
export interface TextFormat {
	readonly encoding: Encoding;
	readonly bom: boolean;
	readonly lineEnding: LineEnding;
}

export const DEFAULT_FORMAT: TextFormat = { encoding: "utf-8", bom: false, lineEnding: "lf" };

export interface DecodedText {
	/** Always LF line endings, no BOM. */
	readonly text: string;
	readonly format: TextFormat;
}

const ENCODINGS: readonly Encoding[] = [
	"utf-8",
	"utf-16le",
	"utf-16be",
	"windows-1254",
	"windows-1252",
];

/** Validates a format that crossed a process boundary or came from disk. */
export function toTextFormat(raw: unknown): TextFormat {
	const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	return {
		encoding: ENCODINGS.includes(value.encoding as Encoding)
			? (value.encoding as Encoding)
			: DEFAULT_FORMAT.encoding,
		bom: value.bom === true,
		lineEnding: value.lineEnding === "crlf" ? "crlf" : "lf",
	};
}

/** Legacy single-byte files are rewritten as UTF-8 on save. */
export function willConvertToUtf8(format: TextFormat): boolean {
	return format.encoding === "windows-1254" || format.encoding === "windows-1252";
}

function startsWith(bytes: Uint8Array, ...signature: number[]): boolean {
	return signature.every((byte, i) => bytes[i] === byte);
}

function detectLineEnding(text: string): LineEnding {
	let crlf = 0;
	let lf = 0;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) !== 10) continue;
		if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
		else lf++;
	}
	return crlf > lf ? "crlf" : "lf";
}

export function decodeBytes(
	bytes: Uint8Array,
	legacyEncoding: LegacyEncoding = "windows-1254",
): DecodedText {
	let encoding: Encoding = "utf-8";
	let bom = false;
	let body = bytes;

	if (startsWith(bytes, 0xef, 0xbb, 0xbf)) {
		bom = true;
		body = bytes.subarray(3);
	} else if (startsWith(bytes, 0xff, 0xfe)) {
		encoding = "utf-16le";
		bom = true;
		body = bytes.subarray(2);
	} else if (startsWith(bytes, 0xfe, 0xff)) {
		encoding = "utf-16be";
		bom = true;
		body = bytes.subarray(2);
	}

	let raw: string;
	if (encoding === "utf-8") {
		try {
			raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
		} catch {
			// Decoding invalid UTF-8 leniently would turn every ş/ğ into U+FFFD,
			// and saving would make that damage permanent.
			encoding = legacyEncoding;
			raw = new TextDecoder(legacyEncoding).decode(body);
		}
	} else {
		raw = new TextDecoder(encoding, { ignoreBOM: true }).decode(body);
	}

	return {
		text: raw.replace(/\r\n?/g, "\n"),
		format: { encoding, bom, lineEnding: detectLineEnding(raw) },
	};
}

function encodeUtf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
	const start = bom ? 2 : 0;
	const out = new Uint8Array(start + text.length * 2);
	if (bom) {
		out[0] = littleEndian ? 0xff : 0xfe;
		out[1] = littleEndian ? 0xfe : 0xff;
	}
	for (let i = 0; i < text.length; i++) {
		const unit = text.charCodeAt(i);
		const low = unit & 0xff;
		const high = unit >> 8;
		out[start + i * 2] = littleEndian ? low : high;
		out[start + i * 2 + 1] = littleEndian ? high : low;
	}
	return out;
}

export function encodeText(text: string, format: TextFormat): Uint8Array {
	const lf = text.replace(/\r\n?/g, "\n");
	const body = format.lineEnding === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;

	if (format.encoding === "utf-16le") return encodeUtf16(body, true, format.bom);
	if (format.encoding === "utf-16be") return encodeUtf16(body, false, format.bom);

	const utf8 = new TextEncoder().encode(body);
	if (!format.bom || format.encoding !== "utf-8") return utf8;
	const out = new Uint8Array(utf8.length + 3);
	out.set([0xef, 0xbb, 0xbf]);
	out.set(utf8, 3);
	return out;
}

export function formatLabel(format: TextFormat): string {
	const names: Record<Encoding, string> = {
		"utf-8": format.bom ? "UTF-8 BOM" : "UTF-8",
		"utf-16le": "UTF-16 LE",
		"utf-16be": "UTF-16 BE",
		"windows-1254": "Windows-1254",
		"windows-1252": "Windows-1252",
	};
	return `${names[format.encoding]} · ${format.lineEnding === "crlf" ? "CRLF" : "LF"}`;
}
