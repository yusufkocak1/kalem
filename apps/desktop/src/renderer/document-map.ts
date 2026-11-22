import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";

/** A thing on the map: where it is on the page, and what it is. */
export interface MapMark {
	readonly kind: "heading" | "note" | "change" | "found";
	/** Its box's top, in the page's own coordinates (from the top of what scrolls). */
	readonly top: number;
	readonly label: string;
	/** For a heading: its level, a note: its kind. */
	readonly detail?: string;
}

export interface DocumentMapOptions {
	readonly t: Strings;
	/** The active page's scroller, while it has a map; `null` hides it. */
	desk(): HTMLElement | null;
	/** What is on the page now, from the top of what scrolls. */
	marks(desk: HTMLElement): readonly MapMark[];
	/**
	 * How tall the document's text is, from the top of what scrolls: a page
	 * drawn a sheet tall can scroll with little text on it.
	 */
	extent?(desk: HTMLElement): number;
}

export interface DocumentMap {
	readonly element: HTMLElement;
	/** The page or what is on it changed: the marks are placed again, soon. */
	refresh(): void;
	/** The page scrolled: only the view's box moves. */
	scrolled(): void;
}

/** A mark's share of the map's height, from the top: where its thing is in the page. */
export function markShare(top: number, scrollHeight: number): number {
	if (scrollHeight <= 0) return 0;
	return Math.min(1, Math.max(0, top / scrollHeight));
}

/** The page's scroll that brings a share of it to the middle of the view. */
export function scrollForShare(share: number, scrollHeight: number, viewHeight: number): number {
	const top = share * scrollHeight - viewHeight / 2;
	return Math.max(0, Math.min(top, scrollHeight - viewHeight));
}

const REFRESH_DELAY = 150;

/**
 * The document's map, beside the scrollbar: the headings, the user's notes,
 * the assistant's changes and what the search found, each a tick where it is
 * in the document. A click goes there; pointed at, it shows the part of the
 * document in view.
 */
export function createDocumentMap(options: DocumentMapOptions): DocumentMap {
	const { t } = options;
	const view = el("div", { class: "doc-map-view", attrs: { "aria-hidden": "true" } });
	const ticks = el("div", { class: "doc-map-ticks" });
	const element = el("div", {
		class: "doc-map",
		attrs: { role: "navigation", "aria-label": t.documentMap, hidden: "" },
		children: [view, ticks],
	});

	let timer: ReturnType<typeof setTimeout> | undefined;

	function scrolled(): void {
		const desk = options.desk();
		if (desk === null || element.hidden) return;
		const height = desk.scrollHeight;
		view.style.top = `${markShare(desk.scrollTop, height) * 100}%`;
		view.style.height = `${(desk.clientHeight / Math.max(1, height)) * 100}%`;
	}

	function draw(): void {
		clearTimeout(timer);
		const desk = options.desk();
		// Nothing to find in a document that fits in the view.
		const long =
			desk !== null && (options.extent?.(desk) ?? desk.scrollHeight) > desk.clientHeight * 1.2;
		element.hidden = !long;
		if (desk === null || !long) {
			ticks.replaceChildren();
			return;
		}
		const height = desk.scrollHeight;
		ticks.replaceChildren(
			...options.marks(desk).map((mark) => {
				const tick = el("span", {
					class: `doc-map-tick doc-map-${mark.kind}`,
					attrs: {
						title: mark.label,
						...(mark.detail === undefined ? {} : { "data-detail": mark.detail }),
					},
				});
				tick.style.top = `${markShare(mark.top, height) * 100}%`;
				return tick;
			}),
		);
		scrolled();
	}

	element.addEventListener("mousedown", (event) => {
		// Not the document's caret: the map only moves the view.
		event.preventDefault();
		const desk = options.desk();
		if (desk === null) return;
		const box = element.getBoundingClientRect();
		const share = (event.clientY - box.top) / Math.max(1, box.height);
		desk.scrollTo({
			top: scrollForShare(share, desk.scrollHeight, desk.clientHeight),
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
		});
	});

	return {
		element,
		refresh() {
			clearTimeout(timer);
			timer = setTimeout(draw, REFRESH_DELAY);
		},
		scrolled,
	};
}
