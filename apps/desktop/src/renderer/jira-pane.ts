import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { JiraIssueRow } from "../shared/jira.js";
import { el } from "./dom.js";
import { statusLozenge } from "./jira-dialog.js";

export interface JiraPaneOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	/** Opens an issue in the Jira dialog. */
	openIssue(key: string): void;
}

/** The pane's ready-made lists, as JQL. */
const LISTS = {
	mine: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
	reported: "reporter = currentUser() ORDER BY updated DESC",
	watching: "watcher = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
	recent: "ORDER BY updated DESC",
} as const;
type List = keyof typeof LISTS;

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/**
 * Jira in a dock: the user's issues (assigned, reported, watched, recent)
 * or a search by key, words or JQL; an issue opens in the Jira dialog.
 */
export function createJiraPane(options: JiraPaneOptions): {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
} {
	const { t, bridge } = options;
	const search = el("input", {
		class: "confluence-pane-search jira-pane-search",
		attrs: {
			type: "search",
			placeholder: t.jiraSearchPlaceholder,
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
			] as const
		).map(([value, label]) => el("option", { text: label, attrs: { value } })),
	});
	const status = el("p", { class: "jira-message jira-pane-message" });
	const rows = el("ul", { class: "jira-list jira-pane-rows" });
	const more = el("button", {
		class: "confluence-link jira-more",
		text: t.jiraMore,
		attrs: { type: "button" },
	});
	more.hidden = true;
	const element = el("div", {
		class: "jira-pane",
		children: [
			el("div", { class: "jira-pane-toolbar", children: [search, list] }),
			status,
			rows,
			more,
		],
	});

	let searchId = 0;
	let next: string | null = null;
	let shown = 0;

	const row = (issue: JiraIssueRow): HTMLElement => {
		const item = el("li", {
			class: "jira-row jira-pane-row",
			attrs: { tabindex: "0", role: "link", "data-key": issue.key, title: issue.summary },
			children: [
				el("span", {
					class: "jira-pane-row-head",
					children: [
						el("span", { class: "jira-key", text: issue.key }),
						...(issue.status === "" ? [] : [statusLozenge(issue.status, issue.statusCategory)]),
					],
				}),
				el("span", { class: "jira-summary", text: issue.summary }),
			],
		});
		const open = (): void => options.openIssue(issue.key);
		item.addEventListener("click", open);
		item.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open();
		});
		return item;
	};

	async function run(append: boolean): Promise<void> {
		const id = ++searchId;
		if (!append) {
			rows.replaceChildren();
			shown = 0;
			next = null;
		}
		status.className = "jira-message jira-pane-message";
		status.textContent = t.confluenceLoading;
		more.hidden = true;
		const query = search.value.trim() === "" ? LISTS[list.value as List] : search.value;
		try {
			const found = await bridge.jiraSearch(query, append ? next : null);
			if (id !== searchId) return;
			rows.append(...found.issues.map(row));
			shown += found.issues.length;
			next = found.next;
			more.hidden = next === null;
			status.textContent =
				shown === 0
					? t.jiraNoIssues
					: found.total === null
						? ""
						: format(t.jiraCount, shown, found.total);
		} catch (error) {
			if (id !== searchId) return;
			status.className = "jira-error jira-pane-message";
			status.textContent = format(t.jiraRequestFailed, errorText(error));
		}
	}

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
	});
	list.addEventListener("change", () => {
		search.value = "";
		void run(false);
	});
	more.addEventListener("click", () => void run(true));

	return { element, refresh: () => run(false) };
}
