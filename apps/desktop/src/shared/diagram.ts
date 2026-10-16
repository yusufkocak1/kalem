/**
 * Flow diagrams: the data the diagram editor works on, and the SVG drawn
 * from it. The same drawing is the editor's canvas and the PNG that goes
 * into the document, whose `iTXt` chunk keeps this data for the next edit.
 */

/** The PNG text keyword the diagram data is kept under. */
export const DIAGRAM_KEYWORD = "kalem-diagram";
/** Diagram files end in this, so the editor can offer to edit them. */
export const DIAGRAM_SUFFIX = ".diagram.png";
/** The diagram's data, next to its picture: `<name>.diagram.json`. */
export const DIAGRAM_DATA_SUFFIX = ".diagram.json";

/** The data file's name or URL for a diagram picture's (a query or fragment is dropped). */
export function diagramDataName(picture: string): string {
	return `${picture.replace(/[?#].*$/, "").replace(/\.png$/i, "")}.json`;
}

export function isDiagramPicture(name: string): boolean {
	// kalem-locale-ok: file extensions are ASCII
	return name
		.replace(/[?#].*$/, "")
		.toLowerCase()
		.endsWith(DIAGRAM_SUFFIX);
}

export const SHAPES = [
	"terminal",
	"process",
	"decision",
	"io",
	"document",
	"database",
	"subprocess",
	"circle",
	"text",
	"mux",
	"group",
] as const;
export type ShapeKind = (typeof SHAPES)[number];

export const COLORS = {
	default: { fill: "#ffffff", stroke: "#334155" },
	blue: { fill: "#dbeafe", stroke: "#2563eb" },
	green: { fill: "#dcfce7", stroke: "#16a34a" },
	yellow: { fill: "#fef9c3", stroke: "#ca8a04" },
	red: { fill: "#fee2e2", stroke: "#dc2626" },
	purple: { fill: "#f3e8ff", stroke: "#9333ea" },
	gray: { fill: "#f1f5f9", stroke: "#64748b" },
} as const;
export type ColorName = keyof typeof COLORS;

export const DIRECTIONS = ["right", "down", "left", "up"] as const;
/** Where a multiplexer's output points; its inputs are on the opposite, long side. */
export type Direction = (typeof DIRECTIONS)[number];

export interface DiagramNode {
	readonly id: string;
	readonly shape: ShapeKind;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly text: string;
	readonly color: ColorName;
	/** The group the shape is in; shapes outside it cannot connect to it. */
	readonly parent?: string;
	/** A multiplexer's output side; `right` when not given. */
	readonly direction?: Direction;
}

export const ARROWS = ["end", "both", "none"] as const;
/** Where a connector has arrowheads. */
export type ArrowKind = (typeof ARROWS)[number];

export interface DiagramEdge {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly text: string;
	readonly dashed: boolean;
	readonly arrow: ArrowKind;
}

export interface Diagram {
	readonly nodes: readonly DiagramNode[];
	readonly edges: readonly DiagramEdge[];
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

export const GRID = 10;
export const MIN_WIDTH = 40;
export const MIN_HEIGHT = 30;
const MAX_ITEMS = 2000;
const MAX_COORD = 100_000;
const MAX_TEXT = 2000;

export const DEFAULT_SIZE: Readonly<Record<ShapeKind, { w: number; h: number }>> = {
	terminal: { w: 140, h: 50 },
	process: { w: 160, h: 70 },
	decision: { w: 160, h: 100 },
	io: { w: 170, h: 70 },
	document: { w: 160, h: 80 },
	database: { w: 120, h: 90 },
	subprocess: { w: 170, h: 70 },
	circle: { w: 60, h: 60 },
	text: { w: 160, h: 40 },
	mux: { w: 60, h: 120 },
	group: { w: 400, h: 260 },
};

export const FONT_SIZE = 14;
const LINE_HEIGHT = 18;
const FONT_FAMILY = "Segoe UI, Arial, Helvetica, sans-serif";
const TEXT_COLOR = "#0f172a";
const EDGE_COLOR = "#475569";

export function emptyDiagram(): Diagram {
	return { nodes: [], edges: [] };
}

export const snap = (value: number): number => Math.round(value / GRID) * GRID;

/** An id the diagram does not use yet: `n1`, `n2`… or `e1`, `e2`… */
export function nextId(diagram: Diagram, prefix: "n" | "e"): string {
	const used = new Set([...diagram.nodes, ...diagram.edges].map((item) => item.id));
	for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/** The diagram's data file; indented, so it reads and diffs well. */
export function serializeDiagram(diagram: Diagram, indent = 2): string {
	return `${JSON.stringify({ format: DIAGRAM_KEYWORD, version: 1, ...diagram }, null, indent)}\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

function finite(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
}

const str = (value: unknown): string => (typeof value === "string" ? value.slice(0, MAX_TEXT) : "");

/** The diagram kept in a file; `null` when the text is not one. Unknown values fall back to defaults. */
export function parseDiagram(text: string): Diagram | null {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isObject(data) || data.format !== DIAGRAM_KEYWORD) return null;
	const nodes: DiagramNode[] = [];
	const ids = new Set<string>();
	for (const raw of Array.isArray(data.nodes) ? data.nodes.slice(0, MAX_ITEMS) : []) {
		if (!isObject(raw)) continue;
		const id = str(raw.id);
		if (id === "" || ids.has(id)) continue;
		const shape = SHAPES.includes(raw.shape as ShapeKind) ? (raw.shape as ShapeKind) : "process";
		const size = DEFAULT_SIZE[shape];
		ids.add(id);
		nodes.push({
			id,
			shape,
			x: finite(raw.x, 0, -MAX_COORD, MAX_COORD),
			y: finite(raw.y, 0, -MAX_COORD, MAX_COORD),
			w: finite(raw.w, size.w, MIN_WIDTH, MAX_COORD),
			h: finite(raw.h, size.h, MIN_HEIGHT, MAX_COORD),
			text: str(raw.text),
			color:
				typeof raw.color === "string" && raw.color in COLORS ? (raw.color as ColorName) : "default",
			...(typeof raw.parent === "string" && raw.parent !== "" ? { parent: raw.parent } : {}),
			...(shape === "mux" && DIRECTIONS.includes(raw.direction as Direction)
				? { direction: raw.direction as Direction }
				: {}),
		});
	}
	const checked = withValidParents(nodes);
	const edges: DiagramEdge[] = [];
	for (const raw of Array.isArray(data.edges) ? data.edges.slice(0, MAX_ITEMS) : []) {
		if (!isObject(raw)) continue;
		const id = str(raw.id);
		const from = str(raw.from);
		const to = str(raw.to);
		if (id === "" || ids.has(id) || !ids.has(from) || !ids.has(to) || from === to) continue;
		ids.add(id);
		const arrow = ARROWS.includes(raw.arrow as ArrowKind) ? (raw.arrow as ArrowKind) : "end";
		edges.push({ id, from, to, text: str(raw.text), dashed: raw.dashed === true, arrow });
	}
	return liftEdges({ nodes: checked, edges });
}

/** Drops a `parent` that is not a group of the diagram, or that would make a loop. */
function withValidParents(nodes: readonly DiagramNode[]): DiagramNode[] {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const loops = (start: DiagramNode): boolean => {
		const seen = new Set([start.id]);
		for (let at = start.parent; at !== undefined; at = byId.get(at)?.parent) {
			if (seen.has(at)) return true;
			seen.add(at);
		}
		return false;
	};
	return nodes.map((node) => {
		if (node.parent === undefined) return node;
		const parent = byId.get(node.parent);
		if (parent?.shape === "group" && !loops(node)) return node;
		const { parent: _dropped, ...rest } = node;
		return rest;
	});
}

// --- Groups ------------------------------------------------------------------

/** The groups a shape is in, innermost first. */
export function ancestors(diagram: Diagram, id: string): string[] {
	const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	const chain: string[] = [];
	for (
		let at = byId.get(id)?.parent;
		at !== undefined && !chain.includes(at);
		at = byId.get(at)?.parent
	) {
		chain.push(at);
	}
	return chain;
}

/**
 * Shapes can connect when they are in the same group (or both outside every
 * group), or when one is the group the other is in. A shape inside a group
 * is not reachable from outside it: the outside connects to the group.
 */
export function connectionAllowed(diagram: Diagram, from: string, to: string): boolean {
	if (from === to) return false;
	const parentOf = (id: string): string | undefined =>
		diagram.nodes.find((node) => node.id === id)?.parent;
	const a = parentOf(from);
	const b = parentOf(to);
	return a === b || a === to || b === from;
}

/**
 * Connectors that cross a group's border are moved up to the group: the
 * end inside is replaced by the group it is in, the deeper end first,
 * until the connection is allowed. One that ends where it starts goes, as
 * does a second connector between the same two shapes.
 */
export function liftEdges(diagram: Diagram): Diagram {
	const depth = (id: string): number => ancestors(diagram, id).length;
	const parentOf = (id: string): string | undefined =>
		diagram.nodes.find((node) => node.id === id)?.parent;
	const edges: DiagramEdge[] = [];
	const seen = new Set<string>();
	let changed = false;
	for (const edge of diagram.edges) {
		let { from, to } = edge;
		while (from !== to && !connectionAllowed(diagram, from, to)) {
			const df = depth(from);
			const dt = depth(to);
			if (df >= dt) from = parentOf(from) ?? from;
			if (dt >= df) to = parentOf(to) ?? to;
		}
		const key = `${from}\u0000${to}`;
		if (from === to || seen.has(key)) {
			changed = true;
			continue;
		}
		seen.add(key);
		if (from !== edge.from || to !== edge.to) changed = true;
		edges.push(from === edge.from && to === edge.to ? edge : { ...edge, from, to });
	}
	return changed ? { ...diagram, edges } : diagram;
}

// --- Geometry ----------------------------------------------------------------

type Side = "top" | "right" | "bottom" | "left";

interface Anchor extends Point {
	readonly side: Side;
}

export interface Route {
	readonly points: Point[];
	readonly label: Point;
}

function anchor(node: DiagramNode, side: Side): Point {
	switch (side) {
		case "top":
			return { x: node.x + node.w / 2, y: node.y };
		case "bottom":
			return { x: node.x + node.w / 2, y: node.y + node.h };
		case "left":
			return { x: node.x, y: node.y + node.h / 2 };
		case "right":
			return { x: node.x + node.w, y: node.y + node.h / 2 };
	}
}

/**
 * The connector between two shapes: down (or up) when one is below the
 * other, sideways otherwise, with right-angled bends between the sides'
 * midpoints. `label` is where its text goes.
 */
export function edgeRoute(from: DiagramNode, to: DiagramNode): { points: Point[]; label: Point } {
	const vertical = to.y >= from.y + from.h + GRID || from.y >= to.y + to.h + GRID;
	const across = to.x + to.w / 2 - (from.x + from.w / 2);
	let points: Point[];
	if (vertical && from.shape === "decision" && Math.abs(across) > from.w / 2) {
		// A decision's branch to one side leaves from that corner of the diamond, so
		// it does not share the way down with the branch below.
		const down = to.y > from.y;
		const a = anchor(from, across > 0 ? "right" : "left");
		const b = anchor(to, down ? "top" : "bottom");
		points = [a, { x: b.x, y: a.y }, b];
		// On the longer leg: a short one leaves the label on the diamond's corner.
		return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
			? { points, label: { x: (a.x + b.x) / 2, y: a.y } }
			: { points, label: { x: b.x, y: (a.y + b.y) / 2 } };
	}
	if (vertical) {
		const down = to.y > from.y;
		const a = anchor(from, down ? "bottom" : "top");
		const b = anchor(to, down ? "top" : "bottom");
		const middle = (a.y + b.y) / 2;
		points =
			Math.abs(a.x - b.x) < 1 ? [a, b] : [a, { x: a.x, y: middle }, { x: b.x, y: middle }, b];
	} else {
		const right = to.x + to.w / 2 >= from.x + from.w / 2;
		const a = anchor(from, right ? "right" : "left");
		const b = anchor(to, right ? "left" : "right");
		const middle = (a.x + b.x) / 2;
		points =
			Math.abs(a.y - b.y) < 1 ? [a, b] : [a, { x: middle, y: a.y }, { x: middle, y: b.y }, b];
	}
	const [p, q] = points.length === 2 ? [points[0], points[1]] : [points[1], points[2]];
	return {
		points,
		label: { x: ((p as Point).x + (q as Point).x) / 2, y: ((p as Point).y + (q as Point).y) / 2 },
	};
}

const isAcross = (side: Side): boolean => side === "left" || side === "right";

/** The side of a shape that faces a point. */
function sideToward(node: DiagramNode, point: Point): Side {
	const dx = (point.x - (node.x + node.w / 2)) / (node.w / 2);
	const dy = (point.y - (node.y + node.h / 2)) / (node.h / 2);
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
	return dy >= 0 ? "bottom" : "top";
}

/** A right-angled path between two anchors; the label on its longest leg. */
function orthogonal(a: Anchor, b: Anchor): Route {
	let points: Point[];
	if (Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1) points = [a, b];
	else if (isAcross(a.side) && isAcross(b.side)) {
		const middle = (a.x + b.x) / 2;
		points = [a, { x: middle, y: a.y }, { x: middle, y: b.y }, b];
	} else if (!isAcross(a.side) && !isAcross(b.side)) {
		const middle = (a.y + b.y) / 2;
		points = [a, { x: a.x, y: middle }, { x: b.x, y: middle }, b];
	} else if (isAcross(a.side)) points = [a, { x: b.x, y: a.y }, b];
	else points = [a, { x: a.x, y: b.y }, b];
	let label: Point = a;
	let longest = -1;
	for (let i = 1; i < points.length; i++) {
		const p = points[i - 1] as Point;
		const q = points[i] as Point;
		const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
		if (length > longest) {
			longest = length;
			label = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
		}
	}
	return { points: points.map(({ x, y }) => ({ x, y })), label };
}

/** How far a multiplexer's narrow side is set in at each end. */
const muxInset = (node: DiagramNode): number =>
	(node.direction ?? "right") === "right" || node.direction === "left"
		? node.h * 0.2
		: node.w * 0.2;

/** Where the `index`-th of `count` connectors meets a multiplexer: inputs on the long side, outputs on the short one. */
function muxAnchor(node: DiagramNode, input: boolean, index: number, count: number): Anchor {
	const direction = node.direction ?? "right";
	const inset = input ? 0 : muxInset(node);
	const along = (index + 1) / (count + 1);
	const out: Record<Direction, Side> = { right: "right", left: "left", down: "bottom", up: "top" };
	const back: Record<Direction, Side> = { right: "left", left: "right", down: "top", up: "bottom" };
	const side = input ? back[direction] : out[direction];
	if (isAcross(side)) {
		const y = node.y + inset + along * (node.h - 2 * inset);
		return { x: side === "left" ? node.x : node.x + node.w, y, side };
	}
	const x = node.x + inset + along * (node.w - 2 * inset);
	return { x, y: side === "top" ? node.y : node.y + node.h, side };
}

/** A group's border opposite a shape inside it, and the shape's side that faces it. */
function inside(group: DiagramNode, child: DiagramNode): { outer: Anchor; inner: Anchor } {
	const gaps: [Side, number][] = [
		["left", child.x - group.x],
		["right", group.x + group.w - (child.x + child.w)],
		["top", child.y - group.y],
		["bottom", group.y + group.h - (child.y + child.h)],
	];
	const side = gaps.reduce((best, gap) => (gap[1] < best[1] ? gap : best))[0];
	const cx = child.x + child.w / 2;
	const cy = child.y + child.h / 2;
	const inner = { ...anchor(child, side), side };
	const outer: Anchor = isAcross(side)
		? { x: side === "left" ? group.x : group.x + group.w, y: cy, side }
		: { x: cx, y: side === "top" ? group.y : group.y + group.h, side };
	return { outer, inner };
}

/**
 * Every connector's path. Most go between the facing sides' middles
 * ({@link edgeRoute}); a multiplexer spreads its inputs along its long side
 * and its outputs along its short one, and a group meets a shape inside it
 * from the nearest border.
 */
export function routeEdges(diagram: Diagram): Map<string, Route> {
	const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	const center = (node: DiagramNode): Point => ({ x: node.x + node.w / 2, y: node.y + node.h / 2 });
	// The connectors at each multiplexer, in the order their other ends lie along its side.
	const slots = new Map<string, { index: number; count: number }>();
	for (const node of diagram.nodes) {
		if (node.shape !== "mux") continue;
		const across = isAcross(muxAnchor(node, true, 0, 1).side);
		for (const input of [true, false]) {
			const ends = diagram.edges
				.filter((edge) => (input ? edge.to : edge.from) === node.id)
				.map((edge) => ({ edge, other: byId.get(input ? edge.from : edge.to) }))
				.filter((end): end is { edge: DiagramEdge; other: DiagramNode } => end.other !== undefined)
				.sort((p, q) =>
					across ? center(p.other).y - center(q.other).y : center(p.other).x - center(q.other).x,
				);
			ends.forEach(({ edge }, index) => {
				slots.set(`${edge.id}:${input ? "to" : "from"}`, { index, count: ends.length });
			});
		}
	}
	const routes = new Map<string, Route>();
	for (const edge of diagram.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (from === undefined || to === undefined) continue;
		let a: Anchor | null = null;
		let b: Anchor | null = null;
		const fromSlot = slots.get(`${edge.id}:from`);
		const toSlot = slots.get(`${edge.id}:to`);
		if (fromSlot !== undefined) a = muxAnchor(from, false, fromSlot.index, fromSlot.count);
		if (toSlot !== undefined) b = muxAnchor(to, true, toSlot.index, toSlot.count);
		if (to.parent === from.id) {
			const ends = inside(from, to);
			a ??= ends.outer;
			b ??= ends.inner;
		} else if (from.parent === to.id) {
			const ends = inside(to, from);
			a ??= ends.inner;
			b ??= ends.outer;
		}
		if (a === null && b === null) {
			routes.set(edge.id, edgeRoute(from, to));
			continue;
		}
		a ??= {
			...anchor(from, sideToward(from, b ?? center(to))),
			side: sideToward(from, b ?? center(to)),
		};
		b ??= { ...anchor(to, sideToward(to, a)), side: sideToward(to, a) };
		routes.set(edge.id, orthogonal(a, b));
	}
	return routes;
}

/** Lines of `text` that fit `width`, estimated from an average character width. */
export function wrapLines(text: string, width: number, fontSize = FONT_SIZE): string[] {
	const perLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter((part) => part !== "")) {
			let rest = word;
			// A word longer than the line is cut.
			while (rest.length > perLine) {
				if (line !== "") lines.push(line);
				lines.push(rest.slice(0, perLine));
				rest = rest.slice(perLine);
				line = "";
			}
			if (line === "") line = rest;
			else if (line.length + 1 + rest.length <= perLine) line += ` ${rest}`;
			else {
				lines.push(line);
				line = rest;
			}
		}
		lines.push(line);
	}
	return lines;
}

/** The width inside a shape that text can use. */
function textWidth(node: DiagramNode): number {
	switch (node.shape) {
		case "decision":
			return node.w * 0.6;
		case "io":
			return node.w - 2 * skew(node) - 12;
		case "terminal":
			return node.w - node.h * 0.5;
		case "subprocess":
			return node.w - 2 * SIDE_BAR - 12;
		case "circle":
			return node.w * 0.75;
		case "text":
			return node.w - 4;
		case "mux":
			return Math.min(node.w, node.h) * 0.8;
		case "group":
			return node.w - 24;
		default:
			return node.w - 16;
	}
}

/** Inset of the inner lines of a subprocess. */
const SIDE_BAR = 12;
const skew = (node: DiagramNode): number => Math.min(24, node.w * 0.15);
const cap = (node: DiagramNode): number => Math.min(12, node.h * 0.15);

function labelSize(text: string): { w: number; h: number } {
	const lines = text.split("\n");
	const longest = Math.max(...lines.map((line) => line.length));
	return { w: longest * FONT_SIZE * 0.55 * 0.9 + 10, h: lines.length * 16 + 6 };
}

/** The area the diagram covers, its edge labels included. */
export function bounds(diagram: Diagram): { x: number; y: number; w: number; h: number } {
	if (diagram.nodes.length === 0) return { x: 0, y: 0, w: 200, h: 100 };
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	const add = (x: number, y: number, w: number, h: number): void => {
		left = Math.min(left, x);
		top = Math.min(top, y);
		right = Math.max(right, x + w);
		bottom = Math.max(bottom, y + h);
	};
	for (const node of diagram.nodes) add(node.x, node.y, node.w, node.h);
	const routes = routeEdges(diagram);
	for (const edge of diagram.edges) {
		const route = routes.get(edge.id);
		if (route === undefined || edge.text === "") continue;
		const { label } = route;
		const size = labelSize(edge.text);
		add(label.x - size.w / 2, label.y - size.h / 2, size.w, size.h);
	}
	return { x: left, y: top, w: right - left, h: bottom - top };
}

// --- Drawing -----------------------------------------------------------------

/** An SVG element as data: written out as markup for the PNG, built as DOM for the editor. */
export interface SvgNode {
	readonly tag: string;
	readonly attrs: Readonly<Record<string, string | number>>;
	readonly children?: readonly SvgNode[];
	readonly text?: string;
}

const svg = (
	tag: string,
	attrs: Record<string, string | number>,
	children?: readonly SvgNode[],
	text?: string,
): SvgNode => ({
	tag,
	attrs,
	...(children === undefined ? {} : { children }),
	...(text === undefined ? {} : { text }),
});

const round = (value: number): number => Math.round(value * 100) / 100;

function outline(
	node: DiagramNode,
	attrs: Record<string, string | number>,
	interactive: boolean,
): SvgNode[] {
	const { x, y, w, h } = node;
	switch (node.shape) {
		case "process":
			return [svg("rect", { x, y, width: w, height: h, rx: 4, ...attrs })];
		case "terminal":
			return [svg("rect", { x, y, width: w, height: h, rx: h / 2, ...attrs })];
		case "decision":
			return [
				svg("polygon", {
					points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
					...attrs,
				}),
			];
		case "io": {
			const s = skew(node);
			return [
				svg("polygon", {
					points: `${x + s},${y} ${x + w},${y} ${x + w - s},${y + h} ${x},${y + h}`,
					...attrs,
				}),
			];
		}
		case "document": {
			const wave = Math.min(10, h * 0.12);
			return [
				svg("path", {
					d: `M${x} ${y}H${x + w}V${round(y + h - wave)}Q${round(x + w * 0.75)} ${round(y + h - 3 * wave)} ${round(x + w / 2)} ${round(y + h - wave)}T${x} ${round(y + h - wave)}Z`,
					...attrs,
				}),
			];
		}
		case "subprocess":
			return [
				svg("rect", { x, y, width: w, height: h, ...attrs }),
				svg("path", {
					d: `M${x + SIDE_BAR} ${y}V${y + h}M${x + w - SIDE_BAR} ${y}V${y + h}`,
					...attrs,
					fill: "none",
				}),
			];
		case "circle":
			return [svg("ellipse", { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, ...attrs })];
		case "mux": {
			const s = muxInset(node);
			const corners: Record<Direction, [number, number][]> = {
				right: [
					[x, y],
					[x + w, y + s],
					[x + w, y + h - s],
					[x, y + h],
				],
				left: [
					[x, y + s],
					[x + w, y],
					[x + w, y + h],
					[x, y + h - s],
				],
				down: [
					[x, y],
					[x + w, y],
					[x + w - s, y + h],
					[x + s, y + h],
				],
				up: [
					[x + s, y],
					[x + w - s, y],
					[x + w, y + h],
					[x, y + h],
				],
			};
			const points = corners[node.direction ?? "right"]
				.map(([px, py]) => `${round(px)},${round(py)}`)
				.join(" ");
			return [svg("polygon", { points, ...attrs })];
		}
		case "group":
			return [svg("rect", { x, y, width: w, height: h, rx: 8, ...attrs })];
		case "text":
			// Only text; in the editor a clear box keeps it easy to grab.
			return interactive ? [svg("rect", { x, y, width: w, height: h, fill: "transparent" })] : [];
		case "database": {
			const c = cap(node);
			const r = w / 2;
			return [
				svg("path", {
					d: `M${x} ${round(y + c)}A${round(r)} ${round(c)} 0 0 1 ${x + w} ${round(y + c)}V${round(y + h - c)}A${round(r)} ${round(c)} 0 0 1 ${x} ${round(y + h - c)}Z`,
					...attrs,
				}),
				svg("path", {
					d: `M${x} ${round(y + c)}A${round(r)} ${round(c)} 0 0 0 ${x + w} ${round(y + c)}`,
					...attrs,
					fill: "none",
				}),
			];
		}
	}
}

function textBlock(lines: readonly string[], cx: number, cy: number): SvgNode {
	const first = cy - ((lines.length - 1) * LINE_HEIGHT) / 2;
	return svg(
		"text",
		{
			x: round(cx),
			y: round(first),
			"text-anchor": "middle",
			"dominant-baseline": "central",
			"font-family": FONT_FAMILY,
			"font-size": FONT_SIZE,
			fill: TEXT_COLOR,
		},
		lines.map((line, index) =>
			svg("tspan", { x: round(cx), y: round(first + index * LINE_HEIGHT) }, undefined, line),
		),
	);
}

/** A group's name, in its top left corner. */
const GROUP_TITLE = 32;

function nodeElement(node: DiagramNode, interactive: boolean): SvgNode {
	const color = COLORS[node.color];
	if (node.shape === "group") {
		const fill = node.color === "default" ? "#f8fafc" : color.fill;
		const title = wrapLines(node.text, textWidth(node))[0] ?? "";
		return svg("g", interactive ? { "data-node": node.id, class: "kd-node kd-group" } : {}, [
			...outline(node, { fill, stroke: color.stroke, "stroke-width": 1.5 }, interactive),
			...(title === ""
				? []
				: [
						svg(
							"text",
							{
								x: round(node.x + 12),
								y: round(node.y + GROUP_TITLE / 2 + 2),
								"dominant-baseline": "central",
								"font-family": FONT_FAMILY,
								"font-size": FONT_SIZE,
								"font-weight": 600,
								fill: TEXT_COLOR,
							},
							undefined,
							title,
						),
					]),
		]);
	}
	const lines = node.text === "" ? [] : wrapLines(node.text, textWidth(node));
	const centerY =
		node.shape === "database" ? node.y + node.h / 2 + cap(node) / 2 : node.y + node.h / 2;
	return svg("g", interactive ? { "data-node": node.id, class: "kd-node" } : {}, [
		...outline(node, { fill: color.fill, stroke: color.stroke, "stroke-width": 1.5 }, interactive),
		...(lines.length === 0 ? [] : [textBlock(lines, node.x + node.w / 2, centerY)]),
	]);
}

function edgeElement(edge: DiagramEdge, route: Route, interactive: boolean): SvgNode {
	const { points } = route;
	const d = points
		.map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
		.join("");
	const children: SvgNode[] = [];
	// A wide transparent stroke under the line makes it easy to click.
	if (interactive)
		children.push(
			svg("path", { d, fill: "none", stroke: "transparent", "stroke-width": 12, class: "kd-hit" }),
		);
	children.push(
		svg("path", {
			d,
			fill: "none",
			stroke: EDGE_COLOR,
			"stroke-width": 1.5,
			...(edge.arrow === "none" ? {} : { "marker-end": "url(#kd-arrow)" }),
			...(edge.arrow === "both" ? { "marker-start": "url(#kd-arrow)" } : {}),
			...(edge.dashed ? { "stroke-dasharray": "6 4" } : {}),
		}),
	);
	return svg("g", interactive ? { "data-edge": edge.id, class: "kd-edge" } : {}, children);
}

/** A connector's text on a white box; drawn after every line, so no line crosses it. */
function edgeLabel(edge: DiagramEdge, route: Route, interactive: boolean): SvgNode | null {
	if (edge.text === "") return null;
	const { label } = route;
	const size = labelSize(edge.text);
	return svg("g", interactive ? { "data-edge": edge.id, class: "kd-label" } : {}, [
		svg("rect", {
			x: round(label.x - size.w / 2),
			y: round(label.y - size.h / 2),
			width: round(size.w),
			height: round(size.h),
			rx: 3,
			fill: "#ffffff",
		}),
		textBlock(edge.text.split("\n"), label.x, label.y),
	]);
}

const ARROW = svg("defs", {}, [
	svg(
		"marker",
		{
			id: "kd-arrow",
			viewBox: "0 0 10 10",
			refX: 9,
			refY: 5,
			markerWidth: 8,
			markerHeight: 8,
			orient: "auto-start-reverse",
			markerUnits: "userSpaceOnUse",
		},
		[svg("path", { d: "M0 0L10 5L0 10z", fill: EDGE_COLOR })],
	),
]);

/**
 * The diagram's elements: arrow definition, groups (outer ones first),
 * connectors, their labels, then the other shapes on top.
 */
export function diagramContent(diagram: Diagram, interactive = false): SvgNode[] {
	const routes = routeEdges(diagram);
	const edges: SvgNode[] = [];
	const labels: SvgNode[] = [];
	for (const edge of diagram.edges) {
		const route = routes.get(edge.id);
		if (route === undefined) continue;
		edges.push(edgeElement(edge, route, interactive));
		const label = edgeLabel(edge, route, interactive);
		if (label !== null) labels.push(label);
	}
	const groups = diagram.nodes
		.filter((node) => node.shape === "group")
		.map((node) => ({ node, depth: ancestors(diagram, node.id).length }))
		.sort((a, b) => a.depth - b.depth)
		.map(({ node }) => nodeElement(node, interactive));
	return [
		ARROW,
		...groups,
		...edges,
		...labels,
		...diagram.nodes
			.filter((node) => node.shape !== "group")
			.map((node) => nodeElement(node, interactive)),
	];
}

export const PADDING = 20;

/** The whole diagram as a standalone SVG on a white background. */
export function diagramSvg(diagram: Diagram): { svg: SvgNode; width: number; height: number } {
	const box = bounds(diagram);
	const width = Math.ceil(box.w + 2 * PADDING);
	const height = Math.ceil(box.h + 2 * PADDING);
	const x = box.x - PADDING;
	const y = box.y - PADDING;
	return {
		width,
		height,
		svg: svg(
			"svg",
			{
				xmlns: "http://www.w3.org/2000/svg",
				width,
				height,
				viewBox: `${x} ${y} ${width} ${height}`,
			},
			[svg("rect", { x, y, width, height, fill: "#ffffff" }), ...diagramContent(diagram)],
		),
	};
}

const escapeXml = (value: string): string =>
	value.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
	);

export function svgMarkup(node: SvgNode): string {
	const attrs = Object.entries(node.attrs)
		.map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
		.join("");
	const inner =
		(node.text === undefined ? "" : escapeXml(node.text)) +
		(node.children ?? []).map(svgMarkup).join("");
	return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}
