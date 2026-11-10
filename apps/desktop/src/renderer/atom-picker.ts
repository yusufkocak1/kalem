import type { Inline, Root } from "@kalem-editor/core";
import { replaceAt } from "@kalem-editor/core";
import type { Caret, Editor } from "@kalem-editor/editor";
import { spliceInline } from "@kalem-editor/editor";
import type { SlashItem } from "@kalem-editor/ui";
import { position } from "@kalem-editor/ui";
import type { KalemBridge } from "../shared/bridge.js";
import type { JiraServer, MentionUser } from "../shared/confluence-insert.js";
import { jiraHref, mentionHref } from "../shared/confluence-insert.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { issueKey, issueUrl } from "../shared/jira.js";
import { el } from "./dom.js";

export type PickerMode = "mention" | "jira";

/** Which services the picker may ask; read each time it opens. */
export interface PickerConnections {
	readonly confluence: boolean;
	readonly jira: boolean;
}

export interface AtomPickerOptions {
	readonly editor: Editor;
	readonly bridge: KalemBridge;
	readonly t: Strings;
	readonly connections: () => PickerConnections;
	readonly errorText: (error: unknown) => string;
}

export interface AtomPicker {
	/** Opens the picker at the caret (or `at`); what is typed next is the search. */
	open(mode: PickerMode, at?: Caret): void;
	close(): void;
	destroy(): void;
}

interface Choice {
	readonly glyph: string;
	readonly label: string;
	readonly detail: string;
	/** The text the link shows and its target. */
	readonly insert: () => Promise<{ text: string; url: string } | null>;
}

/** Where the picker was opened: the block, the trigger's start and where the search starts. */
interface Anchor {
	readonly blockIndex: number;
	readonly path: readonly number[];
	/** Removed on choosing: the `@` and the search. */
	readonly from: number;
	/** The search begins here (after the `@`). */
	readonly start: number;
}

const SEARCH_DELAY = 180;
/**
 * A space at the end of a paragraph collapses, and the browser drops it as
 * soon as something is typed after it: one put there by an edit is a
 * no-break space, as the browser itself types it.
 */
const NBSP = "\u00a0";
const MAX_QUERY = 60;

/** A node's text as the caret counts it. */
function plain(node: Inline): string {
	switch (node.type) {
		case "text":
		case "html":
		case "inlineCode":
			return node.value;
		case "break":
			return "\n";
		case "image":
		case "imageReference":
			return "";
		default:
			return node.children.map(plain).join("");
	}
}

/**
 * The `@` box that mentions a Confluence user, and the Jira issue box the
 * `/` menu opens. Both work inside a line: what is typed after the `@` (or
 * after choosing the menu item) is in the document and is the search;
 * choosing a result replaces it with the mention or the issue, a link
 * that saves to Confluence as a real mention or Jira macro
 * (`confluence-insert.ts`). The keys are taken only while it is open, like
 * the slash menu's.
 */
export function createAtomPicker(options: AtomPickerOptions): AtomPicker {
	const { editor, bridge, t } = options;
	const element = editor.getElement();

	const list = el("div", { class: "kalem-slash-list", attrs: { role: "listbox" } });
	const empty = el("div", { class: "kalem-slash-empty" });
	const root = el("div", {
		class: "kalem-menu kalem-slash kalem-theme atom-picker",
		attrs: { hidden: "" },
		children: [list, empty],
	});
	document.body.append(root);

	let mode: PickerMode = "mention";
	let anchor: Anchor | null = null;
	let choices: Choice[] = [];
	let selected = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let request = 0;
	let lastQuery: string | null = null;
	let busy = false;
	/** Asked once per opening: the Jira server new macros name, the Jira site for plain links. */
	let jiraServer: Promise<JiraServer | null> = Promise.resolve(null);
	let jiraSite: Promise<string | null> = Promise.resolve(null);

	const isOpen = (): boolean => anchor !== null;

	function nodeAt(doc: Root, caret: { blockIndex: number; path: readonly number[] }) {
		let current: unknown = doc.children[caret.blockIndex];
		for (const index of caret.path) {
			const children = (current as { children?: readonly unknown[] } | undefined)?.children;
			if (children === undefined) return null;
			current = children[index];
		}
		const node = current as { children?: readonly Inline[] } | undefined;
		return node?.children === undefined ? null : (node as { children: readonly Inline[] });
	}

	function blockText(caret: Caret): string | null {
		const node = nodeAt(editor.getDocument(), caret);
		return node === null ? null : node.children.map(plain).join("");
	}

	const samePlace = (caret: Caret, at: Anchor): boolean =>
		caret.blockIndex === at.blockIndex &&
		caret.path.length === at.path.length &&
		caret.path.every((n, i) => n === at.path[i]);

	/** The search typed since opening; `null` when the caret left it. */
	function query(): string | null {
		const at = anchor;
		const caret = editor.getCaret();
		const range = editor.getTextRange();
		if (at === null || caret === null || range === null || range.from !== range.to) return null;
		if (!samePlace(caret, at) || caret.offset < at.start) return null;
		const text = blockText(caret);
		if (text === null) return null;
		if (at.from < at.start && text[at.from] !== "@") return null;
		return text.slice(at.start, caret.offset);
	}

	// --- Drawing ----------------------------------------------------------------

	function render(message: string | null): void {
		list.replaceChildren();
		for (const [index, choice] of choices.entries()) {
			const row = el("div", {
				class: "kalem-slash-item",
				attrs: {
					role: "option",
					id: `atom-picker-${index}`,
					"aria-selected": String(index === selected),
				},
				children: [
					el("span", {
						class: "kalem-slash-glyph",
						text: choice.glyph,
						attrs: { "aria-hidden": "true" },
					}),
					el("span", {
						class: "atom-picker-text",
						children: [
							el("span", { class: "kalem-slash-label", text: choice.label }),
							...(choice.detail === ""
								? []
								: [el("span", { class: "atom-picker-detail", text: choice.detail })]),
						],
					}),
				],
			});
			// Clicking must not move the caret out of the search.
			row.addEventListener("mousedown", (event) => event.preventDefault());
			row.addEventListener("click", () => void choose(index));
			list.append(row);
		}
		empty.textContent = message ?? "";
		empty.hidden = message === null;
		announce();
		place();
	}

	function announce(): void {
		if (choices[selected] === undefined) {
			element.removeAttribute("aria-activedescendant");
			return;
		}
		element.setAttribute("aria-activedescendant", `atom-picker-${selected}`);
		list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
	}

	function move(delta: number): void {
		if (choices.length === 0) return;
		selected = (selected + delta + choices.length) % choices.length;
		for (const [index, row] of Array.from(list.children).entries()) {
			row.setAttribute("aria-selected", String(index === selected));
		}
		announce();
	}

	function place(): void {
		const selection = document.getSelection();
		if (selection === null || selection.rangeCount === 0 || root.hidden) return;
		position(root, selection.getRangeAt(0).getBoundingClientRect(), { placement: "bottom" });
	}

	// --- Searching ----------------------------------------------------------------

	function userChoice(user: MentionUser): Choice | null {
		const url = mentionHref(user);
		if (url === null) return null;
		return {
			glyph: "@",
			label: user.name,
			detail: user.detail ?? "",
			insert: async () => ({ text: `@${user.name}`, url }),
		};
	}

	function issueChoice(key: string, summary: string): Choice {
		return {
			glyph: "◆",
			label: key,
			detail: summary,
			insert: async () => {
				if (options.connections().confluence) {
					const url = jiraHref(key, await jiraServer);
					return url === null ? null : { text: key, url };
				}
				const site = await jiraSite;
				return site === null ? null : { text: key, url: issueUrl(site, key) };
			},
		};
	}

	async function search(text: string): Promise<void> {
		const mine = ++request;
		const words = text.trim();
		const connections = options.connections();
		if (mode === "mention") {
			if (words === "") {
				choices = [];
				render(t.pickerMentionHint);
				return;
			}
			busy = true;
			if (choices.length === 0) render(t.pickerSearching);
			try {
				const users = await bridge.confluenceUsers(words);
				if (mine !== request) return;
				choices = users.map(userChoice).filter((choice) => choice !== null);
				selected = 0;
				render(choices.length === 0 ? t.pickerNone : null);
			} catch (error) {
				if (mine !== request) return;
				choices = [];
				render(format(t.pickerFailed, options.errorText(error)));
			} finally {
				if (mine === request) busy = false;
			}
			return;
		}
		// A Jira issue: a typed key is offered as it is; Jira, when connected, is searched.
		const key = issueKey(words);
		const typed = key === null ? [] : [issueChoice(key, "")];
		if (!connections.jira) {
			choices = typed;
			selected = 0;
			render(typed.length > 0 ? null : t.pickerJiraKeyHint);
			return;
		}
		if (words === "" && typed.length === 0) {
			choices = [];
			render(t.pickerJiraHint);
			return;
		}
		choices = typed;
		busy = true;
		render(t.pickerSearching);
		try {
			const found = await bridge.jiraSearch(words, null);
			if (mine !== request) return;
			const rows = found.issues
				.filter((issue) => issue.key !== key)
				.slice(0, 10)
				.map((issue) => issueChoice(issue.key, issue.summary));
			// The typed key's summary, when the search found it.
			const same = found.issues.find((issue) => issue.key === key);
			choices = [...(key === null ? [] : [issueChoice(key, same?.summary ?? "")]), ...rows];
			selected = 0;
			render(choices.length === 0 ? t.pickerNone : null);
		} catch (error) {
			if (mine !== request) return;
			render(typed.length > 0 ? null : format(t.pickerFailed, options.errorText(error)));
		} finally {
			if (mine === request) busy = false;
		}
	}

	function refresh(): void {
		const text = query();
		const at = anchor;
		if (text === null || at === null) {
			close();
			return;
		}
		// A long text, a new line or a pause of two spaces is writing, not a search.
		if (text.length > MAX_QUERY || text.includes("\n") || / {2}$/.test(text)) {
			close();
			return;
		}
		if (mode === "mention" && (text.startsWith(" ") || text.split(" ").length > 4)) {
			close();
			return;
		}
		place();
		if (text === lastQuery) return;
		lastQuery = text;
		clearTimeout(timer);
		timer = setTimeout(() => void search(text), SEARCH_DELAY);
	}

	// --- Choosing -----------------------------------------------------------------

	async function choose(index: number): Promise<void> {
		const choice = choices[index];
		const at = anchor;
		if (choice === undefined || at === null) return;
		const text = query();
		if (text === null) return;
		const end = at.start + text.length;
		const made = await choice.insert();
		// The search may have moved on while the server was asked.
		if (made === null || anchor !== at || query() !== text) return;
		close();
		const doc = editor.getDocument();
		const node = nodeAt(doc, at);
		if (node === null) return;
		const link: Inline = {
			type: "link",
			url: made.url,
			title: null,
			children: [{ type: "text", value: made.text }],
		} as Inline;
		const atEnd = node.children.map(plain).join("").length === end;
		const children = spliceInline(node.children, at.from, end, [
			link,
			{ type: "text", value: atEnd ? NBSP : " " } as Inline,
		]);
		editor.applyEdit({
			doc: replaceAt(doc, [at.blockIndex, ...at.path], { ...node, children } as never),
			caret: {
				blockIndex: at.blockIndex,
				path: at.path,
				offset: at.from + made.text.length + 1,
			},
		});
	}

	// --- Opening and closing ------------------------------------------------------

	function openAt(next: PickerMode, from: number, start: number, at?: Caret): void {
		const caret = at ?? editor.getCaret();
		if (caret === null || editor.isReadOnly()) return;
		mode = next;
		anchor = { blockIndex: caret.blockIndex, path: caret.path, from, start };
		choices = [];
		selected = 0;
		lastQuery = null;
		list.setAttribute("aria-label", mode === "mention" ? t.pickerMentionLabel : t.pickerJiraLabel);
		if (mode === "jira") {
			const connections = options.connections();
			jiraServer = connections.confluence
				? bridge.confluenceJiraServer().catch(() => null)
				: Promise.resolve(null);
			jiraSite = connections.jira
				? bridge
						.jiraAccount()
						.then((account) => account?.site ?? null)
						.catch(() => null)
				: Promise.resolve(null);
		}
		root.hidden = false;
		render(mode === "mention" ? t.pickerMentionHint : t.pickerJiraHint);
		refresh();
	}

	function close(): void {
		anchor = null;
		request++;
		busy = false;
		clearTimeout(timer);
		root.hidden = true;
		element.removeAttribute("aria-activedescendant");
	}

	const onKey = (event: KeyboardEvent): void => {
		if (!isOpen()) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			move(event.key === "ArrowDown" ? 1 : -1);
		} else if (event.key === "Enter" || event.key === "Tab") {
			// While a search is under way Enter waits for nothing: it chooses what is there.
			if (choices.length === 0) {
				if (event.key === "Enter" && busy) event.preventDefault();
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			void choose(selected);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	};

	/** `@` at the start of a word opens it while Confluence is connected; then each change searches. */
	const onChange = (): void => {
		if (editor.isReadOnly()) return;
		if (isOpen()) {
			refresh();
			return;
		}
		if (!options.connections().confluence) return;
		const caret = editor.getCaret();
		const range = editor.getTextRange();
		if (caret === null || caret.offset === 0 || range === null || range.from !== range.to) return;
		const text = blockText(caret);
		if (text === null || text[caret.offset - 1] !== "@") return;
		const before = caret.offset >= 2 ? (text[caret.offset - 2] ?? " ") : " ";
		if (before.trim() !== "" && !"([{\"'".includes(before)) return;
		openAt("mention", caret.offset - 1, caret.offset);
	};

	const onPointer = (event: PointerEvent): void => {
		if (!isOpen()) return;
		if (event.target instanceof Node && root.contains(event.target)) return;
		close();
	};

	element.addEventListener("keydown", onKey, true);
	document.addEventListener("pointerdown", onPointer, true);
	const offChange = editor.on("change", onChange);
	const offSelection = editor.on("selectionchange", () => {
		if (isOpen() && query() === null) close();
	});

	return {
		open(next, at) {
			const caret = at ?? editor.getCaret();
			if (caret === null) return;
			openAt(next, caret.offset, caret.offset, caret);
		},
		close,
		destroy() {
			close();
			element.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onPointer, true);
			offChange();
			offSelection();
			root.remove();
		},
	};
}

/** The `/` menu's items that open the picker where the caret is, inside the line. */
export function pickerSlashItems(
	picker: () => AtomPicker | null,
	t: Strings,
	connections: PickerConnections,
): SlashItem[] {
	const item = (id: string, label: string, glyph: string, mode: PickerMode): SlashItem => ({
		id,
		label,
		group: t.insertGroup,
		glyph,
		// Only the `/search` goes; the line stays as it is and the picker opens in it.
		apply: (doc, caret) => {
			// Opened where the `/search` was, once the menu's edit is in.
			queueMicrotask(() => picker()?.open(mode, caret));
			return { doc: keepTrailingSpace(doc, caret), caret };
		},
	});
	return [
		...(connections.confluence ? [item("mention", t.insertMention, "@", "mention")] : []),
		...(connections.confluence || connections.jira
			? [item("jira-issue", t.insertJira, "◆", "jira")]
			: []),
	];
}

/** The space the caret is after, at the end of its paragraph, kept as a no-break space (see `NBSP`). */
function keepTrailingSpace(doc: Root, caret: Caret): Root {
	let current: unknown = doc.children[caret.blockIndex];
	for (const index of caret.path) {
		current = (current as { children?: readonly unknown[] } | undefined)?.children?.[index];
	}
	const node = current as { children?: readonly Inline[] } | undefined;
	const last = node?.children?.at(-1);
	if (node?.children === undefined || last?.type !== "text" || !last.value.endsWith(" "))
		return doc;
	// Only when the caret is at the very end of the line.
	if (node.children.map(plain).join("").length !== caret.offset) return doc;
	const children = [
		...node.children.slice(0, -1),
		{ ...last, value: `${last.value.slice(0, -1)}${NBSP}` },
	];
	return replaceAt(doc, [caret.blockIndex, ...caret.path], { ...node, children } as never);
}
