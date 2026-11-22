import type { RemotePage, Workspace, WorkspaceEntry } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { fileName } from "../shared/paths.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

/** One part of where the document is: a folder, or the document itself. */
export interface PathSegment {
	readonly label: string;
	/** The folder whose files a click lists: the segment's own, or the document's for the document. */
	readonly folder: string | null;
	/** The document itself, the last part. */
	readonly current: boolean;
}

function separator(path: string): string {
	return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function trimEnd(path: string): string {
	return path.replace(/[\\/]+$/, "");
}

/** The folder a path is in. */
export function parentOf(path: string): string {
	const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return at <= 0 ? path.slice(0, at + 1) : path.slice(0, at);
}

/**
 * Where a document is, from the workspace folder it is in: the folder's
 * name, the folders under it, then the document. A document outside the
 * workspace: its folder, then it. A Confluence page: its space, then it.
 */
export function pathSegments(
	path: string | null,
	remote: Pick<RemotePage, "spaceKey" | "title"> | null,
	workspace: Workspace | null,
): PathSegment[] {
	if (remote !== null) {
		return [
			{ label: remote.spaceKey, folder: null, current: false },
			{ label: remote.title, folder: null, current: true },
		];
	}
	if (path === null) return [];
	const sep = separator(path);
	const roots = [...(workspace?.roots ?? [])]
		.map((root) => trimEnd(root.path))
		.filter((root) => path.startsWith(root + sep))
		// The deepest folder that holds it.
		.sort((a, b) => b.length - a.length);
	const root = roots[0];
	const document: PathSegment = { label: fileName(path), folder: parentOf(path), current: true };
	if (root === undefined) {
		const folder = parentOf(path);
		return [{ label: fileName(folder) || folder, folder: null, current: false }, document];
	}
	const parts = path.slice(root.length + 1).split(/[\\/]/);
	parts.pop();
	const segments: PathSegment[] = [{ label: fileName(root) || root, folder: root, current: false }];
	let at = root;
	for (const part of parts) {
		at = `${at}${sep}${part}`;
		segments.push({ label: part, folder: at, current: false });
	}
	segments.push(document);
	return segments;
}

/** What is in a folder of the workspace, folders first, each group by name. */
export function folderEntries(
	workspace: Workspace,
	folder: string,
	lang: string,
): readonly WorkspaceEntry[] {
	const entries = workspace.roots.flatMap((root) =>
		root.entries.filter((entry) => parentOf(entry.path) === folder),
	);
	const collator = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
	return entries.sort(
		(a, b) => Number(b.folder) - Number(a.folder) || collator.compare(a.name, b.name),
	);
}

export interface PathBarOptions {
	readonly t: Strings;
	readonly lang: string;
	/** The active document's path and page; `null` path for one never saved. */
	where(): { readonly path: string | null; readonly remote: RemotePage | null } | null;
	workspace(): Promise<Workspace>;
	open(path: string): void;
}

export interface PathBar {
	readonly element: HTMLElement;
	/** The document or the workspace changed. */
	refresh(): void;
	/** The page scrolled: the bar is only there at its top. */
	scrolled(scrollTop: number): void;
}

/**
 * Where the active document is, above its page: `project › specs ›
 * payment.md`. A folder's part lists what is in it, a click on a folder
 * there goes into it, and a click on a file opens it.
 */
export function createPathBar(options: PathBarOptions): PathBar {
	const { t } = options;
	const list = el("ol", { class: "path-bar-list" });
	const element = el("nav", {
		class: "path-bar",
		attrs: { "aria-label": t.pathBar, hidden: "" },
		children: [list],
	});
	const menu = el("div", {
		class: "path-bar-menu",
		attrs: { role: "menu", hidden: "" },
	});
	document.body.append(menu);
	let workspace: Workspace | null = null;
	let opener: HTMLButtonElement | null = null;
	let generation = 0;

	function closeMenu(focus = false): void {
		if (menu.hidden) return;
		menu.hidden = true;
		opener?.setAttribute("aria-expanded", "false");
		if (focus) opener?.focus();
		opener = null;
	}

	function fill(folder: string): void {
		if (workspace === null) return;
		const current = options.where()?.path ?? null;
		const items = folderEntries(workspace, folder, options.lang).map((entry) => {
			const item = el("button", {
				class: "path-bar-item",
				attrs: {
					type: "button",
					role: "menuitem",
					...(entry.path === current ? { "aria-current": "page" } : {}),
				},
				children: [icon(entry.folder ? "open" : "file"), el("span", { text: entry.name })],
			});
			item.addEventListener("click", () => {
				if (entry.folder) {
					fill(entry.path);
					return;
				}
				closeMenu();
				options.open(entry.path);
			});
			return item;
		});
		menu.setAttribute("aria-label", fileName(folder) || folder);
		menu.replaceChildren(
			...(items.length > 0 ? items : [el("p", { class: "path-bar-empty", text: t.pathBarEmpty })]),
		);
		(menu.querySelector<HTMLElement>("[aria-current]") ?? menu.querySelector("button"))?.focus();
	}

	function openMenu(button: HTMLButtonElement, folder: string): void {
		closeMenu();
		opener = button;
		button.setAttribute("aria-expanded", "true");
		menu.hidden = false;
		const box = button.getBoundingClientRect();
		menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - 284))}px`;
		menu.style.top = `${box.bottom + 4}px`;
		fill(folder);
	}

	menu.addEventListener("keydown", (event) => {
		const items = [...menu.querySelectorAll<HTMLButtonElement>(".path-bar-item")];
		const at = items.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === "Escape") {
			event.preventDefault();
			closeMenu(true);
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			items[(at + step + items.length) % items.length]?.focus();
		}
	});
	document.addEventListener(
		"mousedown",
		(event) => {
			const target = event.target as Node;
			if (menu.contains(target) || opener?.contains(target) === true) return;
			closeMenu();
		},
		true,
	);
	window.addEventListener("resize", () => closeMenu());

	function draw(): void {
		const where = options.where();
		const segments = where === null ? [] : pathSegments(where.path, where.remote, workspace);
		element.hidden = segments.length === 0;
		list.replaceChildren(
			...segments.map((segment) => {
				const item = el("li", { class: "path-bar-part" });
				if (segment.folder === null) {
					item.append(
						el("span", {
							class: "path-bar-label",
							text: segment.label,
							attrs: segment.current ? { "aria-current": "page" } : {},
						}),
					);
					return item;
				}
				const folder = segment.folder;
				const button = el("button", {
					class: "path-bar-button",
					text: segment.label,
					attrs: {
						type: "button",
						"aria-haspopup": "menu",
						"aria-expanded": "false",
						...(segment.current ? { "aria-current": "page" } : {}),
					},
				});
				button.addEventListener("click", () =>
					opener === button ? closeMenu() : openMenu(button, folder),
				);
				item.append(button);
				return item;
			}),
		);
	}

	return {
		element,
		refresh() {
			closeMenu();
			draw();
			const mine = ++generation;
			void options.workspace().then(
				(found) => {
					if (mine !== generation) return;
					workspace = found;
					draw();
				},
				() => undefined,
			);
		},
		scrolled(scrollTop) {
			element.toggleAttribute("data-away", scrollTop > 6);
			if (scrollTop > 6) closeMenu();
		},
	};
}
