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
	open(path: string): void;
}

export interface StartPage {
	readonly element: HTMLElement;
	/** Shown or hidden; the recent documents are read again each time it is shown. */
	show(visible: boolean): void;
}

const MAX_RECENT = 6;

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

/**
 * Under an empty, untitled page: the ways to start (a template, a file, a
 * folder, Word, Confluence, Jira) and the documents opened last. It sits
 * in the page below the first line, so typing starts the document as
 * before; it goes as soon as the document has something in it.
 */
export function createStartPage(options: StartPageOptions): StartPage {
	const { t } = options;
	const actions = el("div", { class: "start-actions" });
	const recentList = el("ul", { class: "start-recent-list" });
	const recent = el("div", {
		class: "start-recent",
		children: [el("h3", { class: "start-heading", text: t.startRecent }), recentList],
	});
	recent.hidden = true;
	const element = el("section", {
		class: "start-page",
		attrs: { "aria-label": t.startLabel },
		children: [el("p", { class: "start-title", text: t.startTitle }), actions, recent],
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

	let asked = 0;
	async function drawRecent(): Promise<void> {
		const mine = ++asked;
		let paths: readonly string[];
		try {
			paths = await options.recent();
		} catch {
			paths = [];
		}
		if (mine !== asked) return;
		recentList.replaceChildren(
			...paths.slice(0, MAX_RECENT).map((path) => {
				const { name, folder } = splitPath(path);
				const button = el("button", {
					class: "start-recent-item",
					attrs: { type: "button", title: path },
					children: [
						el("span", {
							class: `files-icon tone-${fileType(path).tone}`,
							children: [icon(fileType(path).icon)],
						}),
						el("span", { class: "start-recent-name", text: name }),
						el("span", { class: "start-recent-folder", text: folder }),
					],
				});
				button.addEventListener("click", () => options.open(path));
				return el("li", { children: [button] });
			}),
		);
		recent.hidden = paths.length === 0;
	}

	return {
		element,
		show(visible) {
			if (visible === !element.hidden) return;
			element.hidden = !visible;
			if (!visible) return;
			drawActions();
			void drawRecent();
		},
	};
}
