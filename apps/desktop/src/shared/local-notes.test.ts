import { describe, expect, it } from "vitest";
import type { LocalNote } from "./local-notes.js";
import {
	anchorAt,
	locateNote,
	noteKey,
	noteOrder,
	parseNotes,
	reanchored,
	stackBalloons,
} from "./local-notes.js";

const note = (over: Partial<LocalNote>): LocalNote => ({
	id: "n1",
	kind: "question",
	text: "",
	quote: "",
	prefix: "",
	suffix: "",
	created: 1,
	updated: 1,
	resolved: false,
	...over,
});

describe("noteKey", () => {
	it("keys a page by its site and id, a file by its path, an untitled tab by nothing", () => {
		expect(noteKey("/a/b.md", null)).toBe("file:/a/b.md");
		expect(noteKey(null, { site: "https://x/wiki", id: "42" })).toBe(
			"confluence:https://x/wiki#42",
		);
		expect(noteKey(null, null)).toBeNull();
	});
});

describe("parseNotes", () => {
	it("keeps notes and leaves out what is not one", () => {
		const notes = parseNotes([
			{ id: "a", kind: "attention", quote: "x", text: "dikkat", created: 5 },
			{ id: "b", quote: "" },
			{ id: "a", quote: "again" },
			{ id: "c", kind: "bogus", quote: "y", resolved: true },
			"no",
		]);
		expect(notes.map((n) => [n.id, n.kind, n.resolved])).toEqual([
			["a", "attention", false],
			["c", "note", true],
		]);
		expect(notes[0]?.updated).toBe(5);
		expect(parseNotes({})).toEqual([]);
	});
});

describe("anchorAt and locateNote", () => {
	const page = "Sipariş iptal edilir. Kargo durumu kontrol edilir. Sipariş iptal edilir. ";

	it("anchors on what was selected, with its surroundings, spaces trimmed", () => {
		const start = page.lastIndexOf("Sipariş");
		const anchor = anchorAt(page, start - 1, start + "Sipariş iptal".length);
		expect(anchor?.quote).toBe("Sipariş iptal");
		expect(anchor?.prefix.endsWith("edilir. ")).toBe(true);
		expect(anchorAt(page, 3, 3)).toBeNull();
	});

	it("finds the right one of two equal quotes by its surroundings", () => {
		const start = page.lastIndexOf("Sipariş");
		const anchor = anchorAt(page, start, start + 13);
		if (anchor === null) throw new Error("no anchor");
		expect(locateNote(page, anchor)).toEqual({ start, end: start + 13 });
		// Text added before it moves it; it is found where it went.
		const edited = `Yeni giriş. ${page}`;
		expect(locateNote(edited, anchor)?.start).toBe(edited.lastIndexOf("Sipariş"));
	});

	it("follows its words when they were edited between unchanged surroundings", () => {
		const text = "Birinci cümle burada. Sistem hızlı yanıt vermeli. Üçüncü cümle orada.";
		const start = text.indexOf("hızlı");
		const anchor = anchorAt(text, start, start + "hızlı".length);
		if (anchor === null) throw new Error("no anchor");
		const edited = text.replace("hızlı", "2 saniyede");
		const found = locateNote(edited, anchor);
		expect(found && edited.slice(found.start, found.end)).toBe("2 saniyede");
		const moved = reanchored(edited, note(anchor), found?.start ?? 0, found?.end ?? 0);
		expect(moved.quote).toBe("2 saniyede");
	});

	it("is lost when its words and surroundings are gone", () => {
		expect(
			locateNote("Başka bir metin.", { quote: "yok", prefix: "hiç ", suffix: " burada" }),
		).toBeNull();
	});
});

describe("noteOrder", () => {
	it("puts notes in the page's order, the lost ones last", () => {
		const a = note({ id: "a", created: 1 });
		const b = note({ id: "b", created: 2 });
		const c = note({ id: "c", created: 3 });
		const places: Record<string, number | null> = { a: 50, b: null, c: 10 };
		expect(noteOrder([a, b, c], (n) => places[n.id] ?? null).map((n) => n.id)).toEqual([
			"c",
			"a",
			"b",
		]);
	});
});

describe("stackBalloons", () => {
	it("keeps each balloon at its words unless the one above is in the way", () => {
		expect(
			stackBalloons(
				[
					{ top: 0, height: 50 },
					{ top: 20, height: 30 },
					{ top: 200, height: 30 },
				],
				8,
				10,
			),
		).toEqual([10, 68, 200]);
	});
});
