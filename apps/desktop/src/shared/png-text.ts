/**
 * Text kept inside a PNG, in an uncompressed `iTXt` chunk (UTF-8). A diagram
 * travels as its picture with its data in the same file: every viewer shows
 * the picture, Kalem reads the data back to edit it.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= 8 && SIGNATURE.every((value, index) => bytes[index] === value);
}

interface Chunk {
	readonly type: string;
	/** Offset of the length field. */
	readonly start: number;
	/** Offset after the CRC. */
	readonly end: number;
	readonly data: Uint8Array;
}

function* chunks(png: Uint8Array): Generator<Chunk> {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let offset = 8;
	while (offset + 12 <= png.length) {
		const length = view.getUint32(offset);
		const end = offset + 12 + length;
		if (end > png.length) return;
		const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
		yield { type, start: offset, end, data: png.subarray(offset + 8, offset + 8 + length) };
		if (type === "IEND") return;
		offset = end;
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** keyword, null, compression flag 0, method 0, empty language, null, empty translated keyword, null, text. */
function iTXt(keyword: string, text: string): Uint8Array {
	const key = encoder.encode(keyword);
	const value = encoder.encode(text);
	const data = new Uint8Array(key.length + 5 + value.length);
	data.set(key, 0);
	data.set(value, key.length + 5);
	const chunk = new Uint8Array(12 + data.length);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, data.length);
	chunk.set(encoder.encode("iTXt"), 4);
	chunk.set(data, 8);
	view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
	return chunk;
}

/** The PNG with `text` under `keyword`, replacing an earlier one; placed before the image data. */
export function withPngText(png: Uint8Array, keyword: string, text: string): Uint8Array {
	if (!isPng(png)) throw new Error("Not a PNG image");
	const parts: Uint8Array[] = [png.subarray(0, 8)];
	let placed = false;
	for (const chunk of chunks(png)) {
		if (chunk.type === "iTXt" && keywordOf(chunk.data) === keyword) continue;
		if (!placed && (chunk.type === "IDAT" || chunk.type === "IEND")) {
			parts.push(iTXt(keyword, text));
			placed = true;
		}
		parts.push(png.subarray(chunk.start, chunk.end));
	}
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function keywordOf(data: Uint8Array): string {
	const end = data.indexOf(0);
	return end < 0 ? "" : String.fromCharCode(...data.subarray(0, end));
}

/** The uncompressed text under `keyword`, or `null` when the PNG has none. */
export function readPngText(png: Uint8Array, keyword: string): string | null {
	if (!isPng(png)) return null;
	for (const chunk of chunks(png)) {
		if (chunk.type !== "iTXt" || keywordOf(chunk.data) !== keyword) continue;
		const data = chunk.data;
		let offset = keyword.length + 1;
		// Compressed text is not something Kalem writes.
		if (data[offset] !== 0) return null;
		offset += 2;
		const language = data.indexOf(0, offset);
		if (language < 0) return null;
		const translated = data.indexOf(0, language + 1);
		if (translated < 0) return null;
		try {
			return decoder.decode(data.subarray(translated + 1));
		} catch {
			return null;
		}
	}
	return null;
}
