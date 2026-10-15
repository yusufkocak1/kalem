/**
 * Flow diagrams: the data the diagram editor works on, and the SVG drawn
 * from it. The same drawing is the editor's canvas and the PNG that goes
 * into the document, whose `iTXt` chunk keeps this data for the next edit.
 */

/** The PNG text keyword the diagram data is kept under. */
export const DIAGRAM_KEYWORD = "kalem-diagram";
/** Diagram files end in this, so the editor can offer to edit them. */
export const DIAGRAM_SUFFIX = ".diagram.png";

export const SHAPES = ["terminal", "process", "decision", "io", "document", "database"] as const;
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

export interface DiagramNode {
	readonly id: string;
	readonly shape: ShapeKind;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly text: string;
	readonly color: ColorName;
}

export interface DiagramEdge {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly text: string;
	readonly dashed: boolean;
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

export function serializeDiagram(diagram: Diagram): string {
	return JSON.stringify({ format: DIAGRAM_KEYWORD, version: 1, ...diagram });
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
		});
	}
	const edges: DiagramEdge[] = [];
	for (const raw of Array.isArray(data.edges) ? data.edges.slice(0, MAX_ITEMS) : []) {
		if (!isObject(raw)) continue;
		const id = str(raw.id);
		const from = str(raw.from);
		const to = str(raw.to);
		if (id === "" || ids.has(id) || !ids.has(from) || !ids.has(to) || from === to) continue;
		ids.add(id);
		edges.push({ id, from, to, text: str(raw.text), dashed: raw.dashed === true });
	}
	return { nodes, edges };
}

// --- Geometry ----------------------------------------------------------------

type Side = "top" | "right" | "bottom" | "left";

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
	let points: Point[];
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
		default:
			return node.w - 16;
	}
}

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
	const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	for (const edge of diagram.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (from === undefined || to === undefined || edge.text === "") continue;
		const { label } = edgeRoute(from, to);
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

function outline(node: DiagramNode, attrs: Record<string, string | number>): SvgNode[] {
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

function nodeElement(node: DiagramNode, interactive: boolean): SvgNode {
	const color = COLORS[node.color];
	const lines = node.text === "" ? [] : wrapLines(node.text, textWidth(node));
	const centerY =
		node.shape === "database" ? node.y + node.h / 2 + cap(node) / 2 : node.y + node.h / 2;
	return svg("g", interactive ? { "data-node": node.id, class: "kd-node" } : {}, [
		...outline(node, { fill: color.fill, stroke: color.stroke, "stroke-width": 1.5 }),
		...(lines.length === 0 ? [] : [textBlock(lines, node.x + node.w / 2, centerY)]),
	]);
}

function edgeElement(
	edge: DiagramEdge,
	from: DiagramNode,
	to: DiagramNode,
	interactive: boolean,
): SvgNode {
	const { points, label } = edgeRoute(from, to);
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
			"marker-end": "url(#kd-arrow)",
			...(edge.dashed ? { "stroke-dasharray": "6 4" } : {}),
		}),
	);
	if (edge.text !== "") {
		const size = labelSize(edge.text);
		children.push(
			svg("rect", {
				x: round(label.x - size.w / 2),
				y: round(label.y - size.h / 2),
				width: round(size.w),
				height: round(size.h),
				rx: 3,
				fill: "#ffffff",
			}),
			textBlock(edge.text.split("\n"), label.x, label.y),
		);
	}
	return svg("g", interactive ? { "data-edge": edge.id, class: "kd-edge" } : {}, children);
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

/** The diagram's elements: arrow definition, connectors, then shapes on top. */
export function diagramContent(diagram: Diagram, interactive = false): SvgNode[] {
	const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	const edges: SvgNode[] = [];
	for (const edge of diagram.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (from !== undefined && to !== undefined)
			edges.push(edgeElement(edge, from, to, interactive));
	}
	return [ARROW, ...edges, ...diagram.nodes.map((node) => nodeElement(node, interactive))];
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
