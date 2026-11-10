import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { JiraFavorite, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type {
	JiraAccount,
	JiraIssue,
	JiraIssueRef,
	JiraIssueRow,
	JiraRemoteLink,
	StatusCategory,
} from "../shared/jira.js";
import { issueKey, issueKeyFromUrl, normalizeJiraSite } from "../shared/jira.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { createDevelopmentSection, createStatusControl } from "./jira-development.js";
import { jiraHtmlRoot } from "./jira-html.js";
import { createWorklogForm } from "./jira-worklog.js";

export interface JiraDialogOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	openLink(url: string): void;
	/** After a login or a disconnect. */
	onAccountChange?(): void;
	/** After the issue changed in Kalem (its status): lists showing it are read again. */
	onIssueChange?(key: string): void;
	/** The starred issues, of every Jira site. */
	favorites(): readonly JiraFavorite[];
	setFavorites(favorites: readonly JiraFavorite[]): void;
}

export interface JiraDialog {
	/** Shows an issue; `browserUrl` is where it opens while Jira is not connected. */
	showIssue(key: string, browserUrl?: string | null): Promise<void>;
	/** Shows an issue with its work log form open. */
	logWork(key: string): Promise<void>;
	/** Shows a search: JQL, a key or words. */
	showSearch(query?: string, browserUrl?: string | null): Promise<void>;
	/** Asks for the login, then shows the search. */
	showLogin(): Promise<void>;
}

/** What the dialog shows; the back button returns to the one before. */
type View =
	| { readonly kind: "issue"; readonly key: string }
	| { readonly kind: "search"; query: string };

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Jira's status colours by their category: grey to do, blue in progress, green done. */
export function statusLozenge(status: string, category: StatusCategory): HTMLElement {
	return el("span", {
		class: "jira-status",
		text: status,
		attrs: { "data-category": category === "" ? "new" : category },
	});
}

/**
 * Jira's issues in Kalem: one issue with its fields, description,
 * sub-tasks, links and comments, or a search's issues. Linked issues open
 * in the same dialog, with a way back. Without a connection it asks for
 * the login first (Cloud uses Confluence's when it is on the same site).
 */
export function createJiraDialog(options: JiraDialogOptions): JiraDialog {
	const { t, bridge } = options;
	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "medium" });
	const timeFormat = new Intl.DateTimeFormat(options.lang, {
		dateStyle: "medium",
		timeStyle: "short",
	});
	const when = (value: string | null, withTime = false): string => {
		if (value === null) return "";
		const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
		if (Number.isNaN(date.getTime())) return value;
		return (withTime ? timeFormat : dateFormat).format(date);
	};

	const button = (
		label: string,
		name: IconName | null,
		run: () => void | Promise<void>,
		className = "jira-button",
	): HTMLButtonElement => {
		const element = el("button", {
			class: className,
			attrs: { type: "button" },
			children: name === null ? [label] : [icon(name), label],
		});
		element.addEventListener("click", () => void run());
		return element;
	};

	// --- Frame ----------------------------------------------------------------
	const back = el("button", {
		class: "jira-icon-button",
		attrs: { type: "button", "aria-label": t.jiraBack, title: t.jiraBack },
		text: "←",
	});
	const heading = el("span", { class: "jira-heading", text: "Jira" });
	const siteLabel = el("span", { class: "jira-site" });
	const searchButton = el("button", {
		class: "jira-icon-button",
		attrs: { type: "button", "aria-label": t.jiraSearchTitle, title: t.jiraSearchTitle },
		children: [icon("find")],
	});
	const close = el("button", {
		class: "jira-icon-button",
		attrs: { type: "button", "aria-label": t.jiraClose, title: t.jiraClose },
		children: [icon("close")],
	});
	const body = el("div", { class: "jira-body" });
	const dialog = el("dialog", {
		class: "jira-dialog",
		attrs: { "aria-label": "Jira", lang: options.lang },
		children: [
			el("div", {
				class: "jira-header",
				children: [back, heading, siteLabel, searchButton, close],
			}),
			body,
		],
	});
	document.body.append(dialog);

	let history: View[] = [];
	let account: JiraAccount | null = null;
	/** Where the shown item opens while Jira is not connected. */
	let fallback: string | null = null;
	/** Answers that come after the dialog moved on are dropped. */
	let shownId = 0;
	/** Once opened, the work log form stays open for the next issue too. */
	let worklogOpen = false;

	const current = (): View | undefined => history.at(-1);

	function updateHeader(): void {
		back.hidden = history.length < 2;
		searchButton.hidden = account === null;
		// The site by its name, the whole address on hover: the scheme and path add nothing here.
		const host = account === null ? "" : hostOf(account.site);
		siteLabel.textContent =
			account === null
				? ""
				: account.shared
					? `${t.jiraSharedLogin} · ${host}`
					: account.username === ""
						? host
						: `${account.username} · ${host}`;
		siteLabel.title = account?.site ?? "";
	}

	function message(text: string, kind: "info" | "error" = "info"): HTMLElement {
		return el("p", {
			class: kind === "error" ? "jira-error" : "jira-message",
			text,
			attrs: kind === "error" ? { role: "alert" } : {},
		});
	}

	function go(view: View): void {
		history.push(view);
		void render();
	}

	/** An issue as a list's row: key, summary, status; it opens in the dialog. */
	function issueRow(ref: JiraIssueRef | JiraIssueRow, relation = ""): HTMLElement {
		const row = el("li", {
			class: "jira-row",
			attrs: { tabindex: "0", role: "link", "data-key": ref.key },
			children: [
				...(relation === "" ? [] : [el("span", { class: "jira-relation", text: relation })]),
				el("span", { class: "jira-key", text: ref.key }),
				el("span", { class: "jira-summary", text: ref.summary }),
				...("assignee" in ref && ref.assignee !== ""
					? [el("span", { class: "jira-assignee", text: ref.assignee })]
					: []),
				...(ref.status === "" ? [] : [statusLozenge(ref.status, ref.statusCategory)]),
			],
		});
		const open = (): void => go({ kind: "issue", key: ref.key });
		row.addEventListener("click", open);
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open();
		});
		return row;
	}

	// --- Login ------------------------------------------------------------------
	async function renderLogin(error = ""): Promise<void> {
		const field = (label: string, input: HTMLInputElement): HTMLLabelElement =>
			el("label", { class: "confluence-field", children: [el("span", { text: label }), input] });
		const site = el("input", {
			attrs: { type: "url", placeholder: "https://jira.example.com", autocomplete: "url" },
		});
		const username = el("input", { attrs: { type: "text", autocomplete: "username" } });
		const token = el("input", { attrs: { type: "password", autocomplete: "current-password" } });
		const loginError = el("p", {
			class: "confluence-error",
			attrs: { role: "alert" },
			text: error,
		});
		const connect = el("button", {
			class: "confluence-primary",
			text: t.jiraConnect,
			attrs: { type: "submit" },
		});
		const actions: HTMLElement[] = [];
		const url = fallback;
		if (url !== null) {
			actions.push(
				button(t.linkOpenBrowser, "open", () => {
					dialog.close();
					options.openLink(url);
				}),
			);
		}
		actions.push(connect);
		const form = el("form", {
			class: "confluence-login",
			children: [
				el("h2", { text: t.jiraConnectTitle }),
				...(current() === undefined
					? []
					: [el("p", { class: "jira-message", text: t.jiraOpenHint })]),
				field(t.jiraSite, site),
				field(t.confluenceUsername, username),
				field(t.confluenceToken, token),
				el("p", { class: "confluence-hint", text: t.jiraLoginHint }),
				loginError,
				el("div", { class: "confluence-actions jira-actions", children: actions }),
			],
		});
		body.replaceChildren(form);
		// The address the page's issue opens at, or the Jira Confluence knows, is filled in.
		if (url !== null) {
			try {
				site.value = normalizeJiraSite(url);
			} catch {}
		}
		if (site.value === "") {
			const suggested = await bridge.jiraSuggestedSite().catch(() => null);
			if (suggested !== null && site.value === "") site.value = suggested;
		}
		(site.value === "" ? site : token).focus();
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			connect.disabled = true;
			connect.textContent = t.jiraConnecting;
			loginError.textContent = "";
			bridge
				.jiraConnect({ site: site.value, username: username.value, token: token.value })
				.then((connected) => {
					token.value = "";
					account = connected;
					options.onAccountChange?.();
					if (current() === undefined) history.push({ kind: "search", query: "" });
					return render();
				})
				.catch((failure: unknown) => {
					loginError.textContent = format(t.jiraConnectFailed, errorText(failure));
				})
				.finally(() => {
					connect.disabled = false;
					connect.textContent = t.jiraConnect;
				});
		});
	}

	// --- Issue ------------------------------------------------------------------
	function renderIssue(issue: JiraIssue): void {
		const facts: [string, string][] = [
			[t.jiraType, issue.type],
			[t.jiraPriority, issue.priority],
			[t.jiraAssignee, issue.assignee || t.jiraUnassigned],
			[t.jiraReporter, issue.reporter],
			[t.jiraResolution, issue.resolution],
			[t.jiraProject, issue.project],
			[t.jiraCreated, when(issue.created)],
			[t.jiraUpdated, when(issue.updated)],
			[t.jiraDue, when(issue.due)],
			[t.jiraLabels, issue.labels.join(", ")],
			[t.jiraComponents, issue.components.join(", ")],
			[t.jiraFixVersions, issue.fixVersions.join(", ")],
		];
		const worklogSlot = el("div", { class: "jira-worklog-slot" });
		const logWork = button(t.jiraLogWork, "clock", () => toggleWorklog(!worklogOpen));
		logWork.classList.add("jira-log-work");
		const toggleWorklog = (open: boolean): void => {
			worklogOpen = open;
			logWork.setAttribute("aria-expanded", String(open));
			if (!open) {
				worklogSlot.replaceChildren();
				return;
			}
			if (worklogSlot.childElementCount > 0) return;
			const form = createWorklogForm({
				t,
				bridge,
				issueKey: issue.key,
				formatDate: (iso) => when(iso),
			});
			worklogSlot.replaceChildren(form);
			form.querySelector<HTMLElement>(".jira-worklog-chip")?.focus();
		};
		const description = richText(issue.description, issue.descriptionHtml);
		if (issue.description === "" && issue.descriptionHtml === null) {
			description.append(message(t.jiraNoDescription));
		}
		const sections: HTMLElement[] = [
			el("div", {
				class: "jira-issue-head",
				children: [
					el("span", { class: "jira-key", text: issue.key }),
					...(issue.type === "" ? [] : [el("span", { class: "jira-type", text: issue.type })]),
					...(issue.status === ""
						? []
						: [
								createStatusControl({
									t,
									bridge,
									issueKey: issue.key,
									status: issue.status,
									category: issue.statusCategory,
									issueUrl: issue.url,
									openLink: options.openLink,
									onChanged: () => void refreshIssue(issue.key),
								}),
							]),
				],
			}),
			el("h2", { class: "jira-title", text: issue.summary }),
			el("div", {
				class: "jira-actions",
				children: [
					button(
						t.linkOpenBrowser,
						"open",
						() => options.openLink(issue.url),
						"jira-button primary",
					),
					logWork,
					favoriteButton(issue),
					copyButton(t.jiraCopyKey, issue.key),
					copyButton(t.linkCopyUrl, issue.url),
				],
			}),
			worklogSlot,
			el("dl", {
				class: "jira-fields",
				children: facts
					.filter(([, value]) => value !== "")
					.flatMap(([name, value]) => [el("dt", { text: name }), el("dd", { text: value })]),
			}),
		];
		if (issue.id !== "") {
			sections.push(
				createDevelopmentSection({
					t,
					lang: options.lang,
					bridge,
					issueId: issue.id,
					openLink: options.openLink,
					fold,
				}),
			);
		}
		if (issue.parent !== null) {
			sections.push(fold(t.jiraParent, [list([issueRow(issue.parent)])]));
		}
		sections.push(fold(t.jiraDescription, [description]));
		if (issue.subtasks.length > 0) {
			sections.push(
				fold(format(t.jiraSubtasks, issue.subtasks.length), [
					list(
						issue.subtasks.map((ref, index) => issueRow(ref, `${index + 1}.`)),
						"jira-subtasks",
					),
				]),
			);
		}
		// Links grouped by how they relate, as Jira's "Issue Links": issues and Confluence pages together.
		const groups = new Map<string, HTMLElement[]>();
		const add = (relation: string, row: HTMLElement): void => {
			const rows = groups.get(relation) ?? [];
			rows.push(row);
			groups.set(relation, rows);
		};
		for (const link of issue.links) add(link.relation, issueRow(link.issue));
		for (const link of issue.remoteLinks) add(link.relation, remoteRow(link));
		const linkCount = issue.links.length + issue.remoteLinks.length;
		if (linkCount > 0) {
			sections.push(
				fold(
					format(t.jiraLinks, linkCount),
					[...groups].map(([relation, rows]) =>
						el("div", {
							class: "jira-link-group",
							children: [el("h4", { text: relation }), list(rows)],
						}),
					),
				),
			);
		}
		if (issue.comments.length > 0) {
			const title =
				issue.commentTotal > issue.comments.length
					? format(t.jiraCommentsLatest, issue.commentTotal, issue.comments.length)
					: format(t.jiraComments, issue.commentTotal);
			sections.push(
				fold(
					title,
					issue.comments.map((comment) =>
						el("article", {
							class: "jira-comment",
							children: [
								el("div", {
									class: "jira-comment-head",
									children: [
										el("strong", { text: comment.author }),
										el("span", { text: when(comment.created, true) }),
									],
								}),
								richText(comment.body, comment.html),
							],
						}),
					),
				),
			);
		}
		body.replaceChildren(...sections);
		heading.textContent = issue.key;
		toggleWorklog(worklogOpen);
	}

	/** A part of the issue that folds away, as Jira's own sections do. */
	function fold(title: string, children: readonly HTMLElement[]): HTMLElement {
		const part = el("details", {
			class: "jira-section",
			attrs: { open: "" },
			children: [el("summary", { children: [el("h3", { text: title })] }), ...children],
		});
		return part;
	}

	function list(rows: readonly HTMLElement[], extra = ""): HTMLElement {
		return el("ul", { class: `jira-list ${extra}`.trim(), children: rows });
	}

	/** Text as Jira shows it: HTML drawn as a page (not as code), wiki markup as Markdown. */
	function richText(markdown: string, html: string | null): HTMLElement {
		const target = el("div", { class: "jira-markdown" });
		renderToDOM(html === null ? parse(markdown) : jiraHtmlRoot(html), target, {
			containerClass: false,
		});
		return target;
	}

	/** A link outside Jira: a Confluence page opens in a tab of Kalem, anything else in the browser. */
	function remoteRow(link: JiraRemoteLink): HTMLElement {
		const row = el("li", {
			class: "jira-row jira-remote",
			attrs: { tabindex: "0", role: "link", title: link.url, "data-url": link.url },
			children: [
				icon(link.pageId === null ? "link" : "confluence"),
				el("span", { class: "jira-summary", text: link.title }),
			],
		});
		const open = async (): Promise<void> => {
			const pageId = link.pageId;
			if (pageId === null) {
				options.openLink(link.url);
				return;
			}
			try {
				await bridge.confluenceOpenPage(pageId);
				dialog.close();
			} catch {
				options.openLink(link.url);
			}
		};
		row.addEventListener("click", () => void open());
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter") void open();
		});
		return row;
	}

	/** Stars the issue, or takes the star off: it is then in the Jira pane's favorites. */
	function favoriteButton(issue: JiraIssue): HTMLButtonElement {
		const site = account?.site ?? null;
		const starred = (): boolean =>
			options.favorites().some((item) => item.site === site && item.key === issue.key);
		const star = el("button", { class: "jira-button jira-favorite", attrs: { type: "button" } });
		const draw = (): void => {
			const on = starred();
			star.textContent = `${on ? "★" : "☆"} ${on ? t.jiraUnfavorite : t.jiraFavorite}`;
			star.setAttribute("aria-pressed", String(on));
		};
		star.addEventListener("click", () => {
			if (site === null) return;
			const all = options.favorites();
			options.setFavorites(
				starred()
					? all.filter((item) => !(item.site === site && item.key === issue.key))
					: [{ site, key: issue.key, summary: issue.summary, type: issue.type }, ...all],
			);
			draw();
		});
		draw();
		star.hidden = site === null;
		return star;
	}

	function copyButton(label: string, text: string): HTMLButtonElement {
		const copy = button(label, "copy", async () => {
			await navigator.clipboard.writeText(text);
			const last = copy.lastChild;
			if (last !== null) last.textContent = t.linkCopied;
			setTimeout(() => {
				if (copy.lastChild !== null) copy.lastChild.textContent = label;
			}, 1200);
		});
		return copy;
	}

	// --- Search -------------------------------------------------------------------
	function renderSearch(view: Extract<View, { kind: "search" }>): void {
		heading.textContent = t.jiraSearchTitle;
		const input = el("input", {
			class: "quick-open-input",
			attrs: {
				type: "search",
				placeholder: t.jiraSearchPlaceholder,
				"aria-label": t.jiraSearchPlaceholder,
			},
		});
		input.value = view.query;
		const status = el("p", { class: "jira-message" });
		const list = el("ul", { class: "jira-list jira-results" });
		const more = el("button", {
			class: "confluence-link jira-more",
			text: t.jiraMore,
			attrs: { type: "button" },
		});
		more.hidden = true;
		body.replaceChildren(input, status, list, more);
		input.focus();

		let searchId = 0;
		let next: string | null = null;
		let shown = 0;
		const run = async (append: boolean): Promise<void> => {
			const id = ++searchId;
			view.query = input.value;
			if (!append) {
				list.replaceChildren();
				shown = 0;
				next = null;
			}
			status.textContent = t.confluenceLoading;
			status.className = "jira-message";
			more.hidden = true;
			try {
				const found = await bridge.jiraSearch(input.value, append ? next : null);
				if (id !== searchId) return;
				list.append(...found.issues.map((row) => issueRow(row)));
				shown += found.issues.length;
				next = found.next;
				more.hidden = next === null;
				status.textContent =
					shown === 0
						? t.jiraNoIssues
						: found.total === null
							? ""
							: format(t.jiraCount, shown, found.total);
				// A key that names one issue opens it.
				if (!append && found.issues.length === 1 && issueKey(input.value) !== null) {
					const [only] = found.issues;
					if (only !== undefined) go({ kind: "issue", key: only.key });
				}
			} catch (error) {
				if (id !== searchId) return;
				status.className = "jira-error";
				status.textContent = format(t.jiraRequestFailed, errorText(error));
			}
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		input.addEventListener("input", () => {
			clearTimeout(timer);
			timer = setTimeout(() => void run(false), 350);
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				clearTimeout(timer);
				void run(false);
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				(list.firstElementChild as HTMLElement | null)?.focus();
			}
		});
		list.addEventListener("keydown", (event) => {
			const row = document.activeElement;
			if (!(row instanceof HTMLElement) || row.parentElement !== list) return;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				(row.nextElementSibling as HTMLElement | null)?.focus();
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				((row.previousElementSibling as HTMLElement | null) ?? input).focus();
			}
		});
		more.addEventListener("click", () => void run(true));
		void run(false);
	}

	// --- Showing --------------------------------------------------------------------
	/** The issue read again where it is shown (after its status changed), keeping the place. */
	async function refreshIssue(key: string): Promise<void> {
		const id = ++shownId;
		try {
			const issue = await bridge.jiraIssue(key);
			const view = current();
			if (id !== shownId || view?.kind !== "issue" || view.key !== key) return;
			const scroll = body.scrollTop;
			renderIssue(issue);
			body.scrollTop = scroll;
			options.onIssueChange?.(key);
		} catch {
			// What is shown stays; the next look reads it again.
		}
	}

	async function render(): Promise<void> {
		const id = ++shownId;
		const view = current();
		updateHeader();
		if (account === null) {
			heading.textContent = "Jira";
			await renderLogin();
			return;
		}
		if (view === undefined || view.kind === "search") {
			renderSearch(view ?? { kind: "search", query: "" });
			return;
		}
		heading.textContent = view.key;
		body.replaceChildren(message(t.confluenceLoading));
		try {
			const issue = await bridge.jiraIssue(view.key);
			if (id !== shownId) return;
			renderIssue(issue);
			body.scrollTop = 0;
		} catch (error) {
			if (id !== shownId) return;
			const text = errorText(error);
			// A login that no longer works is asked for again.
			if (/HTTP 401/.test(text)) {
				account = null;
				updateHeader();
				await renderLogin(format(t.jiraConnectFailed, text));
				return;
			}
			const url = fallback;
			body.replaceChildren(
				message(format(t.jiraRequestFailed, text), "error"),
				el("div", {
					class: "jira-actions",
					children: [
						...(url === null
							? []
							: [button(t.linkOpenBrowser, "open", () => options.openLink(url))]),
						button(t.jiraConnectTo, "settings", async () => {
							await bridge.jiraDisconnect().catch(() => {});
							options.onAccountChange?.();
							account = null;
							updateHeader();
							await renderLogin();
						}),
					],
				}),
			);
		}
	}

	async function open(view: View, browserUrl: string | null): Promise<void> {
		fallback = browserUrl;
		history = [view];
		account = await bridge.jiraAccount().catch(() => null);
		if (!dialog.open) dialog.showModal();
		await render();
	}

	back.addEventListener("click", () => {
		if (history.length < 2) return;
		history.pop();
		fallback = null;
		void render();
	});
	searchButton.addEventListener("click", () => go({ kind: "search", query: "" }));
	close.addEventListener("click", () => dialog.close());
	// A click on the backdrop lands on the dialog element itself.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) {
			dialog.close();
			return;
		}
		// Links in a description or a comment: another issue opens here, the rest in the browser.
		const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (link === null || !body.contains(link)) return;
		event.preventDefault();
		const href = link.getAttribute("href") ?? "";
		const key = issueKeyFromUrl(href);
		if (key !== null && account !== null) go({ kind: "issue", key });
		else if (/^https?:\/\//i.test(href)) options.openLink(href);
	});
	// Alt+← goes back, like a browser.
	dialog.addEventListener("keydown", (event) => {
		const field = event.target instanceof HTMLInputElement;
		if (event.altKey && event.key === "ArrowLeft" && !field) back.click();
	});

	return {
		showIssue: (key, browserUrl = null) => open({ kind: "issue", key }, browserUrl),
		logWork: (key) => {
			worklogOpen = true;
			return open({ kind: "issue", key }, null);
		},
		showSearch: (query = "", browserUrl = null) => open({ kind: "search", query }, browserUrl),
		async showLogin() {
			fallback = null;
			history = [];
			account = null;
			if (!dialog.open) dialog.showModal();
			await render();
		},
	};
}

/** A site's host name, as people call it ("jira.example.com"); the text itself when it is no URL. */
function hostOf(site: string): string {
	try {
		return new URL(site).host;
	} catch {
		return site;
	}
}
