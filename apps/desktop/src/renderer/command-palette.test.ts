import { describe, expect, it } from "vitest";
import type { PaletteCommand } from "../shared/bridge.js";
import { rankCommands } from "./command-palette.js";

const command = (label: string, group: string): PaletteCommand => ({
	id: label,
	label,
	group,
	accelerator: "",
	checked: null,
});

const commands = [
	command("Kaydet", "Dosya"),
	command("Farklı Kaydet…", "Dosya"),
	command("Word Belgesi Olarak Dışa Aktar…", "Dosya › Dışa Aktar"),
	command("İçindekiler", "Ekle"),
	command("Odak Modu", "Görünüm"),
];

describe("command palette", () => {
	it("puts names that start with the search first, then words of them, then the rest", () => {
		expect(rankCommands(commands, "kay", "tr").map((c) => c.label)).toEqual([
			"Kaydet",
			"Farklı Kaydet…",
		]);
	});

	it("matches the menus a command is under, every word of the search", () => {
		expect(rankCommands(commands, "dışa word", "tr").map((c) => c.label)).toEqual([
			"Word Belgesi Olarak Dışa Aktar…",
		]);
		expect(rankCommands(commands, "görünüm", "tr").map((c) => c.label)).toEqual(["Odak Modu"]);
	});

	it("folds case the way the language does", () => {
		expect(rankCommands(commands, "İÇİNDEKİLER", "tr").map((c) => c.label)).toEqual([
			"İçindekiler",
		]);
	});

	it("keeps the menu's order with nothing typed", () => {
		expect(rankCommands(commands, "", "tr")).toHaveLength(commands.length);
		expect(rankCommands(commands, "", "tr")[0]?.label).toBe("Kaydet");
	});
});
