import { describe, expect, it } from "vitest";
import type { Diagram, DiagramEdge, DiagramNode } from "./diagram.js";
import { parseDiagram, serializeDiagram } from "./diagram.js";
import {
	alignmentGuides,
	alignNodes,
	copyItems,
	decisionLabel,
	distributeNodes,
	layoutDiagram,
	nodesInBox,
	pasteItems,
	removeItems,
} from "./diagram-edit.js";

const node = (id: string, x: number, y: number, extra: Partial<DiagramNode> = {}): DiagramNode => ({
	id,
	shape: "process",
	x,
	y,
	w: 100,
	h: 50,
	text: "",
	color: "default",
	...extra,
});
const edge = (id: string, from: string, to: string, text = ""): DiagramEdge => ({
	id,
	from,
	to,
	text,
	dashed: false,
	arrow: "end",
});
const at = (diagram: Diagram, id: string) => {
	const found = diagram.nodes.find((item) => item.id === id);
	return found === undefined ? null : { x: found.x, y: found.y };
};

describe("diagram editing", () => {
	it("selects the shapes wholly inside a box drawn either way", () => {
		const diagram = { nodes: [node("a", 0, 0), node("b", 200, 0), node("c", 90, 0)], edges: [] };
		expect(nodesInBox(diagram, { x: -10, y: -10, w: 120, h: 70 })).toEqual(["a"]);
		expect(nodesInBox(diagram, { x: 310, y: 60, w: -320, h: -70 })).toEqual(["a", "b", "c"]);
	});

	it("aligns and spreads shapes", () => {
		const diagram = {
			nodes: [node("a", 0, 0), node("b", 200, 30, { w: 60 }), node("c", 50, 300)],
			edges: [],
		};
		const ids = new Set(["a", "b", "c"]);
		expect(alignNodes(diagram, ids, "left").nodes.map((item) => item.x)).toEqual([0, 0, 0]);
		expect(alignNodes(diagram, ids, "right").nodes.map((item) => item.x)).toEqual([160, 200, 160]);
		expect(alignNodes(diagram, ids, "center").nodes.map((item) => item.x)).toEqual([80, 100, 80]);
		expect(alignNodes(diagram, ids, "top").nodes.map((item) => item.y)).toEqual([0, 0, 0]);
		// One shape alone stays.
		expect(alignNodes(diagram, new Set(["a"]), "left")).toBe(diagram);

		const spread = distributeNodes(diagram, ids, "y");
		expect(spread.nodes.map((item) => item.y)).toEqual([0, 150, 300]);
		expect(distributeNodes(diagram, new Set(["a", "b"]), "x")).toBe(diagram);
	});

	it("copies shapes with the connectors between them and pastes them under new ids", () => {
		const diagram = {
			nodes: [node("n1", 0, 0), node("n2", 0, 100), node("n3", 0, 200)],
			edges: [edge("e1", "n1", "n2", "a"), edge("e2", "n2", "n3")],
		};
		const clip = copyItems(diagram, new Set(["n1", "n2"]));
		expect(clip.edges.map((item) => item.id)).toEqual(["e1"]);
		const pasted = pasteItems(diagram, clip, { x: 20, y: 20 });
		expect(pasted.ids).toEqual(["n4", "n5"]);
		expect(pasted.diagram.nodes.slice(3).map((item) => [item.x, item.y])).toEqual([
			[20, 20],
			[20, 120],
		]);
		expect(pasted.diagram.edges.at(-1)).toEqual(edge("e3", "n4", "n5", "a"));
	});

	it("removes shapes with their connectors", () => {
		const diagram = {
			nodes: [node("n1", 0, 0), node("n2", 0, 100), node("n3", 0, 200)],
			edges: [edge("e1", "n1", "n2"), edge("e2", "n2", "n3"), edge("e3", "n1", "n3")],
		};
		const left = removeItems(diagram, new Set(["n2"]), new Set(["e3"]));
		expect(left.nodes.map((item) => item.id)).toEqual(["n1", "n3"]);
		expect(left.edges).toEqual([]);
	});

	it("labels a decision's ways out yes, then no", () => {
		let diagram: Diagram = {
			nodes: [node("d", 0, 0, { shape: "decision" }), node("p", 0, 100)],
			edges: [],
		};
		expect(decisionLabel(diagram, "d", "Evet", "Hayır")).toBe("Evet");
		diagram = { ...diagram, edges: [edge("e1", "d", "p", "Evet")] };
		expect(decisionLabel(diagram, "d", "Evet", "Hayır")).toBe("Hayır");
		diagram = { ...diagram, edges: [...diagram.edges, edge("e2", "d", "p", "Hayır")] };
		expect(decisionLabel(diagram, "d", "Evet", "Hayır")).toBe("");
		expect(decisionLabel(diagram, "p", "Evet", "Hayır")).toBe("");
	});

	it("lays a flow out top-down, a loop back left alone", () => {
		const diagram: Diagram = {
			nodes: [
				node("start", 500, 500),
				node("check", 0, 0, { shape: "decision", w: 160, h: 100 }),
				node("yes", 900, 40),
				node("no", -300, 20),
				node("end", 0, 900),
			],
			edges: [
				edge("e1", "start", "check"),
				edge("e2", "check", "yes"),
				edge("e3", "check", "no"),
				edge("e4", "yes", "end"),
				edge("e5", "no", "end"),
				// Loop back to the decision.
				edge("e6", "no", "check"),
			],
		};
		const laid = layoutDiagram(diagram);
		const rows = ["start", "check", "yes", "no", "end"].map((id) => at(laid, id)?.y);
		expect(rows).toEqual([0, 110, 270, 270, 380]);
		// The second row's two shapes sit side by side, the rest centred.
		expect(at(laid, "no")?.x).toBeLessThan(at(laid, "yes")?.x ?? 0);
		expect(at(laid, "start")?.x).toBe(-50);
		expect(at(laid, "check")?.x).toBe(-80);
		// Laid out twice, nothing moves.
		expect(layoutDiagram(laid)).toEqual(laid);
	});

	it("snaps a moving box to the sides and middles of other shapes", () => {
		const others = [node("a", 0, 0), node("b", 300, 200)];
		const result = alignmentGuides({ x: 4, y: 103, w: 100, h: 50 }, others, 6);
		expect([result.dx, result.dy]).toEqual([-4, 0]);
		expect(result.guides).toEqual([{ x1: 0, y1: -10, x2: 0, y2: 163 }]);
		const middle = alignmentGuides({ x: 120, y: 198, w: 100, h: 50 }, others, 6);
		expect(middle.dy).toBe(2);
		expect(alignmentGuides({ x: 150, y: 100, w: 20, h: 20 }, others, 6).guides).toEqual([]);
	});

	it("keeps arrowheads in the file, the end one by default", () => {
		const diagram: Diagram = {
			nodes: [node("a", 0, 0, { shape: "text" }), node("b", 0, 100, { shape: "circle" })],
			edges: [{ ...edge("e", "a", "b"), arrow: "both" }],
		};
		expect(parseDiagram(serializeDiagram(diagram))).toEqual(diagram);
		const old = serializeDiagram(diagram).replace('"arrow": "both"', '"arrow": "sideways"');
		expect(parseDiagram(old)?.edges[0]?.arrow).toBe("end");
	});
});
