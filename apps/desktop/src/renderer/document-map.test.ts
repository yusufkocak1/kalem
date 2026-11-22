import { describe, expect, it } from "vitest";
import { markShare, scrollForShare } from "./document-map.js";

describe("document map", () => {
	it("puts a mark at its thing's share of the page", () => {
		expect(markShare(0, 4000)).toBe(0);
		expect(markShare(1000, 4000)).toBe(0.25);
		expect(markShare(5000, 4000)).toBe(1);
		expect(markShare(-10, 4000)).toBe(0);
		expect(markShare(10, 0)).toBe(0);
	});

	it("scrolls a click's share of the page to the middle of the view, inside the page", () => {
		expect(scrollForShare(0.5, 4000, 800)).toBe(1600);
		expect(scrollForShare(0, 4000, 800)).toBe(0);
		expect(scrollForShare(1, 4000, 800)).toBe(3200);
	});
});
