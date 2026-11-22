import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ systemPreferences: {} }));

const { accentHex } = await import("./accent.js");

describe("accentHex", () => {
	it("reads the system's RRGGBBAA and RRGGBB", () => {
		expect(accentHex("0078D4FF")).toBe("#0078d4");
		expect(accentHex("#C42B1C")).toBe("#c42b1c");
	});

	it("is null for anything else", () => {
		expect(accentHex("")).toBeNull();
		expect(accentHex("blue")).toBeNull();
		expect(accentHex("12345")).toBeNull();
	});
});
