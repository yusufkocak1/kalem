import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { StatusCategory } from "../shared/jira.js";
import { shortDateTime } from "../shared/jira-comments.js";
import type {
	DevelopmentCount,
	DevelopmentItem,
	DevelopmentKind,
	JiraTransition,
	TransitionValues,
} from "../shared/jira-dev.js";
import { hasDevelopment } from "../shared/jira-dev.js";
import type { FieldMeta } from "../shared/jira-write.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

/** An icon with a class of its own, for its place. */
function mark(name: IconName, className: string): Element {
	const svg = icon(name);
	svg.classList.add(className);
	return svg;
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

const lozenge = (text: string, category: StatusCategory): HTMLElement =>
	el("span", {
		class: "jira-status",
		text,
		attrs: { "data-category": category === "" ? "new" : category },
	});

export interface StatusControlOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly issueKey: string;
	readonly status: string;
	readonly category: StatusCategory;
	/** Where a step can still be taken, from its form. */
	readonly issueUrl: string;
	openLink(url: string): void;
	/** After the status changed: the issue is read again. */
	onChanged(): void;
}

/** The issue's status, which opens the steps it can take from there. */
export function createStatusControl(options: StatusControlOptions): HTMLElement {
	const { t, bridge } = options;
	const button = el("button", {
		class: "jira-status-button",
		attrs: {
			type: "button",
			"aria-haspopup": "menu",
			"aria-expanded": "false",
			title: t.jiraTransition,
		},
		children: [lozenge(options.status, options.category), mark("chevron", "jira-status-chevron")],
	});
	const menu = el("div", {
		class: "dock-menu jira-transition-menu",
		attrs: { role: "menu", "aria-label": t.jiraTransition },
	});
	menu.hidden = true;
	const note = el("span", { class: "jira-transition-note", attrs: { role: "status" } });
	const panel = el("div", { class: "jira-transition-panel" });
	panel.hidden = true;
	const wrap = el("span", {
		class: "jira-status-control",
		children: [button, menu, panel, note],
	});

	const close = (): void => {
		menu.hidden = true;
		menu.replaceChildren();
		button.setAttribute("aria-expanded", "false");
	};
	const closePanel = (): void => {
		panel.hidden = true;
		panel.replaceChildren();
	};
	document.addEventListener("mousedown", (event) => {
		if (!(event.target instanceof Node && wrap.contains(event.target))) close();
	});
	wrap.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !menu.hidden) {
			// Only the menu closes: without this the issue's dialog would close with it.
			event.preventDefault();
			event.stopPropagation();
			close();
			button.focus();
		}
		if (event.key === "Escape" && !panel.hidden) {
			event.preventDefault();
			event.stopPropagation();
			closePanel();
			button.focus();
		}
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !menu.hidden) {
			event.preventDefault();
			const items = [...menu.querySelectorAll<HTMLElement>("button")];
			const index = items.indexOf(document.activeElement as HTMLElement);
			const step = event.key === "ArrowDown" ? 1 : -1;
			items[(index + step + items.length) % items.length]?.focus();
		}
	});

	const take = async (step: JiraTransition): Promise<void> => {
		close();
		if (step.needs.length > 0) {
			openForm(step);
			return;
		}
		button.disabled = true;
		note.dataset.kind = "busy";
		note.textContent = t.jiraTransitionMoving;
		try {
			await bridge.jiraTransition(options.issueKey, step.id);
			note.textContent = "";
			options.onChanged();
		} catch (error) {
			note.dataset.kind = "error";
			note.textContent = format(t.jiraTransitionFailed, errorText(error));
		} finally {
			button.disabled = false;
		}
	};

	const openForm = (step: JiraTransition): void => {
		note.textContent = "";
		const form = createTransitionForm({
			t,
			step,
			cancel: () => {
				closePanel();
				button.focus();
			},
			openInJira: () => options.openLink(options.issueUrl),
			submit: async (values) => {
				button.disabled = true;
				try {
					await bridge.jiraTransition(options.issueKey, step.id, values);
					closePanel();
					options.onChanged();
				} finally {
					button.disabled = false;
				}
			},
		});
		panel.replaceChildren(form);
		panel.hidden = false;
		form.querySelector<HTMLElement>("select, input, textarea")?.focus();
	};

	button.addEventListener("click", async () => {
		if (!menu.hidden) {
			close();
			return;
		}
		closePanel();
		menu.replaceChildren(el("div", { class: "jira-menu-heading", text: t.confluenceLoading }));
		menu.hidden = false;
		button.setAttribute("aria-expanded", "true");
		note.textContent = "";
		let steps: JiraTransition[];
		try {
			steps = await bridge.jiraTransitions(options.issueKey);
		} catch (error) {
			menu.replaceChildren(
				el("div", {
					class: "jira-menu-heading jira-error",
					text: format(t.jiraTransitionFailed, errorText(error)),
				}),
			);
			return;
		}
		if (menu.hidden) return;
		menu.replaceChildren(
			el("div", { class: "jira-menu-heading", text: t.jiraTransition }),
			...(steps.length === 0
				? [el("div", { class: "jira-menu-heading", text: t.jiraTransitionsNone })]
				: steps.map((step) => {
						const item = el("button", {
							class: "dock-menu-item jira-transition",
							attrs: {
								type: "button",
								role: "menuitem",
								"data-transition": step.id,
								...(step.needs.length > 0
									? { title: format(t.jiraTransitionAsks, step.needs.join(", ")) }
									: {}),
							},
							children: [
								el("span", { class: "jira-transition-arrow", text: "→" }),
								lozenge(step.to, step.toCategory),
								...(step.name !== "" && step.name !== step.to
									? [el("span", { class: "jira-transition-name", text: step.name })]
									: []),
								...(step.needs.length > 0
									? [el("span", { class: "jira-transition-out", text: "…" })]
									: []),
							],
						});
						item.addEventListener("click", () => void take(step));
						return item;
					})),
		);
		menu.querySelector<HTMLElement>("button")?.focus();
	});
	return wrap;
}

/** Fields a transition form leaves out: Jira fills them, or they have their own place. */
const UNFORMED = new Set(["attachment", "worklog", "timetracking", "issuelinks"]);
const TEXTAREA = /:textarea$/i;

interface TransitionFormOptions {
	readonly t: Strings;
	readonly step: JiraTransition;
	cancel(): void;
	openInJira(): void;
	/** Throws what Jira said; the form stays open with it. */
	submit(values: TransitionValues): Promise<void>;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function controlOf(field: FieldMeta, step: JiraTransition): Control {
	const attrs = { "data-field": field.id, ...(field.required ? { "aria-required": "true" } : {}) };
	if (field.choices.length > 0) {
		const multiple = field.type === "array";
		const select = el("select", {
			class: "jira-worklog-input jira-transition-input",
			attrs: { ...attrs, ...(multiple ? { multiple: "" } : {}) },
			children: [
				...(multiple ? [] : [el("option", { text: "—", attrs: { value: "" } })]),
				...field.choices.map((choice) =>
					el("option", { text: choice.name, attrs: { value: choice.id } }),
				),
			],
		});
		if (field.id === "resolution" && step.resolution !== null) {
			const chosen = field.choices.find((choice) => choice.name === step.resolution);
			if (chosen !== undefined) select.value = chosen.id;
		}
		return select;
	}
	if (field.id === "comment" || field.system === "description" || TEXTAREA.test(field.custom)) {
		return el("textarea", {
			class: "jira-worklog-input jira-transition-input",
			attrs: { ...attrs, rows: "3" },
		});
	}
	const type =
		field.type === "number"
			? "number"
			: field.type === "date"
				? "date"
				: field.type === "datetime"
					? "datetime-local"
					: "text";
	return el("input", {
		class: "jira-worklog-input jira-transition-input",
		attrs: { ...attrs, type },
	});
}

/** `2026-11-25T14:30` with the computer's own offset, as Jira takes a date and time. */
function datetimeOf(local: string): string {
	const offset = -new Date(local).getTimezoneOffset();
	const sign = offset < 0 ? "-" : "+";
	const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
	const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
	return `${local}:00.000${sign}${hours}${minutes}`;
}

function controlValue(control: Control, field: FieldMeta): unknown {
	if (control instanceof HTMLSelectElement && control.multiple) {
		return [...control.selectedOptions].map((option) => option.value);
	}
	const value = control.value.trim();
	if (value === "") return null;
	return field.type === "datetime" ? datetimeOf(value) : value;
}

/** The fields a step's screen asks for, filled in Kalem instead of in Jira. */
export function createTransitionForm(options: TransitionFormOptions): HTMLElement {
	const { t, step } = options;
	const fields = step.fields.filter((field) => !UNFORMED.has(field.id));
	const controls = fields.map((field) => ({ field, control: controlOf(field, step) }));
	for (const { control } of controls) {
		control.addEventListener("change", () => control.classList.remove("invalid"));
	}
	const status = el("p", { class: "jira-worklog-status", attrs: { role: "status" } });
	const submit = el("button", {
		class: "jira-button primary jira-transition-submit",
		text: t.jiraTransition,
		attrs: { type: "submit" },
	});
	const inJira = el("button", {
		class: "jira-button jira-transition-jira",
		text: t.jiraOpenInJira,
		attrs: { type: "button" },
	});
	inJira.addEventListener("click", () => options.openInJira());
	const cancel = el("button", { class: "jira-button", text: t.cancel, attrs: { type: "button" } });
	cancel.addEventListener("click", () => options.cancel());
	const form = el("form", {
		class: "jira-worklog jira-transition-form",
		attrs: { "data-transition": step.id, "aria-label": format(t.jiraTransitionTo, step.to) },
		children: [
			el("h3", { class: "jira-worklog-title", text: format(t.jiraTransitionTo, step.to) }),
			...controls.map(({ field, control }) =>
				el("label", {
					class: "jira-worklog-field",
					children: [
						el("span", {
							class: "jira-worklog-label",
							text: field.required ? `${field.name} *` : field.name,
						}),
						el("span", { class: "jira-worklog-control", children: [control] }),
					],
				}),
			),
			status,
			el("div", { class: "jira-transition-actions", children: [inJira, cancel, submit] }),
		],
	});
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const values: Record<string, unknown> = {};
		let comment = "";
		const missing: string[] = [];
		for (const { field, control } of controls) {
			const value = controlValue(control, field);
			const empty = value === null || (Array.isArray(value) && value.length === 0);
			control.classList.toggle("invalid", field.required && empty);
			if (field.required && empty) missing.push(field.name);
			if (empty) continue;
			if (field.id === "comment") comment = String(value);
			else values[field.id] = value;
		}
		if (missing.length > 0) {
			status.dataset.kind = "error";
			status.textContent = format(t.jiraTransitionMissing, missing.join(", "));
			return;
		}
		submit.disabled = true;
		status.dataset.kind = "busy";
		status.textContent = t.jiraTransitionMoving;
		try {
			await options.submit({ fields: values, comment });
		} catch (error) {
			status.dataset.kind = "error";
			status.textContent = format(t.jiraTransitionFailed, errorText(error));
		} finally {
			submit.disabled = false;
		}
	});
	return form;
}

export interface DevelopmentOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	readonly issueId: string;
	openLink(url: string): void;
	/** Makes a folding part of the issue, as the dialog's other parts. */
	fold(title: string, children: readonly HTMLElement[]): HTMLElement;
}

/**
 * The Development panel: how many branches, commits and pull requests the
 * issue has in code, each opening into its list. Hidden until Jira says
 * there are some.
 */
export function createDevelopmentSection(options: DevelopmentOptions): HTMLElement {
	const { t, bridge } = options;
	const lines = el("div", { class: "jira-dev" });
	const section = options.fold(t.jiraDevelopment, [lines]);
	section.classList.add("jira-dev-section");
	section.hidden = true;

	const dateTime = new Intl.DateTimeFormat(options.lang, {
		dateStyle: "medium",
		timeStyle: "short",
	});
	const ago = (iso: string | null): string =>
		iso === null ? "" : shortDateTime(iso, options.lang).short;

	function line(
		kind: DevelopmentKind,
		label: string,
		part: DevelopmentCount,
		when: string,
		state = "",
	): HTMLElement {
		const list = el("ul", { class: "jira-dev-items" });
		list.hidden = true;
		const toggle = el("button", {
			class: "jira-dev-line",
			attrs: { type: "button", "aria-expanded": "false", "data-kind": kind },
			children: [
				mark("chevron", "jira-dev-chevron"),
				el("span", { class: "jira-dev-count", text: label }),
				...(state === ""
					? []
					: [el("span", { class: "jira-dev-state", text: state, attrs: { "data-state": state } })]),
				el("span", {
					class: "jira-dev-when",
					text: when,
					attrs: { title: dateTime.format(new Date(part.updated ?? 0)) },
				}),
			],
		});
		let loaded = false;
		toggle.addEventListener("click", async () => {
			const open = toggle.getAttribute("aria-expanded") !== "true";
			toggle.setAttribute("aria-expanded", String(open));
			list.hidden = !open;
			if (!open || loaded) return;
			loaded = true;
			list.replaceChildren(el("li", { class: "jira-dev-note", text: t.confluenceLoading }));
			try {
				const items = await bridge.jiraDevelopmentDetail(options.issueId, kind);
				list.replaceChildren(
					...(items.length === 0
						? [el("li", { class: "jira-dev-note", text: t.jiraDevNone })]
						: items.map(item)),
				);
			} catch (error) {
				loaded = false;
				list.replaceChildren(
					el("li", {
						class: "jira-dev-note jira-error",
						text: format(t.jiraDevFailed, errorText(error)),
					}),
				);
			}
		});
		return el("div", { class: "jira-dev-part", children: [toggle, list] });
	}

	function item(entry: DevelopmentItem): HTMLElement {
		const row = el("li", {
			class: "jira-dev-item",
			attrs: { tabindex: "0", role: "link", title: entry.url },
			children: [
				el("span", {
					class: "jira-dev-item-head",
					children: [
						el("span", { class: "jira-dev-title", text: entry.title }),
						...(entry.state === ""
							? []
							: [
									el("span", {
										class: "jira-dev-state",
										text: entry.state,
										attrs: { "data-state": entry.state },
									}),
								]),
					],
				}),
				...(entry.detail === ""
					? []
					: [el("span", { class: "jira-dev-detail", text: entry.detail })]),
				el("span", {
					class: "jira-dev-meta",
					text: [entry.repository, entry.author, ago(entry.when)].filter(Boolean).join(" · "),
				}),
			],
		});
		const open = (): void => {
			if (entry.url !== "") options.openLink(entry.url);
		};
		row.addEventListener("click", open);
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open();
		});
		return row;
	}

	void (async () => {
		try {
			const summary = await bridge.jiraDevelopment(options.issueId);
			if (summary === null || !hasDevelopment(summary)) return;
			const parts: HTMLElement[] = [];
			if (summary.branches.count > 0) {
				parts.push(
					line(
						"branches",
						summary.branches.count === 1
							? t.jiraDevBranch
							: format(t.jiraDevBranches, summary.branches.count),
						summary.branches,
						format(t.jiraDevUpdated, ago(summary.branches.updated)),
					),
				);
			}
			if (summary.commits.count > 0) {
				parts.push(
					line(
						"commits",
						summary.commits.count === 1
							? t.jiraDevCommit
							: format(t.jiraDevCommits, summary.commits.count),
						summary.commits,
						format(t.jiraDevLatest, ago(summary.commits.updated)),
					),
				);
			}
			if (summary.pullRequests.count > 0) {
				parts.push(
					line(
						"pullRequests",
						summary.pullRequests.count === 1
							? t.jiraDevPullRequest
							: format(t.jiraDevPullRequests, summary.pullRequests.count),
						summary.pullRequests,
						format(t.jiraDevUpdated, ago(summary.pullRequests.updated)),
						summary.pullRequests.state,
					),
				);
			}
			lines.replaceChildren(...parts);
			section.hidden = false;
		} catch {
			// No development information to show: the part stays hidden.
		}
	})();
	return section;
}
