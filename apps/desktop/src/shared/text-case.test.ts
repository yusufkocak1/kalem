import { describe, expect, it } from "vitest";
import { changeCase, collapseSpaces, nextCase } from "./text-case.js";

describe("changeCase", () => {
	it("follows Turkish rules for i and ı", () => {
		expect(changeCase("ılık iyi", "upper", "tr")).toBe("ILIK İYİ");
		expect(changeCase("ILIK İYİ", "lower", "tr")).toBe("ılık iyi");
		expect(changeCase("istanbul ırmak", "title", "tr")).toBe("İstanbul Irmak");
		expect(changeCase("istanbul", "title", "en")).toBe("Istanbul");
	});

	it("capitalizes sentences and toggles case", () => {
		expect(changeCase("BUGÜN HAVA GÜZEL. YARIN? belki!", "sentence", "tr")).toBe(
			"Bugün hava güzel. Yarın? Belki!",
		);
		expect(changeCase("Kalem iyi", "toggle", "tr")).toBe("kALEM İYİ");
	});

	it("keeps what is not a word as it is", () => {
		expect(changeCase("ali'nin 2. kitabı — (yeni)", "title", "tr")).toBe(
			"Ali'nin 2. Kitabı — (Yeni)",
		);
	});
});

describe("nextCase", () => {
	it("cycles lower, upper and title case", () => {
		expect(nextCase("kalem", "tr")).toBe("upper");
		expect(nextCase("KALEM", "tr")).toBe("title");
		expect(nextCase("Kalem", "tr")).toBe("lower");
	});
});

describe("collapseSpaces", () => {
	it("joins runs of spaces and trims line ends", () => {
		expect(collapseSpaces("bir   iki\t\tüç  \nsatır  ")).toBe("bir iki üç\nsatır");
		expect(collapseSpaces("tek boşluk")).toBe("tek boşluk");
	});
});
