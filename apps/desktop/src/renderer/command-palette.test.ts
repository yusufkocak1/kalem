import { describe, expect, it } from "vitest";
import type { PaletteCommand } from "../shared/bridge.js";
import { frecency, paletteIcon, parseQuery, rankCommands, usageKey } from "./command-palette.js";

const command = (label: string, group: string): PaletteCommand => ({
	id: label,
	label,
	group,
	accelerator: "",
	checked: null,
	action: null,
	path: null,
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

	it("finds a recent document by its name first, and by any part of its path", () => {
		const recent: PaletteCommand = {
			...command("/home/ali/proje/specs/siparis-iptali.md", "Dosya › Son Kullanılanlar"),
			path: "/home/ali/proje/specs/siparis-iptali.md",
		};
		const all = [command("Sipariş Şablonu", "Ekle"), recent];
		expect(rankCommands(all, "siparis", "tr")[0]).toBe(recent);
		expect(rankCommands(all, "specs", "tr")).toEqual([recent]);
	});

	it("draws a command with its own icon, a menu item and a role with theirs, a document with its kind's", () => {
		const iconOf = (action: string | null, path: string | null = null) =>
			paletteIcon({ ...command("x", "y"), action, path });
		expect(iconOf("bullet-list")).toEqual({ name: "bulletList", tone: null });
		expect(iconOf("export-docx")).toEqual({ name: "word", tone: null });
		expect(iconOf("item:open-folder")).toEqual({ name: "folderOpen", tone: null });
		expect(iconOf("role:copy")).toEqual({ name: "copy", tone: null });
		expect(iconOf(null, "/a/b/notlar.md")).toEqual({ name: "file", tone: "markdown" });
		expect(iconOf("heading-9-nothing")).toBeNull();
		expect(iconOf(null)).toBeNull();
	});

	it("reads what is searched from the first character", () => {
		expect(parseQuery("kaydet")).toEqual({ scope: "all", text: "kaydet" });
		expect(parseQuery("> kaydet")).toEqual({ scope: "commands", text: "kaydet" });
		expect(parseQuery("#kapsam")).toEqual({ scope: "headings", text: "kapsam" });
		expect(parseQuery("? bu belgeyi özetle")).toEqual({ scope: "ask", text: "bu belgeyi özetle" });
		// Only first: a # inside is searched for.
		expect(parseQuery("C# notları")).toEqual({ scope: "all", text: "C# notları" });
	});

	it("puts the commands used more and lately first, among those that match as well", () => {
		const used = (c: PaletteCommand): number => (c.label === "Farklı Kaydet…" ? 3 : 0);
		expect(rankCommands(commands, "kaydet", "tr", used).map((c) => c.label)).toEqual([
			"Kaydet",
			"Farklı Kaydet…",
		]);
		// With nothing typed, the one used comes first.
		expect(rankCommands(commands, "", "tr", used)[0]?.label).toBe("Farklı Kaydet…");
	});

	it("halves a use's weight a week on, and knows a command by what it does", () => {
		const now = Date.UTC(2026, 10, 22);
		const week = 7 * 24 * 60 * 60 * 1000;
		expect(frecency(undefined, now)).toBe(0);
		expect(frecency({ count: 4, last: now }, now)).toBe(4);
		expect(frecency({ count: 4, last: now - week }, now)).toBeCloseTo(2);
		expect(usageKey({ ...command("Kaydet", "Dosya"), action: "save" })).toBe("action:save");
		expect(usageKey({ ...command("a.md", "Dosya"), path: "/x/a.md" })).toBe("path:/x/a.md");
		expect(usageKey(command("Kaydet", "Dosya"))).toBe("menu:Dosya › Kaydet");
	});
});
