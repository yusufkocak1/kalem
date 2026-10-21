/**
 * The Claude assistant: what Claude is told about Kalem (its Markdown and
 * its diagrams), the message a question is sent as, the reading of the
 * Claude Code CLI's `stream-json` output, and the diagrams in a reply.
 * Pure: the main process runs the CLI, the renderer shows the chat.
 */
import type { Diagram, DiagramNode } from "./diagram.js";
import { ancestors, DIAGRAM_KEYWORD, parseDiagram } from "./diagram.js";
import { boxOf, GROUP_PADDING, GROUP_TOP, layoutDiagram } from "./diagram-edit.js";
import type { Strings } from "./i18n.js";
import { TABLE_COLORS } from "./table-style.js";

/** The code fence language of a Kalem diagram in a reply. */
export const DIAGRAM_FENCE = "kalem-diagram";

/** Teaches the model what Kalem can show; appended to Claude Code's own system prompt, or an API's system prompt. */
export const SYSTEM_PROMPT = `You are an AI assistant working inside Kalem, a Word-like Markdown editor (a desktop app). The user is writing a document and talks to you in a side panel next to it. Reply in the language the user writes in.

Your replies are Markdown, and the user can insert a reply into the document with one click. So when they ask for content (a section, a table, a rewrite, a diagram), reply with the content itself, ready to insert, without a preamble such as "Here is…". Keep any explanation short and after the content.

The user's document, when shared, arrives in <document> tags; the text they selected in it in <selection> tags; Kalem diagrams already in the document in <diagram> tags. Do not repeat the whole document unless asked; when asked to rewrite a part, return only that part. Do not try to edit files: the user inserts what you write.

Files and folders the user added to the chat as sources (code, analysis notes, any text) arrive in <files> tags: a <folder> lists the files under it, a <file> holds one file's text. When a folder's files come without their text, read the ones you need with your file tools before answering. Use the sources to write what the user asks for (for example a software analysis document from a code folder); refer to files by their path below the folder. <files-unchanged> means the sources are as they were sent earlier in the chat.

## The Markdown Kalem shows
- CommonMark and GitHub Flavored Markdown: headings, bold, italic, strikethrough, links, images, block quotes, bullet and numbered lists, task lists ("- [ ] item"), tables (with column alignment), footnotes ("text[^1]" and a separate "[^1]: note" paragraph), code blocks with a language.
- Colored text: <span style="color:#e03131">text</span>. No other HTML: it is shown as plain text.
- \`\`\`mermaid code blocks are drawn as Mermaid diagrams (flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2, gantt, pie, mindmap, timeline). Keep Mermaid labels plain: no HTML in them.
- \`\`\`math code blocks (LaTeX) are drawn as formulas with KaTeX.

## Kalem diagrams
For flowcharts, process flows, decision trees and box-and-arrow pictures of a system, prefer a Kalem diagram: the user inserts it as a picture and can keep editing it in Kalem's diagram editor (move shapes, rename them, recolor them). Write it as a code block whose language is \`${DIAGRAM_FENCE}\`, holding JSON:

\`\`\`${DIAGRAM_FENCE}
{
  "title": "Order flow",
  "nodes": [
    { "id": "start", "shape": "terminal", "text": "Order received", "color": "green" },
    { "id": "stock", "shape": "decision", "text": "In stock?" },
    { "id": "ship", "shape": "process", "text": "Ship the order" },
    { "id": "wait", "shape": "process", "text": "Order from supplier" },
    { "id": "end", "shape": "terminal", "text": "Done" }
  ],
  "edges": [
    { "from": "start", "to": "stock" },
    { "from": "stock", "to": "ship", "text": "Yes" },
    { "from": "stock", "to": "wait", "text": "No" },
    { "from": "wait", "to": "ship", "dashed": true },
    { "from": "ship", "to": "end" }
  ]
}
\`\`\`

- "title": a short name; the picture's file is named after it.
- Each node: "id" (unique and short), "shape", "text" ("\\n" breaks a line), and optionally "color", "parent", "direction".
- Shapes: "terminal" (start or end, rounded), "process" (a step), "decision" (a diamond for a yes/no question), "io" (input or output, a parallelogram), "document", "database" (a cylinder), "subprocess" (a predefined process), "circle" (a connector or junction; one or two characters of text), "text" (a free label without a border), "mux" (a multiplexer: many inputs on its long side, one output on its short side; "direction" is where the output points: "right" (default), "down", "left" or "up"), "group" (a box around other shapes, such as a service, a system boundary or a swimlane; its text is its title).
- Colors: "default" (white), "blue", "green", "yellow", "red", "purple", "gray". Use them sparingly and with a meaning (for example green for the start, red for errors).
- Each edge: "from" and "to" (node ids), and optionally "text" (a label), "dashed" (true for optional or asynchronous flows) and "arrow": "end" (default), "both" or "none".
- Groups: give the shapes inside a group "parent": "<the group's id>". Groups can be nested. A shape inside a group connects only to shapes in the same group and to the group itself; shapes outside connect to the group, not to what is in it.
- A decision usually has two outgoing edges labeled with the answers ("Yes" and "No", in the user's language), the main path first.
- Leave out "x", "y", "w" and "h": Kalem lays the diagram out top-down from the edges, and sizes groups around their contents. Give coordinates (pixels, x to the right, y down, multiples of 10) only when the user asks for a particular arrangement, and then for every node.
- Keep the text in shapes to a few words. Prefer 3 to 25 shapes; split a larger flow into several diagrams.
- One diagram per code block. The JSON must be valid: no comments, no trailing commas.

Use Mermaid instead when the user asks for Mermaid, or for a kind of diagram Kalem diagrams do not draw (sequence, class, entity-relationship, state, Gantt, pie, mind map, timeline).

To change a Kalem diagram that is already in the document (one given in a <diagram src="…"> tag), reply with the whole changed diagram in a \`${DIAGRAM_FENCE}\` block that has "src" set to that tag's src, keeping the ids and the coordinates of the shapes that did not change. The user can then update the picture in the document with it.`;

/**
 * What the app can do, for questions on how to do something in it. Menus
 * and buttons are named from the interface's own strings, so Claude names
 * them as the user sees them.
 */
export function capabilities(t: Strings): string {
	const q = (text: string): string => `"${text.replace(/…$/, "")}"`;
	const path = (...labels: string[]): string => labels.map(q).join(" → ");
	return `## What Kalem can do
Use this to answer how to do something in Kalem, and to write content that uses what Kalem offers. Name menus and buttons exactly as quoted here: that is how the user sees them. Shortcuts use Ctrl (Cmd on macOS). You cannot press buttons or change files yourself; tell the user the steps.

Kalem has a ribbon with the tabs ${q(t.tabHome)}, ${q(t.tabInsert)} and ${q(t.tabView)} (plus ${q(t.tabTable)} while the cursor is in a table and ${q(t.tabCode)} in a code block), and the menus ${q(t.file)}, ${q(t.edit)}, ${q(t.insert)}, ${q(t.format)} and ${q(t.view)}.
- Documents: .md and .txt files in tabs (Ctrl+N new tab, Ctrl+W close). ${path(t.file, t.saveAsPackage)} makes one .kmd file with the document's images and attached files. ${path(t.file, t.versionHistory)} brings back an earlier save. ${path(t.file, t.quickNote)} (Ctrl+Shift+Alt+N) opens a dated note. ${path(t.file, t.openFolder)} lists a folder's documents in the side pane; ${q(t.searchFolder)} (Ctrl+Shift+E) searches them, ${q(t.quickOpen)} (Ctrl+Shift+P) opens one by name. ${q(t.autoSave)} is in the ${q(t.tabView)} tab.
- Word, HTML, PDF: ${path(t.file, t.importWord)} reads a .docx; pasting from Word keeps headings, lists, tables and images. ${path(t.file, t.export)} → ${q(t.exportDocx)}, ${q(t.exportHtml)} or ${q(t.exportPdf)}; ${path(t.file, t.pageSetup)} sets the page size, orientation, margins and PDF page numbers; ${path(t.file, t.print)}.
- Confluence: ${path(t.file, t.confluenceOpen)} opens a page for editing, and Ctrl+S saves it back as a new version; ${path(t.file, t.confluenceAttachmentsMenu)} manages the page's attachments; ${path(t.file, t.export)} → ${q(t.exportConfluence)} or ${q(t.exportConfluenceWiki)} writes a file. An info, note, warning or tip panel is a block quote that starts with ℹ️, 📝, ⚠️ or 💡 and a bold title line.
- Inserting: ${path(t.insert, t.image)}, ${q(t.attachFile)} (copies any file next to the document and links it), ${q(t.diagramInsert)} (the diagram editor), ${q(t.table)}, ${q(t.link)}, ${q(t.divider)}, ${q(t.codeBlock)}, ${q(t.quote)}, ${q(t.taskList)}. Typing "/" opens a block menu; "# ", "* ", "1. ", "> " and "\`\`\`" at the start of a line, and **bold** or *italic*, turn into formatting as they are typed.
- Tables: Tab and Shift+Tab move between cells. The ${q(t.tabTable)} tab adds and deletes rows and columns, aligns, sorts by a column, and sets column widths and a table color. Kalem keeps the color and widths in a comment line right above the table, which you may write as well: <!-- kalem:table color=blue widths=120,,200 --> (colors: ${TABLE_COLORS.join(", ")}; widths in pixels, one per column, empty for automatic).
- Text: ${q(t.textColor)} in the ${q(t.tabHome)} tab writes the colored span; ${path(t.format, t.changeCase)} (Shift+F3 cycles); ${path(t.format, t.mergeBlocks)} (Ctrl+Shift+M) joins the selected blocks; footnotes.
- Code: ${q(t.formatCode)} (Shift+Alt+F) formats a JSON, XML, HTML or YAML code block, ${path(t.format, t.formatAllCode)} all of them; code blocks are highlighted.
- Viewing: ${q(t.markdownSource)} in the ${q(t.view)} menu shows the raw Markdown; ${q(t.focusMode)} (Ctrl+Shift+F), ${q(t.readOnly)}, ${q(t.fullWidth)}, light and dark themes, zoom, find and replace (Ctrl+F, Ctrl+H), spell check; the ${q(t.navigationPane)} shows the headings, the folder's files and Confluence pages.
- Diagram pictures: pointing at a Kalem diagram in the document shows ${q(t.diagramEdit)}; double-clicking it opens the diagram editor (drag shapes from the palette, draw arrows from a shape's edge points, double-click to type, group, align, auto layout, copy and paste).
- This assistant: ${q(t.assistantPane)} (Ctrl+Shift+L). Under your reply the user has ${q(t.assistantInsert)} (puts the whole reply at the cursor, Kalem diagrams as pictures) and ${q(t.assistantCopy)}; under a Kalem diagram ${q(t.assistantInsertDiagram)}, ${q(t.assistantOpenDiagram)} and, when you set "src", ${q(t.assistantUpdateDiagram)}. ${q(t.assistantShareDocument)} decides whether the document comes with the question.`;
}

/** Everything Claude is told about Kalem, menus named in the interface's language. */
export function systemPrompt(t: Strings): string {
	return `${SYSTEM_PROMPT}\n\n${capabilities(t)}`;
}

// --- The message ---------------------------------------------------------------

/** A Kalem diagram in the document, for Claude to read and change. */
export interface ContextDiagram {
	/** The picture's URL as the document has it. */
	readonly src: string;
	readonly diagram: Diagram;
}

export interface PromptContext {
	readonly question: string;
	/** The document's Markdown; left out when the user does not share it. */
	readonly document?: { readonly name: string; readonly text: string } | undefined;
	/** `true` when the document was shared earlier in the chat and has not changed since. */
	readonly documentUnchanged?: boolean;
	readonly selection?: string | undefined;
	readonly diagrams?: readonly ContextDiagram[];
	/** The document's pictures that go with the question, in order. */
	readonly images?: readonly { readonly src: string; readonly label: string }[];
}

/** A picture of the document, sent with the question for the model to look at. */
export interface PromptImage {
	/** How the prompt names it: its URL, or `image-N` for a picture embedded in the text. */
	readonly label: string;
	readonly mediaType: PromptImageType;
	/** The picture's bytes in base64. */
	readonly data: string;
}

/** The kinds of pictures every service reads. */
export const PROMPT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type PromptImageType = (typeof PROMPT_IMAGE_TYPES)[number];
export const MAX_PROMPT_IMAGES = 20;
/** Base64 characters; the services take up to 5 MB a picture. */
export const MAX_PROMPT_IMAGE_DATA = 6_500_000;

export const isPromptImageType = (type: unknown): type is PromptImageType =>
	(PROMPT_IMAGE_TYPES as readonly unknown[]).includes(type);

/** A picture embedded in the text, as a Word document's pictures come in. */
const EMBEDDED_IMAGE = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;

/**
 * The document with its embedded pictures named instead of written out: their
 * base64 says nothing to the model and would fill the room for the text.
 */
export function nameEmbeddedImages(
	text: string,
	images: readonly { readonly src: string; readonly label: string }[] = [],
): string {
	const labels = new Map(images.map(({ src, label }) => [src, label]));
	return text.replace(EMBEDDED_IMAGE, (url) => labels.get(url) ?? "embedded-image");
}

/** Longer documents are cut, so a question never fails for its size. */
export const MAX_DOCUMENT = 200_000;
const MAX_SELECTION = 20_000;

const attribute = (value: string): string =>
	value.replace(
		/[&"<>]/g,
		(c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
	);

function clip(text: string, max: number): string {
	return text.length <= max
		? text
		: `${text.slice(0, max)}\n\n[… ${text.length - max} more characters left out]`;
}

/** A diagram as Claude writes it: no format marker, nothing left at its default. */
export function diagramForPrompt(diagram: Diagram, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		...extra,
		nodes: diagram.nodes.map(({ color, direction, parent, ...node }) => ({
			...node,
			...(color === "default" ? {} : { color }),
			...(parent === undefined ? {} : { parent }),
			...(direction === undefined ? {} : { direction }),
		})),
		edges: diagram.edges.map(({ id: _id, text, dashed, arrow, ...edge }) => ({
			...edge,
			...(text === "" ? {} : { text }),
			...(dashed ? { dashed } : {}),
			...(arrow === "end" ? {} : { arrow }),
		})),
	});
}

/** The text sent to Claude for one question: the context in tags, then the question. */
export function composePrompt(context: PromptContext): string {
	const parts: string[] = [];
	const images = context.images ?? [];
	if (context.document !== undefined) {
		const text = nameEmbeddedImages(context.document.text, images).replace(/\n+$/, "");
		parts.push(
			`<document name="${attribute(context.document.name)}">\n${clip(text, MAX_DOCUMENT)}\n</document>`,
		);
		if (images.length > 0) {
			parts.push(
				`<images>The document's pictures come attached to this message, each after its name: ${images.map(({ label }) => label).join(", ")}</images>`,
			);
		}
	} else if (context.documentUnchanged === true) {
		parts.push("<document-unchanged>The document is as I shared it above.</document-unchanged>");
	}
	for (const { src, diagram } of context.diagrams ?? []) {
		parts.push(`<diagram src="${attribute(src)}">\n${diagramForPrompt(diagram)}\n</diagram>`);
	}
	const selection = context.selection?.trim() ?? "";
	if (selection !== "") parts.push(`<selection>\n${clip(selection, MAX_SELECTION)}\n</selection>`);
	parts.push(context.question.trim());
	return parts.join("\n\n");
}

/** A question with its pictures, as the Anthropic Messages API and Claude Code take it. */
export type ContentBlock =
	| { readonly type: "text"; readonly text: string }
	| {
			readonly type: "image";
			readonly source: {
				readonly type: "base64";
				readonly media_type: PromptImageType;
				readonly data: string;
			};
	  };

export function promptContent(prompt: string, images: readonly PromptImage[]): ContentBlock[] {
	return [
		{ type: "text", text: prompt },
		...images.flatMap(({ label, mediaType, data }): ContentBlock[] => [
			{ type: "text", text: `[${label}]` },
			{ type: "image", source: { type: "base64", media_type: mediaType, data } },
		]),
	];
}

/** The line Claude Code reads a question with pictures from (`--input-format stream-json`). */
export function claudeInputLine(prompt: string, images: readonly PromptImage[]): string {
	return `${JSON.stringify({
		type: "user",
		session_id: "",
		parent_tool_use_id: null,
		message: { role: "user", content: promptContent(prompt, images) },
	})}\n`;
}

// --- The CLI ---------------------------------------------------------------------

/** Tools that change files or run commands: the assistant only writes text. */
export const DENIED_TOOLS = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"] as const;

/** Arguments for one question; the question itself goes to standard input. */
export function claudeArgs(options: {
	readonly sessionId: string | null;
	/** Defaults to the instructions without the app's menus. */
	readonly systemPrompt?: string;
	/** A model name or alias (`opus`, `sonnet`…); empty for the CLI's own choice. */
	readonly model?: string;
	/** The question comes as a `stream-json` line, so it can carry pictures. */
	readonly jsonInput?: boolean;
	/** Folders outside the one it runs in that it may read: the chat's sources. */
	readonly folders?: readonly string[];
}): string[] {
	return [
		"-p",
		...(options.jsonInput === true ? ["--input-format", "stream-json"] : []),
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--append-system-prompt",
		options.systemPrompt ?? SYSTEM_PROMPT,
		...(options.folders ?? []).flatMap((folder) => ["--add-dir", folder]),
		"--disallowedTools",
		...DENIED_TOOLS,
		...(options.model ? ["--model", options.model] : []),
		...(options.sessionId === null ? [] : ["--resume", options.sessionId]),
	];
}

/** What the Copilot CLI may not do: run commands or change files. */
export const COPILOT_DENIED_TOOLS = ["shell", "write"] as const;

/**
 * Arguments for one question to the GitHub Copilot CLI; the question goes
 * to standard input. `-s` writes only the answer, as it comes. The same
 * session id starts a conversation and continues it.
 */
export function copilotArgs(options: {
	readonly sessionId: string;
	readonly model: string;
	/** Folders outside the one it runs in that it may read: the chat's sources. */
	readonly folders?: readonly string[];
}): string[] {
	return [
		"-s",
		"--stream",
		"on",
		// Required without a terminal to ask in; the denied tools stay denied.
		"--allow-all-tools",
		...COPILOT_DENIED_TOOLS.flatMap((tool) => ["--deny-tool", tool]),
		...(options.folders ?? []).flatMap((folder) => ["--add-dir", folder]),
		"--no-ask-user",
		"--no-auto-update",
		"--session-id",
		options.sessionId,
		...(options.model === "" ? [] : ["--model", options.model]),
	];
}

/** The Copilot CLI takes no system prompt: a conversation's first question carries the instructions. */
export function withInstructions(system: string, question: string): string {
	return `<instructions>\n${system}\n</instructions>\n\n${question}`;
}

export type ClaudeEvent =
	/** The conversation's id, and for a CLI the folder it runs in; the next question resumes it. */
	| { readonly kind: "session"; readonly id: string; readonly folder?: string }
	/** More of the reply. */
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "done" }
	| { readonly kind: "error"; readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

function messageText(message: unknown): string {
	if (!isRecord(message) || !Array.isArray(message.content)) return "";
	return message.content
		.map((block) =>
			isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : "",
		)
		.join("");
}

/**
 * Turns the CLI's `stream-json` lines into chat events. The reply's text
 * comes as deltas (`--include-partial-messages`); a version that does not
 * send them still sends each whole message, which is used instead. The
 * messages of one turn (around tool calls) are kept apart by a blank line.
 */
export class ClaudeStreamReader {
	#written = false;
	#newMessage = false;
	#sawDelta = false;
	#session: string | null = null;
	#finished = false;

	/** Whether the CLI reported the end of the turn. */
	get finished(): boolean {
		return this.#finished;
	}

	feed(line: string): ClaudeEvent[] {
		let data: unknown;
		try {
			data = JSON.parse(line);
		} catch {
			return [];
		}
		if (!isRecord(data)) return [];
		const events: ClaudeEvent[] = [];
		const session = typeof data.session_id === "string" ? data.session_id : null;
		if (session !== null && session !== this.#session) {
			this.#session = session;
			events.push({ kind: "session", id: session });
		}
		switch (data.type) {
			case "stream_event": {
				const event = isRecord(data.event) ? data.event : {};
				if (event.type === "message_start") {
					this.#newMessage = true;
					this.#sawDelta = false;
				} else if (event.type === "content_block_delta") {
					const delta = isRecord(event.delta) ? event.delta : {};
					if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text !== "") {
						events.push(...this.#write(delta.text));
						this.#sawDelta = true;
					}
				}
				break;
			}
			case "assistant": {
				if (!this.#sawDelta) {
					this.#newMessage = true;
					const text = messageText(data.message);
					if (text !== "") events.push(...this.#write(text));
				}
				this.#sawDelta = false;
				this.#newMessage = true;
				break;
			}
			case "result": {
				this.#finished = true;
				if (
					data.is_error === true ||
					(typeof data.subtype === "string" && data.subtype !== "success")
				) {
					const result = typeof data.result === "string" ? data.result.trim() : "";
					events.push({ kind: "error", message: result || String(data.subtype ?? "error") });
				} else {
					// A reply whose text never came in the stream (an old CLI, or no text messages).
					const result = typeof data.result === "string" ? data.result : "";
					if (!this.#written && result !== "") events.push(...this.#write(result));
					events.push({ kind: "done" });
				}
				break;
			}
		}
		return events;
	}

	#write(text: string): ClaudeEvent[] {
		const separator = this.#newMessage && this.#written ? "\n\n" : "";
		this.#newMessage = false;
		this.#written = true;
		return [{ kind: "text", text: separator + text }];
	}
}

/** Splits a stream into lines; the last, unfinished one waits for more. */
export class LineSplitter {
	#rest = "";

	push(chunk: string): string[] {
		const text = this.#rest + chunk;
		const lines = text.split(/\r?\n/);
		this.#rest = lines.pop() ?? "";
		return lines.filter((line) => line.trim() !== "");
	}

	end(): string[] {
		const rest = this.#rest.trim();
		this.#rest = "";
		return rest === "" ? [] : [rest];
	}
}

// --- Diagrams in a reply -------------------------------------------------------------

export interface ReplyDiagram {
	readonly diagram: Diagram;
	/** The name Claude gave it; empty when none. */
	readonly title: string;
	/** The document's picture this diagram is a new version of. */
	readonly src: string | null;
}

/**
 * A diagram as Claude writes it: lenient about what can be filled in (the
 * format marker, edge ids, sizes). Without coordinates it is laid out.
 * `null` when the text is not a diagram.
 */
export function diagramFromReply(json: string): ReplyDiagram | null {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return null;
	}
	if (!isRecord(data) || !Array.isArray(data.nodes)) return null;
	const nodes = data.nodes.filter(isRecord);
	const used = new Set(nodes.map((node) => String(node.id ?? "")));
	let count = 0;
	const edgeId = (): string => {
		for (;;) {
			const id = `e${++count}`;
			if (!used.has(id)) {
				used.add(id);
				return id;
			}
		}
	};
	const edges = (Array.isArray(data.edges) ? data.edges : []).filter(isRecord).map((edge) => {
		const id =
			typeof edge.id === "string" && edge.id !== "" && !used.has(edge.id) ? edge.id : edgeId();
		used.add(id);
		return { ...edge, id, text: typeof edge.text === "string" ? edge.text : "" };
	});
	const parsed = parseDiagram(
		JSON.stringify({ format: DIAGRAM_KEYWORD, version: 1, nodes, edges }),
	);
	if (parsed === null || parsed.nodes.length === 0) return null;
	const placed = nodes.every((node) => typeof node.x === "number" && typeof node.y === "number");
	return {
		diagram: placed ? parsed : autoLayout(parsed),
		title: typeof data.title === "string" ? data.title.trim().slice(0, 120) : "",
		src: typeof data.src === "string" && data.src !== "" ? data.src : null,
	};
}

/**
 * Lays out a diagram that has no coordinates: the inside of each group
 * first (inner groups first), the group sized around it, then the whole.
 */
export function autoLayout(diagram: Diagram): Diagram {
	const groups = diagram.nodes
		.filter((node) => node.shape === "group")
		.sort((a, b) => ancestors(diagram, b.id).length - ancestors(diagram, a.id).length);
	let next = diagram;
	for (const { id } of groups) {
		const inside = new Set(
			next.nodes.filter((node) => ancestors(next, node.id).includes(id)).map((node) => node.id),
		);
		if (inside.size === 0) continue;
		const sub: Diagram = {
			nodes: next.nodes
				.filter((node) => inside.has(node.id))
				.map((node): DiagramNode => {
					if (node.parent !== id) return node;
					const { parent: _group, ...rest } = node;
					return rest;
				}),
			edges: next.edges.filter((edge) => inside.has(edge.from) && inside.has(edge.to)),
		};
		const laid = layoutDiagram(sub);
		const box = boxOf(laid.nodes);
		const group = next.nodes.find((node) => node.id === id) as DiagramNode;
		const dx = group.x + GROUP_PADDING - box.x;
		const dy = group.y + GROUP_TOP - box.y;
		const moved = new Map(laid.nodes.map((node) => [node.id, { x: node.x + dx, y: node.y + dy }]));
		const size = {
			w: Math.max(box.w + 2 * GROUP_PADDING, 200),
			h: box.h + GROUP_TOP + GROUP_PADDING,
		};
		next = {
			...next,
			nodes: next.nodes.map((node) => {
				if (node.id === id) return { ...node, ...size };
				const at = moved.get(node.id);
				return at === undefined ? node : { ...node, ...at };
			}),
		};
	}
	return layoutDiagram(next);
}

export type ReplyPart =
	| { readonly kind: "markdown"; readonly text: string }
	| ({ readonly kind: "diagram"; readonly source: string } & ReplyDiagram);

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*kalem-diagram[ \t]*\n([\s\S]*?)\n {0,3}\2[`~]*[ \t]*$/gm;

/**
 * The reply cut into Markdown and Kalem diagrams. A diagram block that
 * does not hold a diagram stays in the Markdown, as code.
 */
export function splitReply(text: string): ReplyPart[] {
	const parts: ReplyPart[] = [];
	let at = 0;
	for (const match of text.matchAll(FENCE)) {
		const source = match[3] ?? "";
		const diagram = diagramFromReply(source);
		if (diagram === null) continue;
		const before = text.slice(at, match.index);
		if (before.trim() !== "") parts.push({ kind: "markdown", text: before });
		parts.push({ kind: "diagram", source, ...diagram });
		at = match.index + match[0].length;
	}
	const rest = text.slice(at);
	if (rest.trim() !== "") parts.push({ kind: "markdown", text: rest });
	return parts;
}
