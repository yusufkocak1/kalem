import type {
	ColorName,
	Diagram,
	DiagramEdge,
	DiagramNode,
	Point,
	ShapeKind,
	SvgNode,
} from "../shared/diagram.js";
import {
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

type Selection = { readonly kind: "node" | "edge"; readonly id: string } | null;

type Drag =
	| { kind: "pan"; startX: number; startY: number; viewX: number; viewY: number }
	| { kind: "move"; id: string; start: Point; origin: Point; moved: boolean }
	| { kind: "resize"; id: string; start: Point; origin: { w: number; h: number }; moved: boolean }
	| { kind: "connect"; from: string; pointer: Point; over: string | null };

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

/** The small drawing of a shape on its palette button. */
function shapePreview(shape: ShapeKind): Element {
	const preview = svgEl("svg", {
		viewBox: "-4 -4 128 78",
		class: "diagram-shape-preview",
		"aria-hidden": "true",
	});
	const node: DiagramNode = {
		id: "p",
		shape,
		x: 0,
		y: 0,
		w: 120,
		h: 70,
		text: "",
		color: "default",
	};
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

	// --- Elements ------------------------------------------------------------

	const toolButton = (
		label: string,
		text: string,
		run: () => void,
		shortcut?: string,
	): HTMLButtonElement => {
		const button = el("button", {
			class: "diagram-tool",
			text,
			attrs: {
				type: "button",
				title: shortcut === undefined ? label : `${label} (${shortcut})`,
				"aria-label": label,
			},
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
	const dashedButton = toolButton(t.diagramDashed, "┄", () => toggleDashed());
	dashedButton.setAttribute("aria-pressed", "false");
	const deleteButton = toolButton(t.diagramDelete, "🗑", () => deleteSelection(), "Delete");
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
				children: [colorGroup, dashedButton, deleteButton],
			}),
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
		attrs: { role: "toolbar", "aria-orientation": "vertical", "aria-label": t.diagramShapes },
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
	let selection: Selection = null;
	let hover: string | null = null;
	let view = { x: 0, y: 0, zoom: 1 };
	let drag: Drag | null = null;
	let editing: { kind: "node" | "edge"; id: string } | null = null;
	let request: DiagramEditRequest | null = null;
	let saving = false;

	const nodeById = (id: string): DiagramNode | undefined =>
		diagram.nodes.find((node) => node.id === id);

	/** Records the current diagram for undo, then replaces it. */
	function change(next: Diagram): void {
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
		if (selection === null) return;
		const list: readonly { id: string }[] =
			selection.kind === "node" ? diagram.nodes : diagram.edges;
		if (!list.some((item) => item.id === selection?.id)) selection = null;
	}

	const updateNode = (id: string, patch: Partial<DiagramNode>): Diagram => ({
		...diagram,
		nodes: diagram.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
	});

	const updateEdge = (id: string, patch: Partial<DiagramEdge>): Diagram => ({
		...diagram,
		edges: diagram.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)),
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
			text: shapeLabels[shape],
			color: "default",
		};
	}

	/**
	 * A shape from the palette: below the selected shape and connected to it,
	 * so a flow is built by clicking; otherwise in the middle of the view.
	 */
	function addShape(shape: ShapeKind): void {
		const selected = selection?.kind === "node" ? nodeById(selection.id) : undefined;
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
		const node = placeNode(shape, {
			x: selected.x + selected.w / 2,
			y: selected.y + selected.h + GAP + size.h / 2,
		});
		const withNode = { ...diagram, nodes: [...diagram.nodes, node] };
		change({
			...withNode,
			edges: [
				...diagram.edges,
				{ id: nextId(withNode, "e"), from: selected.id, to: node.id, text: "", dashed: false },
			],
		});
		selection = { kind: "node", id: node.id };
		render();
	}

	function insertNode(node: DiagramNode): void {
		change({ ...diagram, nodes: [...diagram.nodes, node] });
		selection = { kind: "node", id: node.id };
		render();
	}

	function connect(from: string, to: string): void {
		if (from === to || diagram.edges.some((edge) => edge.from === from && edge.to === to)) return;
		const id = nextId(diagram, "e");
		change({ ...diagram, edges: [...diagram.edges, { id, from, to, text: "", dashed: false }] });
		selection = { kind: "edge", id };
		render();
	}

	function deleteSelection(): void {
		if (selection === null) return;
		const { kind, id } = selection;
		selection = null;
		if (kind === "node") {
			change({
				nodes: diagram.nodes.filter((node) => node.id !== id),
				edges: diagram.edges.filter((edge) => edge.from !== id && edge.to !== id),
			});
		} else {
			change({ ...diagram, edges: diagram.edges.filter((edge) => edge.id !== id) });
		}
	}

	function duplicateSelection(): void {
		const node = selection?.kind === "node" ? nodeById(selection.id) : undefined;
		if (node === undefined) return;
		insertNode({ ...node, id: nextId(diagram, "n"), x: node.x + 2 * GRID, y: node.y + 2 * GRID });
	}

	function setColor(color: ColorName): void {
		if (selection?.kind !== "node") return;
		change(updateNode(selection.id, { color }));
	}

	function toggleDashed(): void {
		if (selection?.kind !== "edge") return;
		const edge = diagram.edges.find((item) => item.id === selection?.id);
		if (edge !== undefined) change(updateEdge(edge.id, { dashed: !edge.dashed }));
	}

	function nudge(dx: number, dy: number): void {
		const node = selection?.kind === "node" ? nodeById(selection.id) : undefined;
		if (node !== undefined) change(updateNode(node.id, { x: node.x + dx, y: node.y + dy }));
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
		if (selection?.kind === "edge")
			content.querySelector(`[data-edge="${CSS.escape(selection.id)}"]`)?.classList.add("selected");
		renderOverlay();

		undoButton.disabled = undoStack.length === 0;
		redoButton.disabled = redoStack.length === 0;
		const node = selection?.kind === "node" ? nodeById(selection.id) : undefined;
		const edge =
			selection?.kind === "edge"
				? diagram.edges.find((item) => item.id === selection?.id)
				: undefined;
		colorGroup.hidden = node === undefined;
		for (const swatch of swatches)
			swatch.setAttribute("aria-pressed", String(swatch.dataset.color === node?.color));
		dashedButton.hidden = edge === undefined;
		dashedButton.setAttribute("aria-pressed", String(edge?.dashed === true));
		deleteButton.disabled = selection === null;
		saveButton.disabled = saving || diagram.nodes.length === 0;
		status.textContent = diagram.nodes.length === 0 ? t.diagramEmpty : "";
		status.hidden = status.textContent === "";
	}

	function renderOverlay(): void {
		const parts: SVGElement[] = [];
		const handle = 8 / view.zoom;
		const selected = selection?.kind === "node" ? nodeById(selection.id) : undefined;
		if (selected !== undefined) {
			parts.push(
				svgEl("rect", {
					x: selected.x - 4,
					y: selected.y - 4,
					width: selected.w + 8,
					height: selected.h + 8,
					class: "diagram-selected",
				}),
				svgEl("rect", {
					x: selected.x + selected.w - handle / 2,
					y: selected.y + selected.h - handle / 2,
					width: handle,
					height: handle,
					class: "diagram-handle",
					"data-handle": selected.id,
				}),
			);
		}
		// Connection points on the shape under the pointer and the selected one.
		const ported = new Set(
			[hover, selected?.id].filter((id): id is string => id !== null && id !== undefined),
		);
		if (drag?.kind === "connect") ported.clear();
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
				const start =
					over === undefined
						? { x: from.x + from.w / 2, y: from.y + from.h / 2 }
						: edgeRoute(from, over).points[0];
				const end =
					over === undefined ? drag.pointer : (edgeRoute(from, over).points.at(-1) as Point);
				parts.push(
					svgEl("line", {
						x1: start?.x ?? 0,
						y1: start?.y ?? 0,
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
		let box: { x: number; y: number; w: number; h: number };
		if (editing.kind === "node") {
			const node = nodeById(editing.id);
			if (node === undefined) return;
			box = { x: node.x, y: node.y, w: node.w, h: node.h };
		} else {
			const edge = diagram.edges.find((item) => item.id === editing?.id);
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
		const item = kind === "node" ? nodeById(id) : diagram.edges.find((edge) => edge.id === id);
		if (item === undefined) return;
		editing = { kind, id };
		selection = { kind, id };
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
		const item = kind === "node" ? nodeById(id) : diagram.edges.find((edge) => edge.id === id);
		if (keep && item !== undefined && item.text !== text) {
			change(kind === "node" ? updateNode(id, { text }) : updateEdge(id, { text }));
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

	canvas.addEventListener("pointerdown", (event) => {
		if (event.button !== 0 && event.button !== 1) return;
		if (editing !== null) finishText(true);
		canvas.focus();
		const point = toWorld(event.clientX, event.clientY);
		const handle = hit(event.target, "data-handle");
		const port = hit(event.target, "data-port");
		const node = hit(event.target, "data-node");
		const edge = hit(event.target, "data-edge");
		if (event.button === 0 && handle === null && port === null) {
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
		if (event.button === 0 && handle !== null) {
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
		} else if (event.button === 0 && port !== null) {
			drag = { kind: "connect", from: port, pointer: point, over: null };
		} else if (event.button === 0 && node !== null) {
			const target = nodeById(node);
			selection = { kind: "node", id: node };
			if (target !== undefined)
				drag = {
					kind: "move",
					id: node,
					start: point,
					origin: { x: target.x, y: target.y },
					moved: false,
				};
		} else if (event.button === 0 && edge !== null) {
			selection = { kind: "edge", id: edge };
		} else {
			if (event.button === 0) selection = null;
			drag = {
				kind: "pan",
				startX: event.clientX,
				startY: event.clientY,
				viewX: view.x,
				viewY: view.y,
			};
		}
		canvas.setPointerCapture(event.pointerId);
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
					undoStack.push(diagram);
					redoStack = [];
					drag.moved = true;
				}
				diagram = updateNode(drag.id, { x: snap(drag.origin.x + dx), y: snap(drag.origin.y + dy) });
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
				diagram = updateNode(drag.id, { w, h });
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
		}
	});

	const endDrag = (): void => {
		const ended = drag;
		drag = null;
		if (ended?.kind === "connect" && ended.over !== null) connect(ended.from, ended.over);
		else render();
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
				view = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY };
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
		} else if (inField) {
			return;
		} else if (mod && key === "z") {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (mod && key === "y") {
			event.preventDefault();
			redo();
		} else if (mod && key === "d") {
			event.preventDefault();
			duplicateSelection();
		} else if (event.key === "Delete" || event.key === "Backspace") {
			event.preventDefault();
			deleteSelection();
		} else if (event.key === "Enter" || event.key === "F2") {
			if (selection === null) return;
			event.preventDefault();
			editText(selection.kind, selection.id);
		} else if (event.key.startsWith("Arrow") && selection?.kind === "node") {
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

	// Escape: leaves the selection first, then the panel (asking when there are changes).
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		if (selection !== null) {
			selection = null;
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
			selection = null;
			hover = null;
			drag = null;
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
