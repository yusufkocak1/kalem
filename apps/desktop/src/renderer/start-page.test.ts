import { describe, expect, it } from "vitest";
import { splitPath } from "./start-page.js";

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
