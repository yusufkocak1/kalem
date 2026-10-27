import type {
	KalemBridge,
	SearchHit,
	Workspace,
	WorkspaceEntry,
	WorkspaceRoot,
} from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { fileName } from "../shared/paths.js";
import { el } from "./dom.js";
import { fileType } from "./file-types.js";
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
	/** Tells the user that a file operation failed. */
	notify(text: string): void;
}

export interface FilesPane {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
	focusSearch(): void;
	/** Marks the active document, opening the folders above it, without listing the folder again. */
	highlightActive(): void;
	workspace(): Workspace | null;
}

const SEARCH_DELAY = 300;
const MAX_NAME_MATCHES = 50;
/** Where the folders the user opened are remembered between runs. */
const EXPANDED_KEY = "kalem.files.expanded";
const MAX_REMEMBERED = 2000;

function iconButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
	return el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": label, title: label },
		children: [icon(name)],
	});
}

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

/** `name` with the part matching `query` marked. */
function markedName(name: string, query: string, lang: string): HTMLElement {
	const at = name.toLocaleLowerCase(lang).indexOf(query.toLocaleLowerCase(lang));
	const span = el("span", { class: "files-name" });
	if (at === -1) span.textContent = name;
	else {
		span.append(
			name.slice(0, at),
			el("mark", { text: name.slice(at, at + query.length) }),
			name.slice(at + query.length),
		);
	}
	return span;
}

function loadExpanded(): Set<string> {
	try {
		const raw = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as unknown;
		return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
	} catch {
		return new Set();
	}
}

/** One row of the tree as shown: a root, a folder or a file. */
interface Row {
	readonly path: string;
	readonly name: string;
	readonly folder: boolean;
	readonly root: WorkspaceRoot;
	/** Nesting as shown, from 0. */
	readonly level: number;
	readonly isRoot: boolean;
	/** The row of the folder it is in; `null` at the top. */
	readonly parent: string | null;
}

/** What the inline name box is for. */
type Editing =
	| { readonly kind: "create"; readonly parent: string; readonly folder: boolean }
	| { readonly kind: "rename"; readonly path: string };

interface MenuItem {
	readonly label: string;
	readonly run: () => void;
	readonly shortcut?: string;
	readonly danger?: boolean;
}

export function createFilesPane(options: FilesPaneOptions): FilesPane {
	const { t, bridge } = options;
	let current: Workspace | null = null;
	/** Folders shown open; roots are open unless closed here. */
	const expanded = loadExpanded();
	const closedRoots = new Set<string>();
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searchToken = 0;
	/** The row with the keyboard focus. */
	let selected: string | null = null;
	let editing: Editing | null = null;
	/** The rows as last drawn, in order. */
	let rows: Row[] = [];
	let lastActive: string | null = null;
	/** A listing came in while the menu was open or a name was being typed: drawn once they are done. */
	let stale = false;

	const title = el("span", { class: "files-title" });
	const newFile = iconButton("new", t.filesNewFile);
	const newFolder = iconButton("folderNew", t.filesNewFolder);
	const collapseAll = iconButton("collapseAll", t.filesCollapseAll);
	const openFolder = iconButton("open", t.openFolder);
	const refreshButton = iconButton("refresh", t.refresh);
	const closeFolder = iconButton("close", t.closeFolder);
	newFile.addEventListener("click", () => startCreate(targetFolder(), false));
	newFolder.addEventListener("click", () => startCreate(targetFolder(), true));
	collapseAll.addEventListener("click", () => {
		expanded.clear();
		saveExpanded();
		renderTree();
	});
	// Shown while the pane is pointed at or has the focus, so the folder's name has room.
	for (const button of [newFile, newFolder, collapseAll, refreshButton]) {
		button.classList.add("files-hover-action");
	}
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
	const menu = el("div", { class: "files-menu", attrs: { role: "menu", hidden: "" } });

	const element = el("div", {
		class: "files-pane",
		children: [
			el("div", {
				class: "files-toolbar",
				children: [title, newFile, newFolder, collapseAll, openFolder, refreshButton, closeFolder],
			}),
			search,
			message,
			list,
			menu,
		],
	});

	function showMessage(text: string): void {
		message.textContent = text;
		message.hidden = text === "";
	}

	function saveExpanded(): void {
		try {
			localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded].slice(-MAX_REMEMBERED)));
		} catch {
			// Not remembered: the folders simply start closed next time.
		}
	}

	const isOpen = (row: Row): boolean =>
		row.isRoot ? !closedRoots.has(row.path) : expanded.has(row.path);

	function setOpen(row: Row, open: boolean): void {
		if (row.isRoot) {
			if (open) closedRoots.delete(row.path);
			else closedRoots.add(row.path);
		} else {
			if (open) expanded.add(row.path);
			else expanded.delete(row.path);
			saveExpanded();
		}
		renderTree();
	}

	/** The rows to show: closed folders hide what is below them. */
	function visibleRows(): Row[] {
		const roots = current?.roots ?? [];
		const several = roots.length > 1;
		const shown: Row[] = [];
		for (const root of roots) {
			const rootRow: Row = {
				path: root.path,
				name: fileName(root.path),
				folder: true,
				root,
				level: 0,
				isRoot: true,
				parent: null,
			};
			// One folder is named in the toolbar; several each get a heading row.
			if (several) {
				shown.push(rootRow);
				if (!isOpen(rootRow)) continue;
			}
			const shift = several ? 1 : 0;
			const parents: string[] = [];
			let hiddenBelow: number | null = null;
			for (const entry of root.entries) {
				parents.length = entry.depth;
				if (hiddenBelow !== null && entry.depth > hiddenBelow) continue;
				hiddenBelow = null;
				shown.push({
					path: entry.path,
					name: entry.name,
					folder: entry.folder,
					root,
					level: entry.depth + shift,
					isRoot: false,
					parent: parents[entry.depth - 1] ?? (several ? root.path : null),
				});
				if (entry.folder) {
					parents[entry.depth] = entry.path;
					if (!expanded.has(entry.path)) hiddenBelow = entry.depth;
				}
			}
		}
		return shown;
	}

	function renderTree(): void {
		hideMenu();
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
		for (const button of [refreshButton, newFile, newFolder, collapseAll]) {
			button.hidden = roots.length === 0;
		}
		search.disabled = roots.length === 0;

		if (roots.length === 0) {
			showMessage(t.noFolder);
			rows = [];
			return;
		}
		if (roots.every((root) => root.entries.length === 0) && !several && editing === null) {
			showMessage(t.folderEmpty);
		} else {
			const truncated = roots.find((root) => root.truncated);
			showMessage(
				truncated === undefined ? "" : format(t.folderTruncated, truncated.entries.length),
			);
		}

		rows = visibleRows();
		if (selected !== null && !rows.some((row) => row.path === selected)) selected = null;
		const active = options.activePath();
		const focusable = selected ?? rows.find((row) => row.path === active)?.path ?? rows[0]?.path;
		for (const row of rows) {
			const item = rowElement(row, row.path === active, row.path === focusable);
			list.append(item);
			// A new file or folder is named in a box right under its folder.
			if (editing?.kind === "create" && editing.parent === row.path) {
				list.append(newRow(row.level + 1, editing.folder));
			}
		}
		const creating = editing?.kind === "create" ? editing : null;
		if (creating !== null && !rows.some((row) => row.path === creating.parent)) {
			list.prepend(newRow(0, creating.folder));
		}
		list.querySelector<HTMLInputElement>(".files-rename")?.focus();
	}

	function rowElement(row: Row, active: boolean, focusable: boolean): HTMLElement {
		const open = row.folder && isOpen(row);
		const type = row.folder ? null : fileType(row.path);
		const renaming = editing?.kind === "rename" && editing.path === row.path;
		const item = el("div", {
			class: [
				"files-item",
				row.folder ? "files-folder" : `files-file files-${type?.opens}`,
				row.isRoot ? "files-root-name" : "",
				row.path === selected ? "selected" : "",
			]
				.filter(Boolean)
				.join(" "),
			attrs: {
				role: "treeitem",
				title: row.path,
				tabindex: focusable ? "0" : "-1",
				"data-path": row.path,
				"aria-level": String(row.level + 1),
				"aria-selected": String(row.path === selected),
				...(row.folder ? { "aria-expanded": String(open) } : {}),
				...(active ? { "aria-current": "page" } : {}),
			},
		});
		for (let level = 0; level < row.level; level++) {
			item.append(el("span", { class: "files-indent", attrs: { "aria-hidden": "true" } }));
		}
		const twisty = el("span", { class: "files-twisty", attrs: { "aria-hidden": "true" } });
		if (row.folder) twisty.append(icon("chevron"));
		const glyph = el("span", {
			class: `files-icon ${row.folder ? "tone-folder" : `tone-${type?.tone}`}`,
			children: [icon(row.folder ? (open ? "folderOpen" : "open") : (type?.icon ?? "file"))],
		});
		item.append(twisty, glyph);
		if (renaming) item.append(nameBox(row.name, (name) => commitRename(row, name)));
		else item.append(el("span", { class: "files-name", text: row.name }));
		if (row.isRoot && current?.opened === true) {
			const close = iconButton("close", format(t.closeThisFolder, row.name));
			close.classList.add("files-root-close");
			close.tabIndex = -1;
			close.addEventListener("click", (event) => {
				event.stopPropagation();
				bridge.closeFolder(row.path);
			});
			item.append(close);
		}

		item.addEventListener("click", (event) => {
			if (renaming) return;
			select(row.path, false);
			if (row.folder) {
				// The chevron, or the row: both open and close a folder.
				setOpen(row, !open);
				focusRow(row.path);
			} else if (event.detail <= 1) options.open(row.path);
		});
		// Focus from anywhere (the search box, a click, Tab) makes it the selected row.
		item.addEventListener("focus", () => {
			if (selected !== row.path) select(row.path, false);
		});
		item.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			select(row.path);
			showMenu(menuFor(row), event.clientX, event.clientY);
		});
		return item;
	}

	/** The inline box a new or renamed entry is named in. */
	function nameBox(value: string, commit: (name: string) => Promise<boolean>): HTMLInputElement {
		const input = el("input", {
			class: "files-rename",
			attrs: { type: "text", spellcheck: "false", "aria-label": t.filesRename },
		});
		input.value = value;
		let done = false;
		const finish = async (save: boolean): Promise<void> => {
			if (done) return;
			const name = input.value.trim();
			if (!save || name === "" || name === value) {
				done = true;
				editing = null;
				renderTree();
				focusRow(selected);
				return;
			}
			done = true;
			if (!(await commit(name))) {
				// The name was refused: keep the box, with what was typed.
				done = false;
				input.focus();
				input.select();
			}
		};
		input.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.key === "Enter") {
				event.preventDefault();
				void finish(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				void finish(false);
			}
		});
		input.addEventListener("blur", () => void finish(true));
		input.addEventListener("click", (event) => event.stopPropagation());
		// The name is selected without its extension, as in the file manager.
		queueMicrotask(() => {
			const dot = value.lastIndexOf(".");
			input.setSelectionRange(0, dot > 0 ? dot : value.length);
		});
		return input;
	}

	function newRow(level: number, folder: boolean): HTMLElement {
		const parent = editing?.kind === "create" ? editing.parent : "";
		const row = el("div", { class: "files-item files-new", attrs: { role: "none" } });
		for (let i = 0; i < level; i++) row.append(el("span", { class: "files-indent" }));
		row.append(
			el("span", { class: "files-twisty" }),
			el("span", {
				class: `files-icon ${folder ? "tone-folder" : "tone-markdown"}`,
				children: [icon(folder ? "open" : "file")],
			}),
			nameBox(folder ? t.filesNewFolderName : t.filesNewFileName, (name) =>
				commitCreate(parent, name, folder),
			),
		);
		return row;
	}

	// --- File operations ---

	const failed = (error: unknown): void => {
		const text = error instanceof Error ? error.message : String(error);
		options.notify(
			format(
				t.filesActionFailed,
				text.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
			),
		);
	};

	/** The folder new files go in: the selected folder, or the selected file's; else the first root. */
	function targetFolder(): string | null {
		const row = rows.find((candidate) => candidate.path === selected);
		if (row?.folder) return row.path;
		if (row !== undefined) return row.parent ?? row.root.path;
		return current?.roots[0]?.path ?? null;
	}

	function startCreate(parent: string | null, folder: boolean): void {
		if (parent === null) return;
		const row = rows.find((candidate) => candidate.path === parent);
		if (row !== undefined && !isOpen(row)) {
			if (row.isRoot) closedRoots.delete(row.path);
			else expanded.add(row.path);
		}
		editing = { kind: "create", parent, folder };
		if (search.value !== "") search.value = "";
		renderTree();
	}

	async function commitCreate(parent: string, name: string, folder: boolean): Promise<boolean> {
		try {
			const path = await bridge.createInWorkspace(parent, name, folder ? "folder" : "file");
			editing = null;
			selected = path;
			if (folder) expanded.add(path);
			await refresh();
			focusRow(path);
			if (!folder) options.open(path);
			return true;
		} catch (error) {
			failed(error);
			return false;
		}
	}

	function startRename(row: Row): void {
		if (row.isRoot) return;
		editing = { kind: "rename", path: row.path };
		renderTree();
	}

	async function commitRename(row: Row, name: string): Promise<boolean> {
		try {
			const path = await bridge.renameInWorkspace(row.path, name);
			editing = null;
			// What was open below a renamed folder stays open.
			for (const open of [...expanded]) {
				if (
					open === row.path ||
					open.startsWith(`${row.path}/`) ||
					open.startsWith(`${row.path}\\`)
				) {
					expanded.delete(open);
					expanded.add(path + open.slice(row.path.length));
				}
			}
			saveExpanded();
			selected = path;
			await refresh();
			focusRow(path);
			return true;
		} catch (error) {
			failed(error);
			return false;
		}
	}

	async function trash(row: Row): Promise<void> {
		if (row.isRoot) return;
		const index = rows.indexOf(row);
		try {
			if (!(await bridge.trashInWorkspace(row.path))) return;
			selected = rows[index + 1]?.path ?? rows[index - 1]?.path ?? null;
			await refresh();
			focusRow(selected);
		} catch (error) {
			failed(error);
		}
	}

	function relativePath(row: Row): string {
		const root = row.root.path;
		const inside = row.path
			.slice(root.length)
			.replace(/^[\\/]/, "")
			.replace(/\\/g, "/");
		return inside === "" ? fileName(root) : inside;
	}

	function copy(text: string): void {
		void navigator.clipboard.writeText(text).catch(failed);
	}

	// --- Context menu ---

	function menuFor(row: Row): (MenuItem | null)[] {
		const parent = row.folder ? row.path : (row.parent ?? row.root.path);
		const items: (MenuItem | null)[] = [];
		if (!row.folder) {
			items.push({ label: t.filesOpen, run: () => options.open(row.path), shortcut: "Enter" });
			items.push({
				label: t.filesOpenWithSystem,
				run: () => void bridge.openWithSystem(row.path).catch(failed),
			});
			items.push(null);
		}
		items.push(
			{ label: t.filesNewFile, run: () => startCreate(parent, false) },
			{ label: t.filesNewFolder, run: () => startCreate(parent, true) },
		);
		if (!row.isRoot) {
			items.push(
				null,
				{ label: t.filesRename, run: () => startRename(row), shortcut: "F2" },
				{ label: t.filesDelete, run: () => void trash(row), shortcut: "Del", danger: true },
			);
		}
		items.push(
			null,
			{ label: t.filesCopyPath, run: () => copy(row.path) },
			{ label: t.filesCopyRelativePath, run: () => copy(relativePath(row)) },
			{ label: t.filesReveal, run: () => bridge.revealInFolder(row.path) },
		);
		if (row.isRoot && current?.opened === true) {
			items.push(null, {
				label: format(t.closeThisFolder, row.name),
				run: () => bridge.closeFolder(row.path),
			});
		}
		return items;
	}

	let menuReturn: string | null = null;

	function showMenu(items: readonly (MenuItem | null)[], x: number, y: number): void {
		menuReturn = selected;
		menu.replaceChildren(
			...items.map((item) => {
				if (item === null)
					return el("div", { class: "files-menu-separator", attrs: { role: "separator" } });
				const button = el("button", {
					class: `files-menu-item${item.danger === true ? " danger" : ""}`,
					attrs: { type: "button", role: "menuitem", tabindex: "-1" },
					children: [
						el("span", { text: item.label }),
						el("span", { class: "files-menu-shortcut", text: item.shortcut ?? "" }),
					],
				});
				button.addEventListener("click", () => {
					hideMenu(false);
					item.run();
				});
				return button;
			}),
		);
		menu.hidden = false;
		// Inside the window, next to the pointer.
		const box = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
		menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
		menu.querySelector<HTMLElement>(".files-menu-item")?.focus();
	}

	function hideMenu(refocus = true): void {
		if (menu.hidden) return;
		menu.hidden = true;
		if (stale && editing === null) {
			stale = false;
			renderTree();
		}
		if (refocus) focusRow(menuReturn);
	}

	menu.addEventListener("keydown", (event) => {
		const items = [...menu.querySelectorAll<HTMLElement>(".files-menu-item")];
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			items[(at + step + items.length) % items.length]?.focus();
		} else if (event.key === "Escape" || event.key === "Tab") {
			event.preventDefault();
			hideMenu();
		}
	});
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (!menu.hidden && !menu.contains(event.target as Node)) hideMenu(false);
		},
		true,
	);
	window.addEventListener("blur", () => hideMenu(false));
	// Scrolling by hand closes it; the list scrolling to the clicked row does not.
	list.addEventListener("wheel", () => hideMenu(false), { passive: true });
	// The empty part of the list: new files go in the first folder.
	list.addEventListener("contextmenu", (event) => {
		if (event.target !== list) return;
		event.preventDefault();
		const root = current?.roots[0];
		if (root === undefined) return;
		showMenu(
			[
				{ label: t.filesNewFile, run: () => startCreate(root.path, false) },
				{ label: t.filesNewFolder, run: () => startCreate(root.path, true) },
				null,
				{ label: t.filesCollapseAll, run: () => collapseAll.click() },
			],
			event.clientX,
			event.clientY,
		);
	});

	// --- Keyboard ---

	function select(path: string | null, focus = true): void {
		selected = path;
		for (const item of list.querySelectorAll<HTMLElement>(".files-item[data-path]")) {
			const on = item.dataset.path === path;
			item.classList.toggle("selected", on);
			item.setAttribute("aria-selected", String(on));
			item.tabIndex = on ? 0 : -1;
		}
		if (focus) focusRow(path);
	}

	function focusRow(path: string | null): void {
		if (path === null) return;
		const item = [...list.querySelectorAll<HTMLElement>(".files-item[data-path]")].find(
			(candidate) => candidate.dataset.path === path,
		);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView({ block: "nearest" });
	}

	list.addEventListener("keydown", (event) => {
		if (list.getAttribute("role") !== "tree" || editing !== null) return;
		const index = rows.findIndex((row) => row.path === selected);
		const row = rows[index];
		const move = (to: number): void => {
			const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
			if (target !== undefined) select(target.path);
		};
		switch (event.key) {
			case "ArrowDown":
				move(index + 1);
				break;
			case "ArrowUp":
				move(index === -1 ? 0 : index - 1);
				break;
			case "Home":
				move(0);
				break;
			case "End":
				move(rows.length - 1);
				break;
			case "ArrowRight":
				if (row?.folder && !isOpen(row)) setOpen(row, true);
				else if (row?.folder) move(index + 1);
				else return;
				focusRow(selected);
				break;
			case "ArrowLeft":
				if (row?.folder && isOpen(row)) {
					setOpen(row, false);
					focusRow(selected);
				} else if (row?.parent != null) select(row.parent);
				else return;
				break;
			case "Enter":
				if (row === undefined) return;
				if (row.folder) {
					setOpen(row, !isOpen(row));
					focusRow(row.path);
				} else options.open(row.path);
				break;
			case "F2":
				if (row === undefined) return;
				startRename(row);
				break;
			case "Delete":
				if (row === undefined) return;
				void trash(row);
				break;
			case "ContextMenu":
				if (row === undefined) return;
				showMenuAt(row);
				break;
			default:
				if (event.key === "F10" && event.shiftKey && row !== undefined) {
					showMenuAt(row);
					break;
				}
				return;
		}
		event.preventDefault();
	});

	function showMenuAt(row: Row): void {
		const item = list.querySelector<HTMLElement>(".files-item.selected");
		const box = item?.getBoundingClientRect();
		showMenu(menuFor(row), (box?.left ?? 0) + 24, (box?.bottom ?? 0) - 4);
	}

	// --- Search: file names first, then lines in the files ---

	function nameMatches(query: string): { path: string; name: string; relative: string }[] {
		const needle = query.toLocaleLowerCase(options.lang);
		const roots = current?.roots ?? [];
		const found: { path: string; name: string; relative: string }[] = [];
		for (const root of roots) {
			for (const entry of root.entries) {
				if (entry.folder || !entry.name.toLocaleLowerCase(options.lang).includes(needle)) continue;
				const inside = entry.path
					.slice(root.path.length)
					.replace(/^[\\/]/, "")
					.replace(/\\/g, "/");
				found.push({
					path: entry.path,
					name: entry.name,
					relative: roots.length > 1 ? `${fileName(root.path)}/${inside}` : inside,
				});
				if (found.length >= MAX_NAME_MATCHES) return found;
			}
		}
		return found;
	}

	async function runSearch(query: string): Promise<void> {
		const token = ++searchToken;
		const result = await bridge.searchWorkspace(query);
		if (token !== searchToken) return;

		hideMenu(false);
		list.replaceChildren();
		list.setAttribute("role", "list");
		const names = nameMatches(query);
		if (result.hits.length === 0 && names.length === 0) {
			showMessage(t.searchNoHits);
			return;
		}
		const files = new Map<string, SearchHit[]>();
		for (const hit of result.hits) files.set(hit.path, [...(files.get(hit.path) ?? []), hit]);
		showMessage(
			result.truncated
				? format(t.searchTruncated, result.hits.length)
				: result.hits.length === 0
					? ""
					: format(t.searchHits, result.hits.length, files.size),
		);

		if (names.length > 0) {
			const group = el("div", {
				class: "search-names",
				attrs: { role: "listitem" },
				children: [el("div", { class: "search-group-title", text: t.filesNameMatches })],
			});
			for (const match of names) {
				const type = fileType(match.path);
				const button = el("button", {
					class: "search-name",
					attrs: { type: "button", title: match.path, "data-path": match.path },
					children: [
						el("span", { class: `files-icon tone-${type.tone}`, children: [icon(type.icon)] }),
						markedName(match.name, query, options.lang),
						el("span", {
							class: "search-name-folder",
							text: match.relative.slice(0, -match.name.length).replace(/\/$/, ""),
						}),
					],
				});
				button.addEventListener("click", () => options.open(match.path));
				group.append(button);
			}
			list.append(group);
		}
		if (files.size > 0 && names.length > 0) {
			list.append(el("div", { class: "search-group-title", text: t.filesContentMatches }));
		}
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
		} else if (event.key === "ArrowDown" && search.value === "") {
			event.preventDefault();
			focusRow(selected ?? rows[0]?.path ?? null);
		}
	});

	/** Opens the folders above the active document, so it is in sight; `true` when any was opened. */
	function revealActive(): boolean {
		const active = options.activePath();
		if (active === null || active === lastActive) return false;
		lastActive = active;
		let opened = false;
		for (const root of current?.roots ?? []) {
			const entry = root.entries.find((candidate) => candidate.path === active);
			if (entry === undefined) continue;
			// The folders above it are the entries before it with a smaller depth.
			let depth = entry.depth;
			for (let i = root.entries.indexOf(entry) - 1; i >= 0 && depth > 0; i--) {
				const above = root.entries[i] as WorkspaceEntry;
				if (!above.folder || above.depth >= depth) continue;
				depth = above.depth;
				if (!expanded.has(above.path)) {
					expanded.add(above.path);
					opened = true;
				}
			}
			if (closedRoots.delete(root.path)) opened = true;
		}
		if (opened) saveExpanded();
		return opened;
	}

	function scrollToActive(): void {
		const active = options.activePath();
		const item = [...list.querySelectorAll<HTMLElement>(".files-item[data-path]")].find(
			(candidate) => candidate.dataset.path === active,
		);
		item?.scrollIntoView({ block: "nearest" });
	}

	async function refresh(): Promise<void> {
		current = await bridge.getWorkspace();
		// Folders change under an open menu or a name being typed (a save, the watcher): not now.
		if (!menu.hidden || editing !== null) {
			stale = true;
			return;
		}
		stale = false;
		revealActive();
		if (search.value.trim() === "") {
			renderTree();
			scrollToActive();
		} else await runSearch(search.value.trim());
	}

	return {
		element,
		refresh,
		focusSearch: () => {
			search.focus();
			search.select();
		},
		highlightActive: () => {
			if (search.value.trim() === "" && editing === null && revealActive()) {
				renderTree();
				scrollToActive();
				return;
			}
			const active = options.activePath();
			for (const item of list.querySelectorAll<HTMLElement>(".files-item[data-path]")) {
				if (item.dataset.path === active) item.setAttribute("aria-current", "page");
				else item.removeAttribute("aria-current");
			}
			scrollToActive();
		},
		workspace: () => current,
	};
}
