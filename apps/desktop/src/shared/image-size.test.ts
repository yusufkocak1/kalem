import { describe, expect, it } from "vitest";
import { imageInfo } from "./image-size.js";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);

describe("imageInfo", () => {
	it("reads PNG, GIF and BMP headers", () => {
		const png = new Uint8Array(24);
		png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		new DataView(png.buffer).setUint32(16, 640);
		new DataView(png.buffer).setUint32(20, 480);
		expect(imageInfo(png)).toEqual({ type: "png", width: 640, height: 480 });

		expect(imageInfo(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x00, 0x10, 0x00))).toEqual({
			type: "gif",
			width: 32,
			height: 16,
		});

		const bmp = new Uint8Array(26);
		bmp.set([0x42, 0x4d]);
		new DataView(bmp.buffer).setInt32(18, 100, true);
		new DataView(bmp.buffer).setInt32(22, -50, true);
		expect(imageInfo(bmp)).toEqual({ type: "bmp", width: 100, height: 50 });
	});

	it("finds the frame header of a JPEG after other segments", () => {
		const jpeg = bytes(
			0xff,
			0xd8,
			0xff,
			0xe0,
			0x00,
			0x04,
			0x00,
			0x00,
			0xff,
			0xc0,
			0x00,
			0x11,
			0x08,
			0x01,
			0x2c,
			0x02,
			0x58,
			0x03,
			0x00,
			0x00,
		);
		expect(imageInfo(jpeg)).toEqual({ type: "jpg", width: 600, height: 300 });
	});

	it("does not guess other formats", () => {
		expect(imageInfo(new TextEncoder().encode("<svg/>"))).toBeNull();
		expect(imageInfo(bytes())).toBeNull();
	});
});
