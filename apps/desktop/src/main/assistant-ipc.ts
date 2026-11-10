/**
 * The assistant's requests from the windows: which service it uses and how
 * that is set up, the kept chats, and the questions, sent to a CLI on this
 * computer (Claude Code, GitHub Copilot) or to a service's API. An API
 * keeps no conversation, so the messages of each chat are kept here and
 * sent again with every question.
 */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { dialog, ipcMain } from "electron";
import { assistantInstructions } from "../shared/assistant-prompt.js";
import type { AssistantStatus, Settings } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import { parseChat } from "../shared/chats.js";
import type { ClaudeEvent, PromptImage } from "../shared/claude.js";
import {
	claudeArgs,
	claudeInputLine,
	copilotArgs,
	copilotTakesMcp,
	isPromptImageType,
	MAX_PROMPT_IMAGE_DATA,
	MAX_PROMPT_IMAGES,
	withInstructions,
} from "../shared/claude.js";
import type { LookupWay } from "../shared/confluence-tool.js";
import { confluenceRequests, MAX_ROUNDS } from "../shared/confluence-tool.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { jiraRequests } from "../shared/jira-tool.js";
import { modeExcluded } from "../shared/modes.js";
import type { ChatMessage, ProviderId } from "../shared/providers.js";
import {
	checkBaseUrl,
	isCli,
	isProvider,
	modelsFromHelp,
	PROVIDER_INFO,
	providerLabel,
	SUGGESTED_MODELS,
} from "../shared/providers.js";
import type { ChatStore } from "./assistant-chats.js";
import { ConfluenceLookups } from "./assistant-confluence.js";
import { JiraLookups } from "./assistant-jira.js";
import type { AssistantToolServer } from "./assistant-mcp.js";
import { mcpToolName } from "./assistant-mcp.js";
import { PermissionGate } from "./assistant-permissions.js";
import type { DocumentSnapshot, ToolContext, ToolResult } from "./assistant-tools.js";
import { approver, RendererCalls, runTool, toolsFor } from "./assistant-tools.js";
import "./assistant-app-tools.js";
import "./assistant-analysis-tools.js";
import "./assistant-external-tools.js";
import { blockResults, parseApprovalAnswer, toolCalls } from "../shared/tool-protocol.js";
import { collectSources, MAX_SOURCES, SOURCE_BUDGET } from "./assistant-sources.js";
import type { AssistantStore } from "./assistant-store.js";
import type { CliProgram } from "./cli.js";
import { claudeOutput, LocalCli, runCli, textOutput } from "./cli.js";
import type { ConfluenceClient } from "./confluence-client.js";
import type { JiraClient } from "./jira-client.js";
import { askApi, listModels } from "./llm.js";
import type { SettingsStore } from "./settings.js";
import type { TemplateStore } from "./templates.js";
import type { AppWindow } from "./windows.js";
import { errorMessage } from "./windows.js";
import type { KeptEdit, ToolStep } from "./workspace-tools.js";
import {
	applyEdit,
	looksLikeToolText,
	WORKSPACE_INSTRUCTIONS,
	Workspace,
	WorkspaceIndexes,
} from "./workspace-tools.js";

export interface AssistantIpcContext {
	readonly store: SettingsStore;
	readonly assistant: AssistantStore;
	readonly chats: ChatStore;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
	/** The connected Confluence site, for the assistant's look-ups; `null` when there is none. */
	confluence(): Promise<ConfluenceClient | null>;
	/** The connected Jira, for the assistant's look-ups; `null` when there is none. */
	jira(): Promise<JiraClient | null>;
	/** Kalem's tools for a CLI, as an MCP server. */
	readonly tools: AssistantToolServer;
	/** Changes settings as the menus do: every window follows. */
	changeSettings(patch: Partial<Settings>): void;
	changeLanguage(language: Lang | null): void;
	language(): Lang;
	/** The analysis templates, for the assistant to follow and check against. */
	readonly templates: TemplateStore;
}

/** How long an answer may wait for the user to allow a change, in ms. */
const APPROVAL_WAIT = 30 * 60 * 1000;

/** The active document as the window sent it; `null` when it is not shared. */
function sentDocument(raw: unknown): DocumentSnapshot | null {
	const { tabId, name, text, selection } = record(raw);
	if (typeof name !== "string" || typeof text !== "string") return null;
	return {
		tabId: typeof tabId === "string" ? tabId : null,
		name: name.slice(0, 500),
		text: text.slice(0, 2_000_000),
		selection: typeof selection === "string" ? selection.slice(0, 200_000) : "",
	};
}

/** How many past messages of a chat an API is sent again; older ones are dropped. */
const MAX_HISTORY = 40;
const MAX_HISTORY_TEXT = 100_000;

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

const programOf = (provider: ProviderId): CliProgram | null =>
	provider === "claude-code" ? "claude" : provider === "copilot" ? "copilot" : null;

async function isFolder(path: unknown): Promise<boolean> {
	if (typeof path !== "string" || path === "") return false;
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** A chat's messages sent by the window: taking turns from a question, each cut to size. */
function sentHistory(raw: unknown): ChatMessage[] {
	const history: ChatMessage[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		const { role, content } = record(item);
		const expected = history.length % 2 === 0 ? "user" : "assistant";
		if (role !== expected || typeof content !== "string") break;
		history.push({ role: expected, content: content.slice(0, MAX_HISTORY_TEXT) });
	}
	if (history.length % 2 === 1) history.pop();
	return history.slice(-MAX_HISTORY);
}

/** The pictures sent by the window that a service takes; the others are dropped. */
function sentImages(raw: unknown): PromptImage[] {
	const images: PromptImage[] = [];
	for (const item of Array.isArray(raw) ? raw : []) {
		const { label, mediaType, data } = record(item);
		if (
			typeof label !== "string" ||
			!isPromptImageType(mediaType) ||
			typeof data !== "string" ||
			data === "" ||
			data.length > MAX_PROMPT_IMAGE_DATA ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(data)
		) {
			continue;
		}
		images.push({ label: label.slice(0, 500), mediaType, data });
		if (images.length === MAX_PROMPT_IMAGES) break;
	}
	return images;
}

/** The files and folders sent by the window: absolute paths, at most `MAX_SOURCES`. */
function sentSources(raw: unknown): string[] {
	const paths = (Array.isArray(raw) ? raw : []).filter(
		(path): path is string => typeof path === "string" && path.length <= 4096 && isAbsolute(path),
	);
	return [...new Set(paths)].slice(0, MAX_SOURCES);
}

/** Characters of the files read for one answer that the chat keeps for the next questions. */
const MAX_REMEMBERED_READS = 40_000;

/**
 * The files read while answering, as the next questions see them: the
 * latest read of each file first, up to a limit, so a follow-up question
 * does not need them read again.
 */
export function rememberReads(reads: readonly string[]): string {
	const kept: string[] = [];
	const seen = new Set<string>();
	let room = MAX_REMEMBERED_READS;
	for (const read of [...reads].reverse()) {
		// The first line names the file and the lines: `path (lines 1-400 of 900)`.
		const head = read.split("\n", 1)[0] ?? "";
		if (seen.has(head) || !/ \(lines \d+-\d+ of \d+\)$/.test(head)) continue;
		seen.add(head);
		if (read.length > room) continue;
		room -= read.length;
		kept.push(read);
	}
	if (kept.length === 0) return "";
	return `<workspace-reads>\nWhat you read from the workspace to answer this, kept so you need not read it again:\n${kept.reverse().join("\n\n")}\n</workspace-reads>`;
}

/** What a CLI, which searches and reads with its own tools, is told about a workspace. */
const CLI_WORKSPACE_INSTRUCTIONS =
	"The user gave you a workspace: the folders below. Their files are NOT in the message. When the question needs them, search and read them with your own tools, only as much as the answer needs. When you name code, give its path and line.";

/** The `<workspace>` block: what the folders hold, never their files. */
async function workspaceBlock(workspace: Workspace | null, cli: boolean): Promise<string> {
	if (workspace === null) return "";
	return `<workspace>\n${cli ? CLI_WORKSPACE_INSTRUCTIONS : WORKSPACE_INSTRUCTIONS}\n${await workspace.overview()}\n</workspace>`;
}

/** The question with the chat's sources before it; the same sources again are only named. */
function withSources(sources: string, sent: string | undefined, prompt: string): string {
	if (sources === "") return prompt;
	if (sent === sources) {
		return `<files-unchanged>The sources are as I sent them above.</files-unchanged>\n\n${prompt}`;
	}
	return `${sources}\n\n${prompt}`;
}

/** What the rest of the app can ask the assistant directly, outside a chat. */
export interface AssistantService {
	/**
	 * One answer to one question from the service in use (a CLI or an API),
	 * with no chat around it and no tools; rejects with why it could not.
	 */
	complete(system: string, prompt: string, sender: WebContents): Promise<string>;
}

export function registerAssistantIpc(ctx: AssistantIpcContext): AssistantService {
	const clis: Record<CliProgram, LocalCli> = {
		claude: new LocalCli("claude", () => ctx.store.settings.claudePath),
		copilot: new LocalCli("copilot", () => ctx.store.settings.copilotPath),
	};
	/** Each search for a CLI; shared, so a second request does not find it missing half-way. */
	const locating = new Map<CliProgram, Promise<unknown>>();
	const locate = (program: CliProgram, again = false): Promise<unknown> => {
		let search = locating.get(program);
		if (search === undefined || again) {
			search = clis[program].locate();
			locating.set(program, search);
		}
		return search;
	};
	/** Running questions by window and chat; each can be stopped. */
	const running = new Map<string, () => void>();
	/** The folder each CLI conversation ran in. */
	const folders = new Map<string, string>();
	/** Each API conversation's messages. */
	const histories = new Map<string, ChatMessage[]>();
	/** The sources each CLI conversation was last sent, so unchanged ones are not sent again. */
	const sentFiles = new Map<string, string>();
	/** The workspace folders' file lists, shared by the chats. */
	const indexes = new WorkspaceIndexes();
	/** Changes the models proposed in this run, until they are applied. */
	const proposals = new Map<string, KeptEdit>();
	/** The user's say over what the tools change. */
	const gate = new PermissionGate({
		always: () => ctx.store.settings.assistantPermissions,
		setAlways: (permissions) => ctx.changeSettings({ assistantPermissions: permissions }),
	});
	/** Tool calls the windows run. */
	const rendererCalls = new RendererCalls();
	/** The Copilot CLIs that could not start Kalem's MCP server, by path. */
	const noMcp = new Set<string>();
	const copilotUsesMcp = async (): Promise<boolean> => {
		const choice = ctx.store.settings.copilotTools;
		if (choice === "block") return false;
		if (choice === "mcp") return true;
		await locate("copilot");
		const launch = clis.copilot.launch;
		return launch !== null && !noMcp.has(launch.path) && copilotTakesMcp(await clis.copilot.help());
	};

	ipcMain.handle(CHANNEL.assistantApprove, (_event, id: unknown, answer: unknown) => {
		if (typeof id === "string") gate.answer(id, parseApprovalAnswer(answer));
	});
	ipcMain.handle(CHANNEL.assistantToolResult, (_event, id: unknown, answer: unknown) => {
		if (typeof id === "string") rendererCalls.answer(id, answer);
	});
	ipcMain.handle(CHANNEL.assistantForgetPermissions, () => gate.forgetSession());

	ipcMain.handle(CHANNEL.assistantApplyEdit, async (_event, id: unknown) => {
		const kept = typeof id === "string" ? proposals.get(id) : undefined;
		if (kept === undefined) throw new Error(ctx.strings().assistantEditGone);
		await applyEdit(kept);
		proposals.delete(kept.id);
		// A new file is in the next search's list at once.
		indexes.forget(kept.absolute);
	});

	const status = async (refresh = false): Promise<AssistantStatus> => {
		const t = ctx.strings();
		const { provider, connection, key } = await ctx.assistant.active();
		const program = programOf(provider);
		if (program !== null) {
			await locate(program, refresh);
			const found = clis[program].status();
			if (!found.found) {
				return {
					provider,
					model: connection.model,
					ready: false,
					label: t.assistantNotFound,
					detail: "",
					missing: "cli",
				};
			}
			const label =
				connection.model === "" ? found.version : `${found.version} · ${connection.model}`;
			return {
				provider,
				model: connection.model,
				ready: true,
				label,
				detail: found.path,
				missing: null,
			};
		}
		const info = PROVIDER_INFO[provider];
		const ready =
			connection.baseUrl !== "" && connection.model !== "" && (!info.needsKey || key !== null);
		return {
			provider,
			model: connection.model,
			ready,
			label: ready ? `${providerLabel(t, provider)} · ${connection.model}` : t.assistantNotSetUp,
			detail: connection.baseUrl,
			missing: ready ? null : "setup",
		};
	};

	ipcMain.handle(CHANNEL.assistantStatus, (_event, refresh: unknown) => status(refresh === true));

	ipcMain.handle(CHANNEL.assistantConfig, () => ctx.assistant.config());

	ipcMain.handle(CHANNEL.assistantConfigure, async (_event, raw: unknown) => {
		const update = record(raw);
		if (!isProvider(update.provider)) throw new Error("Unknown service");
		const provider = update.provider;
		const info = PROVIDER_INFO[provider];
		const model = typeof update.model === "string" ? update.model.trim().slice(0, 200) : "";
		const baseUrl =
			isCli(info) || typeof update.baseUrl !== "string" || update.baseUrl.trim() === ""
				? info.baseUrl
				: checkBaseUrl(update.baseUrl);
		const key =
			update.key === null ? null : typeof update.key === "string" ? update.key.trim() : undefined;
		await ctx.assistant.update(provider, { baseUrl, model }, key);
		return status(isCli(info));
	});

	ipcMain.handle(CHANNEL.assistantSetModel, async (_event, model: unknown) => {
		if (typeof model !== "string") throw new Error("Invalid model");
		await ctx.assistant.setModel(model.trim().slice(0, 200));
		return status();
	});

	ipcMain.handle(CHANNEL.assistantModels, async (_event, raw: unknown) => {
		const request = record(raw);
		if (!isProvider(request.provider)) return [];
		const provider = request.provider;
		// A CLI names its models in its help; the well-known aliases come first.
		const program = programOf(provider);
		if (program !== null) {
			await locate(program);
			const listed = modelsFromHelp(await clis[program].help());
			return [...new Set([...(SUGGESTED_MODELS[provider] ?? []), ...listed])];
		}
		const info = PROVIDER_INFO[provider];
		// Without an address, the one the user set for the service.
		const baseUrl = checkBaseUrl(
			typeof request.baseUrl === "string" && request.baseUrl.trim() !== ""
				? request.baseUrl
				: (await ctx.assistant.config()).connections[provider].baseUrl || info.baseUrl,
		);
		const key =
			typeof request.key === "string" && request.key.trim() !== ""
				? request.key.trim()
				: await ctx.assistant.key(provider);
		return listModels(info, { baseUrl, model: "" }, key);
	});

	ipcMain.handle(CHANNEL.assistantLocate, async (event) => {
		const win = ctx.senderOf(event);
		const t = ctx.strings();
		const program = programOf((await ctx.assistant.active()).provider);
		if (program === null) return status();
		const result = await dialog.showOpenDialog(win.window, {
			title: program === "claude" ? t.claudeLocateTitle : t.copilotLocateTitle,
			properties: ["openFile", "dontAddToRecent"],
			...(process.platform === "win32"
				? { filters: [{ name: program, extensions: ["exe", "cmd"] }] }
				: {}),
		});
		const path = result.filePaths[0];
		if (!result.canceled && path !== undefined) {
			await locate(program);
			if (await clis[program].check(path)) {
				ctx.store.updateSettings(
					program === "claude" ? { claudePath: path } : { copilotPath: path },
				);
			} else {
				await dialog.showMessageBox(win.window, {
					type: "warning",
					message: program === "claude" ? t.claudeLocateFailed : t.copilotLocateFailed,
					detail: path,
				});
			}
		}
		return status();
	});

	ipcMain.handle(CHANNEL.assistantPickSources, async (event, kind: unknown) => {
		const win = ctx.senderOf(event);
		const t = ctx.strings();
		const folder = kind === "folder";
		const result = await dialog.showOpenDialog(win.window, {
			title: folder ? t.assistantAddFolderTitle : t.assistantAddFilesTitle,
			properties: [folder ? "openDirectory" : "openFile", "multiSelections", "dontAddToRecent"],
		});
		return result.canceled ? [] : result.filePaths;
	});

	ipcMain.handle(CHANNEL.assistantChats, () => ctx.chats.list());
	ipcMain.handle(CHANNEL.assistantChat, (_event, id: unknown) =>
		typeof id === "string" ? ctx.chats.get(id) : null,
	);
	ipcMain.handle(CHANNEL.assistantSaveChat, async (_event, raw: unknown) => {
		const chat = parseChat(raw);
		if (chat === null) throw new Error("Invalid chat");
		await ctx.chats.put(chat);
	});
	ipcMain.handle(CHANNEL.assistantDeleteChat, async (_event, id: unknown) => {
		if (typeof id === "string") await ctx.chats.delete(id);
	});

	ipcMain.handle(CHANNEL.assistantAsk, async (event, raw: unknown) => {
		const win = ctx.senderOf(event);
		const request = record(raw);
		const { chatId, prompt } = request;
		if (typeof chatId !== "string" || typeof prompt !== "string" || prompt.trim() === "") {
			throw new Error("Invalid question");
		}
		// With the whole document in it, for a model that cannot read it with the tools.
		const fullPrompt =
			typeof request.fullPrompt === "string" && request.fullPrompt.trim() !== ""
				? request.fullPrompt
				: prompt;
		const sessionId =
			typeof request.sessionId === "string" && /^[\w-]{1,100}$/.test(request.sessionId)
				? request.sessionId
				: null;
		const images = sentImages(request.images);
		const sources = sentSources(request.sources);
		const sender = event.sender;
		const runKey = `${sender.id}:${chatId}`;
		running.get(runKey)?.();
		const t = ctx.strings();
		const { provider, connection, key } = await ctx.assistant.active();
		const forward = (assistantEvent: ClaudeEvent): void => {
			if (!sender.isDestroyed()) sender.send(CHANNEL.assistantEvent, chatId, assistantEvent);
		};

		const program = programOf(provider);
		// The connected Confluence site and Jira: the model searches and reads them on its own.
		const [confluenceClient, jiraClient] = await Promise.all([
			ctx.confluence().catch(() => null),
			ctx.jira().catch(() => null),
		]);
		const lookups = confluenceClient === null ? null : new ConfluenceLookups(confluenceClient);
		const jiraLookups = jiraClient === null ? null : new JiraLookups(jiraClient);
		const step = (done: ToolStep): void => forward({ kind: "step", ...done });
		// Folders are a workspace: the question says what they hold, and the model reads what it needs.
		const collected = await collectSources(sources, {
			budget: program === null ? SOURCE_BUDGET.api : SOURCE_BUDGET.cli,
			listOnly: program !== null,
			workspace: true,
		});
		const workspace =
			collected.roots.length === 0
				? null
				: new Workspace(collected.roots, indexes, (proposed) => {
						proposals.set(proposed.id, proposed);
						const { absolute: _absolute, ...shown } = proposed;
						forward({ kind: "edit", edit: shown });
					});
		const tools: ToolContext = {
			chatId,
			sender,
			t,
			excluded:
				program === null
					? modeExcluded(request.mode)
					: new Set([...modeExcluded(request.mode), "list_files", "search", "read_file"]),
			settings: () => ctx.store.settings,
			changeSettings: ctx.changeSettings,
			changeLanguage: ctx.changeLanguage,
			confluence: lookups,
			jira: jiraLookups,
			confluenceClient,
			jiraClient,
			workspace,
			templates: ctx.templates,
			document: sentDocument(request.document),
			// Claude Code's own stream says which tools it called: the steps are not said twice.
			step: program === "claude" ? () => {} : step,
			emit: forward,
			approve: (asked) => approve(asked),
			renderer: (name, input) => rendererCalls.call(sender, chatId, name, input),
			readExternal: false,
		};
		const approve = approver(gate, sender, chatId, () => tools.readExternal);
		const offered = toolsFor(tools);
		const definitions = offered.map((tool) => tool.definition);
		const call = (name: string, input: unknown): Promise<ToolResult> => runTool(name, input, tools);

		// Claude Code gets the tools from Kalem's MCP server; Copilot too when it takes one,
		// else it writes them in blocks; an API calls them as its own tools.
		const copilotMcp = program === "copilot" && definitions.length > 0 && (await copilotUsesMcp());
		const mcpRun =
			(program === "claude" || copilotMcp) && definitions.length > 0
				? await ctx.tools.open(() => definitions, call).catch(() => null)
				: null;
		let way: LookupWay = program === null ? "tools" : mcpRun === null ? "block" : "mcp";
		const instructionsFor = (lookupWay: LookupWay): string =>
			assistantInstructions(t, {
				way: lookupWay,
				confluence: lookups?.site ?? null,
				jira: jiraLookups?.site ?? null,
				tools: definitions,
				mode: request.mode,
				document: tools.document,
			});
		let system = instructionsFor(way);
		// The sites cannot be fetched without the user's sign-in: Kalem's tools reach them, WebFetch does not.
		const denied =
			mcpRun === null
				? []
				: [
						...new Set(
							[lookups?.site, jiraLookups?.site]
								.filter((site): site is string => site !== undefined)
								.map((site) => new URL(site).hostname),
						),
					].map((host) => `WebFetch(domain:${host})`);
		const overview = await workspaceBlock(workspace, program !== null);
		const files = {
			...collected,
			text: [overview, collected.text].filter((part) => part !== "").join("\n\n"),
		};
		if (program !== null) {
			const sent = sessionId === null ? undefined : sentFiles.get(sessionId);
			const asked = withSources(files.text, sent, prompt);
			const tab = typeof request.tabId === "string" ? win.tabs.get(request.tabId) : undefined;
			// A CLI keeps a conversation with the folder it ran in, and resumes it
			// only from there; a new one runs next to the active document.
			const remembered =
				sessionId === null
					? undefined
					: (folders.get(sessionId) ??
						((await isFolder(request.folder)) ? (request.folder as string) : undefined));
			const folder =
				remembered ??
				(tab !== undefined && tab.path !== null && tab.remote === null
					? dirname(tab.path)
					: homedir());
			const send = (cliEvent: ClaudeEvent): void => {
				if (cliEvent.kind === "session") {
					folders.set(cliEvent.id, folder);
					sentFiles.set(cliEvent.id, files.text);
					forward({ ...cliEvent, folder });
				} else forward(cliEvent);
			};
			await locate(program);
			const launch = clis[program].launch;
			if (launch === null) {
				await mcpRun?.close();
				send({
					kind: "error",
					message: program === "claude" ? t.claudeNotFound : t.copilotNotFound,
				});
				return;
			}
			const mcpTools = definitions.map((tool) => mcpToolName(tool.name));
			// An answer may wait for the user to allow a change: Claude Code waits for the tool as long.
			const env = program === "claude" ? { MCP_TOOL_TIMEOUT: String(APPROVAL_WAIT) } : {};
			let copilotSession = sessionId ?? randomUUID();
			const argsFor = (conversation: string | null, jsonInput = false): string[] =>
				program === "claude"
					? claudeArgs({
							sessionId: conversation,
							systemPrompt: system,
							model: connection.model,
							jsonInput,
							folders: files.folders,
							...(mcpRun === null
								? {}
								: { mcp: { config: mcpRun.claude, tools: mcpTools }, denied }),
						})
					: copilotArgs({
							sessionId: conversation ?? copilotSession,
							model: connection.model,
							folders: files.folders,
							...(way === "mcp" && mcpRun !== null ? { mcpConfig: mcpRun.copilot } : {}),
						});
			let args: string[];
			let question = asked;
			if (program === "claude") {
				// Pictures need the question as a JSON line; without them it stays plain text.
				const jsonInput = images.length > 0;
				args = argsFor(sessionId, jsonInput);
				if (jsonInput) question = claudeInputLine(asked, images);
			} else {
				// The Copilot CLI reads no pictures: the question names them only.
				// Copilot takes the conversation's id from us, and its instructions with the first question.
				if (sessionId === null) question = withInstructions(system, asked);
				send({ kind: "session", id: copilotSession });
				args = argsFor(copilotSession);
			}
			// Rounds of look-ups and tool calls written in blocks: the reply's requests
			// are run and their results sent back in the same conversation, until it answers.
			let conversation = program === "copilot" ? copilotSession : sessionId;
			let stopped = false;
			running.set(runKey, () => {
				stopped = true;
				gate.cancel(sender, chatId);
			});
			try {
				for (let round = 0; ; round++) {
					let said = "";
					let ended: "done" | "error" | null = null;
					let held: ClaudeEvent | null = null;
					// A Copilot that cannot start Kalem's MCP server fails at once: it is asked again with blocks.
					const trying = program === "copilot" && way === "mcp" && round === 0;
					const output = program === "claude" ? claudeOutput() : textOutput();
					await runCli(
						launch,
						folder,
						args,
						question,
						output,
						(cliEvent) => {
							if (cliEvent.kind === "session") conversation = cliEvent.id;
							if (cliEvent.kind === "text") said += cliEvent.text;
							// The answer is done only when no look-ups are left.
							if (cliEvent.kind === "done") {
								ended = "done";
								return;
							}
							if (cliEvent.kind === "error") {
								ended = "error";
								if (trying) {
									held = cliEvent;
									return;
								}
							}
							send(cliEvent);
						},
						sender,
						(child) => {
							running.set(runKey, () => {
								stopped = true;
								gate.cancel(sender, chatId);
								child.kill();
							});
						},
						env,
					);
					if (trying && ended === "error" && said === "" && !stopped) {
						noMcp.add(launch.path);
						await mcpRun?.close();
						way = "block";
						system = instructionsFor(way);
						copilotSession = randomUUID();
						conversation = copilotSession;
						send({ kind: "session", id: copilotSession });
						question = withInstructions(system, asked);
						args = argsFor(copilotSession);
						round = -1;
						continue;
					}
					if (held !== null) send(held);
					const requests = lookups === null ? [] : confluenceRequests(said);
					const jiraAsked = jiraLookups === null ? [] : jiraRequests(said);
					const blockCalls = way === "block" ? toolCalls(said) : [];
					if (
						ended !== "done" ||
						stopped ||
						requests.length + jiraAsked.length + blockCalls.length === 0 ||
						conversation === null ||
						round >= MAX_ROUNDS ||
						sender.isDestroyed()
					) {
						if (ended === "done") send({ kind: "done" });
						break;
					}
					const found: string[] = [];
					if (requests.length > 0) {
						tools.readExternal = true;
						found.push(await (lookups as ConfluenceLookups).runAll(requests, step));
					}
					if (jiraAsked.length > 0) {
						tools.readExternal = true;
						found.push(await (jiraLookups as JiraLookups).runAll(jiraAsked, step));
					}
					if (blockCalls.length > 0) {
						const results: { tool: string; text: string }[] = [];
						for (const blockCall of blockCalls) {
							if (stopped) break;
							results.push({
								tool: blockCall.tool,
								text: (await call(blockCall.tool, blockCall.input)).text,
							});
						}
						found.push(blockResults(results));
					}
					const results = found.join("\n\n");
					if (stopped) {
						send({ kind: "done" });
						break;
					}
					// The last round may not look up more.
					question =
						round + 1 >= MAX_ROUNDS
							? `${results}\n\nThis was the last look-up: answer now with what you found.`
							: results;
					send({ kind: "text", text: "\n\n" });
					args = argsFor(conversation);
				}
			} finally {
				await mcpRun?.close();
				running.delete(runKey);
			}
			return;
		}

		const info = PROVIDER_INFO[provider];
		if (connection.model === "" || (info.needsKey && key === null)) {
			forward({ kind: "error", message: t.assistantNotSetUp });
			return;
		}
		// A chat this run has not seen (kept from an earlier run) brings its messages along.
		const known = sessionId === null ? undefined : histories.get(sessionId);
		const id = sessionId ?? randomUUID();
		const before = known ?? (sessionId === null ? [] : sentHistory(request.history));
		forward({ kind: "session", id });
		// An API sees the sources again only while a kept message still carries them.
		const seen = files.text !== "" && before.some(({ content }) => content.startsWith(files.text));
		const messages: ChatMessage[] = [
			...before,
			{ role: "user", content: withSources(files.text, seen ? files.text : undefined, prompt) },
		];
		const controller = new AbortController();
		running.set(runKey, () => {
			controller.abort();
			gate.cancel(sender, chatId);
		});
		const stop = (): void => controller.abort();
		sender.once("destroyed", stop);
		let reply = "";
		let looked = false;
		/** The files read for this answer: kept with the question, so the next one need not read them again. */
		const reads: string[] = [];
		const ask = (
			asked: readonly ChatMessage[],
			withTools: boolean,
			instructions: string,
		): Promise<void> =>
			askApi({
				provider: info,
				connection,
				key,
				system: instructions,
				messages: asked,
				images,
				signal: controller.signal,
				text: (chunk) => {
					reply += chunk;
					forward({ kind: "text", text: chunk });
				},
				usage: (cost) => forward({ kind: "usage", ...cost }),
				...(definitions.length === 0 || !withTools
					? {}
					: {
							tools: {
								definitions,
								run: async (name, input) => {
									looked = true;
									const result = await call(name, input);
									if (name === "read_file") reads.push(result.text);
									return result.text;
								},
							},
						}),
			});
		try {
			try {
				await ask(messages, true, system);
				// It answered by writing a tool call out: it cannot use them.
				if (definitions.length > 0 && !looked && looksLikeToolText(reply)) {
					reply = "";
					forward({ kind: "reset" });
					throw new Error("Tools are not called");
				}
			} catch (error) {
				// A model that cannot call tools is sent the folders' text and the whole document
				// instead, as before; without them it is asked again without tools.
				if (definitions.length === 0 || reply !== "" || looked || controller.signal.aborted) {
					throw error;
				}
				const inlined =
					workspace === null
						? files
						: await collectSources(sources, { budget: SOURCE_BUDGET.api, listOnly: false });
				messages[messages.length - 1] = {
					role: "user",
					content: withSources(inlined.text, seen ? inlined.text : undefined, fullPrompt),
				};
				await ask(messages, false, assistantInstructions(t, { way: "none", mode: request.mode }));
			}
			forward({ kind: "done" });
		} catch (error) {
			forward({ kind: "error", message: errorMessage(error) });
		} finally {
			sender.removeListener("destroyed", stop);
			running.delete(runKey);
		}
		// What was said stays, a stopped reply as far as it got; a question without
		// an answer is left out, so the messages keep taking turns.
		const asked = messages.at(-1) as ChatMessage;
		const remembered = rememberReads(reads);
		const answered: ChatMessage[] =
			reply === ""
				? before
				: [
						...messages.slice(0, -1),
						remembered === "" ? asked : { ...asked, content: `${asked.content}\n\n${remembered}` },
						{ role: "assistant", content: reply },
					];
		histories.set(id, answered.slice(-MAX_HISTORY));
	});

	ipcMain.handle(CHANNEL.assistantStop, (event, chatId: unknown) => {
		if (typeof chatId !== "string") return;
		const runKey = `${event.sender.id}:${chatId}`;
		running.get(runKey)?.();
		running.delete(runKey);
	});

	return {
		async complete(system, prompt, sender) {
			const t = ctx.strings();
			const { provider, connection, key } = await ctx.assistant.active();
			const program = programOf(provider);
			let reply = "";
			let failure: string | null = null;
			if (program !== null) {
				await locate(program);
				const launch = clis[program].launch;
				if (launch === null) {
					throw new Error(program === "claude" ? t.claudeNotFound : t.copilotNotFound);
				}
				const args =
					program === "claude"
						? claudeArgs({ sessionId: null, systemPrompt: system, model: connection.model })
						: copilotArgs({ sessionId: randomUUID(), model: connection.model, folders: [] });
				const question = program === "claude" ? prompt : withInstructions(system, prompt);
				const output = program === "claude" ? claudeOutput() : textOutput();
				await runCli(
					launch,
					homedir(),
					args,
					question,
					output,
					(event) => {
						if (event.kind === "text") reply += event.text;
						else if (event.kind === "error") failure = event.message;
					},
					sender,
					() => {},
				);
			} else {
				const info = PROVIDER_INFO[provider];
				if (connection.model === "" || (info.needsKey && key === null)) {
					throw new Error(t.assistantNotSetUp);
				}
				await askApi({
					provider: info,
					connection,
					key,
					system,
					messages: [{ role: "user", content: prompt }],
					signal: new AbortController().signal,
					text: (chunk) => {
						reply += chunk;
					},
				});
			}
			if (failure !== null) throw new Error(failure);
			if (reply.trim() === "") throw new Error(t.assistantNotSetUp);
			return reply;
		},
	};
}
