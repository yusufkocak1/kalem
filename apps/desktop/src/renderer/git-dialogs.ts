import type { GitBranch } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface PromptRequest {
	readonly title: string;
	readonly label: string;
	readonly button: string;
	readonly value?: string;
	readonly placeholder?: string;
	readonly hint?: string;
	/** A message box rather than one line. */
	readonly multiline?: boolean;
	/** Why the text cannot be used; `null` when it can. */
	readonly check?: (value: string) => string | null;
}

export interface GitDialogs {
	/** The text typed, trimmed; `null` when cancelled. */
	prompt(request: PromptRequest): Promise<string | null>;
	/** The branch picked; `null` when cancelled. */
	pickBranch(branches: readonly GitBranch[]): Promise<GitBranch | null>;
}

/** The small windows Git needs: a line of text, and a branch to switch to. */
export function createGitDialogs(t: Strings, lang: string): GitDialogs {
	// --- Prompt -----------------------------------------------------------
	const promptTitle = el("h2");
	const promptLabel = el("span");
	const line = el("input", { attrs: { type: "text", spellcheck: "false", autocomplete: "off" } });
	const box = el("textarea", { attrs: { rows: "4", spellcheck: "true" } });
	const hint = el("p", { class: "git-hint" });
	const error = el("p", { class: "git-error", attrs: { role: "alert" } });
	const cancel = el("button", {
		class: "dialog-button",
		text: t.cancel,
		attrs: { type: "button" },
	});
	const submit = el("button", { class: "dialog-button primary", attrs: { type: "submit" } });
	const form = el("form", {
		class: "git-form",
		attrs: { method: "dialog" },
		children: [
			promptTitle,
			el("label", { class: "git-field", children: [promptLabel, line, box] }),
			hint,
			error,
			el("div", { class: "git-actions", children: [cancel, submit] }),
		],
	});
	const promptDialog = el("dialog", { class: "git-dialog", children: [form] });

	// --- Branches ---------------------------------------------------------
	const filter = el("input", {
		class: "quick-open-input",
		attrs: { type: "search", placeholder: t.gitBranchFilter, "aria-label": t.gitBranchFilter },
	});
	const empty = el("p", { class: "quick-open-empty", text: t.gitNoBranches });
	const list = el("ul", {
		class: "quick-open-list",
		attrs: { role: "listbox", "aria-label": t.gitBranchTitle },
	});
	const branchDialog = el("dialog", {
		class: "git-dialog git-branches",
		attrs: { "aria-label": t.gitBranchTitle },
		children: [filter, empty, list],
	});
	document.body.append(promptDialog, branchDialog);

	let answer: ((value: string | null) => void) | null = null;
	let check: PromptRequest["check"];

	const field = (): HTMLInputElement | HTMLTextAreaElement => (box.hidden ? line : box);

	const settle = (value: string | null): void => {
		const done = answer;
		answer = null;
		if (promptDialog.open) promptDialog.close();
		done?.(value);
	};

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const value = field().value.trim();
		const problem = value === "" ? "" : (check?.(value) ?? null);
		if (problem !== null) {
			error.textContent = problem;
			error.hidden = problem === "";
			field().focus();
			return;
		}
		settle(value);
	});
	cancel.addEventListener("click", () => settle(null));
	// Escape closes it; a prompt opened again meanwhile is not the one cancelled.
	promptDialog.addEventListener("close", () => {
		if (!promptDialog.open) settle(null);
	});
	// Ctrl+Enter commits a message written over several lines.
	box.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			form.requestSubmit();
		}
	});
	for (const input of [line, box]) {
		input.addEventListener("input", () => {
			error.hidden = true;
			submit.disabled = input.value.trim() === "";
		});
	}

	// --- Branch picker state ---
	let branches: readonly GitBranch[] = [];
	let shown: GitBranch[] = [];
	let selected = 0;
	let picked: ((branch: GitBranch | null) => void) | null = null;

	const settleBranch = (branch: GitBranch | null): void => {
		const done = picked;
		picked = null;
		if (branchDialog.open) branchDialog.close();
		done?.(branch);
	};

	function renderBranches(): void {
		const needle = filter.value.trim().toLocaleLowerCase(lang);
		shown = branches.filter((branch) => branch.name.toLocaleLowerCase(lang).includes(needle));
		selected = Math.min(selected, Math.max(0, shown.length - 1));
		empty.hidden = shown.length > 0;
		list.replaceChildren(
			...shown.map((branch, i) => {
				const option = el("li", {
					class: "quick-open-item git-branch",
					attrs: {
						role: "option",
						"aria-selected": String(i === selected),
						"data-branch": branch.name,
					},
					children: [
						icon("branch"),
						el("span", { class: "quick-open-name", text: branch.name }),
						el("span", {
							class: "quick-open-path",
							text: branch.current
								? t.gitCurrent
								: branch.remote === null
									? ""
									: format(t.gitRemote, branch.remote),
						}),
					],
				});
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => settleBranch(branch));
				return option;
			}),
		);
		list.children[selected]?.scrollIntoView({ block: "nearest" });
	}

	filter.addEventListener("input", () => {
		selected = 0;
		renderBranches();
	});
	filter.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			selected = Math.max(0, Math.min(shown.length - 1, selected + step));
			renderBranches();
		} else if (event.key === "Enter") {
			event.preventDefault();
			const branch = shown[selected];
			if (branch !== undefined) settleBranch(branch);
		}
	});
	branchDialog.addEventListener("close", () => {
		if (!branchDialog.open) settleBranch(null);
	});
	branchDialog.addEventListener("click", (event) => {
		if (event.target === branchDialog) settleBranch(null);
	});

	return {
		prompt(request) {
			settle(null);
			check = request.check;
			promptTitle.textContent = request.title;
			promptLabel.textContent = request.label;
			submit.textContent = request.button;
			const multiline = request.multiline === true;
			line.hidden = multiline;
			box.hidden = !multiline;
			const input = field();
			input.value = request.value ?? "";
			input.placeholder = request.placeholder ?? "";
			hint.textContent = request.hint ?? "";
			hint.hidden = hint.textContent === "";
			error.hidden = true;
			submit.disabled = input.value.trim() === "";
			promptDialog.showModal();
			input.focus();
			input.select();
			return new Promise((resolve) => {
				answer = resolve;
			});
		},
		pickBranch(next) {
			settleBranch(null);
			branches = next;
			filter.value = "";
			selected = 0;
			renderBranches();
			branchDialog.showModal();
			filter.focus();
			return new Promise((resolve) => {
				picked = resolve;
			});
		},
	};
}
