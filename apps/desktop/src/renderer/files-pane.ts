import type {
	KalemBridge,
	SearchHit,
	Workspace,
	WorkspaceEntry,
	WorkspaceRoot,
} from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { fileName, isBinaryPath, isEditablePath, isWordPath } from "../shared/paths.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface FilesPaneOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	/** Folds case in search highlights. */
	readonly lang: string;
	/** Path of the active tab's document. */
	activePath(): string | null;
	/** `query` is set when the file was picked from search results. */
	open(path: string, query?: string): void;
}

export interface FilesPane {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
	focusSearch(): void;
	/** Marks the active document without listing the folder again. */
	highlightActive(): void;
	workspace(): Workspace | null;
}

const SEARCH_DELAY = 300;

function iconButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
	return el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": label, title: label },
		children: [icon(name)],
	});
}

/** How a file is shown: documents open in the editor, text files in the text editor, others in their app. */
function fileKind(path: string): "document" | "text" | "other" {
	if (isEditablePath(path) || isWordPath(path)) return "document";
	return isBinaryPath(path) ? "other" : "text";
}

const FILE_ICONS = { document: "file", text: "code", other: "attach" } as const;

/** The line with the first match marked. */
function hitLine(hit: SearchHit, query: string, lang: string): HTMLElement {
	const line = el("span", { class: "search-hit-text" });
	const start = Math.max(
		0,
		hit.text.toLocaleLowerCase(lang).indexOf(query.toLocaleLowerCase(lang)),
	);
	line.append(
		hit.text.slice(0, start).trimStart(),
		el("mark", { text: hit.text.slice(start, start + query.length) }),
		hit.text.slice(start + query.length),
	);
	return line;
}

export function createFilesPane(options: FilesPaneOptions): FilesPane {
	const { t, bridge } = options;
	let current: Workspace | null = null;
	const collapsed = new Set<string>();
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searchToken = 0;

	const title = el("span", { class: "files-title" });
	const openFolder = iconButton("open", t.openFolder);
	const refreshButton = iconButton("refresh", t.refresh);
	const closeFolder = iconButton("close", t.closeFolder);
	openFolder.addEventListener("click", () => void bridge.openFolder());
	refreshButton.addEventListener("click", () => void refresh());
	closeFolder.addEventListener("click", () => bridge.closeFolder());

	const search = el("input", {
		class: "files-search",
		attrs: { type: "search", placeholder: t.folderSearch, "aria-label": t.folderSearch },
	});
	const list = el("div", {
		class: "files-list",
		attrs: { role: "tree", "aria-label": t.filesTab },
	});
	const message = el("p", { class: "files-message" });

	const element = el("div", {
		class: "files-pane",
		children: [
			el("div", {
				class: "files-toolbar",
				children: [title, openFolder, refreshButton, closeFolder],
			}),
			search,
			message,
			list,
		],
	});

	function showMessage(text: string): void {
		message.textContent = text;
		message.hidden = text === "";
	}

	function renderTree(): void {
		list.replaceChildren();
		list.setAttribute("role", "tree");
		const roots = current?.roots ?? [];
		const opened = current?.opened === true;
		const several = roots.length > 1;
		const only = roots.length === 1 ? roots[0] : undefined;
		title.textContent =
			only !== undefined ? fileName(only.path) : several ? format(t.foldersOpen, roots.length) : "";
		title.title = only?.path ?? roots.map((root) => root.path).join("\n");
		closeFolder.hidden = !opened;
		closeFolder.title = several ? t.closeAllFolders : t.closeFolder;
		closeFolder.setAttribute("aria-label", closeFolder.title);
		refreshButton.hidden = roots.length === 0;
		search.disabled = roots.length === 0;

		if (roots.length === 0) {
			showMessage(t.noFolder);
			return;
		}
		if (roots.every((root) => root.entries.length === 0)) {
			showMessage(t.folderEmpty);
			if (!several) return;
		} else {
			const truncated = roots.find((root) => root.truncated);
			showMessage(
				truncated === undefined ? "" : format(t.folderTruncated, truncated.entries.length),
			);
		}

		const active = options.activePath();
		for (const root of roots) {
			// One folder is named in the toolbar; several each get a heading row.
			if (several) {
				list.append(rootRow(root, opened));
				if (collapsed.has(root.path)) continue;
			}
			const shift = several ? 1 : 0;
			let hiddenBelow: number | null = null;
			for (const entry of root.entries) {
				if (hiddenBelow !== null && entry.depth > hiddenBelow) continue;
				hiddenBelow = null;
				list.append(row(entry, entry.path === active, shift));
				if (entry.folder && collapsed.has(entry.path)) hiddenBelow = entry.depth;
			}
		}
	}

	function toggle(path: string): void {
		if (collapsed.has(path)) collapsed.delete(path);
		else collapsed.add(path);
		renderTree();
	}

	function rootRow(root: WorkspaceRoot, opened: boolean): HTMLElement {
		const open = !collapsed.has(root.path);
		const toggleButton = el("button", {
			class: "files-item files-folder files-root-name",
			attrs: {
				type: "button",
				role: "treeitem",
				title: root.path,
				"aria-expanded": String(open),
				"data-path": root.path,
			},
			children: [
				el("span", { class: "files-twisty", text: open ? "▾" : "▸" }),
				icon("open"),
				el("span", { class: "files-name", text: fileName(root.path) }),
			],
		});
		toggleButton.addEventListener("click", () => toggle(root.path));
		const children: HTMLElement[] = [toggleButton];
		if (opened) {
			const close = iconButton("close", format(t.closeThisFolder, fileName(root.path)));
			close.classList.add("files-root-close");
			close.addEventListener("click", () => bridge.closeFolder(root.path));
			children.push(close);
		}
		return el("div", { class: "files-root", children });
	}

	function row(entry: WorkspaceEntry, active: boolean, shift: number): HTMLElement {
		const open = entry.folder && !collapsed.has(entry.path);
		const kind = entry.folder ? null : fileKind(entry.path);
		const item = el("button", {
			class: entry.folder ? "files-item files-folder" : `files-item files-${kind}`,
			attrs: {
				type: "button",
				role: "treeitem",
				title: entry.path,
				"data-path": entry.path,
				...(entry.folder ? { "aria-expanded": String(open) } : {}),
				...(active ? { "aria-current": "page" } : {}),
			},
			children: [
				el("span", { class: "files-twisty", text: entry.folder ? (open ? "▾" : "▸") : "" }),
				icon(kind === null ? "open" : FILE_ICONS[kind]),
				el("span", { class: "files-name", text: entry.name }),
			],
		});
		item.style.setProperty("--depth", String(entry.depth + shift));
		item.addEventListener("click", () => {
			if (entry.folder) toggle(entry.path);
			else options.open(entry.path);
		});
		return item;
	}

	async function runSearch(query: string): Promise<void> {
		const token = ++searchToken;
		const result = await bridge.searchWorkspace(query);
		if (token !== searchToken) return;

		list.replaceChildren();
		list.setAttribute("role", "list");
		if (result.hits.length === 0) {
			showMessage(t.searchNoHits);
			return;
		}
		const files = new Map<string, SearchHit[]>();
		for (const hit of result.hits) files.set(hit.path, [...(files.get(hit.path) ?? []), hit]);
		showMessage(
			result.truncated
				? format(t.searchTruncated, result.hits.length)
				: format(t.searchHits, result.hits.length, files.size),
		);

		for (const [path, hits] of files) {
			const group = el("div", { class: "search-file", attrs: { role: "listitem" } });
			group.append(
				el("div", {
					class: "search-file-name",
					text: hits[0]?.relative ?? fileName(path),
					attrs: { title: path },
				}),
			);
			for (const hit of hits) {
				const button = el("button", {
					class: "search-hit",
					attrs: { type: "button", "data-path": path, "data-line": String(hit.line) },
					children: [
						el("span", { class: "search-hit-line", text: String(hit.line) }),
						hitLine(hit, query, options.lang),
					],
				});
				button.addEventListener("click", () => options.open(path, query));
				group.append(button);
			}
			list.append(group);
		}
	}

	search.addEventListener("input", () => {
		if (searchTimer !== null) clearTimeout(searchTimer);
		const query = search.value.trim();
		if (query === "") {
			searchToken++;
			renderTree();
			return;
		}
		searchTimer = setTimeout(() => void runSearch(query), SEARCH_DELAY);
	});
	search.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			if (searchTimer !== null) clearTimeout(searchTimer);
			const query = search.value.trim();
			if (query !== "") void runSearch(query);
		} else if (event.key === "Escape" && search.value !== "") {
			event.stopPropagation();
			search.value = "";
			searchToken++;
			renderTree();
		}
	});

	async function refresh(): Promise<void> {
		current = await bridge.getWorkspace();
		if (search.value.trim() === "") renderTree();
		else await runSearch(search.value.trim());
	}

	return {
		element,
		refresh,
		focusSearch: () => {
			search.focus();
			search.select();
		},
		highlightActive: () => {
			const active = options.activePath();
			for (const item of list.querySelectorAll<HTMLElement>(".files-item")) {
				if (item.dataset.path === active) item.setAttribute("aria-current", "page");
				else item.removeAttribute("aria-current");
			}
		},
		workspace: () => current,
	};
}
