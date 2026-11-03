import type { GitBranch, GitChangeKind, GitFileChange } from "../shared/bridge.js";
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

export interface CommitRequest {
	readonly title: string;
	readonly files: readonly GitFileChange[];
	/** A message written from the chosen files' changes; rejects with why it could not. */
	suggest?(paths: readonly string[]): Promise<string>;
}

export interface CommitAnswer {
	readonly message: string;
	/** `undefined` when every file is chosen. */
	readonly paths: readonly string[] | undefined;
}

/** The letter a change is marked with, as in other editors. */
export const CHANGE_LETTER: Readonly<Record<GitChangeKind, string>> = {
	modified: "M",
	added: "A",
	deleted: "D",
	renamed: "R",
	untracked: "U",
	conflict: "!",
};

export interface GitDialogs {
	/** The files to commit and the message; `null` when cancelled. */
	commit(request: CommitRequest): Promise<CommitAnswer | null>;
	/** Shows a unified diff. */
	diff(title: string, text: string): void;
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

	// --- Commit -----------------------------------------------------------
	const commitTitle = el("h2");
	const allFiles = el("input", { attrs: { type: "checkbox" } });
	const fileList = el("ul", { class: "git-files", attrs: { "aria-label": t.gitCommitFiles } });
	const message = el("textarea", {
		attrs: {
			rows: "4",
			spellcheck: "true",
			"aria-label": t.gitCommitMessage,
			placeholder: t.gitCommitMessage,
		},
	});
	const suggestButton = el("button", {
		class: "dialog-button git-suggest",
		text: t.gitSuggest,
		attrs: { type: "button", title: t.gitSuggestHint },
	});
	const commitError = el("p", { class: "git-error", attrs: { role: "alert" } });
	const commitCancel = el("button", {
		class: "dialog-button",
		text: t.cancel,
		attrs: { type: "button" },
	});
	const commitSubmit = el("button", {
		class: "dialog-button primary",
		text: t.gitCommitButton,
		attrs: { type: "submit" },
	});
	const commitForm = el("form", {
		class: "git-form",
		attrs: { method: "dialog" },
		children: [
			commitTitle,
			el("label", {
				class: "git-all",
				children: [allFiles, el("span", { text: t.gitCommitAll })],
			}),
			fileList,
			el("div", {
				class: "git-message-head",
				children: [el("span", { text: t.gitCommitMessage }), suggestButton],
			}),
			message,
			commitError,
			el("div", { class: "git-actions", children: [commitCancel, commitSubmit] }),
		],
	});
	const commitDialog = el("dialog", { class: "git-dialog git-commit", children: [commitForm] });
	let committing: ((answer: CommitAnswer | null) => void) | null = null;
	let commitFiles: readonly GitFileChange[] = [];
	let suggest: CommitRequest["suggest"];

	const chosen = (): string[] =>
		[...fileList.querySelectorAll<HTMLInputElement>("input:checked")].map((box) => box.value);
	const updateCommit = (): void => {
		const count = chosen().length;
		allFiles.checked = count === commitFiles.length;
		allFiles.indeterminate = count > 0 && count < commitFiles.length;
		commitSubmit.disabled = count === 0 || message.value.trim() === "";
		suggestButton.disabled = count === 0 || suggest === undefined;
	};
	const settleCommit = (answer: CommitAnswer | null): void => {
		const done = committing;
		committing = null;
		if (commitDialog.open) commitDialog.close();
		done?.(answer);
	};
	allFiles.addEventListener("change", () => {
		for (const box of fileList.querySelectorAll<HTMLInputElement>("input")) {
			box.checked = allFiles.checked;
		}
		updateCommit();
	});
	fileList.addEventListener("change", updateCommit);
	message.addEventListener("input", updateCommit);
	message.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			commitForm.requestSubmit();
		}
	});
	suggestButton.addEventListener("click", async () => {
		if (suggest === undefined) return;
		suggestButton.disabled = true;
		suggestButton.textContent = t.gitSuggesting;
		commitError.hidden = true;
		try {
			message.value = await suggest(chosen());
		} catch (error) {
			commitError.textContent = format(
				t.gitSuggestFailed,
				String((error as Error)?.message ?? error).replace(
					/^Error invoking remote method '[^']+': (Error: )?/,
					"",
				),
			);
			commitError.hidden = false;
		} finally {
			suggestButton.textContent = t.gitSuggest;
			updateCommit();
			message.focus();
		}
	});
	commitForm.addEventListener("submit", (event) => {
		event.preventDefault();
		const paths = chosen();
		if (paths.length === 0 || message.value.trim() === "") return;
		settleCommit({
			message: message.value.trim(),
			paths: paths.length === commitFiles.length ? undefined : paths,
		});
	});
	commitCancel.addEventListener("click", () => settleCommit(null));
	commitDialog.addEventListener("close", () => {
		if (!commitDialog.open) settleCommit(null);
	});

	// --- Diff -------------------------------------------------------------
	const diffTitle = el("h2");
	const diffBody = el("pre", { class: "git-diff" });
	const diffClose = el("button", {
		class: "dialog-button",
		text: t.close,
		attrs: { type: "button" },
	});
	const diffDialog = el("dialog", {
		class: "git-dialog git-diff-dialog",
		children: [diffTitle, diffBody, el("div", { class: "git-actions", children: [diffClose] })],
	});
	diffClose.addEventListener("click", () => diffDialog.close());
	document.body.append(commitDialog, diffDialog);

	return {
		commit(request) {
			settleCommit(null);
			commitFiles = request.files;
			suggest = request.suggest;
			commitTitle.textContent = request.title;
			fileList.replaceChildren(
				...request.files.map((file) =>
					el("li", {
						children: [
							el("label", {
								attrs: { title: file.path },
								children: [
									Object.assign(el("input", { attrs: { type: "checkbox", value: file.path } }), {
										checked: true,
									}),
									el("span", {
										class: `git-letter git-${file.kind}`,
										text: CHANGE_LETTER[file.kind],
									}),
									el("span", { class: "git-file-path", text: file.path }),
								],
							}),
						],
					}),
				),
			);
			message.value = "";
			commitError.hidden = true;
			updateCommit();
			commitDialog.showModal();
			message.focus();
			return new Promise((resolve) => {
				committing = resolve;
			});
		},
		diff(title, text) {
			diffTitle.textContent = title;
			diffBody.replaceChildren(
				...(text.trim() === "" ? [t.gitNoDiff] : text.replace(/\n$/, "").split("\n")).map((line) =>
					el("span", {
						class: `git-diff-line${
							line.startsWith("+++") ||
							line.startsWith("---") ||
							line.startsWith("diff ") ||
							line.startsWith("index ")
								? " head"
								: line.startsWith("@@")
									? " hunk"
									: line.startsWith("+")
										? " add"
										: line.startsWith("-")
											? " remove"
											: ""
						}`,
						text: `${line}\n`,
					}),
				),
			);
			diffDialog.showModal();
			diffClose.focus();
		},
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
