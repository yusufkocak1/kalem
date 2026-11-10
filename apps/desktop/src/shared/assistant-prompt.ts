/**
 * What the assistant is told, kept short: who it is and where, the mode,
 * and how to reach the rest. The long guides (diagrams, Markdown, menus,
 * the document's changes) are not in every question: the model asks for
 * them with `kalem_help` when it needs one. A model that cannot call tools
 * gets the whole instructions, as before. Pure.
 */
import { ACTIONS_FENCE, ACTIONS_PROMPT } from "./actions.js";
import {
	capabilities,
	DIAGRAM_FENCE,
	DIAGRAM_GUIDE,
	MARKDOWN_GUIDE,
	systemPrompt,
} from "./claude.js";
import type { LookupWay } from "./confluence-tool.js";
import { confluenceInstructions } from "./confluence-tool.js";
import type { Strings } from "./i18n.js";
import { jiraInstructions } from "./jira-tool.js";
import { modeInstructions } from "./modes.js";
import type { ToolDefinition } from "./tool-protocol.js";
import { blockInstructions } from "./tool-protocol.js";

/** How the model reaches Kalem's tools; `none` when it cannot call any. */
export type PromptWay = LookupWay | "none";

export interface PromptOptions {
	readonly way: PromptWay;
	readonly confluence?: string | null;
	readonly jira?: string | null;
	readonly tools?: readonly ToolDefinition[];
	readonly mode?: unknown;
	readonly document?: { readonly name: string } | null;
}

/** Who the assistant is, in a few lines: every question carries it. */
export const IDENTITY = `You are the AI assistant inside Kalem, a Word-like Markdown editor (a desktop app). The user writes documents, mostly software analysis documents, and talks to you in a side panel. Your main work: write analysis documents, read and review them, find and fix their problems, and prepare prompts for coding agents; you write code only when asked. Reply in the language the user writes in.

What you are sent: the user's document in <document> tags, or only its outline in <document-outline> when it is long (read the parts you need with document_read); the text they selected in <selection>; Kalem diagrams of the document in <diagram src="…">; files and folders they added in <files> (a <folder> lists files: read the ones you need); <files-unchanged> and <document-unchanged> mean as sent before.

You work inside the app and can use it with Kalem's tools: find and change settings (settings_find, then settings_set: the theme, the language, page setup…), move or show panels (pane_move, pane_show), run the app's commands (app_command), read and change the document (document_outline, document_read, document_search, document_edit), and Jira and Confluence when connected. A tool that changes something asks the user first; when the user refuses, accept it and do not try again another way. Do not guess what Kalem can do or how: call kalem_help with a topic (diagram, markdown, menus, actions, analysis, prompt) or kalem_tools, and app_state for what is open and set now.

Your replies are Markdown the user can insert into the document with one click: when asked for content, reply with the content itself, ready to insert, without a preamble, and keep explanations short and after it. Kalem draws \`\`\`mermaid and \`\`\`math (LaTeX) blocks, and Kalem diagrams (a \`\`\`${DIAGRAM_FENCE} block of JSON that the user edits in Kalem's diagram editor): call kalem_help("diagram") for their format before writing one. To change the document, use document_edit; a \`\`\`${ACTIONS_FENCE} block (kalem_help("actions")) works too.`;

/** The guides `kalem_help` gives, by topic. */
export function helpTopics(t: Strings): Readonly<Record<string, string>> {
	return {
		diagram: DIAGRAM_GUIDE,
		markdown: MARKDOWN_GUIDE,
		menus: capabilities(t),
		actions: ACTIONS_PROMPT,
		analysis: ANALYSIS_GUIDE,
		prompt: PROMPT_GUIDE,
	};
}

/** How a good analysis document is written and reviewed. */
export const ANALYSIS_GUIDE = `## Software analysis documents
A good analysis document lets a developer and a tester work without asking. Check, write or fix it for:
- Purpose and scope: why, for whom, what is in and out.
- Terms: every business term defined once and used the same way everywhere.
- Business rules (BR-xx) and functional requirements (FR-xx): one need each, numbered without gaps or repeats, each with acceptance criteria that can be tested (Given/When/Then), including the error and edge cases (empty, too long, no permission, timeout, duplicate, concurrent change).
- Non-functional requirements (NFR-xx) with numbers: response times (p95), volumes, availability, retention, audit.
- Data: entities, fields with types and rules, an ER diagram (Mermaid erDiagram) when there are several.
- Flows: the main path and the alternatives, as a Kalem diagram or a sequence diagram; every decision with all of its answers.
- Screens and messages, integrations (who calls whom, formats, errors, retries), permissions and roles, data migration, security and privacy (personal data, KVKK/GDPR).
- Risks, assumptions, dependencies, and open questions with who answers them.
Vague words to replace with something measurable: fast, quick, user-friendly, appropriate, flexible, etc., if needed, as soon as possible, hızlı, uygun, kullanıcı dostu, gerekirse, vb., mümkün olduğunca. TBD/TODO/?? are open questions.`;

/** How a prompt for a coding agent is put together. */
export const PROMPT_GUIDE = `## Prompts for coding agents
1. Goal: one or two sentences.
2. Context: the business rules, terms and decisions that matter for this change only, quoted from the document with their ids.
3. Scope: what to do, and what not to touch.
4. Code: the files, modules and patterns to follow, with paths (find them in the workspace first).
5. Acceptance criteria as test cases, the error cases included.
6. Constraints: performance, security, compatibility, style.
7. What to hand back: a short plan before coding, the tests it added, a PR description.
Keep it self-contained: the agent has not read the document.`;

/** Everything the model is told for one question. */
export function assistantInstructions(t: Strings, options: PromptOptions): string {
	const tools = options.tools ?? [];
	const mode = modeInstructions(options.mode);
	if (options.way === "none" || tools.length === 0) {
		return [systemPrompt(t), mode].filter((part) => part !== "").join("\n\n");
	}
	const way: LookupWay = options.way;
	const lookups = new Set([
		"confluence_search",
		"confluence_read_page",
		"jira_get_issue",
		"jira_search",
	]);
	return [
		IDENTITY,
		way === "mcp"
			? "Kalem's tools are named mcp__kalem__<tool> (for example mcp__kalem__settings_set)."
			: "",
		mode,
		confluenceInstructions(options.confluence ?? null, way),
		jiraInstructions(options.jira ?? null, way),
		way === "block" ? blockInstructions(tools.filter((tool) => !lookups.has(tool.name))) : "",
	]
		.filter((part) => part !== "")
		.join("\n\n");
}
