import { describe, expect, it } from "vitest";
import { splitPath, unpinnedRecent } from "./start-page.js";

describe("recent documents", () => {
	it("shows the name and the last two folders of its path", () => {
		expect(splitPath("/home/ayse/projeler/kalem/notlar/plan.md")).toEqual({
			name: "plan.md",
			folder: "…/kalem/notlar",
		});
		expect(splitPath("C:\\Users\\Ayşe\\Belgeler\\rapor.md")).toEqual({
			name: "rapor.md",
			folder: "…\\Ayşe\\Belgeler",
		});
		expect(splitPath("/tmp/plan.md")).toEqual({ name: "plan.md", folder: "tmp" });
	});
});

describe("start page lists", () => {
	it("leaves pinned documents out of the recent ones", () => {
		expect(unpinnedRecent(["/a.md", "/b.md", "/c.md"], ["/b.md"])).toEqual(["/a.md", "/c.md"]);
		expect(unpinnedRecent(["/a.md", "/b.md", "/c.md"], [], 2)).toEqual(["/a.md", "/b.md"]);
	});
});
