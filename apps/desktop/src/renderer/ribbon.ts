import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface RibbonButton {
	readonly kind?: "button";
	/** Written to `data-command`. */
	readonly id: string;
	readonly label: string;
	readonly icon: IconName;
	readonly shortcut?: string;
	/** Show the label next to the icon. */
	readonly showLabel?: boolean;
	run(): void;
	pressed?(): boolean;
	enabled?(): boolean;
}

export interface RibbonWidget {
	readonly kind: "widget";
	readonly element: HTMLElement;
	update?(): void;
}

export type RibbonItem = RibbonButton | RibbonWidget | { readonly kind: "separator" };

export interface RibbonGroup {
	readonly label: string;
	readonly items: readonly RibbonItem[];
}

export interface RibbonTab {
	readonly id: string;
	readonly label: string;
	readonly groups: readonly RibbonGroup[];
	/** Contextual tab: only shown while this returns true. */
	readonly visible?: () => boolean;
}

export interface RibbonOptions {
	readonly label: string;
	readonly fileButton: { readonly label: string; open(x: number, y: number): void };
	readonly quickAccess: { readonly label: string; readonly buttons: readonly RibbonButton[] };
	readonly tabs: readonly RibbonTab[];
	/** Placed at the right end of the tab row. */
	readonly trailing?: HTMLElement;
}

export interface Ribbon {
	readonly element: HTMLElement;
	update(): void;
	selectTab(id: string): void;
	selectedTab(): string;
}

interface BuiltButton {
	readonly element: HTMLButtonElement;
	readonly button: RibbonButton;
}

// Ribbon controls must not take focus on mousedown, or the editor selection
// they are about to act on is lost.
function keepSelection(element: HTMLElement): void {
	element.addEventListener("mousedown", (event) => event.preventDefault());
}

export function createButton(button: RibbonButton): HTMLButtonElement {
	const title =
		button.shortcut === undefined ? button.label : `${button.label} (${button.shortcut})`;
	const element = el("button", {
		class: button.showLabel === true ? "ribbon-button ribbon-button-labeled" : "ribbon-button",
		attrs: { type: "button", "data-command": button.id, title },
		children: [icon(button.icon)],
	});
	if (button.showLabel === true) {
		element.append(el("span", { class: "ribbon-button-label", text: button.label }));
	} else {
		element.setAttribute("aria-label", button.label);
	}
	keepSelection(element);
	element.addEventListener("click", () => button.run());
	return element;
}

function refresh({ element, button }: BuiltButton): void {
	if (button.pressed !== undefined) element.setAttribute("aria-pressed", String(button.pressed()));
	if (button.enabled !== undefined) element.disabled = !button.enabled();
}

export function createRibbon(container: HTMLElement, options: RibbonOptions): Ribbon {
	const buttons: BuiltButton[] = [];
	const widgets: RibbonWidget[] = [];

	function addButton(button: RibbonButton): HTMLButtonElement {
		const element = createButton(button);
		buttons.push({ element, button });
		return element;
	}

	const fileButton = el("button", {
		class: "ribbon-file",
		text: options.fileButton.label,
		attrs: { type: "button", "aria-haspopup": "menu", "data-command": "file" },
	});
	keepSelection(fileButton);
	fileButton.addEventListener("click", () => {
		const box = fileButton.getBoundingClientRect();
		options.fileButton.open(box.left, box.bottom);
	});

	const quickAccess = el("div", {
		class: "ribbon-quick",
		attrs: { role: "toolbar", "aria-label": options.quickAccess.label },
		children: options.quickAccess.buttons.map(addButton),
	});

	const tabList = el("div", { class: "ribbon-tabs", attrs: { role: "tablist" } });
	const panels = el("div", { class: "ribbon-panels" });
	const tabs = new Map<string, { tab: HTMLButtonElement; panel: HTMLElement }>();
	let selected = options.tabs[0]?.id ?? "";

	for (const definition of options.tabs) {
		const tab = el("button", {
			class: "ribbon-tab",
			text: definition.label,
			attrs: {
				type: "button",
				role: "tab",
				id: `tab-${definition.id}`,
				"aria-controls": `panel-${definition.id}`,
				"data-tab": definition.id,
			},
		});
		if (definition.visible !== undefined) tab.classList.add("ribbon-tab-contextual");
		keepSelection(tab);
		tab.addEventListener("click", () => selectTab(definition.id));

		const panel = el("div", {
			class: "ribbon-panel",
			attrs: { role: "tabpanel", id: `panel-${definition.id}`, "aria-labelledby": tab.id },
		});

		for (const group of definition.groups) {
			const items = el("div", { class: "ribbon-items" });
			for (const item of group.items) {
				if (item.kind === "separator") {
					items.append(el("span", { class: "ribbon-separator", attrs: { role: "presentation" } }));
				} else if (item.kind === "widget") {
					widgets.push(item);
					items.append(item.element);
				} else {
					items.append(addButton(item));
				}
			}
			panel.append(
				el("div", {
					class: "ribbon-group",
					attrs: { role: "group", "aria-label": group.label },
					children: [
						items,
						el("div", {
							class: "ribbon-group-label",
							text: group.label,
							attrs: { "aria-hidden": "true" },
						}),
					],
				}),
			);
		}

		tabs.set(definition.id, { tab, panel });
		tabList.append(tab);
		panels.append(panel);
	}

	tabList.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		const visible = options.tabs.filter((tab) => tab.visible?.() !== false).map((tab) => tab.id);
		const current = visible.indexOf(selected);
		if (current < 0) return;
		event.preventDefault();
		const step = event.key === "ArrowRight" ? 1 : -1;
		const target = visible[(current + step + visible.length) % visible.length];
		if (target === undefined) return;
		selectTab(target);
		tabs.get(target)?.tab.focus();
	});

	function selectTab(id: string): void {
		if (!tabs.has(id)) return;
		selected = id;
		for (const [tabId, { tab, panel }] of tabs) {
			const active = tabId === id;
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
			panel.hidden = !active;
		}
	}

	function update(): void {
		for (const definition of options.tabs) {
			if (definition.visible === undefined) continue;
			const visible = definition.visible();
			const built = tabs.get(definition.id);
			if (built !== undefined) built.tab.hidden = !visible;
			if (!visible && selected === definition.id) selectTab(options.tabs[0]?.id ?? "");
		}
		for (const built of buttons) refresh(built);
		for (const widget of widgets) widget.update?.();
	}

	const element = el("div", {
		class: "ribbon",
		attrs: { role: "region", "aria-label": options.label },
		children: [
			el("div", {
				class: "ribbon-top",
				children: [
					fileButton,
					quickAccess,
					tabList,
					...(options.trailing === undefined ? [] : [options.trailing]),
				],
			}),
			panels,
		],
	});
	container.append(element);

	selectTab(selected);
	update();

	return { element, update, selectTab, selectedTab: () => selected };
}

// --- Style gallery ----------------------------------------------------------

export interface StyleOption {
	readonly id: string;
	readonly label: string;
	readonly shortcut?: string;
	active(): boolean;
	apply(): void;
}

export function createStyleGallery(
	label: string,
	styles: readonly StyleOption[],
	enabled: () => boolean,
): RibbonWidget {
	const buttons = styles.map((style) => {
		const title = style.shortcut === undefined ? style.label : `${style.label} (${style.shortcut})`;
		const button = el("button", {
			class: `ribbon-style ribbon-style-${style.id}`,
			text: style.label,
			attrs: { type: "button", "data-command": `style-${style.id}`, title },
		});
		keepSelection(button);
		button.addEventListener("click", () => style.apply());
		return { button, style };
	});

	return {
		kind: "widget",
		element: el("div", {
			class: "ribbon-styles",
			attrs: { role: "group", "aria-label": label },
			children: buttons.map((b) => b.button),
		}),
		update() {
			const on = enabled();
			for (const { button, style } of buttons) {
				button.setAttribute("aria-pressed", String(style.active()));
				button.disabled = !on;
			}
		},
	};
}

// --- Color swatches -----------------------------------------------------------

export interface SwatchOptions<T extends string> {
	readonly label: string;
	readonly noneLabel: string;
	readonly options: readonly { readonly value: T; readonly label: string }[];
	current(): T | null;
	pick(value: T | null): void;
	enabled(): boolean;
}

/** A row of color buttons; the first one clears the color. */
export function createSwatches<T extends string>(options: SwatchOptions<T>): RibbonWidget {
	const choices: { value: T | null; label: string }[] = [
		{ value: null, label: options.noneLabel },
		...options.options,
	];
	const buttons = choices.map(({ value, label }) => {
		const button = el("button", {
			class: "ribbon-swatch",
			attrs: {
				type: "button",
				title: label,
				"aria-label": label,
				"data-color": value ?? "none",
				"data-command": `color-${value ?? "none"}`,
			},
		});
		keepSelection(button);
		button.addEventListener("click", () => options.pick(value));
		return { button, value };
	});

	return {
		kind: "widget",
		element: el("div", {
			class: "ribbon-swatches",
			attrs: { role: "group", "aria-label": options.label },
			children: buttons.map((b) => b.button),
		}),
		update() {
			const on = options.enabled();
			const current = on ? options.current() : null;
			for (const { button, value } of buttons) {
				button.setAttribute("aria-pressed", String(on && value === current));
				button.disabled = !on;
			}
		},
	};
}

// --- Table size picker ------------------------------------------------------

export interface TablePickerOptions {
	readonly label: string;
	readonly dialogLabel: string;
	sizeLabel(rows: number, columns: number): string;
	pick(rows: number, columns: number): void;
	enabled(): boolean;
}

const MAX_ROWS = 6;
const MAX_COLUMNS = 8;

export function createTablePicker(options: TablePickerOptions): RibbonWidget {
	let open = false;

	const button = createButton({
		id: "table",
		label: options.label,
		icon: "table",
		showLabel: true,
		run: () => (open ? hide(false) : show()),
	});
	button.setAttribute("aria-haspopup", "dialog");
	button.setAttribute("aria-expanded", "false");

	const caption = el("div", { class: "table-picker-caption", attrs: { "aria-live": "polite" } });
	const grid = el("div", { class: "table-picker-grid" });
	const popup = el("div", {
		class: "table-picker",
		attrs: { role: "dialog", "aria-label": options.dialogLabel },
		children: [grid, caption],
	});
	popup.hidden = true;

	const cells: HTMLButtonElement[][] = [];

	function highlight(rows: number, columns: number): void {
		for (const [r, row] of cells.entries()) {
			for (const [c, cell] of row.entries()) {
				cell.classList.toggle("selected", r < rows && c < columns);
			}
		}
		caption.textContent = options.sizeLabel(rows, columns);
	}

	for (let r = 0; r < MAX_ROWS; r++) {
		const row: HTMLButtonElement[] = [];
		for (let c = 0; c < MAX_COLUMNS; c++) {
			const cell = el("button", {
				class: "table-picker-cell",
				attrs: {
					type: "button",
					"aria-label": options.sizeLabel(r + 1, c + 1),
					"data-rows": String(r + 1),
					"data-columns": String(c + 1),
				},
			});
			keepSelection(cell);
			cell.addEventListener("mouseenter", () => highlight(r + 1, c + 1));
			cell.addEventListener("focus", () => highlight(r + 1, c + 1));
			cell.addEventListener("click", () => {
				hide(false);
				options.pick(r + 1, c + 1);
			});
			row.push(cell);
			grid.append(cell);
		}
		cells.push(row);
	}

	// `detail === 0` means the click came from the keyboard: only then move
	// focus into the grid, so a mouse user keeps the caret in the document.
	button.addEventListener("click", (event) => {
		if (event.detail === 0 && open) cells[0]?.[0]?.focus();
	});

	// Document-level: when opened with the mouse, focus stays in the editor.
	const onEscape = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		hide(popup.contains(document.activeElement));
	};

	popup.addEventListener("keydown", (event) => {
		const active = document.activeElement;
		if (!(active instanceof HTMLButtonElement) || active.dataset.rows === undefined) return;
		let r = Number(active.dataset.rows) - 1;
		let c = Number(active.dataset.columns) - 1;
		if (event.key === "ArrowRight") c = Math.min(MAX_COLUMNS - 1, c + 1);
		else if (event.key === "ArrowLeft") c = Math.max(0, c - 1);
		else if (event.key === "ArrowDown") r = Math.min(MAX_ROWS - 1, r + 1);
		else if (event.key === "ArrowUp") r = Math.max(0, r - 1);
		else return;
		event.preventDefault();
		cells[r]?.[c]?.focus();
	});

	const onOutsidePress = (event: MouseEvent): void => {
		const target = event.target;
		if (target instanceof Node && (popup.contains(target) || button.contains(target))) return;
		hide(false);
	};

	function show(): void {
		open = true;
		button.setAttribute("aria-expanded", "true");
		const box = button.getBoundingClientRect();
		popup.style.left = `${Math.round(box.left)}px`;
		popup.style.top = `${Math.round(box.bottom + 4)}px`;
		popup.hidden = false;
		highlight(0, 0);
		document.addEventListener("mousedown", onOutsidePress, true);
		document.addEventListener("keydown", onEscape, true);
	}

	function hide(focusButton: boolean): void {
		if (!open) return;
		open = false;
		button.setAttribute("aria-expanded", "false");
		popup.hidden = true;
		document.removeEventListener("mousedown", onOutsidePress, true);
		document.removeEventListener("keydown", onEscape, true);
		if (focusButton) button.focus();
	}

	document.body.append(popup);

	return {
		kind: "widget",
		element: button,
		update() {
			button.disabled = !options.enabled();
			if (button.disabled) hide(false);
		},
	};
}

// --- Color menu -------------------------------------------------------------

export interface ColorMenuOptions {
	readonly id: string;
	readonly icon: IconName;
	readonly label: string;
	readonly noneLabel: string;
	readonly colors: readonly { readonly value: string; readonly label: string }[];
	current(): string | null;
	pick(value: string | null): void;
	enabled(): boolean;
}

/** A button that shows the current color and opens a palette; the first entry clears the color. */
export function createColorMenu(options: ColorMenuOptions): RibbonWidget {
	let open = false;

	const button = createButton({
		id: options.id,
		label: options.label,
		icon: options.icon,
		run: () => (open ? hide(false) : show()),
	});
	button.classList.add("color-menu-button");
	button.setAttribute("aria-haspopup", "dialog");
	button.setAttribute("aria-expanded", "false");
	const bar = el("span", { class: "color-menu-bar", attrs: { "aria-hidden": "true" } });
	button.append(bar);

	const choices: { value: string | null; label: string }[] = [
		{ value: null, label: options.noneLabel },
		...options.colors,
	];
	const swatches = choices.map(({ value, label }) => {
		const swatch = el("button", {
			class: "ribbon-swatch",
			attrs: {
				type: "button",
				title: label,
				"aria-label": label,
				"data-color": value ?? "none",
				"data-command": `${options.id}-${value?.replace("#", "") ?? "none"}`,
			},
		});
		if (value !== null) swatch.style.setProperty("--table-color", value);
		keepSelection(swatch);
		swatch.addEventListener("click", () => {
			hide(false);
			options.pick(value);
		});
		return { swatch, value };
	});

	const popup = el("div", {
		class: "color-menu",
		attrs: { role: "dialog", "aria-label": options.label },
		children: swatches.map((entry) => entry.swatch),
	});
	popup.hidden = true;

	button.addEventListener("click", (event) => {
		if (event.detail === 0 && open) swatches[0]?.swatch.focus();
	});

	popup.addEventListener("keydown", (event) => {
		const index = swatches.findIndex((entry) => entry.swatch === document.activeElement);
		if (index === -1) return;
		const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (step === 0) return;
		event.preventDefault();
		swatches[(index + step + swatches.length) % swatches.length]?.swatch.focus();
	});

	const onEscape = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		hide(popup.contains(document.activeElement));
	};

	const onOutsidePress = (event: MouseEvent): void => {
		const target = event.target;
		if (target instanceof Node && (popup.contains(target) || button.contains(target))) return;
		hide(false);
	};

	function show(): void {
		open = true;
		button.setAttribute("aria-expanded", "true");
		const box = button.getBoundingClientRect();
		popup.style.left = `${Math.round(box.left)}px`;
		popup.style.top = `${Math.round(box.bottom + 4)}px`;
		popup.hidden = false;
		document.addEventListener("mousedown", onOutsidePress, true);
		document.addEventListener("keydown", onEscape, true);
	}

	function hide(focusButton: boolean): void {
		if (!open) return;
		open = false;
		button.setAttribute("aria-expanded", "false");
		popup.hidden = true;
		document.removeEventListener("mousedown", onOutsidePress, true);
		document.removeEventListener("keydown", onEscape, true);
		if (focusButton) button.focus();
	}

	document.body.append(popup);

	return {
		kind: "widget",
		element: button,
		update() {
			const on = options.enabled();
			button.disabled = !on;
			if (!on) hide(false);
			// kalem-locale-ok: CSS colors are ASCII
			const current = on ? (options.current()?.toLowerCase() ?? null) : null;
			if (current === null) bar.style.removeProperty("background");
			else bar.style.background = current;
			for (const { swatch, value } of swatches) {
				swatch.setAttribute("aria-pressed", String(value !== null && value === current));
			}
		},
	};
}
