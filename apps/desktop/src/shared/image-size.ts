export type RasterType = "png" | "jpg" | "gif" | "bmp";

export interface ImageInfo {
	readonly type: RasterType;
	readonly width: number;
	readonly height: number;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
	signature.every((byte, i) => bytes[i] === byte);

/** Reads the type and pixel size from the file header; `null` for anything else. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.length >= 24 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
		return { type: "png", width: view.getUint32(16), height: view.getUint32(20) };
	}
	if (bytes.length >= 10 && startsWith(bytes, [0x47, 0x49, 0x46])) {
		return { type: "gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
	}
	if (bytes.length >= 26 && startsWith(bytes, [0x42, 0x4d])) {
		return {
			type: "bmp",
			width: Math.abs(view.getInt32(18, true)),
			height: Math.abs(view.getInt32(22, true)),
		};
	}
	if (bytes.length >= 4 && startsWith(bytes, [0xff, 0xd8])) {
		// Walk the segments to the first start-of-frame marker.
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) return null;
			const marker = bytes[offset + 1] as number;
			const length = view.getUint16(offset + 2);
			const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
			if (isFrame) {
				return {
					type: "jpg",
					height: view.getUint16(offset + 5),
					width: view.getUint16(offset + 7),
				};
			}
			offset += 2 + length;
		}
	}
	return null;
}
