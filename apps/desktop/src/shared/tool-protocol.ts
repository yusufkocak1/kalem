/**
 * Kalem's own tools as the assistant sees them, whichever way it calls
 * them: what a tool may change (its risk), how the user is asked before it
 * does, and the `kalem-tool` blocks a CLI without MCP writes its calls in.
 * Pure: the main process runs the tools, the renderer shows the cards.
 */
import { fenceBlock } from "./jira-tool.js";

/**
 * What a tool may change, and so how the user is asked:
 * - `read`: nothing; it runs without asking.
 * - `ui`: the app's look, panels and settings; asked, unless the user
 *   allowed that kind of change for the session or always.
 * - `document`: the open document; asked with what changes, can be undone.
 * - `external`: Jira or Confluence, on the server; asked every time.
 */
export type ToolRisk = "read" | "ui" | "document" | "external";

/** How long an approval holds. */
export type ApprovalScope = "once" | "session" | "always";

export interface ToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: {
		readonly type: "object";
		readonly properties: Record<string, unknown>;
		readonly required: readonly string[];
	};
}

/** What the user is shown before a tool changes something. */
export interface ApprovalRequest {
	readonly id: string;
	readonly chatId: string;
	readonly tool: string;
	readonly risk: Exclude<ToolRisk, "read">;
	/** The kind of change, as the permissions keep it (`settings:appearance`, `document`, `jira`). */
	readonly permission: string;
	readonly title: string;
	/** What changes, a line each (`Theme: System → Dark`). */
	readonly lines: readonly string[];
	/** Text sent or written as it is (a comment, a page), shown in full. */
	readonly preview?: string;
	/** Items the user may pick from (issues to create); all picked at first. */
	readonly items?: readonly string[];
	/** Why the model wants it, in its own words. */
	readonly reason?: string;
	/** The ways the user may allow it beyond this once. */
	readonly scopes: readonly ApprovalScope[];
	/** Content read from Jira or Confluence came before it in this answer: it may have asked for it. */
	readonly afterExternal?: boolean;
}

export interface ApprovalAnswer {
	readonly approved: boolean;
	readonly scope: ApprovalScope;
	/** The items picked, by index; all of them when missing. */
	readonly selected?: readonly number[];
}

export const DENIED: ApprovalAnswer = { approved: false, scope: "once" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** An answer from the renderer, made safe. */
export function parseApprovalAnswer(raw: unknown): ApprovalAnswer {
	if (!isRecord(raw) || raw.approved !== true) return DENIED;
	const scope: ApprovalScope =
		raw.scope === "session" || raw.scope === "always" ? raw.scope : "once";
	const selected = Array.isArray(raw.selected)
		? raw.selected.filter((n): n is number => Number.isInteger(n) && n >= 0).slice(0, 500)
		: undefined;
	return { approved: true, scope, ...(selected === undefined ? {} : { selected }) };
}

/** The scopes a kind of change may be allowed for: anything online is asked every time. */
export function scopesFor(risk: Exclude<ToolRisk, "read">): ApprovalScope[] {
	return risk === "external" ? ["once"] : ["once", "session", "always"];
}

// --- Calls written in a block ------------------------------------------------------

/** The code fence language of a CLI's tool calls, when it cannot call Kalem's tools itself. */
export const TOOL_FENCE = "kalem-tool";

/** Calls one round may make in blocks. */
export const MAX_BLOCK_CALLS = 8;

export interface BlockCall {
	readonly tool: string;
	readonly input: Record<string, unknown>;
}

/** The calls in a reply's `kalem-tool` blocks: `{ "tool": …, "input": {…} }`, or an array of them. */
export function toolCalls(reply: string): BlockCall[] {
	const calls: BlockCall[] = [];
	for (const match of reply.matchAll(fenceBlock(TOOL_FENCE))) {
		let data: unknown;
		try {
			data = JSON.parse(match[2] ?? "");
		} catch {
			continue;
		}
		for (const item of Array.isArray(data) ? data : [data]) {
			if (!isRecord(item)) continue;
			const tool =
				typeof item.tool === "string" ? item.tool : typeof item.name === "string" ? item.name : "";
			if (tool === "") continue;
			const input = isRecord(item.input)
				? item.input
				: isRecord(item.arguments)
					? item.arguments
					: {};
			calls.push({ tool, input });
		}
	}
	return calls.slice(0, MAX_BLOCK_CALLS);
}

/** A reply without its `kalem-tool` blocks: what the user is shown of it. */
export function withoutToolCalls(reply: string): string {
	return reply.replace(fenceBlock(TOOL_FENCE), "").replace(/\n{3,}/g, "\n\n");
}

/** One tool, as a CLI that writes blocks is told about it: its name, what it does, its inputs. */
function blockLine(tool: ToolDefinition): string {
	const required = new Set(tool.parameters.required);
	const inputs = Object.keys(tool.parameters.properties)
		.map((name) => (required.has(name) ? name : `${name}?`))
		.join(", ");
	return `- ${tool.name}(${inputs}): ${tool.description.split(/(?<=\.)\s/)[0]}`;
}

/** What a CLI that cannot call Kalem's tools is told: how to write the calls, and the tools. */
export function blockInstructions(tools: readonly ToolDefinition[]): string {
	return `## Kalem's tools
You cannot call Kalem's tools directly. To use them, reply with ONLY a \`${TOOL_FENCE}\` code block holding a JSON array of calls, and nothing else:

\`\`\`${TOOL_FENCE}
[{ "tool": "settings_find", "input": { "query": "dark theme" } }]
\`\`\`

Kalem runs them (asking the user first when they change something) and sends you the results in <tool-results>; then call more, or answer. At most ${MAX_BLOCK_CALLS} calls a round. The tools (inputs with ? are optional):
${tools.map(blockLine).join("\n")}`;
}

/** The results of a round of block calls, as the next question. */
export function blockResults(results: readonly { tool: string; text: string }[]): string {
	return `<tool-results>\n${results
		.map(({ tool, text }) => `<result tool="${tool}">\n${text}\n</result>`)
		.join("\n")}\n</tool-results>`;
}
