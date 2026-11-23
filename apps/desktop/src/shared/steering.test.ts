import { describe, expect, it } from "vitest";
import { steeringNote, withSteering } from "./steering.js";

describe("steering note", () => {
	it("says nothing when nothing was added", () => {
		expect(steeringNote([])).toBe("");
		expect(steeringNote(["  ", ""])).toBe("");
		expect(withSteering("Özetle", [])).toBe("Özetle");
	});

	it("tells the model what the user added, and that it adds to the question", () => {
		const note = steeringNote([" Tabloyu da ekle \n"]);
		expect(note.startsWith("<user-added-while-you-worked>\n")).toBe(true);
		expect(note.endsWith("</user-added-while-you-worked>")).toBe(true);
		expect(note).toContain("the user added this:\n\nTabloyu da ekle\n\n");
		expect(note).toContain("replaces the question only if it says so");
		expect(note).not.toContain("<message>");
	});

	it("keeps several messages apart, in the order they came", () => {
		const note = steeringNote(["bir", "", "iki"]);
		expect(note).toContain("in order:\n\n<message>\nbir\n</message>\n<message>\niki\n</message>\n");
	});

	it("follows the question it was added to", () => {
		expect(withSteering("Özetle", ["Kısa tut"])).toBe(`Özetle\n\n${steeringNote(["Kısa tut"])}`);
	});
});
