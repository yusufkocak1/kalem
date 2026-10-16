import { describe, expect, it } from "vitest";
import type { Diagram, DiagramEdge, DiagramNode } from "./diagram.js";
import {
	connectionAllowed,
	liftEdges,
	parseDiagram,
	routeEdges,
	serializeDiagram,
} from "./diagram.js";
import {
	alignmentGuides,
	alignNodes,
	copyItems,
	decisionLabel,
	distributeNodes,
	fitGroups,
	groupNodes,
	layoutDiagram,
	moveNodes,
	nodesInBox,
	pasteItems,
	placeInGroups,
	removeItems,
	ungroup,
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

describe("diagram groups", () => {
	// Frontend outside; a backend group with two steps inside it.
	const backend = (): Diagram => ({
		nodes: [
			node("front", 0, 100),
			node("api", 300, 0, { shape: "group", w: 400, h: 300, text: "Backend" }),
			node("auth", 340, 60, { parent: "api" }),
			node("db", 340, 200, { parent: "api" }),
		],
		edges: [],
	});

	it("only lets shapes in the same group, or a group and its contents, connect", () => {
		const diagram = backend();
		expect(connectionAllowed(diagram, "auth", "db")).toBe(true);
		expect(connectionAllowed(diagram, "api", "auth")).toBe(true);
		expect(connectionAllowed(diagram, "front", "api")).toBe(true);
		expect(connectionAllowed(diagram, "front", "auth")).toBe(false);
		expect(connectionAllowed(diagram, "db", "front")).toBe(false);
	});

	it("moves a connector across a group's border up to the group", () => {
		const diagram = {
			...backend(),
			edges: [edge("e1", "front", "auth"), edge("e2", "auth", "db"), edge("e3", "front", "db")],
		};
		// The second one from outside would duplicate the first once lifted.
		expect(liftEdges(diagram).edges.map((item) => [item.id, item.from, item.to])).toEqual([
			["e1", "front", "api"],
			["e2", "auth", "db"],
		]);
	});

	it("puts a shape in the group it is dropped in, and out of it again", () => {
		let diagram: Diagram = {
			...backend(),
			nodes: [
				...backend().nodes,
				node("inner", 360, 40, { shape: "group", w: 300, h: 120 }),
				node("loose", 600, 250),
			],
		};
		diagram = placeInGroups(diagram, ["loose", "auth"]);
		expect(diagram.nodes.find((item) => item.id === "loose")?.parent).toBe("api");
		// The smallest group around it wins.
		expect(diagram.nodes.find((item) => item.id === "auth")?.parent).toBe("inner");
		diagram = placeInGroups(moveNodes(diagram, new Set(["loose"]), 600, 0), ["loose"]);
		expect(diagram.nodes.find((item) => item.id === "loose")?.parent).toBeUndefined();
	});

	it("grows a group around what is inside it", () => {
		const diagram = moveNodes(backend(), new Set(["db"]), 0, 200);
		const api = fitGroups(diagram).nodes.find((item) => item.id === "api");
		expect(api).toMatchObject({ x: 300, y: 0, w: 400, h: 470 });
	});

	it("moves, copies and deletes a group with what is inside it", () => {
		const diagram = { ...backend(), edges: [edge("e1", "auth", "db")] };
		const moved = moveNodes(diagram, new Set(["api"]), 10, 20);
		expect(at(moved, "db")).toEqual({ x: 350, y: 220 });
		expect(at(moved, "front")).toEqual({ x: 0, y: 100 });

		const pasted = pasteItems(diagram, copyItems(diagram, new Set(["api"])), { x: 0, y: 400 });
		expect(pasted.diagram.nodes.slice(4).map((item) => [item.id, item.parent])).toEqual([
			["n1", undefined],
			["n2", "n1"],
			["n3", "n1"],
		]);
		expect(pasted.diagram.edges.at(-1)).toMatchObject({ from: "n2", to: "n3" });

		const left = removeItems(diagram, new Set(["api"]), new Set());
		expect(left.nodes.map((item) => item.id)).toEqual(["front"]);
		expect(left.edges).toEqual([]);
	});

	it("groups selected shapes and takes the group away again", () => {
		const diagram: Diagram = {
			nodes: [node("front", 0, 0), node("a", 300, 0), node("b", 300, 100)],
			edges: [edge("e1", "front", "a"), edge("e2", "a", "b")],
		};
		const grouped = groupNodes(diagram, new Set(["a", "b"]), "Servis");
		if (grouped === null) throw new Error("not grouped");
		const group = grouped.diagram.nodes.find((item) => item.id === grouped.id);
		expect(group).toMatchObject({ shape: "group", text: "Servis", x: 280, y: -40, w: 140, h: 210 });
		expect(grouped.diagram.nodes.filter((item) => item.parent === grouped.id)).toHaveLength(2);
		// The connector from outside now ends at the group.
		expect(grouped.diagram.edges[0]).toMatchObject({ from: "front", to: grouped.id });

		const back = ungroup(grouped.diagram, grouped.id);
		expect(back.nodes.map((item) => [item.id, item.parent])).toEqual([
			["front", undefined],
			["a", undefined],
			["b", undefined],
		]);
		expect(back.edges.map((item) => item.id)).toEqual(["e2"]);
	});

	it("lays a group out as one shape and keeps its contents in place inside it", () => {
		const diagram = { ...backend(), edges: [edge("e1", "front", "api"), edge("e2", "auth", "db")] };
		const laid = layoutDiagram(diagram);
		const api = at(laid, "api");
		expect(at(laid, "front")?.y).toBe(0);
		expect(api?.y).toBe(110);
		expect(at(laid, "auth")).toEqual({ x: (api?.x ?? 0) + 40, y: (api?.y ?? 0) + 60 });
		expect(at(laid, "db")).toEqual({ x: (api?.x ?? 0) + 40, y: (api?.y ?? 0) + 200 });
	});

	it("keeps groups and multiplexers in the file and drops a parent that is not a group", () => {
		const diagram: Diagram = {
			nodes: [
				...backend().nodes,
				node("mux", 800, 0, { shape: "mux", w: 60, h: 120, direction: "down" }),
			],
			edges: [edge("e1", "auth", "db")],
		};
		expect(parseDiagram(serializeDiagram(diagram))).toEqual(diagram);
		const broken = serializeDiagram(diagram)
			.replace('"parent": "api"', '"parent": "front"')
			.replace('"direction": "down"', '"direction": "sideways"');
		const parsed = parseDiagram(broken);
		expect(parsed?.nodes.find((item) => item.id === "auth")?.parent).toBeUndefined();
		expect(parsed?.nodes.find((item) => item.id === "mux")?.direction).toBeUndefined();
		// auth left the group, so its connector to db went up to the group.
		expect(parsed?.edges[0]).toMatchObject({ from: "auth", to: "api" });
	});
});

describe("multiplexer and group routes", () => {
	it("spreads a multiplexer's inputs along its long side, in the order of their sources", () => {
		const diagram: Diagram = {
			nodes: [
				node("low", 0, 200),
				node("high", 0, 0),
				node("mux", 300, 40, { shape: "mux", w: 60, h: 120 }),
				node("out", 500, 75),
			],
			edges: [edge("e1", "low", "mux"), edge("e2", "high", "mux"), edge("e3", "mux", "out")],
		};
		const routes = routeEdges(diagram);
		// The upper source comes in at the upper third, the lower at the lower third.
		expect(routes.get("e2")?.points.at(-1)).toEqual({ x: 300, y: 80 });
		expect(routes.get("e1")?.points.at(-1)).toEqual({ x: 300, y: 120 });
		// The output leaves the middle of the short side.
		expect(routes.get("e3")?.points[0]).toEqual({ x: 360, y: 100 });

		const down = routeEdges({
			...diagram,
			nodes: diagram.nodes.map((item) =>
				item.id === "mux" ? { ...item, direction: "down" as const, w: 120, h: 60 } : item,
			),
		});
		expect(down.get("e2")?.points.at(-1)).toMatchObject({ y: 40 });
		expect(down.get("e3")?.points[0]).toEqual({ x: 360, y: 100 });
	});

	it("draws a group's connector to a shape inside it from the nearest border", () => {
		const diagram: Diagram = {
			nodes: [
				node("api", 0, 0, { shape: "group", w: 400, h: 300 }),
				node("auth", 40, 60, { parent: "api" }),
			],
			edges: [edge("e1", "api", "auth")],
		};
		expect(routeEdges(diagram).get("e1")?.points).toEqual([
			{ x: 0, y: 85 },
			{ x: 40, y: 85 },
		]);
	});
});
