import type { Settings } from "../shared/bridge.js";
import { clampNavigationWidth, DEFAULT_SETTINGS, MIN_NAVIGATION_WIDTH } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import type { Dock, PanePlace, ToolPane } from "../shared/panes.js";
import {
	clampDockSize,
	DOCKS,
	dockPatch,
	dockState,
	isPaneShown,
	MIN_DOCK_SIZE,
	movePane,
	panesIn,
	placesFor,
	shownPane,
	TOOL_PANES,
	togglePane,
} from "../shared/panes.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface DockPane {
	readonly id: ToolPane;
	readonly label: string;
	readonly icon: IconName;
	readonly element: HTMLElement;
}

export interface DocksOptions {
	readonly t: Strings;
	readonly panes: readonly DockPane[];
	settings(): Settings;
	update(patch: Partial<Settings>): void;
	/** Whether a pane is set up: Confluence and Jira only once connected. */
	available(pane: ToolPane): boolean;
	/** Opens the settings at the panels. */
	openLayout(): void;
}

export interface Docks {
	/** The docks: the left one is the navigation pane. */
	readonly elements: Readonly<Record<Dock, HTMLElement>>;
	/** The buttons on the window's edges, one per pane in each dock. */
	readonly stripes: Readonly<Record<Dock, HTMLElement>>;
	/** Lays the panes out after a change of settings or connections. */
	apply(): void;
	/** The panes on the screen now. */
	shown(): Set<ToolPane>;
}

const DEFAULT_SIZE: Readonly<Record<Dock, number>> = {
	left: DEFAULT_SETTINGS.navigationWidth,
	right: DEFAULT_SETTINGS.rightWidth,
	bottom: DEFAULT_SETTINGS.bottomHeight,
};

/**
 * The tool panes in docks, as in an IDE: the left dock (the navigation
 * pane), a right dock next to the assistant and a bottom dock under the
 * document. Each shows one of its panes, named in its header like the
 * assistant's panel, and picked by the buttons on the window's edge; a
 * pane's header or button has a menu that moves it to another dock or
 * hides it.
 */
export function createDocks(options: DocksOptions): Docks {
	const { t } = options;
	const entries = new Map(options.panes.map((pane) => [pane.id, pane]));
	const placeLabel: Readonly<Record<PanePlace, string>> = {
		left: t.moveToLeft,
		right: t.moveToRight,
		bottom: t.moveToBottom,
		hidden: t.hidePane,
	};

	// --- Menu: move a pane, hide it, or open the layout settings ------------------
	const menu = el("div", { class: "dock-menu", attrs: { role: "menu", hidden: "" } });
	document.body.append(menu);
	const closeMenu = (): void => {
		menu.hidden = true;
	};
	function showMenu(pane: ToolPane, x: number, y: number): void {
		const place = options.settings().panePlaces[pane];
		const item = (label: string, run: () => void): HTMLButtonElement => {
			const button = el("button", {
				class: "dock-menu-item",
				text: label,
				attrs: { type: "button", role: "menuitem" },
			});
			button.addEventListener("click", () => {
				closeMenu();
				run();
			});
			return button;
		};
		menu.replaceChildren(
			...placesFor(pane)
				.filter((target) => target !== place)
				.map((target) =>
					item(placeLabel[target], () =>
						options.update(movePane(options.settings(), pane, target)),
					),
				),
			el("hr", { class: "dock-menu-separator" }),
			item(t.panelLayout, () => options.openLayout()),
		);
		menu.hidden = false;
		const box = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
		menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
		(menu.firstElementChild as HTMLElement | null)?.focus();
	}
	document.addEventListener("mousedown", (event) => {
		if (!menu.hidden && !(event.target instanceof Node && menu.contains(event.target))) closeMenu();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !menu.hidden) closeMenu();
	});
	const menuOn = (target: HTMLElement, pane: ToolPane): void => {
		target.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			showMenu(pane, event.clientX, event.clientY);
		});
	};

	// --- The docks ----------------------------------------------------------------
	interface DockView {
		readonly element: HTMLElement;
		readonly title: HTMLElement;
		readonly body: HTMLElement;
		readonly resizer: HTMLElement;
		readonly stripe: HTMLElement;
	}

	function makeDock(dock: Dock): DockView {
		// The shown pane's icon and name, as the assistant's panel has its own.
		const title = el("div", { class: "dock-title" });
		title.addEventListener("contextmenu", (event) => {
			const shown = shownPane(options.settings(), dock, options.available);
			if (shown === null) return;
			event.preventDefault();
			showMenu(shown, event.clientX, event.clientY);
		});
		const layout = el("button", {
			class: "icon-button dock-layout",
			attrs: { type: "button", "aria-label": t.panelLayout, title: t.panelLayout },
			text: "⋯",
		});
		layout.addEventListener("click", (event) => {
			const shown = shownPane(options.settings(), dock, options.available);
			if (shown === null) return;
			const box = layout.getBoundingClientRect();
			event.stopPropagation();
			showMenu(shown, box.left, box.bottom + 4);
		});
		const label = dock === "left" ? t.closeNavigation : t.closeDock;
		const close = el("button", {
			class: "icon-button",
			attrs: { type: "button", "aria-label": label, title: label },
			children: [icon("close")],
		});
		close.addEventListener("click", () => options.update(dockPatch(dock, { open: false })));
		const resizer = el("div", {
			class: dock === "left" ? "navigation-resizer" : `dock-resizer dock-resizer-${dock}`,
			attrs: {
				role: "separator",
				tabindex: "0",
				"aria-orientation": dock === "bottom" ? "horizontal" : "vertical",
				"aria-label": dock === "left" ? t.navigationResize : t.dockResize,
				title: dock === "left" ? t.navigationResize : t.dockResize,
			},
		});
		const body = el("div", { class: "dock-body" });
		const element = el(dock === "left" ? "nav" : "aside", {
			class:
				dock === "left"
					? "navigation tool-dock dock-left kalem-theme"
					: `tool-dock dock-${dock} kalem-theme`,
			attrs: { "aria-label": dock === "left" ? t.navigation : placeName(dock), "data-dock": dock },
			children: [
				el("div", {
					class: "navigation-header",
					children: [title, el("span", { class: "dock-spacer" }), layout, close],
				}),
				body,
				resizer,
			],
		});
		const stripe = el("div", {
			class: `dock-stripe stripe-${dock}`,
			attrs: { role: "toolbar", "aria-label": placeName(dock) },
		});
		resizable(dock, element, resizer);
		return { element, title, body, resizer, stripe };
	}

	function placeName(dock: Dock): string {
		return dock === "left" ? t.placeLeft : dock === "right" ? t.placeRight : t.placeBottom;
	}

	// --- Sizes ----------------------------------------------------------------------
	const largest = (dock: Dock): number =>
		dock === "bottom"
			? Math.max(MIN_DOCK_SIZE, window.innerHeight - 260)
			: Math.max(MIN_NAVIGATION_WIDTH, window.innerWidth - 420);
	const fit = (dock: Dock, size: number): number => {
		const clamped =
			dock === "left" ? clampNavigationWidth(size) : clampDockSize(size, DEFAULT_SIZE[dock]);
		return Math.min(largest(dock), clamped);
	};
	function showSize(dock: Dock, size: number): void {
		const view = views[dock];
		if (dock === "bottom") view.element.style.height = `${size}px`;
		else view.element.style.width = `${size}px`;
		view.resizer.setAttribute("aria-valuenow", String(size));
		view.resizer.setAttribute("aria-valuemax", String(largest(dock)));
		view.resizer.setAttribute(
			"aria-valuemin",
			String(dock === "left" ? MIN_NAVIGATION_WIDTH : MIN_DOCK_SIZE),
		);
	}

	function resizable(dock: Dock, element: HTMLElement, resizer: HTMLElement): void {
		resizer.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			resizer.setPointerCapture(event.pointerId);
			const box = element.getBoundingClientRect();
			let size = dockState(options.settings(), dock).size;
			element.classList.add("resizing");
			const move = (moved: PointerEvent): void => {
				size = fit(
					dock,
					dock === "left"
						? moved.clientX - box.left
						: dock === "right"
							? box.right - moved.clientX
							: box.bottom - moved.clientY,
				);
				showSize(dock, size);
			};
			const up = (): void => {
				resizer.removeEventListener("pointermove", move);
				resizer.removeEventListener("pointerup", up);
				resizer.removeEventListener("pointercancel", up);
				element.classList.remove("resizing");
				options.update(dockPatch(dock, { size }));
			};
			resizer.addEventListener("pointermove", move);
			resizer.addEventListener("pointerup", up);
			resizer.addEventListener("pointercancel", up);
		});
		resizer.addEventListener("keydown", (event) => {
			const grow = { left: "ArrowRight", right: "ArrowLeft", bottom: "ArrowUp" }[dock];
			const shrink = { left: "ArrowLeft", right: "ArrowRight", bottom: "ArrowDown" }[dock];
			const step = event.key === grow ? 20 : event.key === shrink ? -20 : 0;
			if (step === 0) return;
			event.preventDefault();
			const size = dockState(options.settings(), dock).size;
			options.update(dockPatch(dock, { size: fit(dock, size + step) }));
		});
		resizer.addEventListener("dblclick", () =>
			options.update(dockPatch(dock, { size: DEFAULT_SIZE[dock] })),
		);
	}

	const views = {} as Record<Dock, DockView>;
	for (const dock of DOCKS) views[dock] = makeDock(dock);

	window.addEventListener("resize", () => {
		for (const dock of DOCKS) {
			if (!views[dock].element.hidden) {
				showSize(dock, fit(dock, dockState(options.settings(), dock).size));
			}
		}
	});

	// --- Laying out -------------------------------------------------------------------
	function stripeButton(pane: DockPane, pressed: boolean): HTMLButtonElement {
		const button = el("button", {
			class: "stripe-button",
			attrs: {
				type: "button",
				title: pane.label,
				"aria-label": pane.label,
				"aria-pressed": String(pressed),
				"data-pane": pane.id,
			},
			children: [icon(pane.icon), el("span", { class: "stripe-label", text: pane.label })],
		});
		button.addEventListener("click", () =>
			options.update(togglePane(options.settings(), pane.id, options.available)),
		);
		menuOn(button, pane.id);
		return button;
	}

	function apply(): void {
		const settings = options.settings();
		for (const dock of DOCKS) {
			const view = views[dock];
			const panes = panesIn(settings, dock, options.available);
			const active = shownPane(settings, dock, options.available);
			const open = dockState(settings, dock).open && active !== null;
			view.element.hidden = !open;
			if (open) showSize(dock, fit(dock, dockState(settings, dock).size));
			const shown = active === null ? undefined : entries.get(active);
			view.title.replaceChildren(
				...(shown === undefined
					? []
					: [icon(shown.icon), el("h2", { text: shown.label, attrs: { "data-pane": shown.id } })]),
			);
			for (const id of panes) {
				const pane = entries.get(id) as DockPane;
				if (pane.element.parentElement !== view.body) view.body.append(pane.element);
				pane.element.hidden = id !== active;
			}
			view.stripe.replaceChildren(
				...panes.map((id) => stripeButton(entries.get(id) as DockPane, open && id === active)),
			);
			view.stripe.hidden = panes.length === 0;
		}
		// What is not in a dock (hidden, or not set up) is not shown anywhere.
		for (const id of TOOL_PANES) {
			const place = settings.panePlaces[id];
			if (place === "hidden" || !options.available(id)) {
				const pane = entries.get(id);
				if (pane !== undefined) pane.element.hidden = true;
			}
		}
	}

	return {
		elements: {
			left: views.left.element,
			right: views.right.element,
			bottom: views.bottom.element,
		},
		stripes: { left: views.left.stripe, right: views.right.stripe, bottom: views.bottom.stripe },
		apply,
		shown: () =>
			new Set(
				TOOL_PANES.filter((pane) => isPaneShown(options.settings(), pane, options.available)),
			),
	};
}
