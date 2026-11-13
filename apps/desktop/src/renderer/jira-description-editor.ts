import { serialize } from "@kalem-editor/core";
import type { MarkType } from "@kalem-editor/core/commands";
import { Editor, toggleList } from "@kalem-editor/editor";
import { renderToString } from "@kalem-editor/viewer";
import type { KalemBridge } from "../shared/bridge.js";
import { markdownToWiki } from "../shared/confluence-wiki.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { JiraIssue } from "../shared/jira.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { errorMessage } from "./jira-field-chip.js";
import { jiraHtmlRoot } from "./jira-html.js";

export interface DescriptionEditorOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	readonly issue: JiraIssue;
	onSaved(): void;
	onCancel(): void;
}

export function createDescriptionEditor(options: DescriptionEditorOptions): HTMLElement {
	const { t, issue } = options;
	const html = issue.descriptionHtml;
	const start = html === null ? issue.description : serialize(jiraHtmlRoot(html));
	const host = el("div", { class: "jira-description-host" });
	const editor = new Editor(host, { value: start, lang: options.lang, label: t.jiraDescription });

	const tool = (name: IconName, label: string, run: () => void): HTMLButtonElement => {
		const button = el("button", {
			class: "jira-icon-action",
			attrs: { type: "button", title: label, "aria-label": label },
			children: [icon(name)],
		});
		button.addEventListener("mousedown", (event) => event.preventDefault());
		button.addEventListener("click", () => {
			run();
			editor.focus();
		});
		return button;
	};
	const mark = (type: MarkType) => () => editor.toggleMark(type);
	const list = (ordered: boolean) => () => {
		const caret = editor.getCaret();
		if (caret !== null) editor.applyEdit(toggleList(editor.getDocument(), caret, ordered));
	};
	const toolbar = el("div", {
		class: "jira-description-tools",
		attrs: { role: "toolbar", "aria-label": t.jiraDescription },
		children: [
			tool("bold", t.jiraEditBold, mark("strong")),
			tool("italic", t.jiraEditItalic, mark("emphasis")),
			tool("strikethrough", t.jiraEditStrike, mark("delete")),
			tool("code", t.jiraEditCode, mark("inlineCode")),
			tool("bulletList", t.jiraEditBullets, list(false)),
			tool("orderedList", t.jiraEditNumbers, list(true)),
		],
	});

	const status = el("p", { class: "jira-composer-status", attrs: { role: "status" } });
	const save = el("button", {
		class: "jira-button primary",
		attrs: { type: "button" },
		text: t.jiraEditSave,
	});
	const cancel = el("button", {
		class: "jira-button",
		attrs: { type: "button" },
		text: t.jiraEditCancel,
	});
	cancel.addEventListener("click", () => {
		editor.destroy();
		options.onCancel();
	});
	save.addEventListener("click", () => {
		save.disabled = true;
		cancel.disabled = true;
		status.classList.remove("error");
		status.textContent = t.jiraReplySending;
		const value =
			html === null ? markdownToWiki(editor.getValue()) : renderToString(editor.getDocument());
		options.bridge
			.jiraSetDescription(issue.key, value)
			.then(() => {
				editor.destroy();
				options.onSaved();
			})
			.catch((error: unknown) => {
				status.classList.add("error");
				status.textContent = format(t.jiraSaveFailed, errorMessage(error));
				save.disabled = false;
				cancel.disabled = false;
			});
	});
	const root = el("div", {
		class: "jira-description-editor",
		children: [
			toolbar,
			host,
			el("div", { class: "jira-description-actions", children: [status, cancel, save] }),
		],
	});
	requestAnimationFrame(() => editor.focus());
	return root;
}
