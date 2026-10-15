/**
 * Operations on a diagram that the editor offers: selecting by area,
 * aligning, spreading, copying, laying out and the guides shown while
 * moving. Each returns a new diagram; none touches the screen.
 */
import type { Diagram, DiagramEdge, DiagramNode, Point } from "./diagram.js";
import { GRID, nextId, snap } from "./diagram.js";

export interface Box {
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

const selected = (diagram: Diagram, ids: ReadonlySet<string>): DiagramNode[] =>
	diagram.nodes.filter((node) => ids.has(node.id));

/** The box around the nodes. */
export function boxOf(nodes: readonly DiagramNode[]): Box {
	const left = Math.min(...nodes.map((node) => node.x));
	const top = Math.min(...nodes.map((node) => node.y));
	const right = Math.max(...nodes.map((node) => node.x + node.w));
	const bottom = Math.max(...nodes.map((node) => node.y + node.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The shapes wholly inside a box drawn in either direction. */
export function nodesInBox(diagram: Diagram, box: Box): string[] {
	const left = Math.min(box.x, box.x + box.w);
	const top = Math.min(box.y, box.y + box.h);
	const right = Math.max(box.x, box.x + box.w);
	const bottom = Math.max(box.y, box.y + box.h);
	return diagram.nodes
		.filter(
			(node) =>
				node.x >= left && node.y >= top && node.x + node.w <= right && node.y + node.h <= bottom,
		)
		.map((node) => node.id);
}

export function moveNodes(
	diagram: Diagram,
	ids: ReadonlySet<string>,
	dx: number,
	dy: number,
): Diagram {
	return {
		...diagram,
		nodes: diagram.nodes.map((node) =>
			ids.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
		),
	};
}

/** Removes shapes (with their connectors) and connectors. */
export function removeItems(
	diagram: Diagram,
	nodes: ReadonlySet<string>,
	edges: ReadonlySet<string>,
): Diagram {
	return {
		nodes: diagram.nodes.filter((node) => !nodes.has(node.id)),
		edges: diagram.edges.filter(
			(edge) => !edges.has(edge.id) && !nodes.has(edge.from) && !nodes.has(edge.to),
		),
	};
}

/** Lines the selected shapes up on one side or their middles, against the box around them. */
export function alignNodes(diagram: Diagram, ids: ReadonlySet<string>, mode: AlignMode): Diagram {
	const nodes = selected(diagram, ids);
	if (nodes.length < 2) return diagram;
	const box = boxOf(nodes);
	const place = (node: DiagramNode): DiagramNode => {
		switch (mode) {
			case "left":
				return { ...node, x: box.x };
			case "center":
				return { ...node, x: snap(box.x + box.w / 2 - node.w / 2) };
			case "right":
				return { ...node, x: box.x + box.w - node.w };
			case "top":
				return { ...node, y: box.y };
			case "middle":
				return { ...node, y: snap(box.y + box.h / 2 - node.h / 2) };
			case "bottom":
				return { ...node, y: box.y + box.h - node.h };
		}
	};
	return {
		...diagram,
		nodes: diagram.nodes.map((node) => (ids.has(node.id) ? place(node) : node)),
	};
}

/** Spreads three or more shapes so the gaps between them are equal; the outer two stay. */
export function distributeNodes(
	diagram: Diagram,
	ids: ReadonlySet<string>,
	axis: "x" | "y",
): Diagram {
	const nodes = selected(diagram, ids);
	if (nodes.length < 3) return diagram;
	const size = axis === "x" ? "w" : "h";
	const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]);
	const first = sorted[0] as DiagramNode;
	const last = sorted[sorted.length - 1] as DiagramNode;
	const span = last[axis] + last[size] - first[axis];
	const used = sorted.reduce((sum, node) => sum + node[size], 0);
	const gap = (span - used) / (sorted.length - 1);
	const placed = new Map<string, number>();
	let at = first[axis];
	for (const node of sorted) {
		placed.set(node.id, Math.round(at));
		at += node[size] + gap;
	}
	return {
		...diagram,
		nodes: diagram.nodes.map((node) => {
			const value = placed.get(node.id);
			return value === undefined ? node : { ...node, [axis]: value };
		}),
	};
}

/** The shapes and the connectors between them, as they are copied. */
export function copyItems(diagram: Diagram, ids: ReadonlySet<string>): Diagram {
	return {
		nodes: selected(diagram, ids),
		edges: diagram.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
	};
}

/** Adds copied items under new ids, moved by `offset`; returns the new shapes' ids too. */
export function pasteItems(
	diagram: Diagram,
	clip: Diagram,
	offset: Point,
): { diagram: Diagram; ids: string[] } {
	let next: Diagram = diagram;
	const ids = new Map<string, string>();
	for (const node of clip.nodes) {
		const id = nextId(next, "n");
		ids.set(node.id, id);
		next = {
			...next,
			nodes: [...next.nodes, { ...node, id, x: node.x + offset.x, y: node.y + offset.y }],
		};
	}
	for (const edge of clip.edges) {
		const from = ids.get(edge.from);
		const to = ids.get(edge.to);
		if (from === undefined || to === undefined) continue;
		next = { ...next, edges: [...next.edges, { ...edge, id: nextId(next, "e"), from, to }] };
	}
	return { diagram: next, ids: [...ids.values()] };
}

/** "Yes" for a decision's first way out, "No" for its second; nothing for anything else. */
export function decisionLabel(diagram: Diagram, from: string, yes: string, no: string): string {
	const node = diagram.nodes.find((item) => item.id === from);
	if (node?.shape !== "decision") return "";
	const labels = diagram.edges.filter((edge) => edge.from === from).map((edge) => edge.text);
	if (!labels.includes(yes)) return yes;
	if (!labels.includes(no)) return no;
	return "";
}

const LAYER_GAP = 60;
const NODE_GAP = 40;

/**
 * Lays the flow out top-down: each shape one row below the lowest shape
 * leading to it (loops back are ignored), rows centred on each other, and
 * shapes in a row ordered by where the shapes leading to them are.
 */
export function layoutDiagram(diagram: Diagram): Diagram {
	if (diagram.nodes.length === 0) return diagram;
	const ids = diagram.nodes.map((node) => node.id);
	const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
	for (const edge of diagram.edges) outgoing.get(edge.from)?.push(edge.to);

	// Depth-first from the top-most shapes; an edge back into the current path is a loop.
	const forward: DiagramEdge[] = [];
	const state = new Map<string, "open" | "done">();
	const order = [...diagram.nodes].sort((a, b) => a.y - b.y || a.x - b.x).map((node) => node.id);
	const visit = (id: string): void => {
		state.set(id, "open");
		for (const edge of diagram.edges.filter((item) => item.from === id)) {
			const seen = state.get(edge.to);
			if (seen === "open") continue;
			forward.push(edge);
			if (seen === undefined) visit(edge.to);
		}
		state.set(id, "done");
	};
	const incoming = new Set(diagram.edges.map((edge) => edge.to));
	for (const id of order) if (!incoming.has(id) && !state.has(id)) visit(id);
	for (const id of order) if (!state.has(id)) visit(id);

	// Longest path from the top: forward edges form no loop, so this settles.
	const layer = new Map<string, number>(ids.map((id) => [id, 0]));
	for (let changed = true, rounds = 0; changed && rounds <= ids.length; rounds++) {
		changed = false;
		for (const edge of forward) {
			const next = (layer.get(edge.from) ?? 0) + 1;
			if (next > (layer.get(edge.to) ?? 0)) {
				layer.set(edge.to, next);
				changed = true;
			}
		}
	}

	const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	const rows: DiagramNode[][] = [];
	for (const node of diagram.nodes) {
		const row = layer.get(node.id) ?? 0;
		const list = rows[row] ?? [];
		list.push(node);
		rows[row] = list;
	}
	const placedX = new Map<string, number>();
	const placed = new Map<string, { x: number; y: number }>();
	let y = 0;
	for (const row of rows) {
		if (row === undefined) continue;
		// Under the middle of the shapes leading here; the first row keeps its order.
		const key = (node: DiagramNode): number => {
			const from = forward
				.filter((edge) => edge.to === node.id)
				.map((edge) => placedX.get(edge.from));
			const known = from.filter((value): value is number => value !== undefined);
			return known.length === 0
				? node.x
				: known.reduce((sum, value) => sum + value, 0) / known.length;
		};
		// Ties (two ways out of one decision) keep their left-to-right order.
		const sorted = [...row].sort((a, b) => key(a) - key(b) || a.x - b.x);
		const width = sorted.reduce((sum, node) => sum + node.w, 0) + NODE_GAP * (sorted.length - 1);
		let x = -width / 2;
		const height = Math.max(...sorted.map((node) => node.h));
		for (const node of sorted) {
			placed.set(node.id, { x: snap(x), y: snap(y + (height - node.h) / 2) });
			placedX.set(node.id, x + node.w / 2);
			x += node.w + NODE_GAP;
		}
		y += height + LAYER_GAP;
	}
	return {
		...diagram,
		nodes: diagram.nodes.map((node) => ({
			...node,
			...(placed.get(node.id) ?? byId.get(node.id)),
		})),
	};
}

export interface Guide {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
}

/**
 * Lines a moving box up with other shapes: a side or middle within
 * `threshold` of another shape's side or middle snaps to it. Returns the
 * correction and the guide lines to show.
 */
export function alignmentGuides(
	box: Box,
	others: readonly DiagramNode[],
	threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
	const xs = (b: Box): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
	const ys = (b: Box): number[] => [b.y, b.y + b.h / 2, b.y + b.h];
	let bestX: { diff: number; at: number } | null = null;
	let bestY: { diff: number; at: number } | null = null;
	for (const other of others) {
		for (const target of xs(other)) {
			for (const own of xs(box)) {
				const diff = target - own;
				if (
					Math.abs(diff) <= threshold &&
					(bestX === null || Math.abs(diff) < Math.abs(bestX.diff))
				) {
					bestX = { diff, at: target };
				}
			}
		}
		for (const target of ys(other)) {
			for (const own of ys(box)) {
				const diff = target - own;
				if (
					Math.abs(diff) <= threshold &&
					(bestY === null || Math.abs(diff) < Math.abs(bestY.diff))
				) {
					bestY = { diff, at: target };
				}
			}
		}
	}
	const dx = bestX?.diff ?? 0;
	const dy = bestY?.diff ?? 0;
	const moved: Box = { ...box, x: box.x + dx, y: box.y + dy };
	const guides: Guide[] = [];
	// Each guide spans the moved box and every shape it lines up with.
	if (bestX !== null) {
		const at = bestX.at;
		const lined = others.filter((other) => xs(other).some((value) => Math.abs(value - at) < 0.5));
		const top = Math.min(moved.y, ...lined.map((other) => other.y));
		const bottom = Math.max(moved.y + moved.h, ...lined.map((other) => other.y + other.h));
		guides.push({ x1: at, y1: top - GRID, x2: at, y2: bottom + GRID });
	}
	if (bestY !== null) {
		const at = bestY.at;
		const lined = others.filter((other) => ys(other).some((value) => Math.abs(value - at) < 0.5));
		const left = Math.min(moved.x, ...lined.map((other) => other.x));
		const right = Math.max(moved.x + moved.w, ...lined.map((other) => other.x + other.w));
		guides.push({ x1: left - GRID, y1: at, x2: right + GRID, y2: at });
	}
	return { dx, dy, guides };
}
