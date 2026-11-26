import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { ProviderId } from "../shared/providers.js";
import type { ServiceUsage, UsageMeter } from "../shared/usage.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

/** The services that say how much of their plan is used. */
const REPORTING: ReadonlySet<ProviderId> = new Set(["claude-code", "copilot", "openrouter"]);

export interface UsageCard {
	readonly element: HTMLElement;
	/** Shows the service's usage; `fresh` asks again rather than using an answer from moments ago. */
	load(provider: ProviderId, fresh?: boolean): void;
}

const locale = (): string => document.documentElement.lang || navigator.language;

function when(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
	return new Intl.DateTimeFormat(
		locale(),
		dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" },
	).format(date);
}

const money = (value: number): string =>
	new Intl.NumberFormat(locale(), { style: "currency", currency: "USD" }).format(value);

const count = (value: number): string => new Intl.NumberFormat(locale()).format(value);

function meterLabel(t: Strings, meter: UsageMeter): string {
	switch (meter.kind) {
		case "session":
			return t.usageSession;
		case "week":
			return t.usageWeek;
		case "weekOpus":
			return t.usageWeekOpus;
		case "weekSonnet":
			return t.usageWeekSonnet;
		case "weekModel":
			return format(t.usageWeekModel, meter.name ?? "");
		case "extra":
			return t.usageExtra;
		case "premium":
			return t.usagePremium;
		case "chat":
			return t.usageChat;
		case "completions":
			return t.usageCompletions;
		case "credits":
			return t.usageCredits;
	}
}

function amount(t: Strings, meter: UsageMeter): string {
	if (meter.used === undefined) return "";
	if (meter.unit === "usd")
		return meter.limit === undefined
			? format(t.usageSpent, money(meter.used))
			: format(t.usageSpentOf, money(meter.used), money(meter.limit));
	return meter.limit === undefined
		? format(t.usageRequestsUsed, count(meter.used))
		: format(t.usageRequests, count(meter.used), count(meter.limit));
}

function meterRow(t: Strings, meter: UsageMeter): HTMLElement {
	const percent = meter.percent;
	const level =
		percent === null ? "" : percent >= 90 ? " is-high" : percent >= 75 ? " is-warn" : "";
	const fill = el("span", { class: "usage-bar-fill" });
	fill.style.width = `${percent ?? 0}%`;
	const bar = el("div", {
		class: `usage-bar${level}${meter.unlimited === true ? " is-unlimited" : ""}`,
		attrs: {
			role: "progressbar",
			"aria-label": meterLabel(t, meter),
			"aria-valuemin": "0",
			"aria-valuemax": "100",
			...(percent === null ? {} : { "aria-valuenow": String(Math.round(percent)) }),
		},
		children: [fill],
	});
	const value =
		meter.unlimited === true && percent === null
			? t.usageUnlimited
			: percent === null
				? amount(t, meter)
				: format(t.usagePercent, Math.round(percent));
	const details = [
		percent === null ? "" : amount(t, meter),
		meter.resetsAt === null ? "" : format(t.usageResets, when(meter.resetsAt)),
	].filter((text) => text !== "");
	return el("div", {
		class: "usage-meter",
		children: [
			el("div", {
				class: "usage-meter-top",
				children: [
					el("span", { class: "usage-meter-label", text: meterLabel(t, meter) }),
					el("span", { class: "usage-meter-value", text: value }),
				],
			}),
			bar,
			...(details.length === 0
				? []
				: [el("div", { class: "usage-meter-foot", text: details.join(" · ") })]),
		],
	});
}

/** A card with the plan's meters: how much is used, and when each starts again. */
export function createUsageCard(
	t: Strings,
	bridge: KalemBridge,
	errorText: (error: unknown) => string,
	key: () => string,
): UsageCard {
	const plan = el("span", { class: "usage-plan", attrs: { hidden: "" } });
	const refresh = el("button", {
		class: "usage-refresh",
		attrs: {
			type: "button",
			title: t.assistantUsageRefresh,
			"aria-label": t.assistantUsageRefresh,
		},
		children: [icon("refresh")],
	});
	const body = el("div", { class: "usage-body", attrs: { "aria-live": "polite" } });
	const updated = el("p", { class: "usage-updated", attrs: { hidden: "" } });
	const element = el("section", {
		class: "assistant-card usage-card",
		attrs: { "aria-label": t.assistantUsageTitle },
		children: [
			el("div", {
				class: "assistant-card-head",
				children: [
					el("span", { class: "assistant-card-icon", children: [icon("gauge")] }),
					el("span", { class: "assistant-card-title", text: t.assistantUsageTitle }),
					plan,
					refresh,
				],
			}),
			body,
			updated,
		],
	});

	let current: ProviderId | null = null;
	let asked = 0;

	const note = (text: string, kind = ""): void => {
		body.replaceChildren(el("p", { class: `usage-note${kind}`, text }));
	};

	function show(usage: ServiceUsage | null): void {
		plan.hidden = usage?.plan == null;
		plan.textContent = usage?.plan == null ? "" : format(t.assistantUsagePlan, usage.plan);
		if (usage === null || usage.meters.length === 0) {
			note(t.assistantUsageUnavailable);
			return;
		}
		body.replaceChildren(...usage.meters.map((meter) => meterRow(t, meter)));
		updated.hidden = false;
		updated.textContent = format(
			t.assistantUsageUpdated,
			new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(new Date()),
		);
	}

	function load(provider: ProviderId, fresh = false): void {
		current = provider;
		const ticket = ++asked;
		updated.hidden = true;
		plan.hidden = true;
		const reports = REPORTING.has(provider);
		refresh.hidden = !reports;
		if (!reports) {
			note(t.assistantUsageNone);
			return;
		}
		element.classList.add("is-loading");
		note(t.assistantUsageLoading, " is-muted");
		refresh.disabled = true;
		const typed = key().trim();
		bridge
			.assistantUsage({ provider, fresh, ...(typed === "" ? {} : { key: typed }) })
			.then((usage) => {
				if (ticket === asked) show(usage);
			})
			.catch((failure: unknown) => {
				if (ticket === asked) note(format(t.assistantUsageFailed, errorText(failure)), " is-error");
			})
			.finally(() => {
				if (ticket !== asked) return;
				element.classList.remove("is-loading");
				refresh.disabled = false;
			});
	}

	refresh.addEventListener("click", () => {
		if (current !== null) load(current, true);
	});

	return { element, load };
}
