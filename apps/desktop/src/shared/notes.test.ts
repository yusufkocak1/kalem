import { describe, expect, it } from "vitest";
import { quickNoteName } from "./notes.js";

describe("quickNoteName", () => {
	const date = new Date(2026, 9, 5, 9, 7);

	it("stamps the local date and time", () => {
		expect(quickNoteName("Not", date, () => false)).toBe("Not 2026-10-05 09.07");
	});

	it("numbers names that are taken", () => {
		const taken = new Set(["Not 2026-10-05 09.07", "Not 2026-10-05 09.07 (2)"]);
		expect(quickNoteName("Not", date, (name) => taken.has(name))).toBe("Not 2026-10-05 09.07 (3)");
	});
});
