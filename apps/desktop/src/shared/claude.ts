/**
 * The Claude assistant: what Claude is told about Kalem (its Markdown and
 * its diagrams), the message a question is sent as, the reading of the
 * Claude Code CLI's `stream-json` output, and the diagrams in a reply.
 * Pure: the main process runs the CLI, the renderer shows the chat.
 */

import type { AssistantAction } from "./actions.js";
import { ACTIONS_FENCE, ACTIONS_PROMPT, actionsFromReply } from "./actions.js";
import type { Diagram, DiagramNode } from "./diagram.js";
import { ancestors, DIAGRAM_KEYWORD, parseDiagram } from "./diagram.js";
import { boxOf, GROUP_PADDING, GROUP_TOP, layoutDiagram } from "./diagram-edit.js";
import type { Finding } from "./findings.js";
import type { Strings } from "./i18n.js";
import { claudeInitModel } from "./models.js";
import type { Steered } from "./steering.js";
import { TABLE_COLORS } from "./table-style.js";

/** The code fence language of a Kalem diagram in a reply. */
export const DIAGRAM_FENCE = "kalem-diagram";

/** Who the assistant is and what it is sent: the start of the full instructions. */
export const SYSTEM_INTRO = `You are an AI assistant working inside Kalem, a Word-like Markdown editor (a desktop app). The user is writing a document and talks to you in a side panel next to it. Reply in the language the user writes in.

Your replies are Markdown, and the user can insert a reply into the document with one click. So when they ask for content (a section, a table, a rewrite, a diagram), reply with the content itself, ready to insert, without a preamble such as "Here is…". Keep any explanation short and after the content.

The user's document, when shared, arrives in <document> tags; the text they selected in it in <selection> tags; Kalem diagrams already in the document in <diagram> tags. Do not repeat the whole document unless asked; when asked to rewrite a part, return only that part. Do not edit files with tools: the user inserts what you write, or applies the changes you propose in a \`${ACTIONS_FENCE}\` block (see below).

Files and folders the user added to the chat as sources (code, analysis notes, any text) arrive in <files> tags: a <folder> lists the files under it, a <file> holds one file's text. When a folder's files come without their text, read the ones you need with your file tools before answering. Use the sources to write what the user asks for (for example a software analysis document from a code folder); refer to files by their path below the folder. <files-unchanged> means the sources are as they were sent earlier in the chat.

`;

/** The Markdown Kalem shows, for a model that writes content to insert. */
export const MARKDOWN_GUIDE = `## The Markdown Kalem shows
- CommonMark and GitHub Flavored Markdown: headings, bold, italic, strikethrough, links, images, block quotes, bullet and numbered lists, task lists ("- [ ] item"), tables (with column alignment), footnotes ("text[^1]" and a separate "[^1]: note" paragraph), code blocks with a language.
- Colored text: <span style="color:#e03131">text</span>. No other HTML: it is shown as plain text.
- \`\`\`mermaid code blocks are drawn as Mermaid diagrams (flowchart, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2, gantt, pie, mindmap, timeline). Keep Mermaid labels plain: no HTML in them.
- \`\`\`math code blocks (LaTeX) are drawn as formulas with KaTeX.

`;

/** Kalem diagrams: their JSON and how to change one in the document. */
export const DIAGRAM_GUIDE = `## Kalem diagrams
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

To change a Kalem diagram that is already in the document (one given in a <diagram src="…"> tag), reply with the whole changed diagram in a \`${DIAGRAM_FENCE}\` block that has "src" set to that tag's src, keeping the ids and the coordinates of the shapes that did not change. The user can then update the picture in the document with it.

`;

/** Teaches the model what Kalem can show; appended to Claude Code's own system prompt, or an API's system prompt. */
export const SYSTEM_PROMPT = `${SYSTEM_INTRO}${MARKDOWN_GUIDE}${DIAGRAM_GUIDE}${ACTIONS_PROMPT}`;

/**
 * What the app can do, for questions on how to do something in it. Menus
 * and buttons are named from the interface's own strings, so Claude names
 * them as the user sees them.
 */
export function capabilities(t: Strings): string {
	const q = (text: string): string => `"${text.replace(/…$/, "")}"`;
	const path = (...labels: string[]): string => labels.map(q).join(" → ");
	return `## What Kalem can do
Use this to answer how to do something in Kalem, and to write content that uses what Kalem offers. Name menus and buttons exactly as quoted here: that is how the user sees them. Shortcuts use Ctrl (Cmd on macOS). You cannot press buttons yourself: tell the user the steps, or propose the command (or the change to the document) in a \`${ACTIONS_FENCE}\` block for the user to apply.

Kalem has a ribbon with the tabs ${q(t.tabHome)}, ${q(t.tabInsert)} and ${q(t.tabView)} (plus ${q(t.tabTable)} while the cursor is in a table and ${q(t.tabCode)} in a code block), and the menus ${q(t.file)}, ${q(t.edit)}, ${q(t.insert)}, ${q(t.format)} and ${q(t.view)}.
- Documents: .md and .txt files in tabs (Ctrl+N new tab, Ctrl+W close). ${path(t.file, t.saveAsPackage)} makes one .kmd file with the document's images and attached files. ${path(t.file, t.versionHistory)} brings back an earlier save. ${path(t.file, t.quickNote)} (Ctrl+Shift+Alt+N) opens a dated note. ${path(t.file, t.openFolder)} lists a folder's documents in the side pane; ${q(t.searchFolder)} (Ctrl+Shift+E) searches them, ${q(t.quickOpen)} (Ctrl+Shift+P) opens one by name. ${q(t.autoSave)} is in the ${q(t.tabView)} tab.
- Word, HTML, PDF: ${path(t.file, t.importMenu, t.importFromWord)} reads a .docx; pasting from Word keeps headings, lists, tables and images. ${path(t.file, t.export)} → ${q(t.exportDocx)}, ${q(t.exportHtml)} or ${q(t.exportPdf)}; ${path(t.file, t.pageSetup)} sets the page size, orientation, margins and PDF page numbers; ${path(t.file, t.print)}.
- Confluence: ${path(t.file, t.confluenceJiraMenu, t.confluenceOpen)} opens a page for editing, and Ctrl+S saves it back as a new version; ${path(t.file, t.confluenceJiraMenu, t.confluenceAttachmentsMenu)} manages the page's attachments; ${path(t.file, t.export)} → ${q(t.exportConfluence)} or ${q(t.exportConfluenceWiki)} writes a file. An info, note, warning or tip panel is a block quote that starts with ℹ️, 📝, ⚠️ or 💡 and a bold title line.
- Inserting: ${path(t.insert, t.image)}, ${q(t.attachFile)} (copies any file next to the document and links it), ${q(t.diagramInsert)} (the diagram editor), ${q(t.table)}, ${q(t.link)}, ${q(t.divider)}, ${q(t.codeBlock)}, ${q(t.quote)}, ${q(t.taskList)}. Typing "/" opens a block menu; "# ", "* ", "1. ", "> " and "\`\`\`" at the start of a line, and **bold** or *italic*, turn into formatting as they are typed.
- Tables: Tab and Shift+Tab move between cells. The ${q(t.tabTable)} tab adds and deletes rows and columns, aligns, sorts by a column, and sets column widths and a table color. Kalem keeps the color and widths in a comment line right above the table, which you may write as well: <!-- kalem:table color=blue widths=120,,200 --> (colors: ${TABLE_COLORS.join(", ")}; widths in pixels, one per column, empty for automatic).
- Text: ${q(t.textColor)} in the ${q(t.tabHome)} tab writes the colored span; ${path(t.format, t.changeCase)} (Shift+F3 cycles); ${path(t.format, t.mergeBlocks)} (Ctrl+Shift+M) joins the selected blocks; footnotes.
- Code: ${q(t.formatCode)} (Shift+Alt+F) formats a JSON, XML, HTML or YAML code block, ${path(t.format, t.formatAllCode)} all of them; code blocks are highlighted.
- Viewing: ${q(t.markdownSource)} in the ${q(t.view)} menu shows the raw Markdown; ${q(t.focusMode)} (Ctrl+Shift+F), ${q(t.readOnly)}, ${q(t.fullWidth)}, ${q(t.lineNumbersDocuments)} (the file's line numbers beside the page, off at first; hidden in focus mode), ${q(t.lineNumbersCode)} (on at first), light and dark themes, zoom, find and replace (Ctrl+F, Ctrl+H), spell check; the ${q(t.navigationPane)} shows the headings, the folder's files and Confluence pages.
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
	/** A long document's outline, sent in place of its text: the model reads parts with its tools. */
	readonly outline?: { readonly name: string; readonly text: string } | undefined;
	/** `true` when the document was shared earlier in the chat and has not changed since. */
	readonly documentUnchanged?: boolean;
	readonly selection?: string | undefined;
	readonly diagrams?: readonly ContextDiagram[];
	/** The document's pictures that go with the question, in order. */
	readonly images?: readonly { readonly src: string; readonly label: string }[];
	/**
	 * Documents the user added to the chat that are open in other tabs:
	 * read from here (Kalem's document tools work on the active one only).
	 * One sent earlier in the chat and not changed since says only that.
	 */
	readonly others?: readonly {
		readonly name: string;
		readonly text: string;
		readonly unchanged?: boolean;
	}[];
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

/** Whether a question is one of Claude Code's slash commands (`/plugin:command args`). */
export const isSlashCommand = (question: string): boolean =>
	/^\/[\w.:-]+(\s|$)/.test(question.trimStart());

/**
 * Context and a question, in the order Claude Code reads them: the context
 * first, but a slash command first of all, or it would not run as one.
 */
export function withContext(context: string, question: string): string {
	if (context === "") return question;
	return isSlashCommand(question)
		? `${question.trim()}\n\n${context}`
		: `${context}\n\n${question}`;
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
	} else if (context.outline !== undefined) {
		parts.push(
			`<document-outline name="${attribute(context.outline.name)}">\nThe document is long: only its outline is here. Read the parts you need with document_read (by heading) or document_search.\n${context.outline.text}\n</document-outline>`,
		);
	} else if (context.documentUnchanged === true) {
		parts.push("<document-unchanged>The document is as I shared it above.</document-unchanged>");
	}
	for (const other of context.others ?? []) {
		const name = attribute(other.name);
		parts.push(
			other.unchanged === true
				? `<other-document-unchanged name="${name}">As I shared it above.</other-document-unchanged>`
				: `<other-document name="${name}">\nOpen in another tab: read it here; Kalem's document tools work on the active document only.\n${clip(other.text.replace(/\n+$/, ""), MAX_DOCUMENT)}\n</other-document>`,
		);
	}
	for (const { src, diagram } of context.diagrams ?? []) {
		parts.push(`<diagram src="${attribute(src)}">\n${diagramForPrompt(diagram)}\n</diagram>`);
	}
	const selection = context.selection?.trim() ?? "";
	if (selection !== "") parts.push(`<selection>\n${clip(selection, MAX_SELECTION)}\n</selection>`);
	return withContext(parts.join("\n\n"), context.question.trim());
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
	/** An MCP configuration file with Kalem's tools, and the tools it may call without asking. */
	readonly mcp?: { readonly config: string; readonly tools: readonly string[] };
	/** More it may not use, as permission rules (`WebFetch(domain:…)`). */
	readonly denied?: readonly string[];
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
		...(options.mcp === undefined
			? []
			: ["--mcp-config", options.mcp.config, "--allowedTools", ...options.mcp.tools]),
		"--disallowedTools",
		...DENIED_TOOLS,
		...(options.denied ?? []),
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
	/** An MCP configuration file with Kalem's tools, for a Copilot that takes one. */
	readonly mcpConfig?: string;
	/** Turns off the MCP servers Kalem did not choose (`copilotIsolation`). */
	readonly isolation?: readonly string[];
}): string[] {
	return [
		"-s",
		"--stream",
		"on",
		// Required without a terminal to ask in; the denied tools stay denied.
		"--allow-all-tools",
		...COPILOT_DENIED_TOOLS.flatMap((tool) => ["--deny-tool", tool]),
		...(options.isolation ?? []),
		...(options.folders ?? []).flatMap((folder) => ["--add-dir", folder]),
		...(options.mcpConfig === undefined
			? []
			: ["--additional-mcp-config", `@${options.mcpConfig}`]),
		"--no-ask-user",
		"--no-auto-update",
		"--session-id",
		options.sessionId,
		...(options.model === "" ? [] : ["--model", options.model]),
	];
}

/**
 * `--allow-all-tools` lets every tool run unasked: the ones of MCP servers
 * Kalem did not choose (the user's own Copilot configuration, the built-in
 * GitHub server) are turned off, where this Copilot can. `keep` names the
 * servers Kalem passes itself.
 */
export function copilotIsolation(
	help: string,
	userServers: readonly string[],
	keep: readonly string[],
): string[] {
	const args: string[] = [];
	if (help.includes("--disable-builtin-mcps")) args.push("--disable-builtin-mcps");
	if (help.includes("--disable-mcp-server")) {
		for (const name of userServers) {
			if (!keep.includes(name) && /^[\w.-]{1,100}$/.test(name)) {
				args.push("--disable-mcp-server", name);
			}
		}
	}
	return args;
}

/** The servers in a Copilot CLI MCP configuration (`mcp-config.json`). */
export function copilotConfigServers(text: string): string[] {
	try {
		const parsed = JSON.parse(text) as { mcpServers?: unknown };
		const servers = parsed.mcpServers;
		return typeof servers === "object" && servers !== null ? Object.keys(servers) : [];
	} catch {
		return [];
	}
}

/** Whether a Copilot CLI's help says it takes more MCP servers on its command line. */
export const copilotTakesMcp = (help: string): boolean => help.includes("--additional-mcp-config");

/** The Copilot CLI takes no system prompt: a conversation's first question carries the instructions. */
export function withInstructions(system: string, question: string): string {
	return `<instructions>\n${system}\n</instructions>\n\n${question}`;
}

/** A change to a workspace file the model proposed; written only when the user applies it. */
export interface ProposedEdit {
	readonly id: string;
	/** As the workspace shows it. */
	readonly path: string;
	/** Empty for a new file. */
	readonly oldText: string;
	readonly newText: string;
	readonly summary: string;
	/** Written at once: the user's approval setting lets code changes be made unasked. */
	readonly applied?: true;
	/** Written at once was tried, and failed: left for the user, with why. */
	readonly failed?: string;
}

export type ClaudeEvent =
	/** The conversation's id, and for a CLI the folder it runs in; the next question resumes it. */
	| { readonly kind: "session"; readonly id: string; readonly folder?: string }
	/** The model the CLI answers with, by its full name (Claude Code's `opus` is `claude-opus-…`). */
	| { readonly kind: "model"; readonly model: string }
	/** More of the reply. */
	| { readonly kind: "text"; readonly text: string }
	/** What came of the reply so far is dropped: it is asked again another way. */
	| { readonly kind: "reset" }
	/** The model proposes a change to a file of the workspace, for the user to apply. */
	| { readonly kind: "edit"; readonly edit: ProposedEdit }
	/** The model looked into the workspace: searched, listed or read a file. */
	| {
			readonly kind: "step";
			readonly tool: string;
			readonly detail: string;
			/** The call's id, for a command whose output follows in a `step-output`. */
			readonly id?: string;
			/** A command's whole line, and why it was run, as the model said. */
			readonly command?: string;
			readonly reason?: string;
	  }
	/** What a command the model ran printed, and how it ended (`code` when known). */
	| {
			readonly kind: "step-output";
			readonly id: string;
			readonly output: string;
			readonly failed: boolean;
			readonly code?: number | null;
	  }
	/** The model's plan for the answer, its steps as they get done. */
	| { readonly kind: "plan"; readonly steps: readonly PlanStep[] }
	/** Problems a review found in the document; with `review`, for the reply that ran it. */
	| {
			readonly kind: "findings";
			readonly findings: readonly Finding[];
			readonly review?: string;
	  }
	/** How the checks of a review run side by side are going, for the reply that ran it. */
	| {
			readonly kind: "checks";
			readonly review: string;
			readonly checks: readonly CheckProgress[];
			/** Whether Kalem ran the rule checks before them. */
			readonly rules: boolean;
			/** A mode's steps run by workers, not a review's checks. */
			readonly steps?: boolean;
	  }
	/** A setting the assistant changed, with what puts it back. */
	| {
			readonly kind: "changed";
			readonly label: string;
			readonly undo: Readonly<Record<string, unknown>>;
	  }
	/** What the answer cost, in tokens. */
	| {
			readonly kind: "usage";
			readonly input: number;
			readonly output: number;
			readonly cached: number;
	  }
	/** What the user added while it answered, now taken in by it (by the ids the window gave them). */
	| { readonly kind: "steered"; readonly messages: readonly Steered[] }
	| { readonly kind: "done" }
	| { readonly kind: "error"; readonly message: string };

/** One check of a review run side by side, as it goes. */
export interface CheckProgress {
	/** The checks it makes, by name. */
	readonly title: string;
	/** Waiting is for its turn: the stages before it are not done. */
	readonly status: "waiting" | "running" | "done" | "failed";
	/** When it started and ended, in ms since the epoch. */
	readonly started: number;
	readonly ended?: number;
	/** The findings it added to the list. */
	readonly findings: number;
	/** What it did last: a tool, and what on. */
	readonly last?: { readonly tool: string; readonly detail: string };
	/** Why it could not finish. */
	readonly error?: string;
	/** What it cost, in tokens, when the CLI says. */
	readonly usage?: { readonly input: number; readonly output: number; readonly cached: number };
	/** It runs next to others. */
	readonly parallel?: boolean;
	/** It cannot be run again on its own (a step whose result the later steps needed). */
	readonly noRetry?: boolean;
}

export interface PlanStep {
	readonly title: string;
	readonly status: "pending" | "active" | "done";
}

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

/** What Claude Code's tool calls in a message looked at: a search, a file, a command. */
export function toolSteps(message: unknown): ClaudeEvent[] {
	if (!isRecord(message) || !Array.isArray(message.content)) return [];
	const steps: ClaudeEvent[] = [];
	for (const block of message.content) {
		if (!isRecord(block) || block.type !== "tool_use" || typeof block.name !== "string") continue;
		const input = isRecord(block.input) ? block.input : {};
		const detail = [
			"pattern",
			"file_path",
			"path",
			"command",
			"query",
			"page_id",
			"key",
			"heading",
			"pane",
			"command",
			"topic",
			"reason",
			"jql",
			"url",
			"description",
		]
			.map((key) => input[key])
			.find((value): value is string => typeof value === "string" && value !== "");
		const shown = (detail ?? "").slice(0, 200);
		if (isTerminalTool(block.name) && typeof input.command === "string") {
			const reason = [input.description, input.reason].find(
				(value): value is string => typeof value === "string" && value.trim() !== "",
			);
			steps.push({
				kind: "step",
				tool: block.name,
				detail: shown,
				...(typeof block.id === "string" ? { id: block.id } : {}),
				command: input.command.slice(0, MAX_STEP_COMMAND),
				...(reason === undefined ? {} : { reason: reason.trim().slice(0, 300) }),
			});
		} else steps.push({ kind: "step", tool: block.name, detail: shown });
	}
	return steps;
}

/** Characters of a command line, and of what it printed, that the chat keeps. */
const MAX_STEP_COMMAND = 4000;
export const MAX_STEP_OUTPUT = 20_000;

/** A tool that runs a command line in a terminal: Claude Code's own, or Kalem's. */
export function isTerminalTool(name: string): boolean {
	return name === "Bash" || name.replace(/^mcp__kalem__/, "") === "run_command";
}

/** The start and end of a command's output, when it is longer than the chat keeps. */
export function clipStepOutput(text: string, max = MAX_STEP_OUTPUT): string {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n[… ${text.length - 2 * half} …]\n${text.slice(-half)}`;
}

/** Kalem's `run_command` report starts with how the command ended. */
const REPORT_HEAD =
	/^(?:`[\s\S]*` exited with code (-?\d+)\.|Stopped after \d+ s: .*|`[\s\S]*` could not be run\.)\n/;

/**
 * What the commands among Claude Code's tool calls printed, from the tool
 * results it sends back (`ids` are the calls that ran a command).
 */
export function commandOutputs(message: unknown, ids: ReadonlySet<string>): ClaudeEvent[] {
	if (!isRecord(message) || !Array.isArray(message.content)) return [];
	const outputs: ClaudeEvent[] = [];
	for (const block of message.content) {
		if (!isRecord(block) || block.type !== "tool_result") continue;
		const id = block.tool_use_id;
		if (typeof id !== "string" || !ids.has(id)) continue;
		let text =
			typeof block.content === "string"
				? block.content
				: Array.isArray(block.content)
					? block.content
							.map((part) =>
								isRecord(part) && part.type === "text" && typeof part.text === "string"
									? part.text
									: "",
							)
							.join("\n")
					: "";
		let code: number | null | undefined;
		const head = REPORT_HEAD.exec(text);
		if (head !== null) {
			code = head[1] === undefined ? null : Number(head[1]);
			text = text.slice(head[0].length);
			if (text === "(it printed nothing)") text = "";
		}
		const failed = block.is_error === true || (code !== undefined && code !== 0);
		outputs.push({
			kind: "step-output",
			id,
			output: clipStepOutput(text),
			failed,
			...(code === undefined ? {} : { code }),
		});
	}
	return outputs;
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
	/** The ids of the tool calls that ran a command: their results are shown. */
	readonly #commands = new Set<string>();

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
		const model = claudeInitModel(data);
		if (model !== null) events.push({ kind: "model", model });
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
				for (const step of toolSteps(data.message)) {
					if (step.kind === "step" && step.id !== undefined) this.#commands.add(step.id);
					events.push(step);
				}
				this.#sawDelta = false;
				this.#newMessage = true;
				break;
			}
			case "user": {
				// The tools' results: what the commands it ran printed.
				if (this.#commands.size > 0) events.push(...commandOutputs(data.message, this.#commands));
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
					const usage = isRecord(data.usage) ? data.usage : null;
					if (usage !== null) {
						const count = (key: string): number =>
							typeof usage[key] === "number" ? (usage[key] as number) : 0;
						events.push({
							kind: "usage",
							input: count("input_tokens") + count("cache_creation_input_tokens"),
							output: count("output_tokens"),
							cached: count("cache_read_input_tokens"),
						});
					}
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
	| ({ readonly kind: "diagram"; readonly source: string } & ReplyDiagram)
	| {
			readonly kind: "actions";
			readonly source: string;
			readonly actions: readonly AssistantAction[];
	  };

const FENCE = new RegExp(
	`^( {0,3})(\`{3,}|~{3,})[ \\t]*(${DIAGRAM_FENCE}|${ACTIONS_FENCE})[ \\t]*\\n([\\s\\S]*?)\\n {0,3}\\2[\`~]*[ \\t]*$`,
	"gm",
);

/** A finished block of the reply as a diagram or actions; `null` when it holds neither. */
function blockPart(language: string, source: string): ReplyPart | null {
	if (language === ACTIONS_FENCE) {
		const actions = actionsFromReply(source);
		return actions === null ? null : { kind: "actions", source, actions };
	}
	const diagram = diagramFromReply(source);
	return diagram === null ? null : { kind: "diagram", source, ...diagram };
}

/**
 * The reply cut into Markdown, Kalem diagrams and actions. A block that
 * does not hold what its language says stays in the Markdown, as code.
 */
export function splitReply(text: string): ReplyPart[] {
	const parts: ReplyPart[] = [];
	let at = 0;
	for (const match of text.matchAll(FENCE)) {
		const part = blockPart(match[3] ?? "", match[4] ?? "");
		if (part === null) continue;
		const before = text.slice(at, match.index);
		if (before.trim() !== "") parts.push({ kind: "markdown", text: before });
		parts.push(part);
		at = match.index + match[0].length;
	}
	const rest = text.slice(at);
	if (rest.trim() !== "") parts.push({ kind: "markdown", text: rest });
	return parts;
}

export interface DiffLine {
	/** Kept, taken out or put in. */
	readonly kind: " " | "-" | "+";
	readonly text: string;
}

/**
 * The lines of a change: the lines both texts share at the start and the
 * end are kept (at most `context` of each shown), the rest is taken out
 * and put in.
 */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
	const a = before === "" ? [] : before.split("\n");
	const b = after === "" ? [] : after.split("\n");
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let end = 0;
	while (
		end < a.length - start &&
		end < b.length - start &&
		a[a.length - 1 - end] === b[b.length - 1 - end]
	) {
		end++;
	}
	const kept = (lines: readonly string[]): DiffLine[] => lines.map((text) => ({ kind: " ", text }));
	return [
		...kept(a.slice(Math.max(0, start - context), start)),
		...a.slice(start, a.length - end).map((text): DiffLine => ({ kind: "-", text })),
		...b.slice(start, b.length - end).map((text): DiffLine => ({ kind: "+", text })),
		...kept(a.slice(a.length - end, Math.min(a.length, a.length - end + context))),
	];
}
