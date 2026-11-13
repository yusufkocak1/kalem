/**
 * Kalem's tools for the assistant, defined once: each with its definition
 * (for an API's tools, Kalem's MCP server and the `kalem-tool` blocks), what
 * it may change, when it is there, and how it runs. A tool that changes
 * something asks the user first, through the permission gate; one that
 * works on the window (the document, a command) asks the renderer.
 */
import type { WebContents } from "electron";
import type { Settings } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { ClaudeEvent } from "../shared/claude.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type {
	ApprovalAnswer,
	ApprovalRequest,
	ToolDefinition,
	ToolPolicy,
	ToolRisk,
} from "../shared/tool-protocol.js";
import { scopesFor } from "../shared/tool-protocol.js";
import type { ConfluenceLookups } from "./assistant-confluence.js";
import { CONFLUENCE_TOOLS } from "./assistant-confluence.js";
import type { JiraLookups } from "./assistant-jira.js";
import { JIRA_TOOLS } from "./assistant-jira.js";
import type { PermissionGate } from "./assistant-permissions.js";
import type { ConfluenceClient } from "./confluence-client.js";
import type { JiraClient } from "./jira-client.js";
import type { TemplateStore } from "./templates.js";
import type { ToolStep, Workspace } from "./workspace-tools.js";
import { EDIT_TOOL, WORKSPACE_TOOLS } from "./workspace-tools.js";

/** The active document as the question found it; a change the user applied updates it. */
export interface DocumentSnapshot {
	readonly tabId: string | null;
	readonly name: string;
	text: string;
	readonly selection: string;
}

/** What the renderer answers to a tool call it runs. */
export interface RendererAnswer {
	readonly ok: boolean;
	readonly text: string;
	/** The document's Markdown after a change. */
	readonly document?: string;
}

/** A service Kalem signs in to. */
export type ConnectionService = "jira" | "confluence";

/** Where Kalem is signed in, as the user may see it: never the token. */
export interface ConnectionAccount {
	readonly site: string;
	readonly username: string;
	/** Jira reached with Confluence Cloud's login, not one of its own. */
	readonly shared?: boolean;
}

/** Signing in to Jira and Confluence, as their panels do. */
export interface Connections {
	account(service: ConnectionService): Promise<ConnectionAccount | null>;
	/** The address the service is likely at (Jira, from Confluence); `null` when unknown. */
	suggestedSite(service: ConnectionService): Promise<string | null>;
	/** Checks the login with the server and keeps it; throws with the server's answer. */
	connect(
		service: ConnectionService,
		login: { site: string; username: string; token: string },
	): Promise<ConnectionAccount>;
	disconnect(service: ConnectionService): Promise<void>;
}

/** Everything a tool may use while one answer is given. */
export interface ToolContext {
	readonly chatId: string;
	readonly sender: WebContents;
	readonly t: Strings;
	/** The tools the mode leaves out of this answer. */
	readonly excluded: ReadonlySet<string>;
	settings(): Settings;
	changeSettings(patch: Partial<Settings>): void;
	changeLanguage(language: Lang | null): void;
	readonly confluence: ConfluenceLookups | null;
	readonly jira: JiraLookups | null;
	readonly confluenceClient: ConfluenceClient | null;
	readonly jiraClient: JiraClient | null;
	/** Signing in to Jira and Confluence; `null` where it cannot be done (tests). */
	readonly connections: Connections | null;
	readonly workspace: Workspace | null;
	/** The analysis templates; `null` where there are none to read (tests). */
	readonly templates: TemplateStore | null;
	/** `null` when the user does not share the document. */
	readonly document: DocumentSnapshot | null;
	step(step: ToolStep): void;
	/** Sends the chat an event of its own (a plan, findings). */
	emit(event: ClaudeEvent): void;
	/** Asks the user, unless that kind of change is allowed already. */
	approve(request: Omit<ApprovalRequest, "id" | "chatId" | "scopes">): Promise<ApprovalAnswer>;
	/** Runs a tool's part that works on the window. */
	renderer(name: string, input: unknown): Promise<RendererAnswer>;
	/** Whether text from Jira or Confluence was read in this answer. */
	readExternal: boolean;
}

export interface KalemTool {
	readonly definition: ToolDefinition;
	readonly risk: ToolRisk;
	/** Whether it can be offered: a connection, a workspace or the document it needs. */
	available(ctx: ToolContext): boolean;
	run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

/** The tools that existed before the registry: the workspace's, and the Confluence and Jira look-ups. */
const LOOKUP_TOOLS: readonly KalemTool[] = [
	...[...WORKSPACE_TOOLS, EDIT_TOOL].map(
		(definition): KalemTool => ({
			definition,
			// Proposing a change writes nothing: the user applies it on its card.
			risk: "read",
			available: (ctx) => ctx.workspace !== null,
			run: (input, ctx) => (ctx.workspace as Workspace).run(definition.name, input, ctx.step),
		}),
	),
	...CONFLUENCE_TOOLS.map(
		(definition): KalemTool => ({
			definition,
			risk: "read",
			available: (ctx) => ctx.confluence !== null,
			run: (input, ctx) => {
				ctx.readExternal = true;
				return (ctx.confluence as ConfluenceLookups).runTool(definition.name, input, ctx.step);
			},
		}),
	),
	...JIRA_TOOLS.map(
		(definition): KalemTool => ({
			definition,
			risk: "read",
			available: (ctx) => ctx.jira !== null,
			run: (input, ctx) => {
				ctx.readExternal = true;
				return (ctx.jira as JiraLookups).runTool(definition.name, input, ctx.step);
			},
		}),
	),
];

const registry: KalemTool[] = [...LOOKUP_TOOLS];

/** Adds tools to the registry; a tool of the same name is replaced. */
export function registerTools(tools: readonly KalemTool[]): void {
	for (const tool of tools) {
		const at = registry.findIndex((known) => known.definition.name === tool.definition.name);
		if (at === -1) registry.push(tool);
		else registry[at] = tool;
	}
}

/** Every tool, whether or not it can be offered now: MCP's list. */
export function allTools(): readonly KalemTool[] {
	return registry;
}

export const toolNamed = (name: string): KalemTool | undefined =>
	registry.find((tool) => tool.definition.name === name);

/** What the user set for a tool in Settings; `undefined` for its risk's way. */
export function toolPolicy(ctx: ToolContext, name: string): ToolPolicy | undefined {
	const settings = typeof ctx.settings === "function" ? ctx.settings() : undefined;
	const policies = settings?.assistantToolPolicies;
	return policies !== undefined && Object.hasOwn(policies, name) ? policies[name] : undefined;
}

/** The tools the model is given in this answer: not the mode's left out, nor those the user turned off. */
export function toolsFor(ctx: ToolContext): KalemTool[] {
	return registry.filter(
		(tool) =>
			!ctx.excluded.has(tool.definition.name) &&
			toolPolicy(ctx, tool.definition.name) !== "off" &&
			tool.available(ctx),
	);
}

/** A call's input in a line, for the card that asks about it. */
const inputLine = (input: Record<string, unknown>): string => {
	const text = JSON.stringify(input);
	return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

export interface ToolResult {
	readonly text: string;
	readonly isError: boolean;
}

/** Runs one call; what it says goes back to the model, a mistake included. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
	const tool = toolNamed(name);
	if (tool === undefined) return { text: `There is no tool named ${name}.`, isError: true };
	const policy = toolPolicy(ctx, name);
	if (policy === "off") {
		return { text: `The user turned ${name} off in Settings: do not call it.`, isError: true };
	}
	if (ctx.excluded.has(name) || !tool.available(ctx)) {
		return { text: `${name} is not available now.`, isError: true };
	}
	try {
		const given = record(input);
		// A tool that only reads asks nothing of its own: it is asked about here when the user wants.
		if (policy === "ask" && tool.risk === "read") {
			const answer = await ctx.approve({
				tool: name,
				risk: /^(?:jira|confluence)_/.test(name) ? "external" : "ui",
				permission: `tool:${name}`,
				title: format(ctx.t.approvalUseTool, name),
				lines: Object.keys(given).length === 0 ? [] : [inputLine(given)],
				everyTime: true,
			});
			if (!answer.approved) {
				return {
					text: "The user did not allow it: nothing was read. Do not try again unless they ask.",
					isError: false,
				};
			}
		}
		return { text: await tool.run(given, ctx), isError: false };
	} catch (error) {
		return {
			text: `Error: ${error instanceof Error ? error.message : String(error)}`,
			isError: true,
		};
	}
}

// --- Calls the renderer runs -----------------------------------------------------------

/** Tool calls waiting for the window to run them. */
export class RendererCalls {
	readonly #waiting = new Map<string, (answer: RendererAnswer) => void>();
	#count = 0;

	call(sender: WebContents, chatId: string, name: string, input: unknown): Promise<RendererAnswer> {
		if (sender.isDestroyed()) return Promise.resolve({ ok: false, text: "The window is closed." });
		const id = `call-${Date.now().toString(36)}-${++this.#count}`;
		return new Promise((resolve) => {
			const gone = (): void => this.answer(id, { ok: false, text: "The window is closed." });
			sender.once("destroyed", gone);
			this.#waiting.set(id, (answer) => {
				sender.removeListener("destroyed", gone);
				resolve(answer);
			});
			sender.send(CHANNEL.assistantToolCall, { id, chatId, name, input });
		});
	}

	answer(id: string, raw: unknown): void {
		const resolve = this.#waiting.get(id);
		if (resolve === undefined) return;
		this.#waiting.delete(id);
		const answer = record(raw);
		resolve({
			ok: answer.ok === true,
			text: typeof answer.text === "string" ? answer.text.slice(0, 200_000) : "",
			...(typeof answer.document === "string" ? { document: answer.document } : {}),
		});
	}
}

/** The context's way to ask: through the gate, in the chat's window. */
export function approver(
	gate: PermissionGate,
	sender: WebContents,
	chatId: string,
	readExternal: () => boolean,
): ToolContext["approve"] {
	return (request) =>
		gate.ask(sender, {
			...request,
			chatId,
			scopes: scopesFor(request.risk),
			...(readExternal() ? { afterExternal: true } : {}),
		});
}
