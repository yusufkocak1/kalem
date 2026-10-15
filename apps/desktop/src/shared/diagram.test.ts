import { describe, expect, it } from "vitest";
import type { Diagram, DiagramNode } from "./diagram.js";
import {
	bounds,
	diagramSvg,
	edgeRoute,
	nextId,
	parseDiagram,
	serializeDiagram,
	svgMarkup,
	wrapLines,
} from "./diagram.js";

const node = (id: string, x: number, y: number, extra: Partial<DiagramNode> = {}): DiagramNode => ({
	id,
	shape: "process",
	x,
	y,
	w: 160,
	h: 70,
	text: "",
	color: "default",
	...extra,
});

describe("diagram data", () => {
	it("round-trips and repairs what it cannot use", () => {
		const diagram: Diagram = {
			nodes: [node("n1", 0, 0, { text: "Başla", shape: "terminal" }), node("n2", 0, 200)],
			edges: [{ id: "e1", from: "n1", to: "n2", text: "evet", dashed: true }],
		};
		expect(parseDiagram(serializeDiagram(diagram))).toEqual(diagram);

		const repaired = parseDiagram(
			JSON.stringify({
				format: "kalem-diagram",
				nodes: [
					{ id: "a", shape: "star", x: "1", w: 5, color: "pink", text: 3 },
					{ id: "a", x: 1 },
					{ id: "b", x: 1e9 },
				],
				edges: [
					{ id: "e", from: "a", to: "missing" },
					{ id: "f", from: "a", to: "a" },
					{ id: "g", from: "a", to: "b" },
				],
			}),
		);
		expect(repaired?.nodes).toEqual([
			{ id: "a", shape: "process", x: 0, y: 0, w: 40, h: 70, text: "", color: "default" },
			{ id: "b", shape: "process", x: 100_000, y: 0, w: 160, h: 70, text: "", color: "default" },
		]);
		expect(repaired?.edges.map((edge) => edge.id)).toEqual(["g"]);
		expect(parseDiagram("{}")).toBeNull();
		expect(parseDiagram("not json")).toBeNull();
	});

	it("gives new ids", () => {
		expect(nextId({ nodes: [node("n1", 0, 0), node("n3", 0, 0)], edges: [] }, "n")).toBe("n2");
		expect(nextId({ nodes: [], edges: [] }, "e")).toBe("e1");
	});
});

describe("diagram geometry", () => {
	it("connects a shape below straight down, one beside it sideways", () => {
		const a = node("a", 0, 0);
		expect(edgeRoute(a, node("b", 0, 200)).points).toEqual([
			{ x: 80, y: 70 },
			{ x: 80, y: 200 },
		]);
		// Offset: two right-angled bends, the label on the middle segment.
		const offset = edgeRoute(a, node("b", 300, 200));
		expect(offset.points).toEqual([
			{ x: 80, y: 70 },
			{ x: 80, y: 135 },
			{ x: 380, y: 135 },
			{ x: 380, y: 200 },
		]);
		expect(offset.label).toEqual({ x: 230, y: 135 });
		expect(edgeRoute(a, node("b", 300, 0)).points).toEqual([
			{ x: 160, y: 35 },
			{ x: 300, y: 35 },
		]);
		expect(edgeRoute(node("b", 0, 200), a).points[0]).toEqual({ x: 80, y: 200 });
	});

	it("wraps text to the shape", () => {
		expect(wrapLines("Müşteri kaydı var mı?", 80)).toEqual(["Müşteri", "kaydı var", "mı?"]);
		expect(wrapLines("bir\niki", 500)).toEqual(["bir", "iki"]);
		expect(wrapLines("çokuzunbirkelimeburada", 50)).toEqual(["çokuzu", "nbirke", "limebu", "rada"]);
	});

	it("covers the shapes and the edge labels", () => {
		const diagram: Diagram = {
			nodes: [node("a", 0, 0), node("b", 300, 0)],
			edges: [{ id: "e", from: "a", to: "b", text: "çok uzun bir etiket metni", dashed: false }],
		};
		expect(bounds(diagram)).toEqual({ x: 0, y: 0, w: 460, h: 70 });
		expect(bounds({ nodes: [], edges: [] })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
	});
});

describe("diagram drawing", () => {
	it("draws a standalone SVG with escaped text", () => {
		const { svg, width, height } = diagramSvg({
			nodes: [
				node("a", 0, 0, { text: 'A < B & "C"', shape: "decision", color: "blue" }),
				node("b", 0, 200),
			],
			edges: [{ id: "e", from: "a", to: "b", text: "evet", dashed: false }],
		});
		expect([width, height]).toEqual([200, 310]);
		const markup = svgMarkup(svg);
		expect(markup).toMatch(
			/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="200" height="310" viewBox="-20 -20 200 310">/,
		);
		expect(markup).toContain("A &lt; B &amp; &quot;C&quot;");
		expect(markup).toContain(
			'<polygon points="80,0 160,35 80,70 0,35" fill="#dbeafe" stroke="#2563eb"',
		);
		expect(markup).toContain('marker-end="url(#kd-arrow)"');
		expect(markup).toContain(">evet</tspan>");
		// Not interactive: no hit areas or ids for the editor.
		expect(markup).not.toContain("data-node");
	});
});
