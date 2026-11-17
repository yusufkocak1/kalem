import { describe, expect, it } from "vitest";
import { imageTypeOf } from "./image-type.js";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("imageTypeOf", () => {
	it("reads the pictures a page or an issue has by their first bytes", () => {
		expect(imageTypeOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
		expect(imageTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
		expect(imageTypeOf(text("GIF89a...."))).toBe("image/gif");
		expect(imageTypeOf(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
		expect(imageTypeOf(text("\0\0\0\x1cftypavif\0\0\0\0"))).toBe("image/avif");
		expect(imageTypeOf(bytes(0, 0, 1, 0, 1, 0))).toBe("image/x-icon");
		expect(
			imageTypeOf(
				text('﻿<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
			),
		).toBe("image/svg+xml");
	});

	it("says no for a page or text in a picture's place", () => {
		expect(imageTypeOf(text("<!DOCTYPE html><html><body>Log in</body></html>"))).toBeNull();
		expect(imageTypeOf(text('{"message":"not found"}'))).toBeNull();
		expect(imageTypeOf(text("<html><svg></svg></html>"))).toBeNull();
		expect(imageTypeOf(bytes())).toBeNull();
	});
});
