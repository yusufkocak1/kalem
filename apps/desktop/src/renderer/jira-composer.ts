import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { JiraComment } from "../shared/jira.js";
import { applyMentions, parsePersonName } from "../shared/jira-comments.js";
import type { JiraAttachment } from "../shared/jira-fields.js";
import { mentionMarkup } from "../shared/jira-fields.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { personMark } from "./jira-comment-view.js";
import { createPopupList, errorMessage } from "./jira-field-chip.js";

export interface ComposerOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	readonly issueKey: string;
	readonly cloud: boolean;
	onSent(comment: JiraComment, uploaded: readonly JiraAttachment[]): void;
}

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

function pastedName(type: string, now: Date): string {
	const pad = (value: number): string => String(value).padStart(2, "0");
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `pasted-image-${stamp}.${IMAGE_EXTENSIONS[type] ?? "png"}`;
}

export function createComposer(options: ComposerOptions): HTMLElement {
	const { t, bridge } = options;
	const mentions = new Map<string, string>();
	let uploaded: JiraAttachment[] = [];
	let uploading = 0;
	let sending = false;

	const input = el("textarea", {
		class: "jira-composer-input",
		attrs: { rows: "2", placeholder: t.jiraReplyPlaceholder, "aria-label": t.jiraReplyPlaceholder },
	});
	const send = el("button", {
		class: "jira-button primary jira-composer-send",
		attrs: { type: "button" },
		children: [icon("send"), t.jiraReplySend],
	});
	const status = el("p", { class: "jira-composer-status", attrs: { "aria-live": "polite" } });
	const root = el("div", {
		class: "jira-composer",
		children: [el("div", { class: "jira-composer-row", children: [input, send] }), status],
	});

	const setStatus = (text: string, error = false): void => {
		status.textContent = text;
		status.classList.toggle("error", error);
		status.setAttribute("role", error ? "alert" : "status");
	};
	const update = (): void => {
		send.disabled = sending || uploading > 0 || input.value.trim() === "";
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
	};

	const tokenBeforeCaret = (): { start: number; query: string } | null => {
		const before = input.value.slice(0, input.selectionStart);
		const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(before);
		if (match === null) return null;
		return { start: before.length - (match[1]?.length ?? 0) - 1, query: match[1] ?? "" };
	};

	const users = new Map<string, string>();
	const popup = createPopupList({
		t,
		lang: options.lang,
		searchable: false,
		remoteSearch: true,
		anchor: input,
		className: "jira-mention-picker",
		query: () => tokenBeforeCaret()?.query ?? "",
		load: async (query) => {
			if (query.length < 1) return [];
			const found = await bridge.jiraMentionUsers(query);
			for (const user of found) users.set(user.id, mentionMarkup(user, options.cloud));
			return found.map((user) => ({ id: user.id, name: user.name }));
		},
		selected: () => null,
		renderMark: (option) => personMark(parsePersonName(option.name).name),
		displayName: (option) => parsePersonName(option.name).name,
		choose: (option) => {
			popup.close();
			const token = tokenBeforeCaret();
			if (option === null || token === null) return;
			const markup = users.get(option.id);
			if (markup === undefined) return;
			const name = parsePersonName(option.name).name;
			mentions.set(name, markup);
			const caret = input.selectionStart;
			const inserted = `@${name} `;
			input.value = input.value.slice(0, token.start) + inserted + input.value.slice(caret);
			const at = token.start + inserted.length;
			input.setSelectionRange(at, at);
			input.focus();
			update();
		},
	});
	root.append(popup.element);

	let timer: ReturnType<typeof setTimeout> | undefined;
	input.addEventListener("input", () => {
		update();
		clearTimeout(timer);
		const token = tokenBeforeCaret();
		if (token === null || token.query === "") {
			popup.close();
			return;
		}
		timer = setTimeout(() => {
			popup.close();
			popup.open();
		}, 250);
	});

	const insertAtCaret = (text: string): void => {
		const start = input.selectionStart;
		const end = input.selectionEnd;
		const before = input.value.slice(0, start);
		const spacer = before === "" || before.endsWith("\n") ? "" : "\n";
		input.value = `${before}${spacer}${text}\n${input.value.slice(end)}`;
		const at = before.length + spacer.length + text.length + 1;
		input.setSelectionRange(at, at);
		update();
	};

	input.addEventListener("paste", (event) => {
		const files = [...(event.clipboardData?.items ?? [])]
			.filter((item) => item.kind === "file" && item.type in IMAGE_EXTENSIONS)
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);
		if (files.length === 0) return;
		event.preventDefault();
		for (const file of files) {
			uploading++;
			update();
			setStatus(t.jiraReplyUploading);
			const name = pastedName(file.type, new Date());
			void file
				.arrayBuffer()
				.then((buffer) =>
					bridge.jiraUploadAttachment(options.issueKey, {
						name,
						type: file.type,
						bytes: new Uint8Array(buffer),
					}),
				)
				.then((storedFiles) => {
					const stored = storedFiles[0];
					if (stored !== undefined) uploaded.push(stored);
					insertAtCaret(`!${stored?.filename ?? name}|thumbnail!`);
					setStatus("");
				})
				.catch((error: unknown) => {
					setStatus(format(t.jiraReplyUploadFailed, errorMessage(error)), true);
				})
				.finally(() => {
					uploading--;
					update();
				});
		}
	});

	const submit = (): void => {
		if (send.disabled) return;
		sending = true;
		update();
		setStatus(t.jiraReplySending);
		const wiki = applyMentions(input.value.trim(), mentions);
		bridge
			.jiraAddComment(options.issueKey, wiki)
			.then((comment) => {
				options.onSent(comment, uploaded);
				input.value = "";
				mentions.clear();
				uploaded = [];
				setStatus("");
			})
			.catch((error: unknown) => {
				setStatus(format(t.jiraReplyFailed, errorMessage(error)), true);
			})
			.finally(() => {
				sending = false;
				update();
			});
	};
	send.addEventListener("click", submit);
	update();
	return root;
}
