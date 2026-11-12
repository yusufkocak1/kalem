/**
 * A review's findings in a reply: how ready the document is, and each
 * problem with what can be done about it — show it in the document, fix
 * it with the suggestion, add it to the open questions, put a note under
 * its paragraph, or set it aside. Whatever was done can be taken back:
 * the finding is open again and its buttons work as before.
 */
import type { Finding, Severity } from "../shared/findings.js";
import { readiness } from "../shared/findings.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
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
	/** Takes back what was done for it, in the document too; the finding is open again. */
	undo(finding: Finding): void;
	/** Marks all of them in the document again. */
	markAll(): void;
	/** Adds every open one to the open questions. */
	askAll(): void;
}

const ORDER: Readonly<Record<Severity, number>> = { high: 0, medium: 1, low: 2 };

export function findingsCard(
	t: Strings,
	findings: readonly Finding[],
	state: (finding: Finding) => FindingState,
	actions: ReviewActions,
): HTMLElement {
	const open = findings.filter((finding) => state(finding) === "open");
	const score = readiness(open);
	const severity: Readonly<Record<Severity, string>> = {
		high: t.reviewHigh,
		medium: t.reviewMedium,
		low: t.reviewLow,
	};
	const count = (level: Severity): number =>
		open.filter((finding) => finding.severity === level).length;
	const head = el("div", {
		class: "assistant-review-head",
		children: [
			el("strong", { text: format(t.reviewReadiness, score) }),
			el("span", {
				class: "assistant-review-counts",
				text: format(t.reviewCounts, count("high"), count("medium"), count("low")),
			}),
		],
	});
	const markAll = button(t.reviewMarkAll, actions.markAll);
	const askAll = button(t.reviewAskAll, actions.askAll);
	askAll.disabled = open.length === 0;
	const items = [...findings]
		.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
		.map((finding) => {
			const now = state(finding);
			const buttons: HTMLElement[] = [];
			if (now === "open") {
				if (finding.quote !== "") buttons.push(button(t.reviewShow, () => actions.show(finding)));
				if (finding.quote !== "" && finding.suggestion !== "") {
					buttons.push(button(t.reviewFix, () => actions.fix(finding)));
				}
				buttons.push(button(t.reviewAsk, () => actions.ask(finding)));
				if (finding.quote !== "") buttons.push(button(t.reviewNote, () => actions.note(finding)));
				buttons.push(button(t.reviewDismiss, () => actions.dismiss(finding)));
			}
			const states: Readonly<Record<Exclude<FindingState, "open">, string>> = {
				fixed: t.reviewFixed,
				asked: t.reviewAsked,
				noted: t.reviewNoted,
				dismissed: t.reviewDismissed,
			};
			const done =
				now === "open"
					? null
					: el("div", {
							class: "assistant-finding-actions",
							children: [
								el("span", { class: "assistant-finding-state", text: states[now] }),
								...(now === "dismissed" ? [] : [button(t.reviewShow, () => actions.show(finding))]),
								button(t.reviewUndo, () => actions.undo(finding)),
							],
						});
			return el("li", {
				class: `assistant-finding severity-${finding.severity} finding-${now}`,
				attrs: { "data-finding": finding.id },
				children: [
					el("div", {
						class: "assistant-finding-head",
						children: [
							el("span", { class: "assistant-finding-severity", text: severity[finding.severity] }),
							el("span", { class: "assistant-finding-id", text: finding.id }),
							...(finding.section === ""
								? []
								: [el("span", { class: "assistant-finding-section", text: finding.section })]),
							...(finding.rule === true
								? [el("span", { class: "assistant-finding-rule", text: t.reviewRule })]
								: []),
						],
					}),
					el("p", { class: "assistant-finding-problem", text: finding.problem }),
					...(finding.quote === "" ? [] : [el("blockquote", { text: finding.quote })]),
					...(finding.suggestion === ""
						? []
						: [
								el("p", { class: "assistant-finding-suggestion", text: `→ ${finding.suggestion}` }),
							]),
					...(finding.question === ""
						? []
						: [el("p", { class: "assistant-finding-question", text: `? ${finding.question}` })]),
					done ?? el("div", { class: "assistant-finding-actions", children: buttons }),
				],
			});
		});
	return el("div", {
		class: "assistant-review",
		attrs: { role: "group", "aria-label": t.reviewTitle },
		children: [
			head,
			el("div", { class: "assistant-review-tools", children: [markAll, askAll] }),
			el("ol", { class: "assistant-findings", children: items }),
		],
	});
}

function button(label: string, click: () => void): HTMLButtonElement {
	const element = el("button", { class: "assistant-link", text: label, attrs: { type: "button" } });
	element.addEventListener("click", click);
	return element;
}
