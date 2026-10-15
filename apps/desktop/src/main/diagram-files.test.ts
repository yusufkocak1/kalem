import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeDiagram } from "../shared/diagram.js";
import {
	checkDiagramBytes,
	checkDiagramData,
	copyDiagramInto,
	diagramFileName,
	diagramPath,
	writeDiagram,
	writeNewDiagram,
} from "./diagram-files.js";
import { PNG_1X1 } from "./sample-docx.test-helper.js";

describe("diagram files", () => {
	it("names diagrams after their title", () => {
		expect(diagramFileName("Sipariş akışı", new Set())).toBe("Sipariş-akışı.diagram.png");
		expect(diagramFileName("", new Set())).toBe("diagram.diagram.png");
		expect(diagramFileName("akış", new Set(["akış.diagram.png"]))).toBe("akış-2.diagram.png");
		// A leftover data file takes the name too.
		expect(diagramFileName("akış", new Set(["akış.diagram.json"]))).toBe("akış-2.diagram.png");
	});

	it("writes a new diagram and its data file next to the document without overwriting", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-diagram-"));
		const doc = join(folder, "notlar.md");
		const png = new Uint8Array(PNG_1X1);
		const data = serializeDiagram({ nodes: [], edges: [] });
		expect(await writeNewDiagram(doc, "notlar.assets", "Akış", png, data)).toBe(
			"notlar.assets/Ak%C4%B1%C5%9F.diagram.png",
		);
		expect(await writeNewDiagram(doc, "notlar.assets", "Akış", png, data)).toBe(
			"notlar.assets/Ak%C4%B1%C5%9F-2.diagram.png",
		);
		const assets = join(folder, "notlar.assets");
		expect((await readdir(assets)).sort()).toEqual([
			"Akış-2.diagram.json",
			"Akış-2.diagram.png",
			"Akış.diagram.json",
			"Akış.diagram.png",
		]);
		expect(await readFile(join(assets, "Akış.diagram.png"))).toEqual(Buffer.from(png));
		expect(await readFile(join(assets, "Akış.diagram.json"), "utf8")).toBe(data);

		// An edit replaces both.
		const edited = serializeDiagram({ nodes: [], edges: [] }, 0);
		await writeDiagram(join(assets, "Akış.diagram.png"), png, edited);
		expect(await readFile(join(assets, "Akış.diagram.json"), "utf8")).toBe(edited);
	});

	it("copies a diagram with its data file and keeps a diagram's name", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-diagram-copy-"));
		await mkdir(join(folder, "from"));
		await writeFile(join(folder, "from", "Akış.diagram.png"), PNG_1X1);
		await writeFile(join(folder, "from", "Akış.diagram.json"), "{}");
		await mkdir(join(folder, "to"));
		await writeFile(join(folder, "to", "Akış.diagram.png"), "taken");
		expect(
			await copyDiagramInto(join(folder, "to"), join(folder, "from", "Akış.diagram.png")),
		).toBe("Akış-2.diagram.png");
		expect(await readFile(join(folder, "to", "Akış-2.diagram.json"), "utf8")).toBe("{}");
	});

	it("accepts only diagram data", () => {
		expect(checkDiagramData(serializeDiagram({ nodes: [], edges: [] }))).toContain("kalem-diagram");
		expect(() => checkDiagramData("{}")).toThrow("Invalid diagram data");
		expect(() => checkDiagramData(3)).toThrow("Invalid diagram data");
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
