import { describe, expect, it } from "vitest";
import type { QuickOpenItem } from "./quick-open.js";
import { rankItems } from "./quick-open.js";

const item = (relative: string): QuickOpenItem => ({
	path: `C:/notlar/${relative}`,
	name: relative.split("/").pop() ?? relative,
	relative,
});

describe("rankItems", () => {
	const items = [
		item("arşiv/eski-rapor.md"),
		item("rapor.md"),
		item("toplantı/raporlar-özet.md"),
		item("İstanbul gezisi.md"),
	];

	it("puts names starting with the query first, then names containing it", () => {
		expect(rankItems(items, "rapor", "tr").map((entry) => entry.relative)).toEqual([
			"rapor.md",
			"toplantı/raporlar-özet.md",
			"arşiv/eski-rapor.md",
		]);
	});

	it("matches every term anywhere in the path with the language's case rules", () => {
		expect(rankItems(items, "arşiv rapor", "tr").map((entry) => entry.relative)).toEqual([
			"arşiv/eski-rapor.md",
		]);
		expect(rankItems(items, "istanbul", "tr").map((entry) => entry.relative)).toEqual([
			"İstanbul gezisi.md",
		]);
	});

	it("keeps everything for an empty query", () => {
		expect(rankItems(items, "", "tr")).toHaveLength(4);
	});
});
