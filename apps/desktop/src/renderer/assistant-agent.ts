/**
 * The assistant's agent parts in a reply: the cards that ask the user
 * before a tool changes something, the plan the model keeps, the changes
 * it made (each with an undo), and what the answer cost.
 */
import type { CheckProgress, PlanStep } from "../shared/claude.js";
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

/** A duration as minutes and seconds. */
export function duration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whether the card of a finished review is opened; `null` until the user says. */
export interface ChecksView {
	open: boolean | null;
}

export interface ChecksOptions {
	readonly checks: readonly CheckProgress[];
	/** Whether Kalem ran the rule checks first. */
	readonly rules: boolean;
	/** Whether the whole answer has ended: the summary is written. */
	readonly done: boolean;
	readonly now: number;
	readonly view: ChecksView;
	/** What a check did last, in words. */
	step(tool: string, detail: string): string;
	retry(index: number): void;
}

/**
 * How the checks of a review run side by side are going: a line each, with
 * what it is doing, what it found and for how long, and why it failed with
 * a way to run it again. Once all is done it is one line, which opens to
 * the same lines with what each cost.
 */
export function checksCard(t: Strings, lang: string, options: ChecksOptions): HTMLElement {
	const { checks, view } = options;
	const finished = checks.filter((check) => check.status !== "running").length;
	const failed = checks.filter((check) => check.status === "failed").length;
	const found = checks.reduce((sum, check) => sum + check.findings, 0);
	const allEnded = finished === checks.length;
	const time = (check: CheckProgress): HTMLElement =>
		el("span", {
			class: "assistant-check-time",
			text: duration((check.ended ?? options.now) - check.started),
			attrs: check.ended === undefined ? { "data-started": String(check.started) } : {},
		});
	const rows = el("ol", {
		class: "assistant-checks-list",
		children: checks.map((check, index) => {
			const meta: (HTMLElement | string)[] = [];
			if (check.findings > 0) meta.push(format(t.checksFindings, check.findings), " · ");
			if (check.started > 0) meta.push(time(check));
			const below: HTMLElement[] = [];
			if (check.status === "running") {
				below.push(
					el("span", {
						class: "assistant-check-last",
						text:
							check.last === undefined
								? t.checksStarting
								: options.step(check.last.tool, check.last.detail),
					}),
				);
			} else if (check.status === "failed") {
				const again = el("button", {
					class: "assistant-link",
					text: t.checksRetry,
					attrs: { type: "button" },
				});
				again.addEventListener("click", () => options.retry(index));
				below.push(
					el("span", {
						class: "assistant-check-error",
						text: format(t.checksFailed, check.error ?? ""),
					}),
					again,
				);
			} else if (allEnded && check.usage !== undefined) {
				const tokens = check.usage.input + check.usage.output + check.usage.cached;
				below.push(
					el("span", {
						class: "assistant-check-last",
						text: format(t.checksTokens, tokens.toLocaleString(lang)),
					}),
				);
			}
			return el("li", {
				class: `assistant-check check-${check.status}`,
				attrs: { "data-check": String(index) },
				children: [
					el("span", { class: "assistant-check-icon", attrs: { "aria-hidden": "true" } }),
					el("span", { class: "assistant-check-title", text: check.title }),
					el("span", { class: "assistant-check-meta", children: meta }),
					...(below.length > 0
						? [el("div", { class: "assistant-check-below", children: below })]
						: []),
				],
			});
		}),
	});

	if (allEnded && options.done) {
		const started = Math.min(...checks.map((check) => check.started).filter((at) => at > 0));
		const ended = Math.max(...checks.map((check) => check.ended ?? check.started));
		const summary = el("summary", {
			children: [
				el("span", {
					text: format(
						t.checksSummary,
						checks.length,
						found,
						duration(Number.isFinite(started) ? ended - started : 0),
					),
				}),
				...(failed > 0
					? [
							el("span", {
								class: "assistant-check-error",
								text: ` · ${format(t.checksFailedCount, failed)}`,
							}),
						]
					: []),
			],
		});
		const card = el("details", {
			class: "assistant-checks assistant-checks-done",
			children: [summary, rows],
		});
		// A failed check stays in sight until the user closes it.
		card.open = view.open ?? failed > 0;
		card.addEventListener("toggle", () => {
			view.open = card.open;
		});
		return card;
	}

	const stage = (label: string, state: "done" | "active" | "waiting"): HTMLElement =>
		el("span", { class: `assistant-checks-stage stage-${state}`, text: label });
	const stages: HTMLElement[] = [];
	if (options.rules) stages.push(stage(t.checksStageRules, "done"));
	stages.push(
		stage(format(t.checksStageChecks, finished, checks.length), allEnded ? "done" : "active"),
		stage(t.checksStageSummary, allEnded ? (options.done ? "done" : "active") : "waiting"),
	);
	const bar = el("div", {
		class: "assistant-checks-bar",
		attrs: {
			role: "progressbar",
			"aria-label": t.checksTitle,
			"aria-valuemin": "0",
			"aria-valuemax": String(checks.length),
			"aria-valuenow": String(finished),
		},
		children: [el("span", {})],
	});
	(bar.firstElementChild as HTMLElement).style.width =
		`${checks.length === 0 ? 0 : Math.round((finished / checks.length) * 100)}%`;
	return el("div", {
		class: "assistant-checks",
		children: [
			el("div", {
				class: "assistant-checks-head",
				children: [
					el("span", { class: "assistant-plan-title", text: t.checksTitle }),
					el("span", { class: "assistant-checks-stages", children: stages }),
				],
			}),
			bar,
			rows,
		],
	});
}
