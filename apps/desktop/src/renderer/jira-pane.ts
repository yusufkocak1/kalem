import type { JiraFavorite, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { IssueTypeKind, JiraIssueRef, JiraIssueRow } from "../shared/jira.js";
import { groupByParent, issueTypeKind } from "../shared/jira.js";
import type { Condition, Facet, FacetCount } from "../shared/jira-facets.js";
import {
	CONDITIONS,
	composeJql,
	conditionJql,
	conditionsFrom,
	FACETS,
	facetChoices,
	facetCounts,
	facetJql,
	facetsFrom,
	NONE,
	splitChips,
} from "../shared/jira-facets.js";
import { formatDuration, QUICK_HOURS, quickEntry } from "../shared/jira-worklog.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { statusLozenge } from "./jira-dialog.js";

export interface JiraPaneOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	/** Opens an issue in the Jira dialog. */
	openIssue(key: string): void;
	/** Opens an issue in the Jira dialog with its work log form. */
	logWork(key: string): void;
	/** The starred issues, of every Jira site. */
	favorites(): readonly JiraFavorite[];
	setFavorites(favorites: readonly JiraFavorite[]): void;
}

/** A day as `YYYY-MM-DD`, in local time. */
function today(): string {
	const now = new Date();
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const TYPE_ICONS: Record<IssueTypeKind, IconName> = {
	bug: "typeBug",
	story: "typeStory",
	task: "typeTask",
	subtask: "typeSubtask",
	epic: "typeEpic",
	feature: "typeFeature",
	improvement: "typeImprovement",
	other: "typeOther",
};

/** Where the filters the list is shown by are kept, for this computer. */
const FACETS_KEY = "kalem.jira.facets";
const CONDITIONS_KEY = "kalem.jira.conditions";

function kept<T>(key: string, read: (value: unknown) => T): T {
	try {
		const value = localStorage.getItem(key);
		return read(value === null ? undefined : JSON.parse(value));
	} catch {
		return read(undefined);
	}
}

function keep(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Not kept: the next window starts with the defaults.
	}
}

/** A popup's list of more than this many values gets a box to find one by. */
const FIND_FROM = 8;

/** How many colours the assignees' avatars take turns with. */
const AVATAR_TONES = 8;

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** The issue type's mark: its family's sign on its family's colour. */
export function typeBadge(type: string): HTMLElement {
	const kind = issueTypeKind(type);
	return el("span", {
		class: "jira-type-badge",
		attrs: { "data-kind": kind, ...(type === "" ? {} : { title: type }) },
		children: [icon(TYPE_ICONS[kind])],
	});
}

/** A person's initials, on a colour that is always theirs. */
function avatar(name: string): HTMLElement {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const initials = [words[0], words.length > 1 ? words.at(-1) : undefined]
		.map((word) => (word === undefined ? "" : (Array.from(word)[0] ?? "")))
		.join("");
	let hash = 0;
	for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
	return el("span", {
		class: "jira-avatar",
		text: initials,
		attrs: { title: name, "aria-label": name, "data-tone": String(hash % AVATAR_TONES) },
	});
}

/**
 * Jira in a dock: issues by filters that can each be taken away (assigned
 * to me, unresolved, a sprint, a type…) and the words, JQL or key in the
 * search box, all asked of Jira as one JQL; sub-tasks fold under their
 * parent. An issue opens in the Jira dialog.
 */
export function createJiraPane(options: JiraPaneOptions): {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
	/** The starred issues changed elsewhere (the Jira dialog): the stars are drawn again. */
	favoritesChanged(): void;
} {
	const { t, bridge } = options;
	const unassigned = (): HTMLElement =>
		el("span", {
			class: "jira-avatar jira-avatar-none",
			text: "?",
			attrs: { title: t.jiraUnassigned, "aria-label": t.jiraUnassigned },
		});
	const search = el("input", {
		class: "confluence-pane-search jira-pane-search",
		attrs: {
			type: "search",
			// The narrow pane's own, shorter hint; the full one is the tooltip.
			placeholder: t.jiraPaneSearchPlaceholder,
			title: t.jiraSearchPlaceholder,
			"aria-label": t.jiraSearchPlaceholder,
		},
	});
	const filterButton = el("button", {
		class: "jira-facets-button",
		attrs: {
			type: "button",
			"aria-haspopup": "menu",
			"aria-expanded": "false",
			title: t.jiraFacetsMenuTitle,
			"aria-label": t.jiraFacetsMenu,
		},
		children: [icon("filter")],
	});
	const types = el("div", {
		class: "jira-facets",
		attrs: { role: "group", "aria-label": t.jiraFacetsMenu },
	});
	types.hidden = true;
	const status = el("p", { class: "jira-message jira-pane-message" });
	const rows = el("ul", { class: "jira-list jira-pane-rows", attrs: { role: "tree" } });
	const more = el("button", {
		class: "confluence-link jira-more",
		text: t.jiraMore,
		attrs: { type: "button" },
	});
	more.hidden = true;
	const element = el("div", {
		class: "jira-pane",
		children: [
			el("div", {
				class: "jira-pane-toolbar",
				children: [
					el("label", {
						class: "jira-pane-search-field",
						children: [icon("find"), search],
					}),
					filterButton,
				],
			}),
			types,
			status,
			rows,
			more,
		],
	});

	let searchId = 0;
	let next: string | null = null;
	/** How many issues the server has, when it says. */
	let total: number | null = null;
	let loading = false;
	let failed = false;

	/** The issues found so far, drawn again as a tree when more come. */
	let issues: JiraIssueRow[] = [];
	/**
	 * Parents the user opened (true) or closed. Sub-tasks start folded under their
	 * parent, a drawer opened on demand; under a parent the search did not
	 * find (shown dimmed) they start open, being what was found.
	 */
	const drawers = new Map<string, boolean>();
	const startsOpen = (group: { row: unknown }): boolean => group.row === null;
	/** The quick conditions in force; each can be taken away. */
	let conditions = kept(CONDITIONS_KEY, conditionsFrom);
	/** What the list can be filtered by, a row of chips each. */
	let facets = kept(FACETS_KEY, facetsFrom);
	/** The values chosen, by facet; a facet with none chosen does not narrow the list. */
	const selection = new Map<Facet, Set<string>>();
	const chosenOf = (facet: Facet): Set<string> => {
		let chosen = selection.get(facet);
		if (chosen === undefined) {
			chosen = new Set();
			selection.set(facet, chosen);
		}
		return chosen;
	};
	const choosing = (): boolean => [...selection.values()].some((chosen) => chosen.size > 0);
	/** Each facet's values seen in the answers so far, so a choice does not hide the others. */
	const seen = new Map<Facet, Set<string>>();
	/** People's ids by the name the list shows, for JQL. */
	const people = new Map<string, string>();
	/** The JQL the list was last asked for. */
	let lastJql = "";

	/** The connected Jira site, which the starred issues are kept by. */
	let site: string | null = null;
	const starred = (): JiraFavorite[] => options.favorites().filter((item) => item.site === site);
	const isFavorite = (key: string): boolean => starred().some((item) => item.key === key);

	function toggleFavorite(issue: JiraIssueRef): void {
		if (site === null) return;
		const all = options.favorites();
		const on = isFavorite(issue.key);
		options.setFavorites(
			on
				? all.filter((item) => !(item.site === site && item.key === issue.key))
				: [{ site, key: issue.key, summary: issue.summary, type: issue.type }, ...all],
		);
		favoritesChanged();
	}

	function favoritesChanged(): void {
		if (conditions.includes("favorites")) {
			// The list is the starred issues: one taken off goes, one added comes.
			const keys = new Set(starred().map((item) => item.key));
			issues = issues.filter((issue) => keys.has(issue.key));
			if (starred().some((item) => !issues.some((issue) => issue.key === item.key))) {
				void run(false);
				return;
			}
			render();
			return;
		}
		for (const star of rows.querySelectorAll<HTMLElement>(".jira-star")) {
			drawStar(star, isFavorite(star.dataset.key ?? ""));
		}
	}

	function drawStar(star: HTMLElement, on: boolean): void {
		star.textContent = on ? "★" : "☆";
		star.setAttribute("aria-pressed", String(on));
		const label = on ? t.jiraUnfavorite : t.jiraFavorite;
		star.setAttribute("aria-label", label);
		star.title = label;
	}

	const facetName = (facet: Facet): string =>
		({
			type: t.jiraFacetType,
			status: t.jiraFacetStatus,
			sprint: t.jiraFacetSprint,
			assignee: t.jiraFacetAssignee,
			priority: t.jiraFacetPriority,
			project: t.jiraFacetProject,
			label: t.jiraFacetLabel,
		})[facet];
	const conditionName = (condition: Condition): string =>
		({
			mine: t.jiraPaneMine,
			unresolved: t.jiraCondUnresolved,
			openSprints: t.jiraCondOpenSprints,
			reported: t.jiraPaneReported,
			watching: t.jiraPaneWatching,
			favorites: `★ ${t.jiraFavorites}`,
		})[condition];
	const valueName = (facet: Facet, value: string): string =>
		value !== NONE ? value : facet === "assignee" ? t.jiraUnassigned : t.jiraFacetNone;

	/** A value chosen or let go (`null`: every value), and the list asked for again. */
	function toggleValue(facet: Facet, value: string | null): void {
		const chosen = chosenOf(facet);
		if (value === null) chosen.clear();
		else if (chosen.has(value)) chosen.delete(value);
		else chosen.add(value);
		void run(false);
	}

	function toggleCondition(condition: Condition): void {
		const on = !conditions.includes(condition);
		conditions = CONDITIONS.filter((each) => (each === condition ? on : conditions.includes(each)));
		keep(CONDITIONS_KEY, conditions);
		void run(false);
	}

	function setFacets(next: readonly Facet[]): void {
		facets = FACETS.filter((facet) => next.includes(facet));
		let narrowed = false;
		for (const facet of FACETS) {
			if (facets.includes(facet)) continue;
			narrowed ||= (selection.get(facet)?.size ?? 0) > 0;
			selection.delete(facet);
		}
		keep(FACETS_KEY, facets);
		if (narrowed) void run(false);
		else render();
	}

	function renderTypes(): void {
		types.hidden = false;
		types.replaceChildren(
			conditionRow(),
			...(issues.length === 0 && !choosing() ? [] : facets.map(facetRow)),
		);
	}

	/** A chip: a value, how many issues have it (none: no count), pressed when chosen. */
	const chipOf = (
		label: string,
		pressed: boolean,
		count: number | null,
		click: () => void,
		lead: HTMLElement | null = null,
	): HTMLButtonElement => {
		const button = el("button", {
			class: "jira-type-chip",
			attrs: { type: "button", "aria-pressed": String(pressed), title: label },
			children: [
				...(lead === null ? [] : [lead]),
				el("span", { class: "jira-type-chip-label", text: label }),
				...(count === null || count === 0
					? []
					: [el("span", { class: "jira-type-chip-count", text: String(count) })]),
			],
		});
		button.addEventListener("click", click);
		return button;
	};

	const moreChipOf = (count: number, open: (anchor: HTMLElement) => void): HTMLElement => {
		const button = el("button", {
			class: "jira-type-chip jira-facet-more",
			text: format(t.jiraFacetMore, count),
			attrs: {
				type: "button",
				"aria-haspopup": "menu",
				"aria-expanded": "false",
				title: format(t.jiraFacetMoreTitle, count),
			},
		});
		button.addEventListener("click", () => open(button));
		return button;
	};

	/** The quick conditions: the first few as chips, any in force among them, the rest a "+N" away. */
	function conditionRow(): HTMLElement {
		const { chips, more } = splitChips(CONDITIONS, new Set(conditions));
		return el("div", {
			class: "jira-facet-row jira-condition-row",
			attrs: { role: "group", "aria-label": t.jiraFacetQuick, "data-facet": "conditions" },
			children: [
				...chips.map((condition) => {
					const chip = chipOf(conditionName(condition), conditions.includes(condition), null, () =>
						toggleCondition(condition),
					);
					chip.dataset.value = condition;
					return chip;
				}),
				...(more.length === 0
					? []
					: [
							moreChipOf(more.length, (anchor) =>
								openPopup(anchor, [
									el("div", { class: "jira-menu-heading", text: t.jiraFacetQuick }),
									...more.map((condition) => {
										const item = checkItem(
											conditionName(condition),
											conditions.includes(condition),
											null,
											() => {
												toggleCondition(condition);
												item.setAttribute("aria-checked", String(conditions.includes(condition)));
											},
										);
										return item;
									}),
								]),
							),
						]),
			],
		});
	}

	/** A facet's values, now and seen before, with how many issues of the list have each. */
	const choicesOf = (facet: Facet): FacetCount[] =>
		facetChoices(facetCounts(issues, facet), seen.get(facet) ?? [], chosenOf(facet));

	function facetRow(facet: Facet): HTMLElement {
		const chosen = chosenOf(facet);
		const { chips, more } = splitChips(choicesOf(facet), chosen);
		const chip = (entry: FacetCount): HTMLButtonElement => {
			const button = chipOf(
				valueName(facet, entry.value),
				chosen.has(entry.value),
				entry.count,
				() => toggleValue(facet, entry.value),
				facet === "type" ? typeBadge(entry.value) : null,
			);
			button.dataset.value = entry.value;
			if (facet === "type") button.dataset.type = entry.value;
			return button;
		};
		const all = chipOf(t.jiraTypeAll, chosen.size === 0, null, () => toggleValue(facet, null));
		all.title = `${facetName(facet)}: ${t.jiraTypeAll}`;
		const moreChip = moreChipOf(more.length, (anchor) => showValues(facet, anchor));
		const remove = el("button", {
			class: "jira-facet-remove",
			attrs: {
				type: "button",
				title: format(t.jiraFacetRemove, facetName(facet)),
				"aria-label": format(t.jiraFacetRemove, facetName(facet)),
			},
			children: [icon("close")],
		});
		remove.addEventListener("click", () => setFacets(facets.filter((each) => each !== facet)));
		return el("div", {
			class: "jira-facet-row",
			attrs: { role: "group", "aria-label": facetName(facet), "data-facet": facet },
			children: [
				el("span", {
					class: "jira-facet-head",
					children: [el("span", { class: "jira-facet-name", text: facetName(facet) }), remove],
				}),
				all,
				...chips.map(chip),
				...(more.length === 0 ? [] : [moreChip]),
			],
		});
	}

	// --- Popups: the facets the list can be filtered by, and a facet's other values ---
	const popup = el("div", {
		class: "dock-menu jira-facet-popup",
		attrs: { role: "menu", hidden: "" },
	});
	document.body.append(popup);
	let popupFor: HTMLElement | null = null;
	const closePopup = (refocus = false): void => {
		if (popup.hidden) return;
		popup.hidden = true;
		popupFor?.setAttribute("aria-expanded", "false");
		if (refocus && popupFor?.isConnected) popupFor.focus();
		popupFor = null;
	};
	document.addEventListener("mousedown", (event) => {
		const target = event.target instanceof Node ? event.target : null;
		if (target !== null && (popup.contains(target) || popupFor?.contains(target))) return;
		closePopup();
	});
	popup.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			closePopup(true);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const items = [...popup.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]")].filter(
			(item) => !item.hidden,
		);
		const index = items.indexOf(document.activeElement as HTMLElement);
		const step = event.key === "ArrowDown" ? 1 : -1;
		items[(index + step + items.length) % items.length]?.focus();
	});

	function openPopup(anchor: HTMLElement, children: HTMLElement[]): void {
		const again = popupFor === anchor;
		closePopup();
		if (again) return;
		popupFor = anchor;
		anchor.setAttribute("aria-expanded", "true");
		popup.replaceChildren(...children);
		popup.hidden = false;
		place(anchor);
		popup.querySelector<HTMLElement>("input, [role=menuitemcheckbox]")?.focus();
	}

	function place(anchor: HTMLElement): void {
		const at = anchor.getBoundingClientRect();
		const box = popup.getBoundingClientRect();
		popup.style.left = `${Math.max(4, Math.min(at.left, window.innerWidth - box.width - 4))}px`;
		const below = at.bottom + 4;
		popup.style.top = `${below + box.height > window.innerHeight - 4 ? Math.max(4, at.top - box.height - 4) : below}px`;
	}

	const checkItem = (
		label: string,
		checked: boolean,
		count: number | null,
		run: () => void,
		lead: HTMLElement | null = null,
	): HTMLButtonElement => {
		const item = el("button", {
			class: "dock-menu-item jira-facet-option",
			attrs: { type: "button", role: "menuitemcheckbox", "aria-checked": String(checked) },
			children: [
				el("span", { class: "jira-facet-check", attrs: { "aria-hidden": "true" } }),
				...(lead === null ? [] : [lead]),
				el("span", { class: "jira-facet-option-label", text: label }),
				...(count === null
					? []
					: [el("span", { class: "jira-type-chip-count", text: String(count) })]),
			],
		});
		item.addEventListener("click", run);
		return item;
	};

	filterButton.addEventListener("click", () => {
		openPopup(filterButton, [
			el("div", { class: "jira-menu-heading", text: t.jiraFacetsMenu }),
			...FACETS.map((facet) => {
				const item = checkItem(facetName(facet), facets.includes(facet), null, () => {
					const on = !facets.includes(facet);
					setFacets(on ? [...facets, facet] : facets.filter((each) => each !== facet));
					item.setAttribute("aria-checked", String(on));
					place(filterButton);
				});
				return item;
			}),
		]);
	});

	/** All of a facet's values, chosen ones ticked; choosing keeps the popup open. */
	function showValues(facet: Facet, anchor: HTMLElement): void {
		const counts = choicesOf(facet);
		const chosen = chosenOf(facet);
		const empty = el("p", { class: "jira-facet-empty", text: t.jiraFacetNoValue });
		empty.hidden = true;
		const items = counts.map((entry) => {
			const item = checkItem(
				valueName(facet, entry.value),
				chosen.has(entry.value),
				entry.count === 0 ? null : entry.count,
				() => {
					toggleValue(facet, entry.value);
					for (const each of items) {
						each.setAttribute(
							"aria-checked",
							String(chosenOf(facet).has(each.dataset.value ?? "")),
						);
					}
				},
				facet === "type" ? typeBadge(entry.value) : null,
			);
			item.dataset.value = entry.value;
			return item;
		});
		const find = el("input", {
			class: "jira-facet-find",
			attrs: { type: "search", placeholder: t.jiraFacetFind, "aria-label": t.jiraFacetFind },
		});
		find.addEventListener("input", () => {
			// Both ways lower-cased: "I" is "ı" in Turkish and "i" in English.
			const lower = (text: string): string[] => [
				text.toLocaleLowerCase("tr"),
				text.toLocaleLowerCase("en"),
			];
			const words = lower(find.value.trim());
			for (const item of items) {
				const text = lower(item.textContent ?? "");
				item.hidden = !text.some((each) => words.some((word) => each.includes(word)));
			}
			empty.hidden = items.some((item) => !item.hidden);
		});
		find.addEventListener("keydown", (event) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				items.find((item) => !item.hidden)?.focus();
			}
		});
		openPopup(anchor, [
			el("div", { class: "jira-menu-heading", text: facetName(facet) }),
			...(counts.length > FIND_FROM ? [find] : []),
			el("div", { class: "jira-facet-options", children: [...items, empty] }),
		]);
		// The chips are drawn again on every choice: the popup stays by the facet's row.
		popupFor = anchor;
	}

	function renderStatus(): void {
		if (failed) return;
		status.className = "jira-message jira-pane-message";
		status.title = lastJql;
		if (loading) {
			status.textContent = t.confluenceLoading;
			return;
		}
		status.textContent =
			issues.length === 0
				? t.jiraNoIssues
				: total === null
					? ""
					: format(t.jiraCount, issues.length, total);
		if (choosing()) {
			const clear = el("button", {
				class: "confluence-link jira-facets-clear",
				text: t.jiraFacetsClear,
				attrs: { type: "button" },
			});
			clear.addEventListener("click", () => {
				selection.clear();
				void run(false);
			});
			status.append(status.textContent === "" ? "" : " ", clear);
		}
	}

	const row = (
		issue: JiraIssueRef | JiraIssueRow,
		extra: string,
		lead: HTMLElement | null,
		subtasks: readonly JiraIssueRow[] = [],
	): HTMLElement => {
		const done = subtasks.filter((child) => child.statusCategory === "done").length;
		const meta = [
			...(subtasks.length === 0
				? []
				: [
						el("span", {
							class: "jira-progress",
							attrs: { title: format(t.jiraSubtasksDone, done, subtasks.length) },
							children: [
								el("progress", {
									attrs: { max: String(subtasks.length), value: String(done) },
								}),
								el("span", { text: `${done}/${subtasks.length}` }),
							],
						}),
					]),
			// A parent only its sub-tasks matched has no row of its own, so no assignee.
			...(!("assignee" in issue)
				? []
				: [issue.assignee === "" ? unassigned() : avatar(issue.assignee)]),
		];
		const star = el("button", {
			class: "jira-star",
			attrs: { type: "button", tabindex: "-1", "data-key": issue.key },
		});
		drawStar(star, isFavorite(issue.key));
		star.addEventListener("click", (event) => {
			event.stopPropagation();
			toggleFavorite(issue);
		});
		const item = el("li", {
			class: `jira-row jira-pane-row ${extra}`.trim(),
			attrs: {
				tabindex: "-1",
				role: "treeitem",
				"data-key": issue.key,
				"data-kind": issueTypeKind(issue.type),
				title: issue.summary,
			},
			children: [
				...(lead === null ? [] : [lead]),
				typeBadge(issue.type),
				el("span", {
					class: "jira-pane-row-body",
					children: [
						el("span", {
							class: "jira-pane-row-head",
							children: [
								el("span", { class: "jira-key", text: issue.key }),
								star,
								...(issue.status === "" ? [] : [statusLozenge(issue.status, issue.statusCategory)]),
							],
						}),
						el("span", { class: "jira-summary", text: issue.summary }),
						...(meta.length === 0
							? []
							: [el("span", { class: "jira-pane-row-meta", children: meta })]),
					],
				}),
			],
		});
		const open = (): void => options.openIssue(issue.key);
		item.addEventListener("click", open);
		item.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open();
			// The menu from the keyboard: the context menu key or Shift+F10.
			if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
				event.preventDefault();
				const box = item.getBoundingClientRect();
				showMenu(issue, item, box.left + 24, box.top + box.height / 2);
			}
		});
		item.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			showMenu(issue, item, event.clientX, event.clientY);
		});
		return item;
	};

	// --- A row's menu: quick work logs, the work log form, the star, open, copy ------
	const menu = el("div", {
		class: "dock-menu jira-row-menu",
		attrs: { role: "menu", hidden: "" },
	});
	document.body.append(menu);
	let menuFor: HTMLElement | null = null;
	const closeMenu = (refocus = false): void => {
		if (menu.hidden) return;
		menu.hidden = true;
		if (refocus) menuFor?.focus();
		menuFor = null;
	};
	document.addEventListener("mousedown", (event) => {
		if (!(event.target instanceof Node && menu.contains(event.target))) closeMenu();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") closeMenu(true);
	});
	menu.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const items = [...menu.querySelectorAll<HTMLElement>("button")];
		const index = items.indexOf(document.activeElement as HTMLElement);
		const step = event.key === "ArrowDown" ? 1 : -1;
		items[(index + step + items.length) % items.length]?.focus();
	});

	function showMenu(issue: JiraIssueRef, item: HTMLElement, x: number, y: number): void {
		menuFor = item;
		const action = (label: string, run: () => void, extra = ""): HTMLButtonElement => {
			const button = el("button", {
				class: `dock-menu-item ${extra}`.trim(),
				text: label,
				attrs: { type: "button", role: "menuitem" },
			});
			button.addEventListener("click", () => {
				closeMenu();
				run();
			});
			return button;
		};
		const quick = el("div", {
			class: "jira-menu-quick",
			attrs: { role: "group", "aria-label": t.jiraQuickLogToday },
			children: QUICK_HOURS.map((hours) => {
				const button = el("button", {
					class: "jira-worklog-chip",
					text: `${hours}h`,
					attrs: {
						type: "button",
						role: "menuitem",
						"data-hours": String(hours),
						title: format(t.jiraQuickLogTitle, `${hours}h`, issue.key),
					},
				});
				button.addEventListener("click", () => {
					closeMenu();
					void quickLog(issue.key, item, hours * 3600);
				});
				return button;
			}),
		});
		menu.replaceChildren(
			el("div", {
				class: "jira-menu-heading",
				text: `${issue.key} · ${t.jiraQuickLogToday}`,
			}),
			quick,
			action(`${t.jiraLogWork}…`, () => options.logWork(issue.key)),
			el("hr", { class: "dock-menu-separator" }),
			action(
				isFavorite(issue.key) ? `☆ ${t.jiraUnfavorite}` : `★ ${t.jiraFavorite}`,
				() => toggleFavorite(issue),
				"jira-menu-star",
			),
			action(t.jiraOpenIssue, () => options.openIssue(issue.key)),
			action(t.jiraCopyKey, () => void navigator.clipboard.writeText(issue.key)),
		);
		menu.hidden = false;
		const box = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`;
		menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`;
		quick.querySelector<HTMLElement>("button")?.focus();
	}

	/** A note on the row for a while: logging, logged, or why not. */
	function note(item: HTMLElement, text: string, kind: "busy" | "ok" | "error"): void {
		const head = item.querySelector(".jira-pane-row-head");
		item.querySelector(".jira-row-note")?.remove();
		const badge = el("span", {
			class: "jira-row-note",
			text,
			attrs: { "data-kind": kind, role: "status" },
		});
		head?.append(badge);
		if (kind !== "busy") setTimeout(() => badge.remove(), kind === "ok" ? 4000 : 8000);
	}

	/** Logs `seconds` today with the remembered choices; the full form when one is missing. */
	async function quickLog(key: string, item: HTMLElement, seconds: number): Promise<void> {
		note(item, t.jiraWorkSending, "busy");
		try {
			const context = await bridge.jiraWorklogContext(key);
			const quick = quickEntry(context, key, seconds, today());
			if ("missing" in quick) {
				note(item, format(t.jiraWorkRequired, quick.missing.join(", ")), "error");
				options.logWork(key);
				return;
			}
			await bridge.jiraLogWork(key, {
				...quick.entry,
				offsetMinutes: -new Date().getTimezoneOffset(),
			});
			note(item, `✓ ${formatDuration(seconds)}`, "ok");
		} catch (error) {
			note(item, format(t.jiraWorkFailed, errorText(error)), "error");
		}
	}

	/** Sub-tasks under their parent, which folds them away; a parent not shown heads them dimmed. */
	function renderTree(): void {
		const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
			".jira-pane-row",
		)?.dataset.key;
		const byKey = new Map(issues.map((issue) => [issue.key, issue]));
		const groups = groupByParent(issues);
		rows.replaceChildren(
			...groups.flatMap((group) => {
				const key = group.parent.key;
				const count = group.children.length;
				const open = drawers.get(key) ?? startsOpen(group);
				const toggle =
					count === 0
						? el("span", { class: "jira-tree-toggle jira-tree-spacer" })
						: el("button", {
								class: "jira-tree-toggle",
								attrs: {
									type: "button",
									tabindex: "-1",
									"aria-expanded": String(open),
									"aria-label": format(t.jiraSubtasks, count),
									title: format(t.jiraSubtasks, count),
								},
								children: [icon("chevron")],
							});
				toggle.addEventListener("click", (event) => {
					if (count === 0) return;
					event.stopPropagation();
					fold(key, open);
				});
				const head = row(
					group.row ?? byKey.get(key) ?? group.parent,
					[
						"jira-tree-root",
						count > 0 ? "jira-tree-parent" : "",
						group.row === null ? "jira-tree-context" : "",
					]
						.join(" ")
						.trim(),
					toggle,
					group.children,
				);
				if (count > 0) head.setAttribute("aria-expanded", String(open));
				const children = open
					? group.children.map((child, index) =>
							row(
								child,
								index === count - 1 ? "jira-tree-child jira-tree-last" : "jira-tree-child",
								null,
							),
						)
					: [];
				return [head, ...children];
			}),
		);
		const items = [...rows.querySelectorAll<HTMLElement>(".jira-pane-row")];
		const current = items.find((item) => item.dataset.key === focused);
		(current ?? items[0])?.setAttribute("tabindex", "0");
		current?.focus();
	}

	function fold(key: string, open: boolean): void {
		// `open` is how it is now; it turns the other way, and stays so.
		drawers.set(key, !open);
		renderTree();
		rows.querySelector<HTMLElement>(`.jira-tree-root[data-key="${CSS.escape(key)}"]`)?.focus();
	}

	function render(): void {
		renderTypes();
		renderTree();
		renderStatus();
	}

	// The tree's keys: up and down move, left and right fold and unfold, Home and End jump.
	rows.addEventListener("keydown", (event) => {
		const item = (event.target as HTMLElement).closest<HTMLElement>(".jira-pane-row");
		if (item === null) return;
		const items = [...rows.querySelectorAll<HTMLElement>(".jira-pane-row")];
		const index = items.indexOf(item);
		const key = item.dataset.key ?? "";
		let target: HTMLElement | undefined;
		switch (event.key) {
			case "ArrowDown":
				target = items[index + 1];
				break;
			case "ArrowUp":
				target = items[index - 1];
				break;
			case "Home":
				target = items[0];
				break;
			case "End":
				target = items.at(-1);
				break;
			case "ArrowLeft":
				if (item.getAttribute("aria-expanded") === "true") fold(key, true);
				else if (item.classList.contains("jira-tree-child")) {
					for (let each = index - 1; each >= 0 && target === undefined; each--) {
						if (items[each]?.classList.contains("jira-tree-root")) target = items[each];
					}
				}
				break;
			case "ArrowRight":
				if (item.getAttribute("aria-expanded") === "false") fold(key, false);
				else if (item.getAttribute("aria-expanded") === "true") target = items[index + 1];
				break;
			default:
				return;
		}
		event.preventDefault();
		if (target === undefined) return;
		for (const each of items) each.setAttribute("tabindex", "-1");
		target.setAttribute("tabindex", "0");
		target.focus();
	});

	/** The values the answer has, kept for the chips; people's ids, for JQL. */
	function remember(found: readonly JiraIssueRow[]): void {
		for (const facet of FACETS) {
			const values = seen.get(facet) ?? new Set<string>();
			for (const { value } of facetCounts(found, facet)) values.add(value);
			seen.set(facet, values);
		}
		for (const row of found) {
			if (row.assignee !== "" && row.assigneeId !== undefined && row.assigneeId !== "") {
				people.set(row.assignee, row.assigneeId);
			}
		}
	}

	async function run(append: boolean): Promise<void> {
		const id = ++searchId;
		if (!append) {
			issues = [];
			rows.replaceChildren();
			next = null;
			total = null;
		}
		loading = true;
		failed = false;
		renderTypes();
		renderStatus();
		more.hidden = true;
		try {
			site ??= (await bridge.jiraAccount())?.site ?? null;
			if (id !== searchId) return;
			const favorites = conditions.includes("favorites") ? starred() : null;
			if (favorites !== null && favorites.length === 0) {
				loading = false;
				issues = [];
				render();
				status.textContent = t.jiraNoFavorites;
				return;
			}
			const filters = [
				...conditions.flatMap((condition) => {
					const jql = conditionJql(
						condition,
						(favorites ?? []).map((item) => item.key),
					);
					return jql === null ? [] : [jql];
				}),
				...facets.flatMap((facet) => {
					const jql = facetJql(facet, chosenOf(facet), (name) => people.get(name));
					return jql === null ? [] : [jql];
				}),
			];
			const typed = search.value.trim();
			const query = composeJql(filters, typed);
			lastJql = query;
			// The starred issues alone, as they were starred: kept when Jira cannot give one.
			const onlyFavorites = favorites !== null && filters.length === 1 && typed === "";
			let found: Awaited<ReturnType<typeof bridge.jiraSearch>>;
			try {
				found = await bridge.jiraSearch(query, append ? next : null);
			} catch (error) {
				// A starred issue that is gone (or hidden now) fails the whole search: what was kept is shown.
				if (!onlyFavorites || favorites === null) throw error;
				found = { jql: query, issues: favorites.map(keptRow), total: null, next: null };
			}
			if (id !== searchId) return;
			if (onlyFavorites && favorites !== null) {
				// In the order they were starred; one Jira did not return is shown as it was kept.
				found = {
					...found,
					issues: favorites.map(
						(item) => found.issues.find((issue) => issue.key === item.key) ?? keptRow(item),
					),
				};
			}
			remember(found.issues);
			issues = [...issues, ...found.issues];
			next = found.next;
			total = found.total;
			loading = false;
			more.hidden = next === null;
			render();
		} catch (error) {
			if (id !== searchId) return;
			loading = false;
			failed = true;
			renderTypes();
			status.className = "jira-error jira-pane-message";
			status.textContent = format(t.jiraRequestFailed, errorText(error));
		}
	}

	/** A starred issue as it was when starred. */
	const keptRow = (item: JiraFavorite): JiraIssueRow => ({
		key: item.key,
		summary: item.summary,
		status: "",
		statusCategory: "",
		type: item.type,
		assignee: "",
		priority: "",
		updated: null,
		parent: null,
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	search.addEventListener("input", () => {
		clearTimeout(timer);
		timer = setTimeout(() => void run(false), 350);
	});
	search.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			clearTimeout(timer);
			void run(false);
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			rows.querySelector<HTMLElement>(".jira-pane-row")?.focus();
		}
		// As in the Files and Confluence panes: Escape empties the search, and the list comes back.
		if (event.key === "Escape" && search.value !== "") {
			event.stopPropagation();
			clearTimeout(timer);
			search.value = "";
			void run(false);
		}
	});
	more.addEventListener("click", () => void run(true));

	return {
		element,
		refresh: () => {
			site = null;
			return run(false);
		},
		favoritesChanged,
	};
}
