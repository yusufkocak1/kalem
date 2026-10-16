/**
 * Operations on a diagram that the editor offers: selecting by area,
 * aligning, spreading, copying, laying out and the guides shown while
 * moving. Each returns a new diagram; none touches the screen.
 */
import type { Diagram, DiagramEdge, DiagramNode, Point } from "./diagram.js";
import { ancestors, GRID, liftEdges, nextId, snap } from "./diagram.js";

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

/** The shapes with everything inside the groups among them. */
export function withContents(diagram: Diagram, ids: Iterable<string>): Set<string> {
	const all = new Set(ids);
	for (let grown = true; grown; ) {
		grown = false;
		for (const node of diagram.nodes) {
			if (node.parent !== undefined && all.has(node.parent) && !all.has(node.id)) {
				all.add(node.id);
				grown = true;
			}
		}
	}
	return all;
}

/** Moves the shapes, and what is inside the groups among them. */
export function moveNodes(
	diagram: Diagram,
	ids: ReadonlySet<string>,
	dx: number,
	dy: number,
): Diagram {
	const moving = withContents(diagram, ids);
	return {
		...diagram,
		nodes: diagram.nodes.map((node) =>
			moving.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
		),
	};
}

/** Removes shapes (a group with what is inside it, all with their connectors) and connectors. */
export function removeItems(
	diagram: Diagram,
	nodes: ReadonlySet<string>,
	edges: ReadonlySet<string>,
): Diagram {
	const gone = withContents(diagram, nodes);
	return {
		nodes: diagram.nodes.filter((node) => !gone.has(node.id)),
		edges: diagram.edges.filter(
			(edge) => !edges.has(edge.id) && !gone.has(edge.from) && !gone.has(edge.to),
		),
	};
}

/**
 * Moves what is inside each group along with it, after an operation that
 * placed groups but not their contents.
 */
function carryContents(before: Diagram, after: Diagram): Diagram {
	const old = new Map(before.nodes.map((node) => [node.id, node]));
	const shift = new Map<string, Point>();
	for (const node of after.nodes) {
		const was = old.get(node.id);
		if (node.shape === "group" && was !== undefined && (was.x !== node.x || was.y !== node.y)) {
			shift.set(node.id, { x: node.x - was.x, y: node.y - was.y });
		}
	}
	if (shift.size === 0) return after;
	return {
		...after,
		nodes: after.nodes.map((node) => {
			const was = old.get(node.id);
			// A shape the operation placed itself stays where it was put.
			if (was === undefined || was.x !== node.x || was.y !== node.y) return node;
			const group = ancestors(after, node.id).find((id) => shift.has(id));
			const by = group === undefined ? undefined : shift.get(group);
			return by === undefined ? node : { ...node, x: node.x + by.x, y: node.y + by.y };
		}),
	};
}

/** Space around a group's contents, and above them for its name. */
export const GROUP_PADDING = 20;
export const GROUP_TOP = 40;

/** The group a shape belongs in by where it is: the smallest one around its middle. */
function groupAt(diagram: Diagram, node: DiagramNode): string | undefined {
	const cx = node.x + node.w / 2;
	const cy = node.y + node.h / 2;
	const own = withContents(diagram, [node.id]);
	let best: DiagramNode | undefined;
	for (const group of diagram.nodes) {
		if (group.shape !== "group" || own.has(group.id)) continue;
		if (cx < group.x || cx > group.x + group.w || cy < group.y || cy > group.y + group.h) continue;
		if (best === undefined || group.w * group.h < best.w * best.h) best = group;
	}
	return best?.id;
}

/** Puts each of the shapes in the group it now lies in (or none). */
export function placeInGroups(diagram: Diagram, ids: Iterable<string>): Diagram {
	let next = diagram;
	for (const id of ids) {
		const node = next.nodes.find((item) => item.id === id);
		if (node === undefined) continue;
		const parent = groupAt(next, node);
		if (parent === node.parent) continue;
		const { parent: _old, ...rest } = node;
		const moved: DiagramNode = parent === undefined ? rest : { ...rest, parent };
		next = { ...next, nodes: next.nodes.map((item) => (item.id === id ? moved : item)) };
	}
	return next;
}

/** Grows each group, inner ones first, to keep its contents inside it with some room. */
export function fitGroups(diagram: Diagram): Diagram {
	const groups = diagram.nodes
		.filter((node) => node.shape === "group")
		.sort((a, b) => ancestors(diagram, b.id).length - ancestors(diagram, a.id).length);
	let next = diagram;
	for (const { id } of groups) {
		const group = next.nodes.find((node) => node.id === id) as DiagramNode;
		const contents = next.nodes.filter((node) => node.parent === id);
		if (contents.length === 0) continue;
		const box = boxOf(contents);
		const left = Math.min(group.x, box.x - GROUP_PADDING);
		const top = Math.min(group.y, box.y - GROUP_TOP);
		const right = Math.max(group.x + group.w, box.x + box.w + GROUP_PADDING);
		const bottom = Math.max(group.y + group.h, box.y + box.h + GROUP_PADDING);
		if (
			left === group.x &&
			top === group.y &&
			right === group.x + group.w &&
			bottom === group.y + group.h
		) {
			continue;
		}
		const grown = { ...group, x: left, y: top, w: right - left, h: bottom - top };
		next = { ...next, nodes: next.nodes.map((node) => (node.id === id ? grown : node)) };
	}
	return next;
}

/**
 * After shapes moved or were added: each goes into the group it lies in,
 * groups grow around their contents, and connectors that now cross a
 * group's border move up to the group.
 */
export function settleGroups(diagram: Diagram, moved: Iterable<string>): Diagram {
	return liftEdges(fitGroups(placeInGroups(diagram, moved)));
}

/**
 * Puts the shapes in a new group drawn around them. Connectors from
 * outside to them now go to the group.
 */
export function groupNodes(
	diagram: Diagram,
	ids: ReadonlySet<string>,
	title: string,
): { diagram: Diagram; id: string } | null {
	// The outermost of the shapes; what is inside them comes along.
	const members = diagram.nodes.filter(
		(node) => ids.has(node.id) && !ancestors(diagram, node.id).some((id) => ids.has(id)),
	);
	if (members.length === 0) return null;
	const parents = new Set(members.map((node) => node.parent));
	const parent = parents.size === 1 ? [...parents][0] : undefined;
	const box = boxOf(members);
	const id = nextId(diagram, "n");
	const group: DiagramNode = {
		id,
		shape: "group",
		x: snap(box.x - GROUP_PADDING),
		y: snap(box.y - GROUP_TOP),
		w: snap(box.w + 2 * GROUP_PADDING),
		h: snap(box.h + GROUP_TOP + GROUP_PADDING),
		text: title,
		color: "default",
		...(parent === undefined ? {} : { parent }),
	};
	const inside = new Set(members.map((node) => node.id));
	const nodes = [
		group,
		...diagram.nodes.map((node) => (inside.has(node.id) ? { ...node, parent: id } : node)),
	];
	return { diagram: liftEdges(fitGroups({ ...diagram, nodes })), id };
}

/** Takes a group away, keeping what was inside it; connectors to the group go with it. */
export function ungroup(diagram: Diagram, id: string): Diagram {
	const group = diagram.nodes.find((node) => node.id === id);
	if (group?.shape !== "group") return diagram;
	return {
		nodes: diagram.nodes
			.filter((node) => node.id !== id)
			.map((node) => {
				if (node.parent !== id) return node;
				const { parent: _old, ...rest } = node;
				return group.parent === undefined ? rest : { ...rest, parent: group.parent };
			}),
		edges: diagram.edges.filter((edge) => edge.from !== id && edge.to !== id),
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
	return carryContents(diagram, {
		...diagram,
		nodes: diagram.nodes.map((node) => (ids.has(node.id) ? place(node) : node)),
	});
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
	return carryContents(diagram, {
		...diagram,
		nodes: diagram.nodes.map((node) => {
			const value = placed.get(node.id);
			return value === undefined ? node : { ...node, [axis]: value };
		}),
	});
}

/** The shapes (groups with what is inside them) and the connectors between them, as they are copied. */
export function copyItems(diagram: Diagram, ids: ReadonlySet<string>): Diagram {
	const all = withContents(diagram, ids);
	return {
		nodes: selected(diagram, all),
		edges: diagram.edges.filter((edge) => all.has(edge.from) && all.has(edge.to)),
	};
}

/** Adds copied items under new ids, moved by `offset`; returns the new shapes' ids too. */
export function pasteItems(
	diagram: Diagram,
	clip: Diagram,
	offset: Point,
): { diagram: Diagram; ids: string[] } {
	const taken = new Set([...diagram.nodes, ...diagram.edges].map((item) => item.id));
	const fresh = (prefix: "n" | "e"): string => {
		for (let n = 1; ; n++) {
			const id = `${prefix}${n}`;
			if (!taken.has(id)) {
				taken.add(id);
				return id;
			}
		}
	};
	const ids = new Map(clip.nodes.map((node) => [node.id, fresh("n")]));
	const nodes = clip.nodes.map((node): DiagramNode => {
		// Inside a copied group it stays inside the copy; otherwise its place decides.
		const { parent, ...rest } = node;
		const copiedParent = parent === undefined ? undefined : ids.get(parent);
		return {
			...rest,
			id: ids.get(node.id) as string,
			x: node.x + offset.x,
			y: node.y + offset.y,
			...(copiedParent === undefined ? {} : { parent: copiedParent }),
		};
	});
	const edges: DiagramEdge[] = [];
	for (const edge of clip.edges) {
		const from = ids.get(edge.from);
		const to = ids.get(edge.to);
		if (from !== undefined && to !== undefined) edges.push({ ...edge, id: fresh("e"), from, to });
	}
	return {
		diagram: { nodes: [...diagram.nodes, ...nodes], edges: [...diagram.edges, ...edges] },
		ids: [...ids.values()],
	};
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
	// Groups are laid out as one shape each, their contents carried along.
	const top = (id: string): string => ancestors(diagram, id).at(-1) ?? id;
	const outer = diagram.nodes.filter((node) => node.parent === undefined);
	const seen = new Set<string>();
	const edges: DiagramEdge[] = [];
	for (const edge of diagram.edges) {
		const from = top(edge.from);
		const to = top(edge.to);
		const key = `${from}\u0000${to}`;
		if (from === to || seen.has(key)) continue;
		seen.add(key);
		edges.push({ ...edge, from, to });
	}
	const laid = layoutFlat({ nodes: outer, edges });
	const placed = new Map(laid.nodes.map((node) => [node.id, node]));
	return carryContents(diagram, {
		...diagram,
		nodes: diagram.nodes.map((node) => {
			const at = placed.get(node.id);
			return at === undefined ? node : { ...node, x: at.x, y: at.y };
		}),
	});
}

function layoutFlat(diagram: Diagram): Diagram {
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
