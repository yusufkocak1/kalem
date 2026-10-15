import type {
	ArrowKind,
	ColorName,
	Diagram,
	DiagramEdge,
	DiagramNode,
	Point,
	ShapeKind,
	SvgNode,
} from "../shared/diagram.js";
import {
	ARROWS,
	bounds,
	COLORS,
	DEFAULT_SIZE,
	diagramContent,
	edgeRoute,
	emptyDiagram,
	FONT_SIZE,
	GRID,
	MIN_HEIGHT,
	MIN_WIDTH,
	nextId,
	PADDING,
	SHAPES,
	serializeDiagram,
	snap,
} from "../shared/diagram.js";
import type { AlignMode, Box, Guide } from "../shared/diagram-edit.js";
import {
	alignmentGuides,
	alignNodes,
	boxOf,
	copyItems,
	decisionLabel,
	distributeNodes,
	layoutDiagram,
	moveNodes,
	nodesInBox,
	pasteItems,
	removeItems,
} from "../shared/diagram-edit.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
/** Pointer travel before a press on a shape becomes a move. */
const DRAG_START = 3;
/** Space left between a selected shape and one added below it. */
const GAP = 60;
/** How close, on screen, a side must come to another shape's to snap to it. */
const GUIDE_SNAP = 6;

export interface DiagramEditRequest {
	/** `null` for a new diagram. */
	readonly diagram: Diagram | null;
	readonly title: string;
	/** A new diagram is named here; an existing one keeps its file name. */
	readonly titleEditable: boolean;
	/** Writes the diagram; resolves to whether the panel can close. */
	save(diagram: Diagram, title: string): Promise<boolean>;
}

export interface DiagramEditor {
	open(request: DiagramEditRequest): void;
	readonly isOpen: boolean;
}

type Drag =
	| { kind: "pan"; startX: number; startY: number; viewX: number; viewY: number }
	| {
			kind: "move";
			ids: ReadonlySet<string>;
			start: Point;
			origin: Diagram;
			moved: boolean;
			/** A plain click on a shape of a larger selection selects just that shape. */
			only: string | null;
	  }
	| { kind: "resize"; id: string; start: Point; origin: { w: number; h: number }; moved: boolean }
	| { kind: "connect"; from: string; pointer: Point; over: string | null }
	| { kind: "marquee"; start: Point; current: Point; base: ReadonlySet<string> };

/** Copied shapes, kept while the app runs so they can be pasted into another diagram too. */
let clipboard: Diagram | null = null;

function build(node: SvgNode): Element {
	const element = document.createElementNS(SVG_NS, node.tag);
	for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, String(value));
	if (node.text !== undefined) element.textContent = node.text;
	for (const child of node.children ?? []) element.append(build(child));
	return element;
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
	const element = document.createElementNS(SVG_NS, tag) as SVGElement;
	for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
	return element;
}

/** A small stroked icon for a toolbar button. */
function glyph(paths: readonly string[]): SVGElement {
	const icon = svgEl("svg", {
		viewBox: "0 0 24 24",
		class: "diagram-glyph",
		"aria-hidden": "true",
	});
	for (const d of paths) icon.append(svgEl("path", { d }));
	return icon;
}

const ALIGN_GLYPHS: Record<AlignMode, readonly string[]> = {
	left: ["M4 3v18", "M7 6h12v4H7z", "M7 14h7v4H7z"],
	center: ["M12 3v18", "M5 6h14v4H5z", "M8 14h8v4H8z"],
	right: ["M20 3v18", "M5 6h12v4H5z", "M10 14h7v4h-7z"],
	top: ["M3 4h18", "M6 7h4v12H6z", "M14 7h4v7h-4z"],
	middle: ["M3 12h18", "M6 5h4v14H6z", "M14 8h4v8h-4z"],
	bottom: ["M3 20h18", "M6 5h4v12H6z", "M14 10h4v7h-4z"],
};

/** The small drawing of a shape on its palette button. */
function shapePreview(shape: ShapeKind): Element {
	const preview = svgEl("svg", {
		viewBox: "-4 -4 128 78",
		class: "diagram-shape-preview",
		"aria-hidden": "true",
	});
	// The bounding box of every preview is 120×70; the circle stays round.
	const node: DiagramNode =
		shape === "circle"
			? { id: "p", shape, x: 30, y: 5, w: 60, h: 60, text: "", color: "default" }
			: {
					id: "p",
					shape,
					x: 0,
					y: 0,
					w: 120,
					h: 70,
					text: shape === "text" ? "Aa" : "",
					color: "default",
				};
	if (shape === "text") {
		// Text has no outline; a large letter stands for it.
		const letter = svgEl("text", {
			x: 60,
			y: 50,
			"text-anchor": "middle",
			"font-size": 44,
			"font-family": "Georgia, serif",
			fill: "#334155",
		});
		letter.textContent = "T";
		preview.append(letter);
		return preview;
	}
	for (const child of diagramContent({ nodes: [node], edges: [] }).slice(1))
		preview.append(build(child));
	return preview;
}

/** A separate panel over the window: a canvas to draw flow diagrams on. */
export function createDiagramEditor(t: Strings): DiagramEditor {
	const shapeLabels: Record<ShapeKind, string> = {
		terminal: t.diagramTerminal,
		process: t.diagramProcess,
		decision: t.diagramDecision,
		io: t.diagramIo,
		document: t.diagramDocument,
		database: t.diagramDatabase,
		subprocess: t.diagramSubprocess,
		circle: t.diagramCircle,
		text: t.diagramTextShape,
	};
	const colorLabels: Record<ColorName, string> = {
		default: t.diagramColorDefault,
		blue: t.diagramColorBlue,
		green: t.diagramColorGreen,
		yellow: t.diagramColorYellow,
		red: t.diagramColorRed,
		purple: t.diagramColorPurple,
		gray: t.diagramColorGray,
	};
	const alignLabels: Record<AlignMode, string> = {
		left: t.diagramAlignLeft,
		center: t.diagramAlignCenter,
		right: t.diagramAlignRight,
		top: t.diagramAlignTop,
		middle: t.diagramAlignMiddle,
		bottom: t.diagramAlignBottom,
	};
	const arrowLabels: Record<ArrowKind, string> = {
		end: t.diagramArrowEnd,
		both: t.diagramArrowBoth,
		none: t.diagramArrowNone,
	};
	const arrowGlyphs: Record<ArrowKind, string> = { end: "→", both: "↔", none: "—" };

	// --- Elements ------------------------------------------------------------

	const toolButton = (
		label: string,
		content: string | Element,
		run: () => void,
		shortcut?: string,
	): HTMLButtonElement => {
		const button = el("button", {
			class: "diagram-tool",
			attrs: {
				type: "button",
				title: shortcut === undefined ? label : `${label} (${shortcut})`,
				"aria-label": label,
			},
			children: [content],
		});
		button.addEventListener("click", run);
		return button;
	};

	const title = el("input", {
		class: "diagram-title",
		attrs: {
			type: "text",
			"aria-label": t.diagramName,
			placeholder: t.diagramName,
			spellcheck: "false",
		},
	});
	const undoButton = toolButton(t.undo, "↶", () => undo(), "Ctrl+Z");
	const redoButton = toolButton(t.redo, "↷", () => redo(), "Ctrl+Y");
	const swatches = (Object.keys(COLORS) as ColorName[]).map((color) => {
		const swatch = el("button", {
			class: "diagram-swatch",
			attrs: {
				type: "button",
				title: colorLabels[color],
				"aria-label": colorLabels[color],
				"data-color": color,
			},
		});
		swatch.style.background = COLORS[color].fill;
		swatch.style.borderColor = COLORS[color].stroke;
		swatch.addEventListener("click", () => setColor(color));
		return swatch;
	});
	const colorGroup = el("div", {
		class: "diagram-group",
		attrs: { role: "group", "aria-label": t.diagramColor },
		children: swatches,
	});
	const arrowButton = toolButton(t.diagramArrow, "→", () => cycleArrow());
	const dashedButton = toolButton(t.diagramDashed, "┄", () => toggleDashed());
	dashedButton.setAttribute("aria-pressed", "false");
	const edgeGroup = el("div", { class: "diagram-group", children: [arrowButton, dashedButton] });
	const deleteButton = toolButton(t.diagramDelete, "🗑", () => deleteSelection(), "Delete");
	const alignButtons = (Object.keys(ALIGN_GLYPHS) as AlignMode[]).map((mode) =>
		toolButton(alignLabels[mode], glyph(ALIGN_GLYPHS[mode]), () => align(mode)),
	);
	const spreadX = toolButton(
		t.diagramDistributeX,
		glyph(["M4 3v18", "M20 3v18", "M10 7h4v10h-4z"]),
		() => distribute("x"),
	);
	const spreadY = toolButton(
		t.diagramDistributeY,
		glyph(["M3 4h18", "M3 20h18", "M7 10h10v4H7z"]),
		() => distribute("y"),
	);
	const alignGroup = el("div", {
		class: "diagram-group",
		attrs: { role: "group", "aria-label": t.diagramAlign },
		children: [...alignButtons, spreadX, spreadY],
	});
	const layoutButton = toolButton(
		t.diagramLayout,
		glyph(["M9 3h6v4H9z", "M3 17h6v4H3z", "M15 17h6v4h-6z", "M12 7v5", "M6 17v-5h12v5"]),
		() => layout(),
	);
	const zoomLabel = el("button", {
		class: "diagram-tool diagram-zoom",
		text: "100%",
		attrs: { type: "button", title: t.diagramZoomReset },
	});
	zoomLabel.addEventListener("click", () => zoomTo(1));
	const cancelButton = el("button", {
		class: "dialog-button",
		text: t.cancel,
		attrs: { type: "button" },
	});
	const saveButton = el("button", {
		class: "dialog-button primary",
		text: t.diagramSave,
		attrs: { type: "button", title: `${t.diagramSave} (Ctrl+S)` },
	});

	const toolbar = el("div", {
		class: "diagram-toolbar",
		children: [
			title,
			el("div", { class: "diagram-group", children: [undoButton, redoButton] }),
			el("div", {
				class: "diagram-group diagram-selection",
				children: [colorGroup, edgeGroup, deleteButton],
			}),
			alignGroup,
			el("div", { class: "diagram-group", children: [layoutButton] }),
			el("div", {
				class: "diagram-group",
				children: [
					toolButton(t.diagramZoomOut, "−", () => zoomTo(view.zoom / 1.2)),
					zoomLabel,
					toolButton(t.diagramZoomIn, "+", () => zoomTo(view.zoom * 1.2)),
					toolButton(t.diagramFit, "⤢", () => fit()),
				],
			}),
			el("span", { class: "diagram-spacer" }),
			cancelButton,
			saveButton,
		],
	});

	const palette = el("div", {
		class: "diagram-palette",
		attrs: { role: "toolbar", "aria-label": t.diagramShapes },
		children: [
			...SHAPES.map((shape) => {
				const item = el("button", {
					class: "diagram-shape",
					attrs: {
						type: "button",
						draggable: "true",
						"data-shape": shape,
						title: t.diagramShapeHint,
					},
					children: [shapePreview(shape), el("span", { text: shapeLabels[shape] })],
				});
				item.addEventListener("click", () => addShape(shape));
				item.addEventListener("dragstart", (event) => {
					event.dataTransfer?.setData("application/x-kalem-shape", shape);
					if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "copy";
				});
				return item;
			}),
			el("p", { class: "diagram-help", text: t.diagramHelp }),
		],
	});

	const grid = svgEl("rect", {
		x: -50000,
		y: -50000,
		width: 100000,
		height: 100000,
		fill: "url(#kd-grid)",
		class: "diagram-grid",
	});
	const content = svgEl("g", { class: "diagram-content" });
	const overlay = svgEl("g", { class: "diagram-overlay" });
	const world = svgEl("g", {});
	world.append(grid, content, overlay);
	const gridPattern = svgEl("pattern", {
		id: "kd-grid",
		width: GRID * 2,
		height: GRID * 2,
		patternUnits: "userSpaceOnUse",
	});
	gridPattern.append(svgEl("circle", { cx: 1, cy: 1, r: 1, fill: "#cbd5e1" }));
	const defs = svgEl("defs", {});
	defs.append(gridPattern);
	const canvas = svgEl("svg", {
		class: "diagram-canvas",
		role: "img",
		"aria-label": t.diagramCanvas,
		tabindex: "0",
	});
	canvas.append(defs, world);
	const textEdit = el("textarea", {
		class: "diagram-text-edit",
		attrs: { hidden: "", "aria-label": t.diagramText, rows: "1" },
	});
	const status = el("p", { class: "diagram-status", attrs: { role: "status" } });
	const viewport = el("div", { class: "diagram-viewport", children: [canvas, textEdit, status] });

	const dialog = el("dialog", {
		class: "diagram-editor",
		attrs: { "aria-label": t.diagramEditor },
		children: [toolbar, el("div", { class: "diagram-body", children: [palette, viewport] })],
	});
	document.body.append(dialog);

	// --- State ---------------------------------------------------------------

	let diagram: Diagram = emptyDiagram();
	let initial = "";
	let undoStack: Diagram[] = [];
	let redoStack: Diagram[] = [];
	let nodesSelected = new Set<string>();
	let edgesSelected = new Set<string>();
	let hover: string | null = null;
	let view = { x: 0, y: 0, zoom: 1 };
	let drag: Drag | null = null;
	let guides: Guide[] = [];
	let spaceDown = false;
	let pasteCount = 0;
	let editing: { kind: "node" | "edge"; id: string } | null = null;
	let request: DiagramEditRequest | null = null;
	let saving = false;

	const nodeById = (id: string): DiagramNode | undefined =>
		diagram.nodes.find((node) => node.id === id);
	const edgeById = (id: string): DiagramEdge | undefined =>
		diagram.edges.find((edge) => edge.id === id);

	function select(nodes: Iterable<string> = [], edges: Iterable<string> = []): void {
		nodesSelected = new Set(nodes);
		edgesSelected = new Set(edges);
	}

	/** The one selected shape, when exactly one shape and nothing else is selected. */
	function onlyNode(): DiagramNode | undefined {
		if (nodesSelected.size !== 1 || edgesSelected.size !== 0) return undefined;
		return nodeById([...nodesSelected][0] as string);
	}

	/** Records the current diagram for undo, then replaces it. */
	function change(next: Diagram): void {
		if (next === diagram) return;
		undoStack.push(diagram);
		if (undoStack.length > 200) undoStack.shift();
		redoStack = [];
		diagram = next;
		render();
	}

	function undo(): void {
		const previous = undoStack.pop();
		if (previous === undefined) return;
		redoStack.push(diagram);
		diagram = previous;
		dropMissingSelection();
		render();
	}

	function redo(): void {
		const next = redoStack.pop();
		if (next === undefined) return;
		undoStack.push(diagram);
		diagram = next;
		dropMissingSelection();
		render();
	}

	function dropMissingSelection(): void {
		select(
			[...nodesSelected].filter((id) => nodeById(id) !== undefined),
			[...edgesSelected].filter((id) => edgeById(id) !== undefined),
		);
	}

	const updateNodes = (ids: ReadonlySet<string>, patch: Partial<DiagramNode>): Diagram => ({
		...diagram,
		nodes: diagram.nodes.map((node) => (ids.has(node.id) ? { ...node, ...patch } : node)),
	});

	const updateEdges = (
		ids: ReadonlySet<string>,
		patch: (edge: DiagramEdge) => Partial<DiagramEdge>,
	): Diagram => ({
		...diagram,
		edges: diagram.edges.map((edge) => (ids.has(edge.id) ? { ...edge, ...patch(edge) } : edge)),
	});

	// --- Editing operations ---------------------------------------------------

	/** The middle of what the canvas shows, in diagram coordinates. */
	function viewCenter(): Point {
		const box = canvas.getBoundingClientRect();
		return toWorld(box.left + box.width / 2, box.top + box.height / 2);
	}

	function placeNode(shape: ShapeKind, center: Point): DiagramNode {
		const size = DEFAULT_SIZE[shape];
		return {
			id: nextId(diagram, "n"),
			shape,
			x: snap(center.x - size.w / 2),
			y: snap(center.y - size.h / 2),
			w: size.w,
			h: size.h,
			text: shape === "circle" ? "" : shapeLabels[shape],
			color: "default",
		};
	}

	const newEdge = (from: string, to: string, within: Diagram): DiagramEdge => ({
		id: nextId(within, "e"),
		from,
		to,
		text: decisionLabel(within, from, t.diagramYes, t.diagramNo),
		dashed: false,
		arrow: "end",
	});

	/**
	 * A shape from the palette: below the selected shape and connected to it,
	 * so a flow is built by clicking; otherwise in the middle of the view.
	 */
	function addShape(shape: ShapeKind): void {
		const selected = onlyNode();
		if (selected === undefined) {
			let center = viewCenter();
			// Clicked again: the next one does not land exactly on the last one.
			while (
				diagram.nodes.some(
					(node) =>
						Math.abs(node.x + node.w / 2 - center.x) < GRID &&
						Math.abs(node.y + node.h / 2 - center.y) < GRID,
				)
			) {
				center = { x: center.x + 2 * GRID, y: center.y + 2 * GRID };
			}
			insertNode(placeNode(shape, center));
			return;
		}
		const size = DEFAULT_SIZE[shape];
		// A decision's second way out goes beside the first, not on top of it.
		const out = diagram.edges.filter((edge) => edge.from === selected.id).length;
		const node = placeNode(shape, {
			x: selected.x + selected.w / 2 + out * (size.w + 2 * GRID),
			y: selected.y + selected.h + GAP + size.h / 2,
		});
		const withNode = { ...diagram, nodes: [...diagram.nodes, node] };
		change({ ...withNode, edges: [...diagram.edges, newEdge(selected.id, node.id, withNode)] });
		select([node.id]);
		render();
	}

	function insertNode(node: DiagramNode): void {
		change({ ...diagram, nodes: [...diagram.nodes, node] });
		select([node.id]);
		render();
	}

	function connect(from: string, to: string): void {
		if (from === to || diagram.edges.some((edge) => edge.from === from && edge.to === to)) return;
		const edge = newEdge(from, to, diagram);
		change({ ...diagram, edges: [...diagram.edges, edge] });
		select([], [edge.id]);
		render();
	}

	function deleteSelection(): void {
		if (nodesSelected.size + edgesSelected.size === 0) return;
		const next = removeItems(diagram, nodesSelected, edgesSelected);
		select();
		change(next);
	}

	function copySelection(): boolean {
		if (nodesSelected.size === 0) return false;
		clipboard = copyItems(diagram, nodesSelected);
		pasteCount = 0;
		return true;
	}

	function paste(items: Diagram | null = clipboard): void {
		if (items === null || items.nodes.length === 0) return;
		pasteCount++;
		const step = 2 * GRID * pasteCount;
		const pasted = pasteItems(diagram, items, { x: step, y: step });
		change(pasted.diagram);
		select(pasted.ids);
		render();
	}

	function duplicateSelection(): void {
		if (nodesSelected.size === 0) return;
		const items = copyItems(diagram, nodesSelected);
		const pasted = pasteItems(diagram, items, { x: 2 * GRID, y: 2 * GRID });
		change(pasted.diagram);
		select(pasted.ids);
		render();
	}

	function selectAll(): void {
		select(
			diagram.nodes.map((node) => node.id),
			diagram.edges.map((edge) => edge.id),
		);
		render();
	}

	function setColor(color: ColorName): void {
		if (nodesSelected.size > 0) change(updateNodes(nodesSelected, { color }));
	}

	function toggleDashed(): void {
		if (edgesSelected.size === 0) return;
		const dashed = ![...edgesSelected].every((id) => edgeById(id)?.dashed === true);
		change(updateEdges(edgesSelected, () => ({ dashed })));
	}

	/** End → both ends → none → end, for every selected connector. */
	function cycleArrow(): void {
		const first = edgeById([...edgesSelected][0] ?? "");
		if (first === undefined) return;
		const arrow = ARROWS[(ARROWS.indexOf(first.arrow) + 1) % ARROWS.length] as ArrowKind;
		change(updateEdges(edgesSelected, () => ({ arrow })));
	}

	function align(mode: AlignMode): void {
		change(alignNodes(diagram, nodesSelected, mode));
	}

	function distribute(axis: "x" | "y"): void {
		change(distributeNodes(diagram, nodesSelected, axis));
	}

	function layout(): void {
		change(layoutDiagram(diagram));
		fit();
	}

	function nudge(dx: number, dy: number): void {
		if (nodesSelected.size > 0) change(moveNodes(diagram, nodesSelected, dx, dy));
	}

	// --- View ------------------------------------------------------------------

	function toWorld(clientX: number, clientY: number): Point {
		const box = canvas.getBoundingClientRect();
		return {
			x: (clientX - box.left - view.x) / view.zoom,
			y: (clientY - box.top - view.y) / view.zoom,
		};
	}

	function applyView(): void {
		world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.zoom})`);
		zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
		if (editing !== null) placeTextEdit();
	}

	/** Zooms around a point of the canvas (its middle by default). */
	function zoomTo(zoom: number, around?: { x: number; y: number }): void {
		const box = canvas.getBoundingClientRect();
		const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
		const ax = around?.x ?? box.width / 2;
		const ay = around?.y ?? box.height / 2;
		view = {
			zoom: next,
			x: ax - ((ax - view.x) / view.zoom) * next,
			y: ay - ((ay - view.y) / view.zoom) * next,
		};
		applyView();
	}

	/** Shows the whole diagram, at most at its real size. */
	function fit(): void {
		const box = canvas.getBoundingClientRect();
		const area = bounds(diagram);
		const zoom =
			diagram.nodes.length === 0
				? 1
				: Math.min(
						1,
						MAX_ZOOM,
						Math.max(
							MIN_ZOOM,
							Math.min((box.width - 2 * PADDING) / area.w, (box.height - 2 * PADDING) / area.h),
						),
					);
		view = {
			zoom,
			x: box.width / 2 - (area.x + area.w / 2) * zoom,
			y: box.height / 2 - (area.y + area.h / 2) * zoom,
		};
		applyView();
	}

	// --- Drawing ---------------------------------------------------------------

	function render(): void {
		content.replaceChildren(...diagramContent(diagram, true).map(build));
		for (const id of edgesSelected) {
			for (const part of content.querySelectorAll(`[data-edge="${CSS.escape(id)}"]`)) {
				part.classList.add("selected");
			}
		}
		renderOverlay();

		undoButton.disabled = undoStack.length === 0;
		redoButton.disabled = redoStack.length === 0;
		const nodes = [...nodesSelected].map(nodeById).filter((node) => node !== undefined);
		const edges = [...edgesSelected].map(edgeById).filter((edge) => edge !== undefined);
		colorGroup.hidden = nodes.length === 0;
		const color = nodes.every((node) => node.color === nodes[0]?.color)
			? nodes[0]?.color
			: undefined;
		for (const swatch of swatches) {
			swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
		}
		edgeGroup.hidden = edges.length === 0;
		const arrow = edges[0]?.arrow ?? "end";
		arrowButton.replaceChildren(arrowGlyphs[arrow]);
		arrowButton.title = `${t.diagramArrow}: ${arrowLabels[arrow]}`;
		dashedButton.setAttribute(
			"aria-pressed",
			String(edges.length > 0 && edges.every((edge) => edge.dashed)),
		);
		alignGroup.hidden = nodes.length < 2;
		spreadX.disabled = nodes.length < 3;
		spreadY.disabled = nodes.length < 3;
		layoutButton.disabled = diagram.nodes.length < 2;
		deleteButton.disabled = nodes.length + edges.length === 0;
		saveButton.disabled = saving || diagram.nodes.length === 0;
		status.textContent = diagram.nodes.length === 0 ? t.diagramEmpty : "";
		status.hidden = status.textContent === "";
	}

	function renderOverlay(): void {
		const parts: SVGElement[] = [];
		const handle = 8 / view.zoom;
		for (const id of nodesSelected) {
			const node = nodeById(id);
			if (node === undefined) continue;
			parts.push(
				svgEl("rect", {
					x: node.x - 4,
					y: node.y - 4,
					width: node.w + 8,
					height: node.h + 8,
					class: "diagram-selected",
				}),
			);
		}
		const single = onlyNode();
		if (single !== undefined) {
			parts.push(
				svgEl("rect", {
					x: single.x + single.w - handle / 2,
					y: single.y + single.h - handle / 2,
					width: handle,
					height: handle,
					class: "diagram-handle",
					"data-handle": single.id,
				}),
			);
		}
		// Connection points on the shape under the pointer and the one selected.
		const ported = new Set(
			[hover, single?.id].filter((id): id is string => id !== null && id !== undefined),
		);
		if (drag !== null) ported.clear();
		for (const id of ported) {
			const node = nodeById(id);
			if (node === undefined) continue;
			for (const [x, y] of [
				[node.x + node.w / 2, node.y],
				[node.x + node.w, node.y + node.h / 2],
				[node.x + node.w / 2, node.y + node.h],
				[node.x, node.y + node.h / 2],
			] as const) {
				parts.push(
					svgEl("circle", {
						cx: x,
						cy: y,
						r: 5 / view.zoom,
						class: "diagram-port",
						"data-port": id,
					}),
				);
			}
		}
		for (const guide of guides) {
			parts.push(svgEl("line", { ...guide, class: "diagram-guide" }));
		}
		if (drag?.kind === "marquee") {
			const { start, current } = drag;
			parts.push(
				svgEl("rect", {
					x: Math.min(start.x, current.x),
					y: Math.min(start.y, current.y),
					width: Math.abs(current.x - start.x),
					height: Math.abs(current.y - start.y),
					class: "diagram-marquee",
				}),
			);
		}
		if (drag?.kind === "connect") {
			const from = nodeById(drag.from);
			const over = drag.over === null ? undefined : nodeById(drag.over);
			if (over !== undefined) {
				parts.push(
					svgEl("rect", {
						x: over.x - 4,
						y: over.y - 4,
						width: over.w + 8,
						height: over.h + 8,
						class: "diagram-target",
					}),
				);
			}
			if (from !== undefined) {
				const route = over === undefined ? null : edgeRoute(from, over);
				const start = route?.points[0] ?? { x: from.x + from.w / 2, y: from.y + from.h / 2 };
				const end = route?.points.at(-1) ?? drag.pointer;
				parts.push(
					svgEl("line", {
						x1: start.x,
						y1: start.y,
						x2: end.x,
						y2: end.y,
						class: "diagram-pending",
					}),
				);
			}
		}
		overlay.replaceChildren(...parts);
	}

	// --- Text ------------------------------------------------------------------

	function placeTextEdit(): void {
		if (editing === null) return;
		let box: Box;
		if (editing.kind === "node") {
			const node = nodeById(editing.id);
			if (node === undefined) return;
			box = { x: node.x, y: node.y, w: node.w, h: node.h };
		} else {
			const edge = edgeById(editing.id);
			const from = edge === undefined ? undefined : nodeById(edge.from);
			const to = edge === undefined ? undefined : nodeById(edge.to);
			if (from === undefined || to === undefined) return;
			const { label } = edgeRoute(from, to);
			box = { x: label.x - 80, y: label.y - 18, w: 160, h: 36 };
		}
		textEdit.style.left = `${box.x * view.zoom + view.x}px`;
		textEdit.style.top = `${box.y * view.zoom + view.y}px`;
		textEdit.style.width = `${box.w * view.zoom}px`;
		textEdit.style.height = `${box.h * view.zoom}px`;
		textEdit.style.fontSize = `${FONT_SIZE * view.zoom}px`;
	}

	function editText(kind: "node" | "edge", id: string): void {
		const item = kind === "node" ? nodeById(id) : edgeById(id);
		if (item === undefined) return;
		editing = { kind, id };
		if (kind === "node") select([id]);
		else select([], [id]);
		render();
		textEdit.value = item.text;
		textEdit.hidden = false;
		placeTextEdit();
		textEdit.focus();
		textEdit.select();
	}

	function finishText(keep: boolean): void {
		if (editing === null) return;
		const { kind, id } = editing;
		editing = null;
		textEdit.hidden = true;
		const text = textEdit.value.replace(/\s+$/, "");
		const item = kind === "node" ? nodeById(id) : edgeById(id);
		if (keep && item !== undefined && item.text !== text) {
			const ids = new Set([id]);
			change(kind === "node" ? updateNodes(ids, { text }) : updateEdges(ids, () => ({ text })));
		}
		canvas.focus();
	}

	textEdit.addEventListener("keydown", (event) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			finishText(false);
		} else if (event.key === "Enter" && !event.shiftKey) {
			// Shift+Enter starts a new line.
			event.preventDefault();
			finishText(true);
		}
	});
	textEdit.addEventListener("blur", () => finishText(true));

	// --- Pointer -----------------------------------------------------------------

	const hit = (target: EventTarget | null, attribute: string): string | null => {
		const found = target instanceof Element ? target.closest(`[${attribute}]`) : null;
		return found?.getAttribute(attribute) ?? null;
	};

	/**
	 * The last press, to tell a double press. The browser's `dblclick` does
	 * not do: every press redraws the shapes, so its target is gone.
	 */
	let lastPress = { time: 0, key: "", x: 0, y: 0 };

	function isDoublePress(event: PointerEvent, key: string): boolean {
		const double =
			event.timeStamp - lastPress.time < 450 &&
			lastPress.key === key &&
			Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) < 6;
		lastPress = double
			? { time: 0, key: "", x: 0, y: 0 }
			: { time: event.timeStamp, key, x: event.clientX, y: event.clientY };
		return double;
	}

	const startPan = (event: PointerEvent): Drag => ({
		kind: "pan",
		startX: event.clientX,
		startY: event.clientY,
		viewX: view.x,
		viewY: view.y,
	});

	canvas.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 && event.button !== 1) return;
		if (editing !== null) finishText(true);
		canvas.focus();
		canvas.setPointerCapture(event.pointerId);
		// The middle button, or the left one with Space held, moves the view.
		if (event.button === 1 || spaceDown) {
			event.preventDefault();
			drag = startPan(event);
			return;
		}
		const point = toWorld(event.clientX, event.clientY);
		const handle = hit(event.target, "data-handle");
		const port = hit(event.target, "data-port");
		const node = hit(event.target, "data-node");
		const edge = hit(event.target, "data-edge");
		const additive = event.shiftKey || event.ctrlKey || event.metaKey;
		if (handle === null && port === null && !additive) {
			const key = node !== null ? `n:${node}` : edge !== null ? `e:${edge}` : "canvas";
			if (isDoublePress(event, key)) {
				event.preventDefault();
				drag = null;
				if (node !== null) editText("node", node);
				else if (edge !== null) editText("edge", edge);
				else {
					// On the empty canvas: a new step there.
					const added = { ...placeNode("process", point), text: "" };
					insertNode(added);
					editText("node", added.id);
				}
				return;
			}
		}
		if (handle !== null) {
			const target = nodeById(handle);
			if (target !== undefined) {
				drag = {
					kind: "resize",
					id: handle,
					start: point,
					origin: { w: target.w, h: target.h },
					moved: false,
				};
			}
		} else if (port !== null) {
			drag = { kind: "connect", from: port, pointer: point, over: null };
		} else if (node !== null) {
			if (additive) {
				// Shift or Ctrl adds the shape to the selection, or takes it out.
				const next = new Set(nodesSelected);
				if (next.has(node)) next.delete(node);
				else next.add(node);
				select(next, edgesSelected);
			} else if (!nodesSelected.has(node)) {
				select([node]);
			}
			// Pressing a selected shape moves everything selected.
			if (nodesSelected.has(node)) {
				drag = {
					kind: "move",
					ids: new Set(nodesSelected),
					start: point,
					origin: diagram,
					moved: false,
					only: !additive && nodesSelected.size + edgesSelected.size > 1 ? node : null,
				};
			}
		} else if (edge !== null) {
			if (additive) {
				const next = new Set(edgesSelected);
				if (next.has(edge)) next.delete(edge);
				else next.add(edge);
				select(nodesSelected, next);
			} else {
				select([], [edge]);
			}
		} else {
			// The empty canvas: a box selects the shapes inside it.
			const base = additive ? new Set(nodesSelected) : new Set<string>();
			if (!additive) select();
			drag = { kind: "marquee", start: point, current: point, base };
		}
		render();
	});

	canvas.addEventListener("pointermove", (event) => {
		if (drag === null) {
			const over = hit(event.target, "data-node") ?? hit(event.target, "data-port");
			if (over !== hover) {
				hover = over;
				renderOverlay();
			}
			return;
		}
		const point = toWorld(event.clientX, event.clientY);
		switch (drag.kind) {
			case "pan":
				view = {
					...view,
					x: drag.viewX + event.clientX - drag.startX,
					y: drag.viewY + event.clientY - drag.startY,
				};
				applyView();
				return;
			case "move": {
				const dx = point.x - drag.start.x;
				const dy = point.y - drag.start.y;
				if (!drag.moved && Math.hypot(dx, dy) * view.zoom < DRAG_START) return;
				if (!drag.moved) {
					// One undo step for the whole move.
					undoStack.push(drag.origin);
					redoStack = [];
					drag.moved = true;
				}
				const moving = drag.origin.nodes.filter(
					(node) => drag?.kind === "move" && drag.ids.has(node.id),
				);
				const box = boxOf(moving);
				// On the grid, unless a side or middle lines up with another shape.
				let sx = snap(box.x + dx) - box.x;
				let sy = snap(box.y + dy) - box.y;
				const others = drag.origin.nodes.filter(
					(node) => drag?.kind === "move" && !drag.ids.has(node.id),
				);
				const free = { ...box, x: box.x + dx, y: box.y + dy };
				const lined = event.altKey
					? { dx: 0, dy: 0, guides: [] }
					: alignmentGuides(free, others, GUIDE_SNAP / view.zoom);
				if (lined.guides.some((guide) => guide.x1 === guide.x2)) sx = dx + lined.dx;
				if (lined.guides.some((guide) => guide.y1 === guide.y2)) sy = dy + lined.dy;
				guides = lined.guides;
				diagram = moveNodes(drag.origin, drag.ids, Math.round(sx), Math.round(sy));
				render();
				return;
			}
			case "resize": {
				const node = nodeById(drag.id);
				if (node === undefined) return;
				const w = Math.max(MIN_WIDTH, snap(drag.origin.w + point.x - drag.start.x));
				const h = Math.max(MIN_HEIGHT, snap(drag.origin.h + point.y - drag.start.y));
				if (w === node.w && h === node.h) return;
				if (!drag.moved) {
					undoStack.push(diagram);
					redoStack = [];
					drag.moved = true;
				}
				diagram = updateNodes(new Set([drag.id]), { w, h });
				render();
				return;
			}
			case "connect": {
				// The element under the pointer, not the one capturing it.
				const under = document.elementFromPoint(event.clientX, event.clientY);
				const over = hit(under, "data-node");
				drag = { ...drag, pointer: point, over: over === drag.from ? null : over };
				renderOverlay();
				return;
			}
			case "marquee": {
				drag = { ...drag, current: point };
				const inside = nodesInBox(diagram, {
					x: drag.start.x,
					y: drag.start.y,
					w: point.x - drag.start.x,
					h: point.y - drag.start.y,
				});
				select([...drag.base, ...inside]);
				render();
				return;
			}
		}
	});

	const endDrag = (): void => {
		const ended = drag;
		drag = null;
		guides = [];
		if (ended?.kind === "connect" && ended.over !== null) connect(ended.from, ended.over);
		else {
			if (ended?.kind === "move" && !ended.moved && ended.only !== null) select([ended.only]);
			render();
		}
	};
	canvas.addEventListener("pointerup", endDrag);
	canvas.addEventListener("pointercancel", endDrag);

	canvas.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				const box = canvas.getBoundingClientRect();
				zoomTo(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), {
					x: event.clientX - box.left,
					y: event.clientY - box.top,
				});
			} else {
				// Shift turns the wheel sideways.
				const dx = event.shiftKey ? event.deltaY : event.deltaX;
				const dy = event.shiftKey ? 0 : event.deltaY;
				view = { ...view, x: view.x - dx, y: view.y - dy };
				applyView();
			}
		},
		{ passive: false },
	);

	// Shapes dragged from the palette.
	viewport.addEventListener("dragover", (event) => {
		if (event.dataTransfer?.types.includes("application/x-kalem-shape") !== true) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	});
	viewport.addEventListener("drop", (event) => {
		const shape = event.dataTransfer?.getData("application/x-kalem-shape") as ShapeKind | undefined;
		if (shape === undefined || !SHAPES.includes(shape)) return;
		event.preventDefault();
		event.stopPropagation();
		insertNode(placeNode(shape, toWorld(event.clientX, event.clientY)));
	});

	// --- Keys ------------------------------------------------------------------

	dialog.addEventListener("keydown", (event) => {
		const mod = event.ctrlKey || event.metaKey;
		const inField = event.target === title;
		// kalem-locale-ok: key names are ASCII
		const key = event.key.toLowerCase();
		if (mod && key === "s") {
			event.preventDefault();
			void save();
			return;
		}
		if (inField) return;
		// Space held: the left button moves the view.
		if (event.key === " ") {
			if (event.target instanceof HTMLButtonElement) return;
			event.preventDefault();
			spaceDown = true;
			canvas.classList.add("panning");
			return;
		}
		if (mod && key === "z") {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (mod && key === "y") {
			event.preventDefault();
			redo();
		} else if (mod && key === "a") {
			event.preventDefault();
			selectAll();
		} else if (mod && key === "c") {
			if (copySelection()) event.preventDefault();
		} else if (mod && key === "x") {
			if (copySelection()) {
				event.preventDefault();
				deleteSelection();
			}
		} else if (mod && key === "v") {
			event.preventDefault();
			paste();
		} else if (mod && key === "d") {
			event.preventDefault();
			duplicateSelection();
		} else if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			deleteSelection();
		} else if (event.key === "Enter" || event.key === "F2") {
			const single = onlyNode();
			const edge =
				nodesSelected.size === 0 && edgesSelected.size === 1 ? [...edgesSelected][0] : undefined;
			if (single !== undefined) {
				event.preventDefault();
				editText("node", single.id);
			} else if (edge !== undefined) {
				event.preventDefault();
				editText("edge", edge);
			}
		} else if (event.key.startsWith("Arrow") && nodesSelected.size > 0) {
			event.preventDefault();
			const step = event.shiftKey ? 1 : GRID;
			const [dx, dy] = {
				ArrowLeft: [-step, 0],
				ArrowRight: [step, 0],
				ArrowUp: [0, -step],
				ArrowDown: [0, step],
			}[event.key] ?? [0, 0];
			nudge(dx as number, dy as number);
		}
	});
	dialog.addEventListener("keyup", (event) => {
		if (event.key !== " ") return;
		spaceDown = false;
		canvas.classList.remove("panning");
	});

	// Escape: leaves the selection first, then the panel (asking when there are changes).
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		if (nodesSelected.size + edgesSelected.size > 0) {
			select();
			render();
			return;
		}
		close();
	});

	// --- Opening and closing ---------------------------------------------------------

	function close(): void {
		if (saving) return;
		if (serializeDiagram(diagram) !== initial && !window.confirm(t.diagramDiscard)) return;
		dialog.close();
		request = null;
	}

	async function save(): Promise<void> {
		if (request === null || saving || diagram.nodes.length === 0) return;
		finishText(true);
		saving = true;
		render();
		saveButton.textContent = t.diagramSaving;
		try {
			const done = await request.save(diagram, title.value.trim());
			if (done) {
				dialog.close();
				request = null;
			}
		} catch (error) {
			status.hidden = false;
			status.textContent = format(
				t.diagramSaveFailed,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			saving = false;
			saveButton.textContent = t.diagramSave;
			if (dialog.open) render();
		}
	}

	cancelButton.addEventListener("click", close);
	saveButton.addEventListener("click", () => void save());

	return {
		get isOpen() {
			return dialog.open;
		},
		open(next) {
			request = next;
			diagram = next.diagram ?? emptyDiagram();
			initial = serializeDiagram(diagram);
			undoStack = [];
			redoStack = [];
			select();
			hover = null;
			drag = null;
			guides = [];
			spaceDown = false;
			pasteCount = 0;
			editing = null;
			textEdit.hidden = true;
			title.value = next.title;
			title.disabled = !next.titleEditable;
			title.title = next.titleEditable ? "" : t.diagramNameFixed;
			if (!dialog.open) dialog.showModal();
			render();
			fit();
			canvas.focus();
		},
	};
}
