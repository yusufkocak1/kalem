import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { WorkAttribute, WorklogContext } from "../shared/jira-worklog.js";
import {
	formatDuration,
	missingAttributes,
	parseDuration,
	QUICK_HOURS,
	remainingAfter,
} from "../shared/jira-worklog.js";
import { createComboBox } from "./combo-box.js";
import { el } from "./dom.js";

export interface WorklogFormOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly issueKey: string;
	/** A work log's day, as the dialog writes dates. */
	formatDate(iso: string): string;
	/** After work was logged: the issue's time spent changed. */
	onLogged?(): void;
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** A day as `YYYY-MM-DD`, in local time. */
function isoDay(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Logging work on an issue: the time (a quick button for 1, 2, 3, 5 or 8
 * hours, or typed), the day, what is left, a description and Tempo's work
 * attributes, which start as they were last chosen.
 */
export function createWorklogForm(options: WorklogFormOptions): HTMLElement {
	const { t, bridge, issueKey } = options;
	const defaultComment = format(t.jiraWorkDefaultComment, issueKey);

	const summary = el("span", { class: "jira-worklog-summary" });
	const worked = el("input", {
		class: "jira-worklog-input jira-worklog-worked",
		attrs: {
			type: "text",
			inputmode: "decimal",
			placeholder: "2h, 1h 30m, 1,5",
			autocomplete: "off",
		},
	});
	const quick = el("div", {
		class: "jira-worklog-quick",
		attrs: { role: "group", "aria-label": t.jiraWorkQuick },
		children: QUICK_HOURS.map((hours) =>
			el("button", {
				class: "jira-worklog-chip",
				text: `${hours}h`,
				attrs: { type: "button", "data-hours": String(hours), "aria-pressed": "false" },
			}),
		),
	});
	const today = new Date();
	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
	const date = el("input", {
		class: "jira-worklog-input jira-worklog-date",
		attrs: { type: "date", value: isoDay(today), max: isoDay(today), required: "" },
	});
	const dayChip = (label: string, day: Date): HTMLButtonElement => {
		const chip = el("button", {
			class: "jira-worklog-chip jira-worklog-day",
			text: label,
			attrs: { type: "button", "data-day": isoDay(day) },
		});
		chip.addEventListener("click", () => {
			date.value = isoDay(day);
			markDay();
		});
		return chip;
	};
	const days = el("div", {
		class: "jira-worklog-days",
		children: [dayChip(t.jiraWorkToday, today), dayChip(t.jiraWorkYesterday, yesterday)],
	});
	const remaining = el("input", {
		class: "jira-worklog-input jira-worklog-remaining",
		attrs: { type: "text", autocomplete: "off" },
	});
	const comment = el("textarea", {
		class: "jira-worklog-input jira-worklog-comment",
		attrs: { rows: "2", placeholder: defaultComment },
	});
	const attributesBox = el("div", { class: "jira-worklog-attributes" });
	const diagnosticsText = el("pre", { class: "jira-worklog-diagnostics-text" });
	const copyDiagnostics = el("button", {
		class: "jira-button",
		text: t.jiraWorkCopyDetails,
		attrs: { type: "button" },
	});
	copyDiagnostics.addEventListener("click", () => {
		void navigator.clipboard.writeText(diagnosticsText.textContent ?? "");
		copyDiagnostics.textContent = t.linkCopied;
		setTimeout(() => {
			copyDiagnostics.textContent = t.jiraWorkCopyDetails;
		}, 1200);
	});
	const diagnostics = el("details", {
		class: "jira-worklog-diagnostics",
		children: [
			el("summary", { class: "jira-worklog-diagnostics-summary", text: t.jiraWorkDetails }),
			el("p", { class: "jira-worklog-diagnostics-hint", text: t.jiraWorkDetailsHint }),
			diagnosticsText,
			copyDiagnostics,
		],
	});
	diagnostics.hidden = true;
	const remember = el("input", { attrs: { type: "checkbox", checked: "" } });
	const submit = el("button", {
		class: "jira-button primary jira-worklog-submit",
		text: t.jiraLogWork,
		attrs: { type: "submit" },
	});
	const status = el("p", { class: "jira-worklog-status", attrs: { role: "status" } });
	const mine = el("ul", { class: "jira-worklog-mine" });
	const mineBox = el("div", {
		class: "jira-worklog-history",
		children: [el("h4", { text: t.jiraWorkMine }), mine],
	});
	mineBox.hidden = true;

	const field = (label: string, control: HTMLElement, extra: HTMLElement[] = []): HTMLElement =>
		el("label", {
			class: "jira-worklog-field",
			children: [
				el("span", { class: "jira-worklog-label", text: label }),
				el("span", { class: "jira-worklog-control", children: [control, ...extra] }),
			],
		});

	const form = el("form", {
		class: "jira-worklog",
		attrs: { "aria-label": t.jiraLogWork, novalidate: "" },
		children: [
			el("div", {
				class: "jira-worklog-head",
				children: [el("h3", { class: "jira-worklog-title", text: t.jiraLogWork }), summary],
			}),
			quick,
			el("div", {
				class: "jira-worklog-grid",
				children: [
					field(`${t.jiraWorkTime} *`, worked),
					field(`${t.jiraWorkDate} *`, date, [days]),
					field(t.jiraWorkRemaining, remaining),
					field(t.jiraWorkComment, comment),
				],
			}),
			attributesBox,
			diagnostics,
			el("div", {
				class: "jira-worklog-footer",
				children: [
					el("label", {
						class: "jira-worklog-remember",
						children: [remember, el("span", { text: t.jiraWorkRemember })],
					}),
					submit,
				],
			}),
			status,
			mineBox,
		],
	});

	let context: WorklogContext | null = null;
	/** The attributes' controls, by key: what takes the focus and the value it holds. */
	const controls = new Map<string, { readonly focus: () => void; readonly value: () => string }>();
	/** Once the remaining estimate is typed, the time no longer changes it. */
	let remainingTyped = false;

	const say = (text: string, kind: "info" | "error" | "ok" = "info"): void => {
		status.textContent = text;
		status.dataset.kind = kind;
	};

	function markQuick(): void {
		const seconds = parseDuration(worked.value);
		for (const chip of quick.querySelectorAll<HTMLButtonElement>(".jira-worklog-chip")) {
			chip.setAttribute("aria-pressed", String(seconds === Number(chip.dataset.hours) * 3600));
		}
	}

	function markDay(): void {
		for (const chip of days.querySelectorAll<HTMLButtonElement>(".jira-worklog-day")) {
			chip.setAttribute("aria-pressed", String(chip.dataset.day === date.value));
		}
	}

	function updateRemaining(): void {
		if (remainingTyped || context === null || context.remainingSeconds === null) return;
		const seconds = parseDuration(worked.value) ?? 0;
		remaining.value = formatDuration(remainingAfter(context.remainingSeconds, seconds) ?? 0);
	}

	function attributeControl(attribute: WorkAttribute, chosen: string): HTMLElement {
		let control: HTMLElement;
		let focusable: HTMLInputElement;
		let read: () => string;
		if (attribute.kind === "list") {
			// A value chosen before that Tempo did not list is still offered, as it was given.
			const options =
				chosen === "" || attribute.options.some((option) => option.value === chosen)
					? attribute.options
					: [...attribute.options, { value: chosen, name: chosen }];
			// Typed into, it narrows the list letter by letter (a `<select>` only jumps by the last letter).
			const combo = createComboBox({
				options,
				value: chosen,
				placeholder: options.length === 0 ? t.jiraWorkNoChoices : t.jiraWorkChoose,
				empty: t.jiraWorkNoMatch,
				lang: document.documentElement.lang || navigator.language,
				inputClass: "jira-worklog-input",
			});
			combo.input.dataset.attribute = attribute.key;
			control = combo.element;
			focusable = combo.input;
			read = () => combo.value;
		} else if (attribute.kind === "checkbox") {
			const box = el("input", { attrs: { type: "checkbox" } });
			box.checked = chosen === "true";
			box.dataset.attribute = attribute.key;
			control = focusable = box;
			read = () => String(box.checked);
		} else {
			const input = el("input", {
				class: "jira-worklog-input",
				attrs: { type: attribute.kind === "number" ? "number" : "text" },
			});
			input.value = chosen;
			input.dataset.attribute = attribute.key;
			control = focusable = input;
			read = () => input.value;
		}
		controls.set(attribute.key, { focus: () => focusable.focus(), value: read });
		const row = field(`${attribute.name}${attribute.required ? " *" : ""}`, control);
		row.dataset.attribute = attribute.key;
		return row;
	}

	function attributeValues(): Record<string, string> {
		const values: Record<string, string> = {};
		for (const [key, control] of controls) values[key] = control.value();
		return values;
	}

	function show(loaded: WorklogContext): void {
		context = loaded;
		summary.textContent = format(
			t.jiraWorkSpent,
			formatDuration(loaded.spentSeconds),
			loaded.remainingSeconds === null ? "—" : formatDuration(loaded.remainingSeconds),
		);
		summary.title = loaded.tempo ? t.jiraWorkViaTempo : t.jiraWorkViaJira;
		form.dataset.tempo = String(loaded.tempo);
		remaining.placeholder = loaded.remainingSeconds === null ? t.jiraWorkRemainingAuto : "";
		// What was chosen before stays chosen when the form is drawn again after a log.
		const before = controls.size > 0 ? attributeValues() : loaded.defaults;
		controls.clear();
		attributesBox.replaceChildren(
			...loaded.attributes.map((attribute) =>
				attributeControl(attribute, before[attribute.key] ?? ""),
			),
		);
		attributesBox.hidden = loaded.attributes.length === 0;
		// A list with nothing to choose: what Tempo said, to be copied and reported.
		const empty = loaded.attributes.some(
			(attribute) =>
				(attribute.kind === "list" && attribute.options.length === 0) ||
				(attribute.required && attribute.kind === "text"),
		);
		diagnostics.hidden = !empty || loaded.diagnostics === "";
		diagnosticsText.textContent = loaded.diagnostics;
		mine.replaceChildren(
			...loaded.mine.map((log) =>
				el("li", {
					class: "jira-worklog-log",
					children: [
						el("span", { class: "jira-worklog-mine-day", text: options.formatDate(log.started) }),
						el("strong", { text: formatDuration(log.seconds) }),
						el("span", {
							class: "jira-worklog-mine-comment",
							text: log.comment,
							attrs: { title: log.comment },
						}),
					],
				}),
			),
		);
		mineBox.hidden = loaded.mine.length === 0;
		updateRemaining();
	}

	async function load(): Promise<void> {
		try {
			show(await bridge.jiraWorklogContext(issueKey));
		} catch (error) {
			say(format(t.jiraWorkFailed, errorText(error)), "error");
		}
	}

	quick.addEventListener("click", (event) => {
		const chip = (event.target as HTMLElement).closest<HTMLButtonElement>(".jira-worklog-chip");
		if (chip === null) return;
		worked.value = `${chip.dataset.hours}h`;
		markQuick();
		updateRemaining();
		worked.classList.remove("invalid");
	});
	worked.addEventListener("input", () => {
		markQuick();
		updateRemaining();
		worked.classList.remove("invalid");
	});
	remaining.addEventListener("input", () => {
		remainingTyped = remaining.value.trim() !== "";
	});
	date.addEventListener("input", markDay);
	form.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			form.requestSubmit();
		}
	});

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void send();
	});

	/** The countdown while Jira's rate limit lasts. */
	let waiting: ReturnType<typeof setInterval> | undefined;

	function waitOut(seconds: number): void {
		let left = Math.max(1, seconds);
		submit.disabled = true;
		const tick = (): void => {
			if (!form.isConnected || left <= 0) {
				clearInterval(waiting);
				waiting = undefined;
				submit.disabled = false;
				if (form.isConnected) say(t.jiraWorkLimitOver);
				return;
			}
			say(format(t.jiraWorkLimited, left), "error");
			left--;
		};
		clearInterval(waiting);
		tick();
		waiting = setInterval(tick, 1000);
	}

	async function send(): Promise<void> {
		const seconds = parseDuration(worked.value);
		if (seconds === null || seconds > 24 * 3600) {
			worked.classList.add("invalid");
			worked.focus();
			say(t.jiraWorkInvalidTime, "error");
			return;
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
			date.focus();
			say(t.jiraWorkInvalidDate, "error");
			return;
		}
		// Only what the user typed is sent: the figure filled in for them is
		// what Jira counts down to by itself, and setting it can be refused.
		let remainingSeconds: number | null = null;
		if (remainingTyped && remaining.value.trim() !== "") {
			remainingSeconds = remaining.value.trim() === "0" ? 0 : parseDuration(remaining.value);
			if (remainingSeconds === null) {
				remaining.focus();
				say(t.jiraWorkInvalidTime, "error");
				return;
			}
		}
		const attributes = attributeValues();
		const missing = missingAttributes(context?.attributes ?? [], attributes);
		if (missing.length > 0) {
			say(format(t.jiraWorkRequired, missing.join(", ")), "error");
			controls.get(context?.attributes.find((a) => missing.includes(a.name))?.key ?? "")?.focus();
			return;
		}
		submit.disabled = true;
		say(t.jiraWorkSending);
		try {
			await bridge.jiraLogWork(issueKey, {
				date: date.value,
				seconds,
				remainingSeconds,
				comment: comment.value.trim() || defaultComment,
				attributes,
				remember: remember.checked,
				offsetMinutes: -new Date(`${date.value}T09:00:00`).getTimezoneOffset(),
			});
			say(format(t.jiraWorkLogged, formatDuration(seconds), issueKey), "ok");
			comment.value = "";
			remainingTyped = false;
			remaining.value = "";
			options.onLogged?.();
			await load();
		} catch (error) {
			const text = errorText(error);
			// Jira's rate limit: the button waits out the time Jira asked, counting down.
			const limited = /allows them again in (\d+) s/.exec(text);
			if (limited !== null) {
				waitOut(Number(limited[1]));
				return;
			}
			say(format(t.jiraWorkFailed, text), "error");
		} finally {
			if (waiting === undefined) submit.disabled = false;
		}
	}

	markDay();
	void load();
	return form;
}
