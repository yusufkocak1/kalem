import type {
	ConfluenceAccount,
	ConfluenceFavorite,
	ConfluencePageSummary,
	ConfluenceSpace,
	ConfluenceTreePage,
	ConfluenceTreeParent,
	KalemBridge,
} from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface ConfluencePaneOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	/** The space listed when the pane opens; empty for all spaces. */
	space(): string;
	/** Remembers the chosen space as the default. */
	setSpace(key: string): void;
	/** Starred pages of every site. */
	favorites(): readonly ConfluenceFavorite[];
	setFavorites(favorites: readonly ConfluenceFavorite[]): void;
	/** The Confluence page id of the active tab, if it is one. */
	activePage(): string | null;
	/** Opens the login dialog. */
	connect(): void;
}

export interface ConfluencePane {
	readonly element: HTMLElement;
	/** Reconnects and lists the pages again. */
	refresh(): Promise<void>;
	/** Marks the active page without listing again. */
	highlightActive(): void;
	/** Shows favorites changed in another window. */
	render(): void;
}

const SEARCH_DELAY = 300;

/** A level of the tree: a space's top-level pages (`s:KEY`) or a page's children (`p:ID`). */
type Level =
	| { readonly status: "loading" }
	| { readonly status: "done"; readonly pages: readonly ConfluenceTreePage[] }
	| { readonly status: "error"; readonly message: string };

const spaceLevel = (key: string): string => `s:${key}`;
const pageLevel = (id: string): string => `p:${id}`;

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/**
 * The side pane's Confluence tab: starred pages, then the chosen space's page
 * tree (or every space as a branch), or title search results while there is
 * a query.
 */
export function createConfluencePane(options: ConfluencePaneOptions): ConfluencePane {
	const { t, bridge } = options;
	let account: ConfluenceAccount | null = null;
	let spaces: readonly ConfluenceSpace[] = [];
	/** Spaces are listed once per connection. */
	let spacesOf: string | null = null;
	/** Search results; `null` when there is no query and the tree is shown. */
	let results: readonly ConfluencePageSummary[] | null = null;
	const levels = new Map<string, Level>();
	const expanded = new Set<string>();
	/** Answers to requests made before a refresh are dropped. */
	let generation = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchId = 0;

	const title = el("span", { class: "confluence-pane-title" });
	const refreshButton = el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": t.refresh, title: t.refresh },
		children: [icon("refresh")],
	});
	refreshButton.addEventListener("click", () => void refresh());

	const space = el("select", {
		class: "confluence-pane-space",
		attrs: { "aria-label": t.confluencePickSpace, title: t.confluencePickSpace },
	});
	const search = el("input", {
		class: "confluence-pane-search",
		attrs: {
			type: "search",
			placeholder: t.confluenceSearchPlaceholder,
			"aria-label": t.confluenceSearchPlaceholder,
		},
	});
	const message = el("p", { class: "confluence-pane-message" });
	const connectButton = el("button", {
		class: "confluence-primary confluence-pane-connect",
		text: t.confluenceConnect,
		attrs: { type: "button" },
	});
	connectButton.addEventListener("click", () => options.connect());
	const list = el("div", {
		class: "confluence-pane-list",
		attrs: { role: "tree", "aria-label": t.confluenceTab },
	});

	const element = el("div", {
		class: "confluence-pane",
		children: [
			el("div", { class: "confluence-pane-toolbar", children: [title, refreshButton] }),
			space,
			search,
			message,
			connectButton,
			list,
		],
	});

	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "medium" });
	const describe = (page: ConfluencePageSummary): string => {
		const date = page.modified === null ? null : new Date(page.modified);
		const when = date === null || Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
		// The space is shown only when the results span spaces.
		return [space.value === "" ? page.spaceName : "", when]
			.filter((part) => part !== "")
			.join(" · ");
	};

	function showMessage(text: string): void {
		message.textContent = text;
		message.hidden = text === "";
	}

	function showSignedIn(signedIn: boolean): void {
		connectButton.hidden = signedIn;
		space.hidden = !signedIn;
		search.hidden = !signedIn;
		refreshButton.hidden = !signedIn;
	}

	// --- Favorites -----------------------------------------------------------

	const siteFavorites = (): ConfluenceFavorite[] =>
		account === null ? [] : options.favorites().filter((item) => item.site === account?.site);
	const isFavorite = (id: string): boolean => siteFavorites().some((item) => item.id === id);

	function toggleFavorite(page: { readonly id: string; readonly title: string }): void {
		if (account === null) return;
		const site = account.site;
		const all = options.favorites();
		const starred = all.some((item) => item.site === site && item.id === page.id);
		options.setFavorites(
			starred
				? all.filter((item) => !(item.site === site && item.id === page.id))
				: [...all, { site, id: page.id, title: page.title }],
		);
		render();
	}

	// --- Rows ----------------------------------------------------------------

	function starButton(page: { readonly id: string; readonly title: string }): HTMLElement {
		const starred = isFavorite(page.id);
		const label = starred ? t.confluenceRemoveFavorite : t.confluenceAddFavorite;
		const button = el("button", {
			class: "icon-button confluence-star",
			attrs: { type: "button", "aria-label": label, title: label, "aria-pressed": String(starred) },
			children: [icon("star")],
		});
		button.addEventListener("click", () => toggleFavorite(page));
		return button;
	}

	/** A twisty for a branch, or a spacer that keeps leaves aligned. */
	function twisty(key: string | null, label: string): HTMLElement {
		if (key === null) return el("span", { class: "confluence-twisty" });
		const open = expanded.has(key);
		const button = el("button", {
			class: "confluence-twisty",
			text: open ? "▾" : "▸",
			attrs: {
				type: "button",
				tabindex: "-1",
				"aria-hidden": "true",
				"data-twisty": label,
			},
		});
		button.addEventListener("click", () => toggle(key));
		return button;
	}

	interface RowOptions {
		readonly depth: number;
		/** The level this row expands to, when it can have children. */
		readonly branch: string | null;
		readonly title: string;
		readonly meta?: string;
		/** A page (opened on click, can be starred) or a space (expands on click). */
		readonly page: string | null;
	}

	function row(row: RowOptions): HTMLElement {
		const active = row.page !== null && row.page === options.activePage();
		const open = row.branch !== null && expanded.has(row.branch);
		const main = el("button", {
			class: "confluence-row-main",
			attrs: { type: "button", title: row.title },
			children: [
				icon(row.page === null ? "open" : "file"),
				el("span", {
					class: "confluence-page-text",
					children: [
						el("span", { class: "confluence-page-title", text: row.title }),
						...(row.meta === undefined || row.meta === ""
							? []
							: [el("span", { class: "confluence-page-meta", text: row.meta })]),
					],
				}),
			],
		});
		const page = row.page;
		if (page === null) {
			main.addEventListener("click", () => {
				if (row.branch !== null) toggle(row.branch);
			});
		} else {
			main.addEventListener("click", () => void openPage(page));
		}
		const item = el("div", {
			class: "confluence-page-item",
			attrs: {
				role: "treeitem",
				...(page === null ? { "data-space": row.title } : { "data-page": page }),
				...(row.branch === null ? {} : { "aria-expanded": String(open) }),
				...(active ? { "aria-current": "page" } : {}),
			},
			children: [
				twisty(row.branch, row.title),
				main,
				...(page === null ? [] : [starButton({ id: page, title: row.title })]),
			],
		});
		item.style.setProperty("--depth", String(row.depth));
		return item;
	}

	function note(text: string, depth: number): HTMLElement {
		const item = el("p", { class: "confluence-tree-note", text });
		item.style.setProperty("--depth", String(depth));
		return item;
	}

	// --- Tree ----------------------------------------------------------------

	function load(key: string): void {
		if (levels.has(key)) return;
		levels.set(key, { status: "loading" });
		const asked = generation;
		const parent: ConfluenceTreeParent = key.startsWith("s:")
			? { space: key.slice(2) }
			: { page: key.slice(2) };
		bridge
			.confluenceTree(parent)
			.then((pages): Level => ({ status: "done", pages }))
			.catch((error: unknown): Level => ({ status: "error", message: errorText(error) }))
			.then((level) => {
				if (asked !== generation) return;
				levels.set(key, level);
				render();
			});
	}

	function toggle(key: string): void {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
		render();
	}

	/** The rows of a level and, below each expanded page, its own level. */
	function levelRows(key: string, depth: number): HTMLElement[] {
		load(key);
		const level = levels.get(key);
		if (level === undefined || level.status === "loading")
			return [note(t.confluenceLoading, depth)];
		if (level.status === "error") {
			return [note(format(t.confluenceRequestFailed, level.message), depth)];
		}
		if (level.pages.length === 0) return depth === 0 ? [note(t.confluenceNoPages, depth)] : [];
		return level.pages.flatMap((page) => {
			const branch = pageLevel(page.id);
			const childLevel = levels.get(branch);
			// Cloud does not say whether a page has children; an empty answer settles it.
			const leaf =
				page.hasChildren === false ||
				(childLevel?.status === "done" && childLevel.pages.length === 0);
			const rows = [row({ depth, branch: leaf ? null : branch, title: page.title, page: page.id })];
			if (!leaf && expanded.has(branch)) rows.push(...levelRows(branch, depth + 1));
			return rows;
		});
	}

	function treeRows(): HTMLElement[] {
		if (space.value !== "") return levelRows(spaceLevel(space.value), 0);
		if (spaces.length === 0) return [note(t.confluenceNoPages, 0)];
		return spaces.flatMap((item) => {
			const branch = spaceLevel(item.key);
			const rows = [row({ depth: 0, branch, title: item.name, page: null })];
			if (expanded.has(branch)) rows.push(...levelRows(branch, 1));
			return rows;
		});
	}

	// --- Rendering -----------------------------------------------------------

	function heading(text: string): HTMLElement {
		return el("div", { class: "confluence-section", text, attrs: { role: "presentation" } });
	}

	function render(): void {
		if (account === null) {
			list.replaceChildren();
			return;
		}
		const favorites = siteFavorites();
		const favoriteRows = favorites.map((item) =>
			row({ depth: 0, branch: null, title: item.title, page: item.id }),
		);
		const body =
			results === null
				? treeRows()
				: results.map((page) =>
						row({ depth: 0, branch: null, title: page.title, meta: describe(page), page: page.id }),
					);
		list.replaceChildren(
			...(favorites.length === 0
				? body
				: [
						heading(t.confluenceFavorites),
						...favoriteRows,
						heading(t.confluencePaneTree),
						...body,
					]),
		);
	}

	function highlightActive(): void {
		const active = options.activePage();
		for (const item of list.querySelectorAll<HTMLElement>(".confluence-page-item")) {
			if (item.dataset.page !== undefined && item.dataset.page === active) {
				item.setAttribute("aria-current", "page");
			} else {
				item.removeAttribute("aria-current");
			}
		}
	}

	async function openPage(id: string): Promise<void> {
		showMessage(t.confluenceLoading);
		try {
			await bridge.confluenceOpenPage(id);
			showMessage("");
			// The tab may become active just after the answer arrives.
			requestAnimationFrame(() => highlightActive());
		} catch (error) {
			showMessage(`${t.confluenceOpenFailed}: ${errorText(error)}`);
		}
	}

	function fillSpaces(list: readonly ConfluenceSpace[]): void {
		spaces = list;
		const chosen = options.space();
		space.replaceChildren(
			el("option", { text: t.confluenceAllSpaces, attrs: { value: "" } }),
			...list.map((item) =>
				el("option", { text: `${item.name} (${item.key})`, attrs: { value: item.key } }),
			),
		);
		// A default space that is gone (or not visible to this login) falls back to all spaces.
		space.value = list.some((item) => item.key === chosen) ? chosen : "";
	}

	async function runSearch(): Promise<void> {
		const query = search.value.trim();
		const id = ++searchId;
		if (query === "") {
			results = null;
			showMessage("");
			render();
			return;
		}
		showMessage(t.confluenceLoading);
		try {
			const found = await bridge.confluenceSearch(query, space.value === "" ? null : space.value);
			if (id !== searchId) return;
			results = found;
			showMessage(found.length === 0 ? t.confluenceNoPages : "");
		} catch (error) {
			if (id !== searchId) return;
			results = [];
			showMessage(format(t.confluenceRequestFailed, errorText(error)));
		}
		render();
	}

	async function refresh(): Promise<void> {
		const asked = ++generation;
		levels.clear();
		account = await bridge.confluenceAccount().catch(() => null);
		if (asked !== generation) return;
		title.textContent = account?.site.replace(/^https?:\/\//, "") ?? "";
		title.title = account?.site ?? "";
		if (account === null) {
			spacesOf = null;
			showSignedIn(false);
			showMessage(t.confluenceNotConnected);
			render();
			return;
		}
		showSignedIn(true);
		const key = `${account.site}\n${account.username}`;
		if (spacesOf !== key) {
			expanded.clear();
			showMessage(t.confluenceLoading);
			try {
				fillSpaces(await bridge.confluenceSpaces());
				spacesOf = key;
			} catch {
				// Search still works across all spaces.
				fillSpaces([]);
			}
			if (asked !== generation) return;
		}
		showMessage("");
		await runSearch();
	}

	space.addEventListener("change", () => {
		options.setSpace(space.value);
		void runSearch();
	});
	search.addEventListener("input", () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void runSearch(), SEARCH_DELAY);
	});
	search.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			clearTimeout(searchTimer);
			void runSearch();
		} else if (event.key === "Escape" && search.value !== "") {
			event.stopPropagation();
			search.value = "";
			void runSearch();
		}
	});

	showSignedIn(false);
	return { element, refresh, highlightActive, render };
}
