/**
 * A review's findings in a reply: how ready the document is, and each
 * problem with what can be done about it — show it in the document, fix
 * it with the suggestion, add it to the open questions, put a note under
 * its paragraph, or set it aside. Whatever was done can be taken back:
 * the finding is open again and its buttons work as before.
 *
 * Each finding is one line until it is opened; the counts filter the list;
 * the template's missing sections are one item; what was dealt with goes
 * under its own heading at the end.
 */
import type { Finding, FindingKind, Severity } from "../shared/findings.js";
import { readiness, SEVERITIES } from "../shared/findings.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { ReviewItem } from "../shared/review-view.js";
import { firstSentence, reviewLayout } from "../shared/review-view.js";
import { el } from "./dom.js";

/** What became of a finding. */
export type FindingState = "open" | "fixed" | "asked" | "noted" | "dismissed";

export interface ReviewActions {
	/** Shows the finding in the document: its quote, or what was put there for it. */
	show(finding: Finding): void;
	fix(finding: Finding): void;
	ask(finding: Finding): void;
	note(finding: Finding): void;
	dismiss(finding: Finding): void;
	/** Adds missing sections of the template at the end of the document. */
	addSections(findings: readonly Finding[]): void;
	/** Takes back what was done for it, in the document too; the finding is open again. */
	undo(finding: Finding): void;
	/** Marks all of them in the document again. */
	markAll(): void;
	/** Adds every open one to the open questions. */
	askAll(): void;
	/** Draws the card again after the user changed how it is shown. */
	redraw(): void;
}

/** How the user has the list shown: kept across the reply's redraws. */
export interface ReviewView {
	readonly severities: Set<Severity>;
	readonly kinds: Set<FindingKind>;
	readonly expanded: Set<Finding>;
	sectionsOpen: boolean;
	doneOpen: boolean;
}

export const reviewView = (): ReviewView => ({
	severities: new Set(),
	kinds: new Set(),
	expanded: new Set(),
	sectionsOpen: false,
	doneOpen: false,
});

export function findingsCard(
	t: Strings,
	findings: readonly Finding[],
	state: (finding: Finding) => FindingState,
	actions: ReviewActions,
	view: ReviewView = reviewView(),
): HTMLElement {
	const isOpen = (finding: Finding): boolean => state(finding) === "open";
	const layout = reviewLayout(
		findings,
		isOpen,
		view,
		(finding) =>
			view.expanded.has(finding) || (view.sectionsOpen && finding.missingSection !== undefined),
	);
	const open = findings.filter(isOpen);
	const severityLabel: Readonly<Record<Severity, string>> = {
		high: t.reviewHigh,
		medium: t.reviewMedium,
		low: t.reviewLow,
	};
	const kindLabel = (kind: FindingKind): string => t[`reviewKind_${kind}` as keyof Strings] ?? kind;

	const toggle = <T>(set: Set<T>, value: T): void => {
		if (!set.delete(value)) set.add(value);
		actions.redraw();
	};
	const chip = (label: string, count: number, on: boolean, click: () => void, extra = "") => {
		const element = button(`${label} ${count}`, click, `assistant-review-chip ${extra}`);
		element.setAttribute("aria-pressed", String(on));
		element.disabled = count === 0 && !on;
		return element;
	};
	const chips: HTMLElement[] = [
		...SEVERITIES.map((level) =>
			chip(
				severityLabel[level],
				layout.severities[level],
				view.severities.has(level),
				() => toggle(view.severities, level),
				`chip-severity-${level}`,
			),
		),
		...layout.kinds.map(([kind, count]) =>
			chip(kindLabel(kind), count, view.kinds.has(kind), () => toggle(view.kinds, kind)),
		),
	];
	const filtered = view.severities.size + view.kinds.size > 0;
	const head = el("div", {
		class: "assistant-review-head",
		children: [
			el("strong", { text: format(t.reviewReadiness, readiness(open)) }),
			el("div", {
				class: "assistant-review-chips",
				attrs: { role: "group", "aria-label": t.reviewFilter },
				children: chips,
			}),
			...(filtered
				? [
						el("div", {
							class: "assistant-review-hidden",
							children: [
								...(layout.hidden > 0
									? [el("span", { text: format(t.reviewHidden, layout.hidden) })]
									: []),
								button(t.reviewClearFilter, () => {
									view.severities.clear();
									view.kinds.clear();
									actions.redraw();
								}),
							],
						}),
					]
				: []),
		],
	});
	const markAll = button(t.reviewMarkAll, actions.markAll);
	const askAll = button(t.reviewAskAll, actions.askAll);
	askAll.disabled = open.length === 0;

	const item = (entry: ReviewItem): HTMLElement =>
		entry.kind === "sections"
			? sectionsItem(t, entry.findings, state, actions, view)
			: findingItem(
					t,
					entry.finding,
					state(entry.finding),
					actions,
					view,
					kindLabel,
					severityLabel,
				);
	const children: HTMLElement[] = [
		head,
		el("div", { class: "assistant-review-tools", children: [markAll, askAll] }),
	];
	if (layout.open.length > 0) {
		children.push(el("ol", { class: "assistant-findings", children: layout.open.map(item) }));
	} else {
		children.push(
			el("p", {
				class: "assistant-review-empty",
				text: layout.done.length > 0 && !filtered ? t.reviewAllDone : t.reviewNoneShown,
			}),
		);
	}
	if (layout.done.length > 0) {
		const done = el("details", {
			class: "assistant-review-done",
			children: [
				el("summary", { text: format(t.reviewDone, countOf(layout.done)) }),
				el("ol", { class: "assistant-findings", children: layout.done.map(item) }),
			],
		});
		done.open = view.doneOpen;
		done.addEventListener("toggle", () => {
			view.doneOpen = done.open;
		});
		children.push(done);
	}
	return el("div", {
		class: "assistant-review",
		attrs: { role: "group", "aria-label": t.reviewTitle },
		children,
	});
}

const countOf = (items: readonly ReviewItem[]): number =>
	items.reduce((sum, item) => sum + (item.kind === "sections" ? item.findings.length : 1), 0);

function stateText(t: Strings, now: Exclude<FindingState, "open">, section = false): string {
	const states: Readonly<Record<Exclude<FindingState, "open">, string>> = {
		fixed: section ? t.reviewSectionAdded : t.reviewFixed,
		asked: t.reviewAsked,
		noted: t.reviewNoted,
		dismissed: t.reviewDismissed,
	};
	return states[now];
}

/** A row that opens and closes what is under it. */
function row(
	expanded: boolean,
	click: () => void,
	children: readonly (HTMLElement | string)[],
): HTMLButtonElement {
	const element = el("button", {
		class: "assistant-finding-row",
		attrs: { type: "button", "aria-expanded": String(expanded) },
		children: [
			...children,
			el("span", { class: "assistant-finding-chevron", attrs: { "aria-hidden": "true" } }),
		],
	});
	element.addEventListener("click", click);
	return element;
}

function findingItem(
	t: Strings,
	finding: Finding,
	now: FindingState,
	actions: ReviewActions,
	view: ReviewView,
	kindLabel: (kind: FindingKind) => string,
	severityLabel: Readonly<Record<Severity, string>>,
): HTMLElement {
	const expanded = view.expanded.has(finding);
	const title = firstSentence(finding.problem);
	const head = row(expanded, () => {
		if (view.expanded.delete(finding)) {
			actions.redraw();
			return;
		}
		view.expanded.add(finding);
		actions.redraw();
		// Opening it shows where it is.
		if (finding.quote !== "" && now !== "dismissed") actions.show(finding);
	}, [
		el("span", {
			class: "assistant-finding-severity",
			attrs: { title: severityLabel[finding.severity] },
			text: severityLabel[finding.severity],
		}),
		el("span", { class: "assistant-finding-id", text: finding.id }),
		el("span", { class: "assistant-finding-title", text: title }),
		el("span", { class: "assistant-finding-kind", text: kindLabel(finding.kind) }),
		...(finding.rule === true
			? [el("span", { class: "assistant-finding-rule", text: t.reviewRule })]
			: []),
		...(now === "open"
			? []
			: [el("span", { class: "assistant-finding-state", text: stateText(t, now) })]),
	]);
	const children: HTMLElement[] = [head];
	if (expanded) {
		const buttons: HTMLElement[] = [];
		if (now === "open") {
			if (finding.quote !== "") buttons.push(button(t.reviewShow, () => actions.show(finding)));
			if (finding.quote !== "" && finding.suggestion !== "") {
				buttons.push(button(t.reviewFix, () => actions.fix(finding)));
			}
			if (finding.missingSection !== undefined) {
				buttons.push(button(t.reviewAddSection, () => actions.addSections([finding])));
			}
			buttons.push(button(t.reviewAsk, () => actions.ask(finding)));
			if (finding.quote !== "") buttons.push(button(t.reviewNote, () => actions.note(finding)));
			buttons.push(button(t.reviewDismiss, () => actions.dismiss(finding)));
		} else {
			if (now !== "dismissed") buttons.push(button(t.reviewShow, () => actions.show(finding)));
			buttons.push(button(t.reviewUndo, () => actions.undo(finding)));
		}
		children.push(
			el("div", {
				class: "assistant-finding-body",
				children: [
					...(finding.section === ""
						? []
						: [el("span", { class: "assistant-finding-section", text: finding.section })]),
					...(finding.problem.trim() === title
						? []
						: [el("p", { class: "assistant-finding-problem", text: finding.problem })]),
					...(finding.quote === "" ? [] : [el("blockquote", { text: finding.quote })]),
					...(finding.suggestion === "" || finding.missingSection !== undefined
						? []
						: [
								el("p", {
									class: "assistant-finding-suggestion",
									text: `→ ${finding.suggestion}`,
								}),
							]),
					...(finding.question === ""
						? []
						: [el("p", { class: "assistant-finding-question", text: `? ${finding.question}` })]),
					el("div", { class: "assistant-finding-actions", children: buttons }),
				],
			}),
		);
	}
	return el("li", {
		class: `assistant-finding severity-${finding.severity} finding-${now}${expanded ? " finding-expanded" : ""}`,
		attrs: { "data-finding": finding.id },
		children,
	});
}

/** The template's missing sections as one item: each can be added, asked about or set aside. */
function sectionsItem(
	t: Strings,
	findings: readonly Finding[],
	state: (finding: Finding) => FindingState,
	actions: ReviewActions,
	view: ReviewView,
): HTMLElement {
	const open = findings.filter((finding) => state(finding) === "open");
	const head = row(view.sectionsOpen, () => {
		view.sectionsOpen = !view.sectionsOpen;
		actions.redraw();
	}, [
		el("span", { class: "assistant-finding-severity", text: t.reviewHigh }),
		el("span", {
			class: "assistant-finding-title",
			text: format(t.reviewSections, open.length > 0 ? open.length : findings.length),
		}),
		el("span", { class: "assistant-finding-rule", text: t.reviewRule }),
	]);
	const children: HTMLElement[] = [head];
	if (view.sectionsOpen) {
		const lines = findings.map((finding) => {
			const now = state(finding);
			return el("li", {
				class: `assistant-section finding-${now}`,
				attrs: { "data-finding": finding.id },
				children: [
					el("span", {
						class: "assistant-section-name",
						text: finding.missingSection ?? finding.problem,
					}),
					el("span", {
						class: "assistant-finding-actions",
						children:
							now === "open"
								? [
										button(t.reviewAddSection, () => actions.addSections([finding])),
										button(t.reviewDismiss, () => actions.dismiss(finding)),
									]
								: [
										el("span", {
											class: "assistant-finding-state",
											text: stateText(t, now, true),
										}),
										...(now === "dismissed"
											? []
											: [button(t.reviewShow, () => actions.show(finding))]),
										button(t.reviewUndo, () => actions.undo(finding)),
									],
					}),
				],
			});
		});
		const all = button(t.reviewAddSections, () => actions.addSections(open));
		all.disabled = open.length === 0;
		children.push(
			el("div", {
				class: "assistant-finding-body",
				children: [
					el("ul", { class: "assistant-sections", children: lines }),
					el("div", { class: "assistant-finding-actions", children: [all] }),
				],
			}),
		);
	}
	return el("li", {
		class: `assistant-finding assistant-finding-sections severity-high finding-${open.length > 0 ? "open" : "fixed"}${view.sectionsOpen ? " finding-expanded" : ""}`,
		attrs: { "data-sections": String(findings.length) },
		children,
	});
}

function button(label: string, click: () => void, className = "assistant-link"): HTMLButtonElement {
	const element = el("button", { class: className, text: label, attrs: { type: "button" } });
	element.addEventListener("click", click);
	return element;
}
