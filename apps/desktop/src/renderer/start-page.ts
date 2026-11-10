import type { ConfluencePageSummary } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import { fileType } from "./file-types.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface StartAction {
	readonly id: string;
	readonly icon: IconName;
	readonly label: string;
	readonly hint: string;
	run(): void;
}

export interface StartPageOptions {
	readonly t: Strings;
	/** What can be started here; read each time the page is shown. */
	actions(): readonly StartAction[];
	/** The documents opened last, newest first. */
	recent(): Promise<readonly string[]>;
	/** The documents pinned to the start page, and how to change them. */
	pinned(): readonly string[];
	setPinned(paths: readonly string[]): void;
	open(path: string): void;
	/** Confluence's recently changed pages; `null` while it is not connected. */
	confluence(): Promise<readonly ConfluencePageSummary[]> | null;
	openConfluence(pageId: string): void;
}

export interface StartPage {
	readonly element: HTMLElement;
	/** Shown or hidden; what it lists is read again each time it is shown. */
	show(visible: boolean): void;
}

const MAX_RECENT = 6;
const MAX_CONFLUENCE = 5;

/**
 * The file's name and the end of the folder it is in (its last two folders,
 * which tell documents of the same name apart), whichever separator the
 * path uses. The whole path is the item's tooltip.
 */
export function splitPath(path: string): { name: string; folder: string } {
	const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
	const parts = path.split(/[\\/]/).filter((part) => part !== "");
	const name = parts.pop() ?? path;
	const shown = parts.slice(-2).join(separator);
	return { name, folder: parts.length > 2 ? `…${separator}${shown}` : shown };
}

/** Recent documents not pinned already, at most `limit`. */
export function unpinnedRecent(
	recent: readonly string[],
	pinned: readonly string[],
	limit = MAX_RECENT,
): string[] {
	const kept = new Set(pinned);
	return recent.filter((path) => !kept.has(path)).slice(0, limit);
}

/**
 * Under an empty, untitled page: the ways to start (a template, a file, a
 * folder, Word, Confluence, Jira), the pinned documents, the documents
 * opened last and, with Confluence connected, its pages changed last. It
 * sits in the page below the first line, so typing starts the document as
 * before; it goes as soon as the document has something in it.
 */
export function createStartPage(options: StartPageOptions): StartPage {
	const { t } = options;
	const actions = el("div", { class: "start-actions" });
	const section = (title: string): { box: HTMLElement; list: HTMLElement } => {
		const list = el("ul", { class: "start-recent-list" });
		const box = el("div", {
			class: "start-recent",
			children: [el("h3", { class: "start-heading", text: title }), list],
		});
		box.hidden = true;
		return { box, list };
	};
	const pinned = section(t.startPinned);
	const recent = section(t.startRecent);
	const confluence = section(t.startConfluenceRecent);
	pinned.box.classList.add("start-pinned");
	confluence.box.classList.add("start-confluence");
	const lists = el("div", {
		class: "start-lists",
		children: [pinned.box, recent.box, confluence.box],
	});
	const element = el("section", {
		class: "start-page",
		attrs: { "aria-label": t.startLabel },
		children: [el("p", { class: "start-title", text: t.startTitle }), actions, lists],
	});
	element.hidden = true;
	// The page's buttons must not take the caret out of the document on a click.
	element.addEventListener("mousedown", (event) => {
		if ((event.target as HTMLElement).closest("button") !== null) event.preventDefault();
	});

	function drawActions(): void {
		actions.replaceChildren(
			...options.actions().map((action) => {
				const button = el("button", {
					class: "start-action",
					attrs: { type: "button", "data-start": action.id },
					children: [
						el("span", { class: "start-action-icon", children: [icon(action.icon)] }),
						el("span", {
							class: "start-action-text",
							children: [
								el("span", { class: "start-action-label", text: action.label }),
								el("span", { class: "start-action-hint", text: action.hint }),
							],
						}),
					],
				});
				button.addEventListener("click", () => action.run());
				return button;
			}),
		);
	}

	/** A document of the lists: opened by a click, pinned or unpinned by its pin. */
	function fileItem(path: string, isPinned: boolean): HTMLElement {
		const { name, folder } = splitPath(path);
		const type = fileType(path);
		const open = el("button", {
			class: "start-recent-item",
			attrs: { type: "button", title: path },
			children: [
				el("span", { class: `files-icon tone-${type.tone}`, children: [icon(type.icon)] }),
				el("span", { class: "start-recent-name", text: name }),
				el("span", { class: "start-recent-folder", text: folder }),
			],
		});
		open.addEventListener("click", () => options.open(path));
		const label = isPinned ? t.startUnpin : t.startPin;
		const pin = el("button", {
			class: "start-pin",
			attrs: {
				type: "button",
				title: label,
				"aria-label": `${label}: ${name}`,
				"aria-pressed": String(isPinned),
			},
			children: [icon("pin")],
		});
		pin.addEventListener("click", () => {
			const now = options.pinned();
			options.setPinned(isPinned ? now.filter((each) => each !== path) : [...now, path]);
			void drawLists();
		});
		return el("li", { class: "start-file", children: [open, pin] });
	}

	function pageItem(page: ConfluencePageSummary): HTMLElement {
		const open = el("button", {
			class: "start-recent-item",
			attrs: { type: "button", title: page.title },
			children: [
				el("span", { class: "files-icon tone-markdown", children: [icon("confluence")] }),
				el("span", { class: "start-recent-name", text: page.title }),
				el("span", { class: "start-recent-folder", text: page.spaceName }),
			],
		});
		open.addEventListener("click", () => options.openConfluence(page.id));
		return el("li", { children: [open] });
	}

	let asked = 0;
	async function drawLists(): Promise<void> {
		const mine = ++asked;
		const pins = options.pinned();
		pinned.list.replaceChildren(...pins.map((path) => fileItem(path, true)));
		pinned.box.hidden = pins.length === 0;
		let paths: readonly string[];
		try {
			paths = await options.recent();
		} catch {
			paths = [];
		}
		if (mine !== asked) return;
		const shown = unpinnedRecent(paths, pins);
		recent.list.replaceChildren(...shown.map((path) => fileItem(path, false)));
		recent.box.hidden = shown.length === 0;

		const pages = options.confluence();
		if (pages === null) {
			confluence.box.hidden = true;
			return;
		}
		let found: readonly ConfluencePageSummary[];
		try {
			found = await pages;
		} catch {
			found = [];
		}
		if (mine !== asked) return;
		confluence.list.replaceChildren(...found.slice(0, MAX_CONFLUENCE).map(pageItem));
		confluence.box.hidden = found.length === 0;
	}

	return {
		element,
		show(visible) {
			if (visible === !element.hidden) return;
			element.hidden = !visible;
			if (!visible) return;
			drawActions();
			void drawLists();
		},
	};
}
