/**
 * The assistant's agent parts in a reply: the cards that ask the user
 * before a tool changes something, the plan the model keeps, the changes
 * it made (each with an undo), and what the answer cost.
 */
import type { PlanStep } from "../shared/claude.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { ApprovalAnswer, ApprovalRequest, ApprovalScope } from "../shared/tool-protocol.js";
import { el } from "./dom.js";

/** What became of a question the user was asked. */
export type ApprovalState = "waiting" | "allowed" | "denied";

let cardCount = 0;

/** A card that asks the user before a tool changes something; `answer` sends what they chose. */
export function approvalCard(
	t: Strings,
	request: ApprovalRequest,
	state: ApprovalState,
	answer: (answer: ApprovalAnswer) => void,
): HTMLElement {
	const id = ++cardCount;
	const children: HTMLElement[] = [
		el("div", { class: "assistant-approval-title", text: request.title }),
	];
	if (request.lines.length > 0) {
		children.push(
			el("ul", {
				class: "assistant-approval-lines",
				children: request.lines.map((line) => el("li", { text: line })),
			}),
		);
	}
	if (request.reason !== undefined && request.reason !== "") {
		children.push(
			el("p", { class: "assistant-approval-reason", text: format(t.approvalWhy, request.reason) }),
		);
	}
	if (request.preview !== undefined && request.preview !== "") {
		const preview = el("pre", { class: "assistant-edit-diff assistant-approval-preview" });
		for (const line of request.preview.split("\n")) {
			const kind = line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "remove" : "keep";
			preview.append(el("span", { class: `assistant-diff-line diff-${kind}`, text: `${line}\n` }));
		}
		children.push(preview);
	}
	const picks: HTMLInputElement[] = [];
	if (request.items !== undefined) {
		children.push(
			el("div", {
				class: "assistant-approval-items",
				children: request.items.map((item, index) => {
					const box = el("input", {
						attrs: { type: "checkbox", "data-index": String(index) },
					});
					box.checked = true;
					box.disabled = state !== "waiting";
					picks.push(box);
					return el("label", { class: "settings-check", children: [box, item] });
				}),
			}),
		);
	}
	if (request.risk === "external") {
		children.push(el("p", { class: "assistant-approval-note", text: t.approvalOnline }));
	}
	if (request.afterExternal === true) {
		children.push(el("p", { class: "assistant-approval-warning", text: t.approvalAfterExternal }));
	}
	if (state === "waiting") {
		const scopeLabels: Readonly<Record<ApprovalScope, string>> = {
			once: t.approvalScopeOnce,
			session: t.approvalScopeSession,
			always: t.approvalScopeAlways,
		};
		const scope = el("select", {
			class: "assistant-approval-scope",
			attrs: { "aria-label": t.approvalScopeOnce },
			children: request.scopes.map((value) =>
				el("option", { text: scopeLabels[value], attrs: { value } }),
			),
		});
		scope.hidden = request.scopes.length < 2;
		const allow = el("button", {
			class: "assistant-primary",
			text: t.approvalAllow,
			attrs: { type: "button" },
		});
		const deny = el("button", {
			class: "assistant-action",
			text: t.approvalDeny,
			attrs: { type: "button" },
		});
		allow.addEventListener("click", () => {
			const selected = picks.flatMap((box, index) => (box.checked ? [index] : []));
			answer({
				approved: true,
				scope: scope.value as ApprovalScope,
				...(request.items === undefined ? {} : { selected }),
			});
		});
		deny.addEventListener("click", () => answer({ approved: false, scope: "once" }));
		children.push(
			el("div", { class: "assistant-approval-actions", children: [allow, deny, scope] }),
		);
	} else {
		children.push(
			el("p", {
				class: `assistant-approval-state approval-${state}`,
				text: state === "allowed" ? t.approvalAllowed : t.approvalDenied,
			}),
		);
	}
	return el("div", {
		class: `assistant-approval approval-risk-${request.risk}`,
		attrs: { role: "group", "aria-label": request.title, "data-card": String(id) },
		children,
	});
}

/** The model's plan, its steps ticked off as they get done. */
export function planCard(t: Strings, steps: readonly PlanStep[]): HTMLElement {
	return el("div", {
		class: "assistant-plan",
		children: [
			el("div", { class: "assistant-plan-title", text: t.assistantPlan }),
			el("ol", {
				children: steps.map((step) =>
					el("li", {
						class: `plan-${step.status}`,
						text: `${step.status === "done" ? "✓" : step.status === "active" ? "▸" : "○"} ${step.title}`,
					}),
				),
			}),
		],
	});
}

/** A change the assistant made, with its undo. */
export interface MadeChange {
	readonly label: string;
	/** Settings that put it back. */
	readonly settings?: Readonly<Record<string, unknown>>;
	/** The document's text before it, in its tab. */
	readonly document?: { readonly tabId: string; readonly text: string };
	undone?: boolean;
}

export function changeLine(t: Strings, change: MadeChange, undo: () => void): HTMLElement {
	const button = el("button", {
		class: "assistant-link",
		text: change.undone === true ? t.approvalUndone : t.approvalUndo,
		attrs: { type: "button" },
	});
	button.disabled = change.undone === true;
	button.addEventListener("click", undo);
	return el("div", {
		class: "assistant-change",
		children: [el("span", { text: format(t.assistantChanged, change.label) }), button],
	});
}

export interface Usage {
	readonly input: number;
	readonly output: number;
	readonly cached: number;
}

export function usageText(t: Strings, lang: string, usage: Usage): string {
	const n = (value: number): string => value.toLocaleString(lang);
	return format(t.assistantUsage, n(usage.input), n(usage.output), n(usage.cached));
}
