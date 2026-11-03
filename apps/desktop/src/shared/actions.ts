/**
 * What the assistant can do in the app, beyond writing text to insert: the
 * changes to the document and the app's commands it proposes in a
 * `kalem-actions` block, and their applying to the document's Markdown.
 * The user applies them with one click; nothing runs by itself. Pure.
 */
import type { Command } from "./bridge.js";

/** The code fence language of the actions in a reply. */
export const ACTIONS_FENCE = "kalem-actions";

/** The app's commands the assistant may propose, with what each does (for the model). */
export const ASSISTANT_COMMANDS = {
	save: "save the document",
	"save-as": "save the document under another name",
	"save-as-package": "save the document as one .kmd file with its images and attached files",
	"export-docx": "export the document as a Word file",
	"export-html": "export the document as an HTML file",
	"export-confluence": "export as Confluence storage format",
	"export-confluence-wiki": "export as Confluence wiki markup",
	"version-history": "show earlier saves of the document",
	find: "open find",
	replace: "open find and replace",
	image: "insert a picture from a file",
	"attach-file": "attach a file to the document",
	diagram: "open the diagram editor for a new diagram",
	table: "insert an empty table",
	source: "show or hide the Markdown source",
	"read-only": "turn read only on or off",
	focus: "turn focus mode on or off",
	"zoom-in": "zoom in",
	"zoom-out": "zoom out",
	"zoom-reset": "reset the zoom",
	"quick-open": "open a document of the folder by name",
	"search-folder": "search the open folder's documents",
	"format-all-code": "format every JSON, XML, HTML and YAML code block",
	undo: "undo the last change",
	redo: "redo",
} as const satisfies Partial<Record<Command, string>>;

export type AssistantCommand = keyof typeof ASSISTANT_COMMANDS;

export const isAssistantCommand = (value: unknown): value is AssistantCommand =>
	typeof value === "string" && Object.hasOwn(ASSISTANT_COMMANDS, value);

/** Where inserted text goes. */
export type InsertPlace = "cursor" | "start" | "end";

export type DocumentAction =
	/** Exact text of the document's Markdown replaced; `all` for every occurrence. */
	| {
			readonly type: "replace";
			readonly find: string;
			readonly replace: string;
			readonly all: boolean;
	  }
	| { readonly type: "insert"; readonly text: string; readonly at: InsertPlace }
	/** The whole document replaced. */
	| { readonly type: "document"; readonly text: string };

export type AssistantAction =
	| DocumentAction
	| { readonly type: "command"; readonly command: AssistantCommand };

export const isDocumentAction = (action: AssistantAction): action is DocumentAction =>
	action.type !== "command";

const MAX_ACTIONS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function actionOf(raw: unknown): AssistantAction | null {
	if (!isRecord(raw)) return null;
	const type =
		typeof raw.type === "string" ? raw.type : typeof raw.action === "string" ? raw.action : "";
	switch (type) {
		case "replace": {
			const find = typeof raw.find === "string" ? raw.find : "";
			const replace = typeof raw.replace === "string" ? raw.replace : null;
			if (find === "" || replace === null) return null;
			return { type, find, replace, all: raw.all === true };
		}
		case "insert": {
			if (typeof raw.text !== "string" || raw.text.trim() === "") return null;
			const at: InsertPlace = raw.at === "start" || raw.at === "end" ? raw.at : "cursor";
			return { type, text: raw.text, at };
		}
		case "document":
			return typeof raw.text === "string" ? { type, text: raw.text } : null;
		case "command":
			return isAssistantCommand(raw.command) ? { type, command: raw.command } : null;
		default:
			return null;
	}
}

/**
 * The actions of a `kalem-actions` block: a JSON array, or an object with
 * an `actions` array. Actions it does not know are left out; `null` when
 * none is left.
 */
export function actionsFromReply(json: string): AssistantAction[] | null {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return null;
	}
	const list = Array.isArray(data) ? data : isRecord(data) ? (data.actions ?? [data]) : [];
	if (!Array.isArray(list)) return null;
	const actions = list
		.slice(0, MAX_ACTIONS)
		.map(actionOf)
		.filter((action): action is AssistantAction => action !== null);
	return actions.length === 0 ? null : actions;
}

export type ApplyResult =
	| { readonly ok: true; readonly text: string; readonly changes: number }
	| {
			readonly ok: false;
			/** The action that could not be applied, by its position. */
			readonly index: number;
			readonly reason: "missing" | "ambiguous";
	  };

const count = (text: string, find: string): number => {
	let found = 0;
	for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) found++;
	return found;
};

/**
 * Where `find` is in `text`: as written, or else with its line ends and the
 * spaces at its ends as the text has them. `null` when it is not there.
 */
function locate(text: string, find: string): string | null {
	const candidates = [
		find,
		find.replace(/\r\n?/g, "\n"),
		find.trim(),
		find.replace(/\r\n?/g, "\n").trim(),
	];
	for (const candidate of candidates) {
		if (candidate !== "" && text.includes(candidate)) return candidate;
	}
	return null;
}

/**
 * The document's Markdown with the replacements, the whole-document text
 * and the start and end insertions done in order. Insertions at the cursor
 * are not text edits and are left to the editor. Every replacement must
 * find its text, and only once unless it is for all of them.
 */
export function applyActions(text: string, actions: readonly DocumentAction[]): ApplyResult {
	let next = text.replace(/\r\n?/g, "\n");
	let changes = 0;
	for (const [index, action] of actions.entries()) {
		switch (action.type) {
			case "replace": {
				const find = locate(next, action.find);
				if (find === null) return { ok: false, index, reason: "missing" };
				const found = count(next, find);
				if (found > 1 && !action.all) return { ok: false, index, reason: "ambiguous" };
				// A function, so `$` in the new text stays as written.
				next = action.all
					? next.split(find).join(action.replace)
					: next.replace(find, () => action.replace);
				changes += action.all ? found : 1;
				break;
			}
			case "document":
				next = action.text;
				changes++;
				break;
			case "insert": {
				if (action.at === "cursor") break;
				const body = action.text.replace(/^\n+|\n+$/g, "");
				const rest = next.replace(/^\n+|\n+$/g, "");
				next =
					rest === ""
						? `${body}\n`
						: action.at === "start"
							? `${body}\n\n${rest}\n`
							: `${rest}\n\n${body}\n`;
				changes++;
				break;
			}
		}
	}
	return { ok: true, text: next, changes };
}

/** The `kalem-actions` instructions for the model. */
export const ACTIONS_PROMPT = `## Changing the document and using the app
Besides writing content to insert, you can propose changes to the document and the app's commands in a code block whose language is \`${ACTIONS_FENCE}\`, holding a JSON array of actions. Kalem shows them as a card; nothing happens until the user clicks "Apply" (and they can undo it).

\`\`\`${ACTIONS_FENCE}
[
  { "type": "replace", "find": "exact text from the document", "replace": "the new text" },
  { "type": "insert", "at": "end", "text": "## Summary\\n\\nNew Markdown…" },
  { "type": "command", "command": "export-docx" }
]
\`\`\`

- "replace": "find" is copied exactly, character for character, from the Markdown in <document> (not from how it looks), and long enough to occur only once; "replace" is the Markdown that takes its place ("" deletes it). Add "all": true to replace every occurrence (for example renaming a term). Several small replacements are better than one large one; keep the parts that do not change out of "find".
- "insert": "text" is Markdown; "at" is "cursor" (where the user's cursor is), "start" or "end" of the document.
- "document": { "type": "document", "text": "…" } replaces the whole document. Use it only when most of the document changes (a translation, a full rewrite) or the user asks for it.
- "command": runs one of the app's commands: ${Object.entries(ASSISTANT_COMMANDS)
	.map(([name, what]) => `"${name}" (${what})`)
	.join(", ")}.

Use actions when the user asks you to change, fix, shorten, translate, rename, rewrite or remove something in the document, or to do something the commands do (save, export…). Changes need the document: when it was not shared and there is no <selection>, ask the user to share it ("Share the document") instead of guessing the text. For a <selection>, replace exactly the selected text (it is plain text: find it in the document's Markdown when the document is shared). For new content the user will place themselves (a draft, an answer, a table, a diagram), keep writing plain Markdown and Kalem diagrams without actions. Put a short sentence before the block saying what it changes, do not repeat the new text outside it, and use one actions block per reply.`;
