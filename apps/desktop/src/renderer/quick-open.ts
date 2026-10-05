import type { Workspace } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface QuickOpenOptions {
	readonly t: Strings;
	readonly lang: string;
	workspace(): Promise<Workspace>;
	open(path: string): void;
}

export interface QuickOpenItem {
	readonly path: string;
	readonly name: string;
	/** Below the workspace root, with `/`. */
	readonly relative: string;
}

const MAX_RESULTS = 50;

/**
 * Every term of the query must appear in the relative path. Names that
 * start with the query come first, then names containing it, then the rest;
 * shorter paths win ties.
 */
export function rankItems(
	items: readonly QuickOpenItem[],
	query: string,
	lang: string,
): QuickOpenItem[] {
	const terms = query
		.toLocaleLowerCase(lang)
		.split(/\s+/)
		.filter((term) => term !== "");
	const whole = terms.join(" ");
	const score = (item: QuickOpenItem): number => {
		const name = item.name.toLocaleLowerCase(lang);
		if (whole === "") return 0;
		if (name.startsWith(whole)) return 0;
		if (name.includes(whole)) return 1;
		return 2;
	};
	return items
		.filter((item) => {
			const path = item.relative.toLocaleLowerCase(lang);
			return terms.every((term) => path.includes(term));
		})
		.map((item) => ({ item, score: score(item) }))
		.sort((a, b) => a.score - b.score || a.item.relative.length - b.item.relative.length)
		.slice(0, MAX_RESULTS)
		.map(({ item }) => item);
}

function relativeTo(root: string, path: string): string {
	return path
		.slice(root.length)
		.replace(/^[\\/]+/, "")
		.replace(/\\/g, "/");
}

/** A palette that opens a document of the workspace by name. */
export function createQuickOpen(options: QuickOpenOptions): { show(): Promise<void> } {
	const { t } = options;
	const input = el("input", {
		class: "quick-open-input",
		attrs: { type: "text", placeholder: t.quickOpenPlaceholder, "aria-label": t.quickOpen },
	});
	const list = el("ul", { class: "quick-open-list", attrs: { role: "listbox" } });
	const empty = el("p", { class: "quick-open-empty" });
	const dialog = el("dialog", {
		class: "quick-open",
		attrs: { "aria-label": t.quickOpen },
		children: [input, empty, list],
	});
	document.body.append(dialog);

	let items: QuickOpenItem[] = [];
	let shown: QuickOpenItem[] = [];
	let selected = 0;

	function render(): void {
		shown = rankItems(items, input.value, options.lang);
		selected = Math.min(selected, Math.max(0, shown.length - 1));
		empty.textContent = shown.length === 0 ? t.quickOpenEmpty : "";
		empty.hidden = shown.length > 0;
		list.replaceChildren(
			...shown.map((item, i) => {
				const option = el("li", {
					class: "quick-open-item",
					attrs: {
						role: "option",
						"aria-selected": String(i === selected),
						"data-path": item.path,
					},
					children: [
						el("span", { class: "quick-open-name", text: item.name }),
						// The folder only; the name is already shown.
						el("span", {
							class: "quick-open-path",
							text: item.relative.slice(
								0,
								Math.max(0, item.relative.length - item.name.length - 1),
							),
						}),
					],
				});
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => choose(i));
				return option;
			}),
		);
		list.children[selected]?.scrollIntoView({ block: "nearest" });
	}

	function choose(index: number): void {
		const item = shown[index];
		if (item === undefined) return;
		dialog.close();
		options.open(item.path);
	}

	input.addEventListener("input", () => {
		selected = 0;
		render();
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			selected = (selected + step + shown.length) % Math.max(1, shown.length);
			render();
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(selected);
		}
	});
	// A click on the backdrop lands on the dialog element itself.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});

	return {
		async show() {
			const workspace = await options.workspace();
			const root = workspace.root;
			items =
				root === null
					? []
					: workspace.entries
							.filter((entry) => !entry.folder)
							.map((entry) => ({
								path: entry.path,
								name: entry.name,
								relative: relativeTo(root, entry.path),
							}));
			input.value = "";
			selected = 0;
			render();
			if (root === null) empty.textContent = t.noFolder;
			if (!dialog.open) dialog.showModal();
			input.focus();
		},
	};
}
