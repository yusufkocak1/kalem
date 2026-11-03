import type {
	ConfluenceAccount,
	ConfluenceFavorite,
	ConfluenceSpace,
	ConfluenceTreePage,
	ConfluenceTreeParent,
	KalemBridge,
} from "../shared/bridge.js";
import type {
	ConfluenceSearchHit,
	ConfluenceSearchRequest,
	SearchMode,
	SearchPeriod,
	SearchSort,
	TextPart,
} from "../shared/confluence-search.js";
import { DEFAULT_SEARCH, hasCriteria, markWords } from "../shared/confluence-search.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
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
	/** The space of the active tab's Confluence page, if it is one. */
	activeSpace?(): string | null;
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
	| { readonly status: "loading"; readonly done: Promise<void> }
	| { readonly status: "done"; readonly pages: readonly ConfluenceTreePage[] }
	| { readonly status: "error"; readonly message: string };

const spaceLevel = (key: string): string => `s:${key}`;
const pageLevel = (id: string): string => `p:${id}`;

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Search results; the next ones are asked for with `next`. */
interface Results {
	readonly hits: readonly ConfluenceSearchHit[];
	readonly total: number | null;
	readonly next: string | null;
	/** What was searched for, to mark the words of a title search. */
	readonly query: string;
}

/**
 * The side pane's Confluence tab: starred pages, then the chosen space's page
 * tree (or every space as a branch), or search results while there is a
 * query or a filter. Search looks in titles or inside the pages, with
 * filters, the text around what was found and each page's place.
 */
export function createConfluencePane(options: ConfluencePaneOptions): ConfluencePane {
	const { t, bridge } = options;
	let account: ConfluenceAccount | null = null;
	let spaces: readonly ConfluenceSpace[] = [];
	/** Spaces are listed once per connection. */
	let spacesOf: string | null = null;
	/** Search results; `null` when nothing is searched for and the tree is shown. */
	let results: Results | null = null;
	let loadingMore = false;
	const levels = new Map<string, Level>();
	const expanded = new Set<string>();
	/** Answers to requests made before a refresh are dropped. */
	let generation = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchId = 0;
	/** How the search box searches; kept while the app runs. */
	let mode: SearchMode = DEFAULT_SEARCH.mode;
	let sort: SearchSort = DEFAULT_SEARCH.sort;
	let period: SearchPeriod = DEFAULT_SEARCH.period;
	let mine = false;
	/** Searching below a page of the tree. */
	let under: { readonly id: string; readonly title: string } | null = null;
	/** The tree row that has the keyboard focus, by its key. */
	let focusKey: string | null = null;
	/**
	 * A new page being named: the title box shows at the top of `level`.
	 * The box is one element for the whole naming, so a level arriving
	 * while the user types re-renders the tree without losing the text.
	 */
	let creating: {
		readonly level: string;
		readonly space: string;
		readonly parent: string | null;
		readonly input: HTMLInputElement;
	} | null = null;

	function toolButton(name: IconName, label: string): HTMLButtonElement {
		return el("button", {
			class: "icon-button",
			attrs: { type: "button", "aria-label": label, title: label },
			children: [icon(name)],
		});
	}

	const title = el("span", { class: "confluence-pane-title" });
	const refreshButton = toolButton("refresh", t.refresh);
	refreshButton.addEventListener("click", () => void refresh());
	const newPageButton = toolButton("new", t.confluenceNewPage);
	newPageButton.addEventListener("click", () => startCreate(space.value, null));
	const locateButton = toolButton("target", t.confluenceLocate);
	locateButton.addEventListener("click", () => void locateActive());
	const collapseButton = toolButton("collapse", t.confluenceCollapseAll);
	collapseButton.addEventListener("click", () => {
		expanded.clear();
		render();
	});

	const space = el("select", {
		class: "confluence-pane-space",
		attrs: { "aria-label": t.confluencePickSpace, title: t.confluencePickSpace },
	});

	// --- Search box, mode and filters -------------------------------------------

	const search = el("input", {
		class: "confluence-pane-search",
		attrs: { type: "search", autocomplete: "off", spellcheck: "false" },
	});
	const filterButton = el("button", {
		class: "icon-button confluence-filter-button",
		attrs: {
			type: "button",
			"aria-label": t.confluenceFilters,
			title: t.confluenceFilters,
			"aria-expanded": "false",
			"aria-controls": "confluence-filters",
		},
		children: [icon("filter"), el("span", { class: "confluence-filter-count" })],
	});
	const filterCount = filterButton.lastElementChild as HTMLElement;
	filterButton.addEventListener("click", () => {
		filters.hidden = !filters.hidden;
		filterButton.setAttribute("aria-expanded", String(!filters.hidden));
	});

	/** A row of mutually exclusive choices, as pressed buttons. */
	function choices<T extends string>(
		label: string,
		items: readonly (readonly [T, string])[],
		current: () => T,
		pick: (value: T) => void,
		className = "confluence-choices",
	): { element: HTMLElement; update(): void } {
		const buttons = items.map(([value, text]) => {
			const choice = el("button", {
				class: "confluence-choice",
				text,
				attrs: { type: "button", "data-value": value },
			});
			choice.addEventListener("click", () => {
				pick(value);
				update();
			});
			return choice;
		});
		const update = (): void => {
			for (const choice of buttons) {
				choice.setAttribute("aria-pressed", String(choice.dataset.value === current()));
			}
		};
		update();
		return {
			element: el("div", {
				class: className,
				attrs: { role: "group", "aria-label": label },
				children: buttons,
			}),
			update,
		};
	}

	const modeChoice = choices<SearchMode>(
		t.confluenceSearchMode,
		[
			["title", t.confluenceModeTitle],
			["content", t.confluenceModeContent],
		],
		() => mode,
		(value) => {
			if (value === mode) return;
			mode = value;
			// Relevance is what a content search is for; titles read best newest first.
			placeholder();
			void runSearch();
			search.focus();
		},
		"confluence-choices confluence-mode",
	);
	const periodChoice = choices<SearchPeriod>(
		t.confluenceFilterModified,
		[
			["any", t.confluencePeriodAny],
			["day", t.confluencePeriodDay],
			["week", t.confluencePeriodWeek],
			["month", t.confluencePeriodMonth],
			["year", t.confluencePeriodYear],
		],
		() => period,
		(value) => {
			period = value;
			filtersChanged();
		},
	);
	const sortChoice = choices<SearchSort>(
		t.confluenceSort,
		[
			["relevance", t.confluenceSortRelevance],
			["modified", t.confluenceSortModified],
			["title", t.confluenceSortTitle],
		],
		() => sort,
		(value) => {
			sort = value;
			filtersChanged();
		},
	);
	const mineBox = el("input", { attrs: { type: "checkbox" } });
	mineBox.addEventListener("change", () => {
		mine = mineBox.checked;
		filtersChanged();
	});
	const label = el("input", {
		class: "confluence-filter-label",
		attrs: {
			type: "text",
			placeholder: t.confluenceFilterLabelPlaceholder,
			"aria-label": t.confluenceFilterLabel,
			maxlength: "100",
			spellcheck: "false",
		},
	});
	label.addEventListener("input", () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => filtersChanged(), SEARCH_DELAY);
	});
	const underChip = el("div", { class: "confluence-under", attrs: { hidden: "" } });
	const clearFilters = el("button", {
		class: "confluence-link",
		text: t.confluenceClearFilters,
		attrs: { type: "button" },
	});
	clearFilters.addEventListener("click", () => {
		period = "any";
		sort = "relevance";
		mine = false;
		mineBox.checked = false;
		label.value = "";
		under = null;
		filtersChanged();
	});

	function filterGroup(name: string, control: HTMLElement): HTMLElement {
		return el("div", {
			class: "confluence-filter",
			children: [el("span", { class: "confluence-filter-name", text: name }), control],
		});
	}

	const filters = el("div", {
		class: "confluence-filters",
		attrs: { id: "confluence-filters", hidden: "" },
		children: [
			filterGroup(t.confluenceFilterModified, periodChoice.element),
			filterGroup(t.confluenceSort, sortChoice.element),
			filterGroup(t.confluenceFilterLabel, label),
			el("label", {
				class: "confluence-filter-check",
				children: [mineBox, t.confluenceFilterMine],
			}),
			el("p", { class: "confluence-filter-tips", text: t.confluenceSearchTips }),
			clearFilters,
		],
	});

	function placeholder(): void {
		const text =
			mode === "content" ? t.confluenceSearchContentPlaceholder : t.confluenceSearchPlaceholder;
		search.placeholder = text;
		search.setAttribute("aria-label", text);
	}
	placeholder();

	/** How many filters narrow the search, on the filter button. */
	function activeFilters(): number {
		return (
			(period === "any" ? 0 : 1) +
			(mine ? 1 : 0) +
			(label.value.trim() === "" ? 0 : 1) +
			(under === null ? 0 : 1) +
			(sort === "relevance" ? 0 : 1)
		);
	}

	function showFilters(): void {
		periodChoice.update();
		sortChoice.update();
		modeChoice.update();
		const count = activeFilters();
		filterCount.textContent = count === 0 ? "" : String(count);
		filterButton.classList.toggle("active", count > 0);
		clearFilters.hidden = count === 0;
		underChip.hidden = under === null;
		if (under !== null) {
			const clear = el("button", {
				class: "assistant-chip-close",
				attrs: {
					type: "button",
					title: t.confluenceFilterUnderClear,
					"aria-label": t.confluenceFilterUnderClear,
				},
				children: [icon("close")],
			});
			clear.addEventListener("click", () => {
				under = null;
				filtersChanged();
			});
			underChip.replaceChildren(
				icon("open"),
				el("span", {
					class: "confluence-under-text",
					text: format(t.confluenceFilterUnder, under.title),
				}),
				clear,
			);
		}
	}

	function filtersChanged(): void {
		showFilters();
		void runSearch();
	}

	const message = el("p", { class: "confluence-pane-message", attrs: { role: "status" } });
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
	const searchArea = el("div", {
		class: "confluence-search-area",
		children: [
			el("div", {
				class: "confluence-search-row",
				children: [
					el("span", { class: "confluence-search-field", children: [icon("find"), search] }),
					filterButton,
				],
			}),
			modeChoice.element,
			underChip,
			filters,
		],
	});

	const element = el("div", {
		class: "confluence-pane",
		children: [
			el("div", {
				class: "confluence-pane-toolbar",
				children: [title, locateButton, collapseButton, newPageButton, refreshButton],
			}),
			space,
			searchArea,
			message,
			connectButton,
			list,
		],
	});

	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "medium" });
	const relative = new Intl.RelativeTimeFormat(options.lang, { numeric: "auto" });
	/** A recent date as "3 days ago", an older one as the date. */
	function when(iso: string | null): string {
		const date = iso === null ? null : new Date(iso);
		if (date === null || Number.isNaN(date.getTime())) return "";
		const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
		if (minutes > -60) return relative.format(Math.min(minutes, 0), "minute");
		if (minutes > -24 * 60) return relative.format(Math.round(minutes / 60), "hour");
		if (minutes > -30 * 24 * 60) return relative.format(Math.round(minutes / 1440), "day");
		return dateFormat.format(date);
	}

	function showMessage(text: string): void {
		message.textContent = text;
		message.hidden = text === "";
	}

	function showSignedIn(signedIn: boolean): void {
		connectButton.hidden = signedIn;
		space.hidden = !signedIn;
		searchArea.hidden = !signedIn;
		refreshButton.hidden = !signedIn;
		collapseButton.hidden = !signedIn;
		locateButton.hidden = !signedIn;
		newPageButton.hidden = !signedIn || space.value === "";
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

	function rowAction(name: IconName, label: string, className: string): HTMLButtonElement {
		return el("button", {
			class: `icon-button confluence-row-action ${className}`,
			attrs: { type: "button", "aria-label": label, title: label, tabindex: "-1" },
			children: [icon(name)],
		});
	}

	function starButton(page: { readonly id: string; readonly title: string }): HTMLElement {
		const starred = isFavorite(page.id);
		const label = starred ? t.confluenceRemoveFavorite : t.confluenceAddFavorite;
		const button = rowAction("star", label, "confluence-star");
		button.setAttribute("aria-pressed", String(starred));
		button.addEventListener("click", () => toggleFavorite(page));
		return button;
	}

	/** A twisty for a branch, or a spacer that keeps leaves aligned. */
	function twisty(key: string | null, label: string, loading: boolean): HTMLElement {
		if (key === null) return el("span", { class: "confluence-twisty" });
		const button = el("button", {
			class: `confluence-twisty${loading ? " loading" : ""}`,
			attrs: {
				type: "button",
				tabindex: "-1",
				"aria-hidden": "true",
				"data-twisty": label,
			},
			children: [icon("chevron")],
		});
		button.addEventListener("click", () => toggle(key));
		return button;
	}

	interface RowOptions {
		readonly depth: number;
		/** The level this row expands to, when it can have children. */
		readonly branch: string | null;
		readonly title: string;
		/** The title with the words found marked. */
		readonly titleParts?: readonly TextPart[];
		readonly meta?: string;
		/** Where the page is: its space and the pages above it. */
		readonly path?: readonly string[];
		readonly excerpt?: readonly TextPart[];
		/** A page (opened on click, can be starred) or a space (expands on click). */
		readonly page: string | null;
		/** Where a page added from this row goes. */
		readonly add?: { readonly space: string; readonly parent: string | null };
		/** The row's place among its siblings, for assistive technology. */
		readonly position?: { readonly index: number; readonly size: number };
		/** What tells this row apart for the keyboard focus. */
		readonly key: string;
	}

	function marked(parts: readonly TextPart[]): Node[] {
		return parts.map((part) =>
			part.hit ? el("mark", { text: part.text }) : document.createTextNode(part.text),
		);
	}

	function row(row: RowOptions): HTMLElement {
		const active = row.page !== null && row.page === options.activePage();
		const open = row.branch !== null && expanded.has(row.branch);
		const loading = open && row.branch !== null && levels.get(row.branch)?.status === "loading";
		const details: HTMLElement[] = [];
		if (row.path !== undefined && row.path.length > 0) {
			details.push(
				el("span", {
					class: "confluence-page-path",
					text: row.path.join(" › "),
					attrs: { title: row.path.join(" › ") },
				}),
			);
		}
		if (row.excerpt !== undefined && row.excerpt.length > 0) {
			details.push(el("span", { class: "confluence-excerpt", children: marked(row.excerpt) }));
		}
		if (row.meta !== undefined && row.meta !== "") {
			details.push(el("span", { class: "confluence-page-meta", text: row.meta }));
		}
		const main = el("button", {
			class: "confluence-row-main",
			attrs: {
				type: "button",
				title: row.title,
				tabindex: row.key === focusKey ? "0" : "-1",
				"data-key": row.key,
			},
			children: [
				icon(row.page === null ? "open" : "file"),
				el("span", {
					class: "confluence-page-text",
					children: [
						el("span", {
							class: "confluence-page-title",
							children: marked(row.titleParts ?? [{ text: row.title, hit: false }]),
						}),
						...details,
					],
				}),
			],
		});
		const page = row.page;
		main.addEventListener("focus", () => {
			focusKey = row.key;
		});
		if (page === null) {
			main.addEventListener("click", () => {
				if (row.branch !== null) toggle(row.branch);
			});
		} else {
			main.addEventListener("click", () => void openPage(page));
		}
		const actions: HTMLElement[] = [];
		if (page !== null && results === null) {
			const find = rowAction("find", t.confluenceSearchUnder, "confluence-search-under");
			find.addEventListener("click", () => searchUnder(page, row.title));
			actions.push(find);
		}
		if (row.add !== undefined) actions.push(addButton(row.add.space, row.add.parent));
		if (page !== null) actions.push(starButton({ id: page, title: row.title }));
		const item = el("div", {
			class: `confluence-page-item${row.excerpt !== undefined || row.path !== undefined ? " confluence-result" : ""}`,
			attrs: {
				role: "treeitem",
				"aria-level": String(row.depth + 1),
				...(row.position === undefined
					? {}
					: {
							"aria-posinset": String(row.position.index + 1),
							"aria-setsize": String(row.position.size),
						}),
				...(page === null ? { "data-space": row.title } : { "data-page": page }),
				...(row.branch === null ? {} : { "aria-expanded": String(open) }),
				...(active ? { "aria-current": "page" } : {}),
			},
			children: [twisty(row.branch, row.title, loading), main, ...actions],
		});
		if (row.branch !== null) item.dataset.branch = row.branch;
		item.style.setProperty("--depth", String(row.depth));
		return item;
	}

	function addButton(spaceKey: string, parent: string | null): HTMLElement {
		const label = parent === null ? t.confluenceNewPage : t.confluenceAddChild;
		const button = rowAction("new", label, "confluence-add");
		button.addEventListener("click", () => startCreate(spaceKey, parent));
		return button;
	}

	function searchUnder(id: string, pageTitle: string): void {
		under = { id, title: pageTitle };
		if (mode === "title") mode = "content";
		placeholder();
		filtersChanged();
		search.focus();
	}

	// --- New page ------------------------------------------------------------

	function startCreate(spaceKey: string, parent: string | null): void {
		if (spaceKey === "") return;
		const level = parent === null ? spaceLevel(spaceKey) : pageLevel(parent);
		creating = { level, space: spaceKey, parent, input: titleInput() };
		expanded.add(level);
		// The box lives in the tree; search results would hide it.
		search.value = "";
		results = null;
		render();
		creating.input.focus();
	}

	function titleInput(): HTMLInputElement {
		const input = el("input", {
			class: "confluence-new-title",
			attrs: {
				type: "text",
				placeholder: t.confluencePageTitle,
				"aria-label": t.confluencePageTitle,
				maxlength: "255",
			},
		});
		const cancel = (): void => {
			creating = null;
			render();
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				cancel();
			} else if (event.key === "Enter") {
				event.preventDefault();
				void create(input);
			}
		});
		// No cancel on blur: the tree re-renders as levels arrive and focus can
		// briefly leave the box. Escape, another "+" or another space ends it.
		return input;
	}

	function titleRow(depth: number, input: HTMLInputElement): HTMLElement {
		const item = el("div", {
			class: "confluence-page-item confluence-new-page",
			children: [el("span", { class: "confluence-twisty" }), icon("file"), input],
		});
		item.style.setProperty("--depth", String(depth));
		return item;
	}

	async function create(input: HTMLInputElement): Promise<void> {
		const request = creating;
		const name = input.value.trim();
		if (request === null || name === "") return;
		input.disabled = true;
		showMessage(t.confluenceLoading);
		try {
			await bridge.confluenceCreatePage({
				space: request.space,
				parent: request.parent,
				title: name,
			});
			creating = null;
			// The level is listed again with the new page in Confluence's order.
			levels.delete(request.level);
			showMessage("");
			render();
			requestAnimationFrame(() => highlightActive());
		} catch (error) {
			input.disabled = false;
			input.focus();
			showMessage(format(t.confluenceCreateFailed, errorText(error)));
		}
	}

	function note(text: string, depth: number, busy = false): HTMLElement {
		const item = el("p", {
			class: `confluence-tree-note${busy ? " busy" : ""}`,
			children: [...(busy ? [el("span", { class: "confluence-spinner" })] : []), text],
		});
		item.style.setProperty("--depth", String(depth));
		return item;
	}

	// --- Tree ----------------------------------------------------------------

	/** Lists a level once; resolves when it has arrived (or failed). */
	function load(key: string): Promise<void> {
		const known = levels.get(key);
		if (known !== undefined) return known.status === "loading" ? known.done : Promise.resolve();
		const asked = generation;
		const parent: ConfluenceTreeParent = key.startsWith("s:")
			? { space: key.slice(2) }
			: { page: key.slice(2) };
		const done = bridge
			.confluenceTree(parent)
			.then((pages): Level => ({ status: "done", pages }))
			.catch((error: unknown): Level => ({ status: "error", message: errorText(error) }))
			.then((level) => {
				if (asked !== generation) return;
				levels.set(key, level);
				render();
			});
		levels.set(key, { status: "loading", done });
		return done;
	}

	function toggle(key: string): void {
		if (expanded.has(key)) expanded.delete(key);
		else expanded.add(key);
		render();
	}

	/** The rows of a level and, below each expanded page, its own level. */
	function levelRows(key: string, depth: number, spaceKey: string): HTMLElement[] {
		void load(key);
		const level = levels.get(key);
		const naming = creating?.level === key ? [titleRow(depth, creating.input)] : [];
		if (level === undefined || level.status === "loading") {
			return [...naming, note(t.confluenceLoading, depth, true)];
		}
		if (level.status === "error") {
			return [...naming, note(format(t.confluenceRequestFailed, level.message), depth)];
		}
		if (level.pages.length === 0 && naming.length === 0) {
			return depth === 0 ? [note(t.confluenceNoPages, depth)] : [];
		}
		return [
			...naming,
			...level.pages.flatMap((page, index) => {
				const branch = pageLevel(page.id);
				const childLevel = levels.get(branch);
				// Cloud does not say whether a page has children; an empty answer settles it.
				// A child being added, or a level listed again after one was, decides anew.
				const leaf =
					creating?.level !== branch &&
					((page.hasChildren === false && childLevel === undefined) ||
						(childLevel?.status === "done" && childLevel.pages.length === 0));
				const rows = [
					row({
						key: `p:${page.id}`,
						depth,
						branch: leaf ? null : branch,
						title: page.title,
						page: page.id,
						add: { space: spaceKey, parent: page.id },
						position: { index, size: level.pages.length },
					}),
				];
				if (!leaf && expanded.has(branch)) rows.push(...levelRows(branch, depth + 1, spaceKey));
				return rows;
			}),
		];
	}

	function treeRows(): HTMLElement[] {
		if (space.value !== "") return levelRows(spaceLevel(space.value), 0, space.value);
		if (spaces.length === 0) return [note(t.confluenceNoPages, 0)];
		return spaces.flatMap((item, index) => {
			const branch = spaceLevel(item.key);
			const rows = [
				row({
					key: branch,
					depth: 0,
					branch,
					title: item.name,
					meta: item.key,
					page: null,
					add: { space: item.key, parent: null },
					position: { index, size: spaces.length },
				}),
			];
			if (expanded.has(branch)) rows.push(...levelRows(branch, 1, item.key));
			return rows;
		});
	}

	function resultRows(found: Results): HTMLElement[] {
		const rows = found.hits.map((hit, index) => {
			const path = [
				...(space.value === "" && hit.spaceName !== "" ? [hit.spaceName] : []),
				...hit.path,
			];
			return row({
				key: `r:${hit.id}`,
				depth: 0,
				branch: null,
				title: hit.title,
				titleParts:
					hit.titleParts.some((part) => part.hit) || found.query === ""
						? hit.titleParts
						: markWords(hit.title, found.query, options.lang),
				path,
				excerpt: hit.excerpt,
				meta: when(hit.modified),
				page: hit.id,
				position: { index, size: found.total ?? found.hits.length },
			});
		});
		if (found.next !== null) {
			const more = el("button", {
				class: "confluence-more",
				text: loadingMore ? t.confluenceLoading : t.confluenceLoadMore,
				attrs: { type: "button" },
			});
			more.disabled = loadingMore;
			more.addEventListener("click", () => void loadMore());
			rows.push(more);
		}
		return rows;
	}

	// --- Rendering -----------------------------------------------------------

	function heading(text: string): HTMLElement {
		return el("div", { class: "confluence-section", text, attrs: { role: "presentation" } });
	}

	function render(): void {
		collapseButton.disabled = results !== null || expanded.size === 0;
		if (account === null) {
			list.replaceChildren();
			return;
		}
		const favorites = siteFavorites();
		const favoriteRows = favorites.map((item) =>
			row({ key: `f:${item.id}`, depth: 0, branch: null, title: item.title, page: item.id }),
		);
		const body = results === null ? treeRows() : resultRows(results);
		// Focus stays in the title box across re-renders, or comes back to it when a
		// removed row (the "+" just clicked) left it nowhere; it is not taken from
		// anything else the user went to.
		const focused = list.ownerDocument.activeElement;
		const typing =
			creating !== null &&
			(focused === creating.input || focused === null || focused === list.ownerDocument.body);
		const hadFocus = list.contains(focused) && !typing;
		list.replaceChildren(
			...(favorites.length === 0 || results !== null
				? body
				: [
						heading(t.confluenceFavorites),
						...favoriteRows,
						heading(t.confluencePaneTree),
						...body,
					]),
		);
		// One row is reached with Tab; the arrow keys move from it.
		const rows = rowButtons();
		if (!rows.some((button) => button.dataset.key === focusKey)) {
			focusKey = rows[0]?.dataset.key ?? null;
			rows[0]?.setAttribute("tabindex", "0");
		}
		if (typing) creating?.input.focus();
		else if (hadFocus) {
			rows.find((button) => button.dataset.key === focusKey)?.focus({ preventScroll: true });
		}
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

	// --- Keyboard ------------------------------------------------------------

	const rowButtons = (): HTMLButtonElement[] => [
		...list.querySelectorAll<HTMLButtonElement>(".confluence-row-main"),
	];

	function focusRow(button: HTMLButtonElement | undefined): void {
		if (button === undefined) return;
		for (const other of rowButtons()) other.setAttribute("tabindex", "-1");
		button.setAttribute("tabindex", "0");
		focusKey = button.dataset.key ?? null;
		button.focus();
	}

	list.addEventListener("keydown", (event) => {
		const target = event.target;
		if (
			!(target instanceof HTMLButtonElement) ||
			!target.classList.contains("confluence-row-main")
		) {
			return;
		}
		const rows = rowButtons();
		const at = rows.indexOf(target);
		const item = target.closest<HTMLElement>(".confluence-page-item");
		const branch = item?.dataset.branch;
		const open = item?.getAttribute("aria-expanded") === "true";
		const depth = Number(item?.style.getPropertyValue("--depth") || 0);
		switch (event.key) {
			case "ArrowDown":
				focusRow(rows[at + 1]);
				break;
			case "ArrowUp":
				focusRow(rows[at - 1]);
				break;
			case "Home":
				focusRow(rows[0]);
				break;
			case "End":
				focusRow(rows.at(-1));
				break;
			case "ArrowRight":
				if (branch !== undefined && !open) toggle(branch);
				else if (branch !== undefined) focusRow(rows[at + 1]);
				break;
			case "ArrowLeft": {
				if (branch !== undefined && open) {
					toggle(branch);
					break;
				}
				// To the row this one hangs under.
				for (let i = at - 1; i >= 0; i--) {
					const above = rows[i]?.closest<HTMLElement>(".confluence-page-item");
					if (Number(above?.style.getPropertyValue("--depth") || 0) < depth) {
						focusRow(rows[i]);
						break;
					}
				}
				break;
			}
			default:
				return;
		}
		event.preventDefault();
	});

	// --- Pages ---------------------------------------------------------------

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

	/** Opens the tree down to the active tab's page, and shows it there. */
	async function locateActive(): Promise<void> {
		const id = options.activePage();
		const spaceKey = options.activeSpace?.() ?? null;
		if (id === null) {
			showMessage(t.confluenceLocateNone);
			return;
		}
		showMessage(t.confluenceLoading);
		try {
			const above = await bridge.confluenceAncestors(id);
			// The page's space: the one shown, or a branch of all spaces.
			if (space.value !== "" && spaceKey !== null && spaceKey !== space.value) {
				space.value = spaces.some((item) => item.key === spaceKey) ? spaceKey : "";
				options.setSpace(space.value);
				newPageButton.hidden = space.value === "";
			}
			search.value = "";
			results = null;
			const top = space.value !== "" ? space.value : spaceKey;
			if (top !== null && top !== "") {
				expanded.add(spaceLevel(top));
				await load(spaceLevel(top));
			}
			for (const ancestor of above) {
				expanded.add(pageLevel(ancestor));
				await load(pageLevel(ancestor));
			}
			showMessage("");
			render();
			const item = list.querySelector<HTMLElement>(
				`.confluence-page-item[data-page="${CSS.escape(id)}"]`,
			);
			if (item === null) {
				showMessage(t.confluenceLocateNone);
				return;
			}
			item.scrollIntoView({ block: "center" });
			focusRow(item.querySelector<HTMLButtonElement>(".confluence-row-main") ?? undefined);
			item.classList.add("flash");
			setTimeout(() => item.classList.remove("flash"), 1200);
		} catch (error) {
			showMessage(format(t.confluenceRequestFailed, errorText(error)));
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

	// --- Search --------------------------------------------------------------

	function request(cursor: string | null = null): ConfluenceSearchRequest {
		return {
			query: search.value,
			spaceKey: space.value === "" ? null : space.value,
			mode,
			sort,
			period,
			mine,
			label: label.value,
			ancestor: under?.id ?? null,
			cursor,
		};
	}

	function countText(found: Results): string {
		if (found.hits.length === 0) return t.confluenceNoResults;
		if (found.total !== null && found.total > found.hits.length) {
			return format(t.confluenceResultShown, found.hits.length, found.total);
		}
		return format(t.confluenceResultCount, found.total ?? found.hits.length);
	}

	async function runSearch(): Promise<void> {
		const asked = request();
		const id = ++searchId;
		loadingMore = false;
		if (!hasCriteria(asked)) {
			results = null;
			showMessage("");
			render();
			return;
		}
		showMessage(t.confluenceLoading);
		list.setAttribute("aria-busy", "true");
		try {
			const found = await bridge.confluenceFind(asked);
			if (id !== searchId) return;
			results = { ...found, query: asked.mode === "title" ? asked.query : "" };
			showMessage(countText(results));
		} catch (error) {
			if (id !== searchId) return;
			results = { hits: [], total: 0, next: null, query: "" };
			showMessage(format(t.confluenceRequestFailed, errorText(error)));
		} finally {
			if (id === searchId) list.removeAttribute("aria-busy");
		}
		render();
	}

	async function loadMore(): Promise<void> {
		const current = results;
		if (current === null || current.next === null || loadingMore) return;
		const id = searchId;
		loadingMore = true;
		render();
		try {
			const found = await bridge.confluenceFind(request(current.next));
			if (id !== searchId) return;
			const seen = new Set(current.hits.map((hit) => hit.id));
			results = {
				...current,
				hits: [...current.hits, ...found.hits.filter((hit) => !seen.has(hit.id))],
				total: found.total ?? current.total,
				// No new page means no more: a server repeating itself is not followed.
				next: found.hits.some((hit) => !seen.has(hit.id)) ? found.next : null,
			};
			showMessage(countText(results));
		} catch (error) {
			if (id !== searchId) return;
			showMessage(format(t.confluenceRequestFailed, errorText(error)));
		} finally {
			if (id === searchId) loadingMore = false;
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
			under = null;
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
		showFilters();
		await runSearch();
	}

	space.addEventListener("change", () => {
		options.setSpace(space.value);
		creating = null;
		newPageButton.hidden = space.value === "";
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
		} else if (event.key === "ArrowDown") {
			// Down from the box into the results or the tree.
			event.preventDefault();
			focusRow(rowButtons()[0]);
		} else if (event.key === "Escape" && search.value !== "") {
			event.stopPropagation();
			search.value = "";
			void runSearch();
		}
	});

	showSignedIn(false);
	showFilters();
	return { element, refresh, highlightActive, render };
}
