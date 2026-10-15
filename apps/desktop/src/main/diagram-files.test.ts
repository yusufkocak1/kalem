import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkDiagramBytes,
	diagramFileName,
	diagramPath,
	writeNewDiagram,
} from "./diagram-files.js";
import { PNG_1X1 } from "./sample-docx.test-helper.js";

describe("diagram files", () => {
	it("names diagrams after their title", () => {
		expect(diagramFileName("Sipariş akışı", new Set())).toBe("Sipariş-akışı.diagram.png");
		expect(diagramFileName("", new Set())).toBe("diagram.diagram.png");
		expect(diagramFileName("akış", new Set(["akış.diagram.png"]))).toBe("akış-2.diagram.png");
	});

	it("writes a new diagram next to the document without overwriting", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-diagram-"));
		const doc = join(folder, "notlar.md");
		const png = new Uint8Array(PNG_1X1);
		expect(await writeNewDiagram(doc, "notlar.assets", "Akış", png)).toBe(
			"notlar.assets/Ak%C4%B1%C5%9F.diagram.png",
		);
		expect(await writeNewDiagram(doc, "notlar.assets", "Akış", png)).toBe(
			"notlar.assets/Ak%C4%B1%C5%9F-2.diagram.png",
		);
		expect(await readFile(join(folder, "notlar.assets", "Akış.diagram.png"))).toEqual(
			Buffer.from(png),
		);
	});

	it("only rewrites PNGs in the document's folder", () => {
		const doc = join("/docs", "notlar.md");
		expect(diagramPath(doc, "notlar.assets/Ak%C4%B1%C5%9F.diagram.png")).toBe(
			join("/docs", "notlar.assets", "Akış.diagram.png"),
		);
		for (const url of [
			"../x.png",
			"notlar.assets/../../x.png",
			"/etc/x.png",
			"file:///x.png",
			"a.txt",
			"%E0",
		]) {
			expect(() => diagramPath(doc, url)).toThrow("Not a diagram");
		}
	});

	it("accepts only PNG bytes", () => {
		expect(checkDiagramBytes(new Uint8Array(PNG_1X1))).toBeInstanceOf(Uint8Array);
		expect(() => checkDiagramBytes(new Uint8Array([1, 2]))).toThrow("Invalid");
		expect(() => checkDiagramBytes("x")).toThrow("Invalid");
	});
});
