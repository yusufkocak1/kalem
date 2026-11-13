import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { JiraFavorite, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type {
	JiraAccount,
	JiraComment,
	JiraIssue,
	JiraIssueRef,
	JiraIssueRow,
	JiraRemoteLink,
	StatusCategory,
} from "../shared/jira.js";
import { issueKey, issueKeyFromUrl, normalizeJiraSite } from "../shared/jira.js";
import type { CommentFilter } from "../shared/jira-comments.js";
import {
	commentPeople,
	filterComments,
	formatDurationShort,
	NO_COMMENT_FILTER,
	parsePersonName,
	shortDateTime,
	timeBar,
} from "../shared/jira-comments.js";
import type { JiraAttachment, JiraParentLink } from "../shared/jira-fields.js";
import { isEmptyFieldText } from "../shared/jira-fields.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { createImageViewer } from "./image-viewer.js";
import { commentView, personMark } from "./jira-comment-view.js";
import { createComposer } from "./jira-composer.js";
import { createDevelopmentSection, createStatusControl } from "./jira-development.js";
import { createFieldChip } from "./jira-field-chip.js";
import { jiraHtmlRoot } from "./jira-html.js";
import { createJourneyBar } from "./jira-journey-bar.js";
import { createLabelEditor } from "./jira-labels.js";
import { typeBadge } from "./jira-pane.js";
import { decorateImages, decorateLinkCards, holdImages } from "./jira-rich-content.js";
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
type IssueTab = "detail" | "comments" | "development" | "subtasks";

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
	let shownKey = "";
	let activeTab: IssueTab = "detail";
	let commentFilter: CommentFilter = NO_COMMENT_FILTER;
	const viewer = createImageViewer({ t, readOnly: () => true, editAlt: () => {} });

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
		if (shownKey !== issue.key) {
			shownKey = issue.key;
			activeTab = "detail";
			commentFilter = NO_COMMENT_FILTER;
		}
		const worklogSlot = el("div", { class: "jira-worklog-slot" });
		const logWork = iconAction(t.jiraLogWork, "clock", () => toggleWorklog(!worklogOpen));
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

		let attachments: readonly JiraAttachment[] = issue.attachments;
		const decorate = (root: HTMLElement): void => {
			const rich = {
				t,
				bridge,
				attachments,
				issueUrl: issue.url,
				viewer,
				openLink: options.openLink,
				onConfluencePageOpened: () => dialog.close(),
			};
			decorateImages(root, rich);
			decorateLinkCards(root, rich);
		};

		const panels: { id: IssueTab; label: HTMLElement; panel: HTMLElement }[] = [];
		const commentLabel = el("span", { text: format(t.jiraTabComments, issue.commentTotal) });
		panels.push({
			id: "detail",
			label: el("span", { text: t.jiraTabDetail }),
			panel: detailPanel(issue, decorate),
		});
		panels.push({
			id: "comments",
			label: commentLabel,
			panel: commentsPanel(issue, decorate, (count, uploaded) => {
				commentLabel.textContent = format(t.jiraTabComments, count);
				attachments = [...attachments, ...uploaded];
			}),
		});
		if (issue.id !== "") {
			panels.push({
				id: "development",
				label: el("span", { text: t.jiraDevelopment }),
				panel: developmentPanel(issue),
			});
		}
		if (issue.subtasks.length > 0) {
			panels.push({
				id: "subtasks",
				label: el("span", { text: format(t.jiraTabSubtasks, issue.subtasks.length) }),
				panel: el("div", {
					children: [
						list(
							issue.subtasks.map((ref, index) => issueRow(ref, `${index + 1}.`)),
							"jira-subtasks",
						),
					],
				}),
			});
		}
		if (!panels.some((entry) => entry.id === activeTab)) activeTab = "detail";

		const tabBar = el("div", {
			class: "jira-tabs",
			attrs: { role: "tablist", "aria-label": issue.key },
		});
		const buttons = new Map<IssueTab, HTMLButtonElement>();
		const select = (id: IssueTab): void => {
			activeTab = id;
			for (const entry of panels) {
				const on = entry.id === id;
				entry.panel.hidden = !on;
				buttons.get(entry.id)?.setAttribute("aria-selected", String(on));
				buttons.get(entry.id)?.setAttribute("tabindex", on ? "0" : "-1");
			}
		};
		for (const entry of panels) {
			const tabId = `jira-tab-${entry.id}`;
			entry.panel.id = `${tabId}-panel`;
			entry.panel.classList.add("jira-tab-panel");
			entry.panel.setAttribute("role", "tabpanel");
			entry.panel.setAttribute("aria-labelledby", tabId);
			entry.panel.setAttribute("data-tab", entry.id);
			const tab = el("button", {
				class: "jira-tab",
				attrs: {
					type: "button",
					role: "tab",
					id: tabId,
					"aria-controls": entry.panel.id,
					"data-tab": entry.id,
				},
				children: [entry.label],
			});
			tab.addEventListener("click", () => select(entry.id));
			buttons.set(entry.id, tab);
			tabBar.append(tab);
		}

		const parent = issue.parentLink;
		const top = el("div", {
			class: "jira-issue-top",
			children: [
				...(parent === null ? [] : [parentButton(parent)]),
				el("div", {
					class: "jira-issue-head",
					children: [
						el("span", { class: "jira-key", text: issue.key }),
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
						el("span", { class: "jira-head-spacer" }),
						el("div", {
							class: "jira-head-actions",
							children: [
								iconAction(t.linkOpenBrowser, "open", () => options.openLink(issue.url)),
								logWork,
								favoriteButton(issue),
								copyMenu([
									[t.jiraCopyKey, issue.key],
									[t.linkCopyUrl, issue.url],
								]),
							],
						}),
					],
				}),
				el("h2", { class: "jira-title", text: issue.summary, attrs: { title: issue.summary } }),
				tabBar,
			],
		});
		body.replaceChildren(top, worklogSlot, ...panels.map((entry) => entry.panel));
		select(activeTab);
		heading.textContent = issue.key;
		toggleWorklog(worklogOpen);
	}

	function iconAction(
		label: string,
		name: IconName,
		run: () => void | Promise<void>,
	): HTMLButtonElement {
		const element = el("button", {
			class: "jira-icon-action",
			attrs: { type: "button", title: label, "aria-label": label },
			children: [icon(name)],
		});
		element.addEventListener("click", () => void run());
		return element;
	}

	function parentButton(parent: JiraParentLink): HTMLElement {
		const link = el("button", {
			class: "jira-parent-link",
			attrs: { type: "button", title: `${t.jiraParent}: ${parent.key} ${parent.summary}`.trim() },
			children: [
				el("span", { class: "jira-parent-label", text: t.jiraParent }),
				el("span", { class: "jira-key", text: parent.key }),
				...(parent.summary === ""
					? []
					: [el("span", { class: "jira-parent-summary", text: parent.summary })]),
			],
		});
		link.addEventListener("click", () => go({ kind: "issue", key: parent.key }));
		return link;
	}

	function section(title: string, children: readonly HTMLElement[]): HTMLElement {
		return el("section", {
			class: "jira-section",
			children: [el("h3", { text: title }), ...children],
		});
	}

	function detailPanel(issue: JiraIssue, decorate: (root: HTMLElement) => void): HTMLElement {
		const editError = el("p", { class: "jira-edit-error", attrs: { role: "alert" } });
		editError.hidden = true;
		const onError = (text: string): void => {
			editError.textContent = format(t.jiraSaveFailed, text);
			editError.hidden = false;
		};
		const onSaved = (): void => {
			editError.hidden = true;
			options.onIssueChange?.(issue.key);
		};

		const meta: HTMLElement[] = [];
		const metaItem = (mark: Node, text: string, title: string): HTMLElement =>
			el("span", {
				class: "jira-meta-item",
				attrs: { title },
				children: [mark, el("span", { text })],
			});
		if (issue.type !== "") meta.push(metaItem(typeBadge(issue.type), issue.type, t.jiraType));
		if (issue.project !== "") meta.push(metaItem(icon("folderOpen"), issue.project, t.jiraProject));
		if (issue.created !== null) {
			const created = shortDateTime(issue.created, options.lang);
			meta.push(
				metaItem(icon("calendar"), when(issue.created), `${t.jiraCreated}: ${created.full}`),
			);
		}
		if (issue.updated !== null) {
			const updated = shortDateTime(issue.updated, options.lang);
			meta.push(
				metaItem(icon("refresh"), when(issue.updated), `${t.jiraUpdated}: ${updated.full}`),
			);
		}

		const row = (label: string, value: Node): HTMLElement =>
			el("div", {
				class: "jira-field-row",
				children: [el("dt", { text: label }), el("dd", { children: [value] })],
			});
		const rows: HTMLElement[] = [
			row(
				t.jiraAssignee,
				createFieldChip({
					t,
					lang: options.lang,
					label: t.jiraAssignee,
					value: issue.assignee === "" ? null : { id: issue.assigneeId, name: issue.assignee },
					emptyLabel: t.jiraUnassigned,
					person: true,
					remoteSearch: true,
					load: (query) => bridge.jiraAssignableUsers(issue.key, query),
					save: (option) => bridge.jiraAssign(issue.key, option?.id || null),
					onSaved,
					onError,
				}),
			),
		];
		const sprintField = issue.sprintField;
		if (sprintField !== null) {
			rows.push(
				row(
					sprintField.name || t.jiraSprint,
					createFieldChip({
						t,
						lang: options.lang,
						label: sprintField.name || t.jiraSprint,
						value: issue.sprint,
						emptyLabel: t.jiraBacklog,
						load: async () => {
							const sprints = await bridge.jiraSprints(issue.key, issue.sprint?.boardId ?? null);
							const current = issue.sprint;
							return current === null || sprints.some((sprint) => sprint.id === current.id)
								? sprints
								: [current, ...sprints];
						},
						save: (option) => bridge.jiraMoveToSprint(issue.key, option?.id || null),
						onSaved,
						onError,
					}),
				),
			);
		}
		const teamField = issue.teamField;
		if (teamField !== null) {
			rows.push(
				row(
					teamField.name,
					createFieldChip({
						t,
						lang: options.lang,
						label: teamField.name,
						value: issue.team,
						emptyLabel: t.jiraNone,
						load: () => bridge.jiraFieldOptions(issue.key, teamField),
						save: (option) =>
							bridge.jiraSetField(
								issue.key,
								teamField,
								option === null || option.id === "" ? null : option,
							),
						onSaved,
						onError,
					}),
				),
			);
		}
		rows.push(
			row(
				t.jiraLabels,
				createLabelEditor({
					t,
					lang: options.lang,
					bridge,
					issueKey: issue.key,
					labels: issue.labels,
					onSaved,
					onError,
				}),
			),
		);
		const { spent, remaining, estimate } = issue.time;
		if (spent !== null && spent > 0) {
			const duration = (seconds: number): string =>
				formatDurationShort(seconds, t.jiraHourUnit, t.jiraMinuteUnit);
			const range = timeBar(spent, remaining, estimate);
			const text = [duration(spent)];
			if (remaining !== null && remaining > 0) {
				text.push(format(t.jiraTimeLeft, duration(remaining)));
			}
			rows.push(
				row(
					t.jiraTimeTracking,
					el("span", {
						class: "jira-time",
						children: [
							el("progress", {
								class: "jira-time-bar",
								attrs: { max: String(range.max), value: String(range.value) },
							}),
							el("span", { class: "jira-time-text", text: text.join(" · ") }),
						],
					}),
				),
			);
		}

		const description = richText(issue.description, issue.descriptionHtml);
		decorate(description);
		if (issue.description === "" && issue.descriptionHtml === null) {
			description.append(message(t.jiraNoDescription));
		}
		const parts: HTMLElement[] = [
			createJourneyBar({ t, lang: options.lang, bridge, issue }),
			el("div", { class: "jira-meta", children: meta }),
			editError,
			el("dl", { class: "jira-fields", children: rows }),
			allFields(issue),
			section(t.jiraDescription, [description]),
		];

		const groups = new Map<string, HTMLElement[]>();
		const add = (relation: string, item: HTMLElement): void => {
			const items = groups.get(relation) ?? [];
			items.push(item);
			groups.set(relation, items);
		};
		for (const link of issue.links) add(link.relation, issueRow(link.issue));
		for (const link of issue.remoteLinks) add(link.relation, remoteRow(link));
		const linkCount = issue.links.length + issue.remoteLinks.length;
		if (linkCount > 0) {
			parts.push(
				section(
					format(t.jiraLinks, linkCount),
					[...groups].map(([relation, items]) =>
						el("div", {
							class: "jira-link-group",
							children: [el("h4", { text: relation }), list(items)],
						}),
					),
				),
			);
		}
		return el("div", { class: "jira-detail", children: parts });
	}

	function allFields(issue: JiraIssue): HTMLElement {
		const entries: [string, Node | string][] = [];
		const person = (name: string): HTMLElement => {
			const short = parsePersonName(name);
			return el("span", {
				class: "jira-person",
				attrs: { title: short.full },
				children: [personMark(short.name), el("span", { text: short.name })],
			});
		};
		if (issue.reporter !== "") entries.push([t.jiraReporter, person(issue.reporter)]);
		if (issue.priority !== "") {
			entries.push([
				t.jiraPriority,
				el("span", {
					class: "jira-priority",
					attrs: { "data-level": priorityLevel(issue.priority) },
					children: [
						el("span", { class: "jira-priority-mark", attrs: { "aria-hidden": "true" } }),
						el("span", { text: issue.priority }),
					],
				}),
			]);
		}
		if (!isEmptyFieldText(issue.resolution)) entries.push([t.jiraResolution, issue.resolution]);
		if (issue.components.length > 0) entries.push([t.jiraComponents, issue.components.join(", ")]);
		if (issue.fixVersions.length > 0) {
			entries.push([t.jiraFixVersions, issue.fixVersions.join(", ")]);
		}
		if (issue.due !== null) entries.push([t.jiraDue, when(issue.due)]);
		for (const field of issue.allFields) {
			entries.push([
				field.name,
				/^\d{4}-\d{2}-\d{2}$/.test(field.value) ? when(field.value) : field.value,
			]);
		}
		const fold = el("details", {
			class: "jira-all-fields",
			children: [
				el("summary", { text: t.jiraAllFields }),
				el("dl", {
					class: "jira-all-fields-list",
					children: entries.flatMap(([label, value]) => [
						el("dt", { text: label }),
						el("dd", { children: [value] }),
					]),
				}),
			],
		});
		fold.hidden = entries.length === 0;
		return fold;
	}

	function commentsPanel(
		issue: JiraIssue,
		decorate: (root: HTMLElement) => void,
		onAdded: (count: number, uploaded: readonly JiraAttachment[]) => void,
	): HTMLElement {
		const comments: JiraComment[] = [...issue.comments];
		let total = issue.commentTotal;
		const listElement = el("div", { class: "jira-comment-list" });
		const note = el("p", { class: "jira-message" });
		const view = (comment: JiraComment): HTMLElement =>
			commentView(comment, { lang: options.lang, richText, decorate });

		const toggle = (label: string, key: "attachmentsOnly" | "humansOnly"): HTMLButtonElement => {
			const button = el("button", {
				class: "jira-filter-chip",
				attrs: { type: "button", "aria-pressed": String(commentFilter[key]) },
				text: label,
			});
			button.addEventListener("click", () => {
				commentFilter = { ...commentFilter, [key]: !commentFilter[key] };
				button.setAttribute("aria-pressed", String(commentFilter[key]));
				draw();
			});
			return button;
		};
		const who = el("select", {
			class: "jira-filter-select",
			attrs: { "aria-label": t.jiraFilterWho },
		});
		const fillWho = (): void => {
			const { people, teams } = commentPeople(comments);
			const option = (value: string, label: string): HTMLOptionElement =>
				el("option", { text: label, attrs: { value } });
			const group = (label: string, values: readonly string[], prefix: string): HTMLElement =>
				el("optgroup", {
					attrs: { label },
					children: values.map((value) => option(`${prefix}:${value}`, value)),
				});
			who.replaceChildren(
				option("", t.jiraFilterEveryone),
				...(people.length > 0 ? [group(t.jiraFilterPeople, people, "person")] : []),
				...(teams.length > 0 ? [group(t.jiraFilterTeams, teams, "team")] : []),
			);
			who.value =
				commentFilter.person !== null
					? `person:${commentFilter.person}`
					: commentFilter.team !== null
						? `team:${commentFilter.team}`
						: "";
			if (who.selectedIndex < 0) who.value = "";
		};
		who.addEventListener("change", () => {
			const [kind, ...rest] = who.value.split(":");
			const value = rest.join(":");
			commentFilter = {
				...commentFilter,
				person: kind === "person" ? value : null,
				team: kind === "team" ? value : null,
			};
			draw();
		});

		function draw(): void {
			const shown = filterComments(comments, commentFilter);
			listElement.replaceChildren(
				...(shown.length === 0
					? [message(comments.length === 0 ? t.jiraNoComments : t.jiraNoMatchingComments)]
					: shown.map(view)),
			);
			note.textContent =
				total > comments.length ? format(t.jiraCommentsLatest, total, comments.length) : "";
		}
		fillWho();
		draw();

		const composer = createComposer({
			t,
			lang: options.lang,
			bridge,
			issueKey: issue.key,
			cloud: account?.cloud ?? false,
			onSent: (comment, uploaded) => {
				comments.push(comment);
				total++;
				onAdded(total, uploaded);
				fillWho();
				draw();
				listElement.lastElementChild?.scrollIntoView({ block: "nearest" });
				options.onIssueChange?.(issue.key);
			},
		});
		return el("div", {
			class: "jira-comments",
			children: [
				el("div", {
					class: "jira-comment-filters",
					children: [
						toggle(t.jiraFilterAttachments, "attachmentsOnly"),
						toggle(t.jiraFilterHumans, "humansOnly"),
						who,
					],
				}),
				note,
				listElement,
				composer,
			],
		});
	}

	function developmentPanel(issue: JiraIssue): HTMLElement {
		const development = createDevelopmentSection({
			t,
			lang: options.lang,
			bridge,
			issueId: issue.id,
			openLink: options.openLink,
			fold: (_title, children) => el("div", { class: "jira-dev-plain", children }),
		});
		return el("div", {
			class: "jira-development",
			children: [
				development,
				el("p", { class: "jira-message jira-dev-empty", text: t.jiraDevNone }),
			],
		});
	}

	function list(rows: readonly HTMLElement[], extra = ""): HTMLElement {
		return el("ul", { class: `jira-list ${extra}`.trim(), children: rows });
	}

	/** Text as Jira shows it: HTML drawn as a page (not as code), wiki markup as Markdown. */
	function richText(markdown: string, html: string | null): HTMLElement {
		const target = el("div", { class: "jira-markdown" });
		renderToDOM(holdImages(html === null ? parse(markdown) : jiraHtmlRoot(html)), target, {
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
		const star = el("button", {
			class: "jira-icon-action jira-favorite",
			attrs: { type: "button" },
			children: [icon("star")],
		});
		const draw = (): void => {
			const on = starred();
			const label = on ? t.jiraUnfavorite : t.jiraFavorite;
			star.title = label;
			star.setAttribute("aria-label", label);
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

	/** One button that copies the issue's key or its link, from a small menu. */
	function copyMenu(choices: readonly (readonly [string, string])[]): HTMLElement {
		const toggle = el("button", {
			class: "jira-icon-action jira-copy-toggle",
			attrs: {
				type: "button",
				"aria-haspopup": "menu",
				"aria-expanded": "false",
				"aria-label": t.linkCopy,
				title: t.linkCopy,
			},
			children: [icon("copy"), icon("chevron")],
		});
		const menu = el("div", { class: "dock-menu jira-copy-menu", attrs: { role: "menu" } });
		menu.hidden = true;
		const wrap = el("span", { class: "jira-copy", children: [toggle, menu] });
		const close = (): void => {
			menu.hidden = true;
			toggle.setAttribute("aria-expanded", "false");
		};
		for (const [label, text] of choices) {
			const item = el("button", {
				class: "dock-menu-item",
				text: label,
				attrs: { type: "button", role: "menuitem" },
			});
			item.addEventListener("click", async () => {
				close();
				await navigator.clipboard.writeText(text);
				toggle.classList.add("copied");
				toggle.title = t.linkCopied;
				setTimeout(() => {
					toggle.classList.remove("copied");
					toggle.title = t.linkCopy;
				}, 1200);
				toggle.focus();
			});
			menu.append(item);
		}
		toggle.addEventListener("click", () => {
			const open = menu.hidden;
			menu.hidden = !open;
			toggle.setAttribute("aria-expanded", String(open));
			if (open) menu.querySelector<HTMLElement>("button")?.focus();
		});
		wrap.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && !menu.hidden) {
				// The menu only: the issue's dialog stays open.
				event.preventDefault();
				event.stopPropagation();
				close();
				toggle.focus();
			}
		});
		// A click elsewhere closes it; the listener goes with the issue it was drawn for.
		const outside = (event: MouseEvent): void => {
			if (!wrap.isConnected) {
				document.removeEventListener("mousedown", outside);
				return;
			}
			if (!(event.target instanceof Node && wrap.contains(event.target))) close();
		};
		document.addEventListener("mousedown", outside);
		return wrap;
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

/** How urgent a priority reads, from Jira's usual names (and the scheme's own words). */
function priorityLevel(name: string): string {
	if (/highest|blocker|critical|acil|kritik/i.test(name)) return "highest";
	if (/high|major|yüksek/i.test(name)) return "high";
	if (/lowest|trivial|en düşük/i.test(name)) return "lowest";
	if (/low|minor|düşük/i.test(name)) return "low";
	return "medium";
}
