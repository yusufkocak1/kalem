import type { JiraFavorite, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { IssueTypeKind, JiraIssueRef, JiraIssueRow } from "../shared/jira.js";
import { groupByParent, issueTypeKind, typeCounts } from "../shared/jira.js";
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

/** The pane's ready-made lists, as JQL. */
const LISTS = {
	mine: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
	reported: "reporter = currentUser() ORDER BY updated DESC",
	watching: "watcher = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
	recent: "ORDER BY updated DESC",
} as const;
/** The ready-made lists, and the starred issues, which are asked for by their keys. */
type List = keyof typeof LISTS | "favorites";

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
 * Jira in a dock: the user's issues (assigned, reported, watched, recent)
 * or a search by key, words or JQL, narrowed by issue type; sub-tasks fold
 * under their parent. An issue opens in the Jira dialog.
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
	const list = el("select", {
		class: "jira-pane-list",
		attrs: { "aria-label": t.jiraSearchTitle },
		children: (
			[
				["mine", t.jiraPaneMine],
				["reported", t.jiraPaneReported],
				["watching", t.jiraPaneWatching],
				["recent", t.jiraPaneRecent],
				["favorites", `★ ${t.jiraFavorites}`],
			] as const
		).map(([value, label]) => el("option", { text: label, attrs: { value } })),
	});
	const types = el("div", {
		class: "jira-type-filter",
		attrs: { role: "group", "aria-label": t.jiraTypeFilter },
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
					list,
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
	/** Parents whose sub-tasks are folded away. */
	const folded = new Set<string>();
	/** The issue types shown; none means all of them. */
	const selected = new Set<string>();

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
		if (list.value === "favorites" && search.value.trim() === "") {
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

	const shownIssues = (): JiraIssueRow[] =>
		selected.size === 0 ? issues : issues.filter((issue) => selected.has(issue.type));

	function renderTypes(): void {
		const counts = typeCounts(issues);
		for (const type of selected) {
			if (!counts.some((entry) => entry.type === type)) selected.delete(type);
		}
		types.hidden = counts.length < 2 && selected.size === 0;
		const chip = (label: string, count: number, pressed: boolean, type: string | null) => {
			const button = el("button", {
				class: "jira-type-chip",
				attrs: { type: "button", "aria-pressed": String(pressed) },
				children: [
					...(type === null ? [] : [typeBadge(type)]),
					el("span", { class: "jira-type-chip-label", text: label }),
					el("span", { class: "jira-type-chip-count", text: String(count) }),
				],
			});
			if (type !== null) button.dataset.type = type;
			button.addEventListener("click", () => {
				if (type === null) selected.clear();
				else if (selected.has(type)) selected.delete(type);
				else selected.add(type);
				// Every type chosen is the same as none: show all.
				if (selected.size === counts.length) selected.clear();
				render();
			});
			return button;
		};
		types.replaceChildren(
			chip(t.jiraTypeAll, issues.length, selected.size === 0, null),
			...counts.map(({ type, count }) => chip(type, count, selected.has(type), type)),
		);
	}

	function renderStatus(): void {
		if (failed) return;
		status.className = "jira-message jira-pane-message";
		if (loading) {
			status.textContent = t.confluenceLoading;
			return;
		}
		const shown = shownIssues().length;
		status.textContent =
			issues.length === 0
				? t.jiraNoIssues
				: shown === 0
					? t.jiraNoTypeMatch
					: selected.size > 0
						? format(t.jiraFiltered, shown, issues.length)
						: total === null
							? ""
							: format(t.jiraCount, issues.length, total);
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
		const groups = groupByParent(shownIssues());
		rows.replaceChildren(
			...groups.flatMap((group) => {
				const key = group.parent.key;
				const count = group.children.length;
				const open = !folded.has(key);
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
		if (open) folded.add(key);
		else folded.delete(key);
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
		renderStatus();
		more.hidden = true;
		try {
			site ??= (await bridge.jiraAccount())?.site ?? null;
			if (id !== searchId) return;
			const chosen = list.value as List;
			const favorites = chosen === "favorites" && search.value.trim() === "" ? starred() : null;
			if (favorites !== null && favorites.length === 0) {
				loading = false;
				issues = [];
				render();
				status.textContent = t.jiraNoFavorites;
				return;
			}
			const query =
				favorites !== null
					? `key IN (${favorites.map((item) => item.key).join(", ")})`
					: search.value.trim() === ""
						? LISTS[chosen as keyof typeof LISTS]
						: search.value;
			let found: Awaited<ReturnType<typeof bridge.jiraSearch>>;
			try {
				found = await bridge.jiraSearch(query, append ? next : null);
			} catch (error) {
				// A starred issue that is gone (or hidden now) fails the whole search: what was kept is shown.
				if (favorites === null) throw error;
				found = { jql: query, issues: favorites.map(keptRow), total: null, next: null };
			}
			if (id !== searchId) return;
			if (favorites !== null) {
				// In the order they were starred; one Jira did not return is shown as it was kept.
				found = {
					...found,
					issues: favorites.map(
						(item) => found.issues.find((issue) => issue.key === item.key) ?? keptRow(item),
					),
				};
			}
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
			types.hidden = issues.length === 0;
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
	list.addEventListener("change", () => {
		search.value = "";
		void run(false);
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
