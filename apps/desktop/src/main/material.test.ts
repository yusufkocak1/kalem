import { describe, expect, it } from "vitest";
import { windowMaterial } from "./material.js";

describe("windowMaterial", () => {
	it("is Mica on Windows 11 22H2 and later, none on older Windows", () => {
		expect(windowMaterial(true, "win32", "10.0.22631")).toBe("mica");
		expect(windowMaterial(true, "win32", "10.0.22621")).toBe("mica");
		expect(windowMaterial(true, "win32", "10.0.22000")).toBeNull();
		expect(windowMaterial(true, "win32", "10.0.19045")).toBeNull();
	});

	it("is vibrancy on macOS and none on Linux", () => {
		expect(windowMaterial(true, "darwin", "24.0.0")).toBe("vibrancy");
		expect(windowMaterial(true, "linux", "6.8.0")).toBeNull();
	});

	it("is none when the setting is off", () => {
		expect(windowMaterial(false, "win32", "10.0.22631")).toBeNull();
		expect(windowMaterial(false, "darwin", "24.0.0")).toBeNull();
	});
});
