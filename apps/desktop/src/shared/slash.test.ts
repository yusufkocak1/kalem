import { describe, expect, it } from "vitest";
import { findSlash, matchSlash, slashQuery } from "./slash.js";

const entries = [
	{ name: "save", label: "Kaydet" },
	{ name: "save-as", label: "Farklı Kaydet…" },
	{ name: "summarize", label: "Bu belgeyi özetle" },
	{ name: "model", label: "Modeli değiştir" },
	{ name: "find", label: "Bul" },
];

describe("slash commands", () => {
	it("read the name and what follows it", () => {
		expect(slashQuery("/mod")).toEqual({ name: "mod", arg: "", complete: false });
		expect(slashQuery("  /model  gpt-5 mini ")).toEqual({
			name: "model",
			arg: "gpt-5 mini",
			complete: true,
		});
		expect(slashQuery("/")).toEqual({ name: "", arg: "", complete: false });
		expect(slashQuery("/ ")).toEqual({ name: "", arg: "", complete: true });
		expect(slashQuery("bir soru /save")).toBeNull();
	});

	it("find commands by name first, then by the label in the interface's language", () => {
		expect(matchSlash(entries, "sa", "tr").map((entry) => entry.name)).toEqual(["save", "save-as"]);
		expect(matchSlash(entries, "kayd", "tr").map((entry) => entry.name)).toEqual([
			"save",
			"save-as",
		]);
		expect(matchSlash(entries, "ÖZET", "tr").map((entry) => entry.name)).toEqual(["summarize"]);
		// Turkish case folding: İ is i.
		expect(matchSlash([{ name: "x", label: "İyileştir" }], "iyi", "tr")).toHaveLength(1);
		expect(matchSlash(entries, "", "tr")).toHaveLength(entries.length);
		expect(matchSlash(entries, "zzz", "tr")).toEqual([]);
	});

	it("find a command by its exact name", () => {
		expect(findSlash(entries, "Save", "en")?.label).toBe("Kaydet");
		expect(findSlash(entries, "sav", "en")).toBeUndefined();
	});
});
