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
import { dirname } from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { dialog, ipcMain } from "electron";
import type { AssistantStatus } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import { parseChat } from "../shared/chats.js";
import type { ClaudeEvent } from "../shared/claude.js";
import { claudeArgs, copilotArgs, systemPrompt, withInstructions } from "../shared/claude.js";
import type { Strings } from "../shared/i18n.js";
import type { ChatMessage, ProviderId } from "../shared/providers.js";
import {
	checkBaseUrl,
	isCli,
	isProvider,
	PROVIDER_INFO,
	providerLabel,
} from "../shared/providers.js";
import type { ChatStore } from "./assistant-chats.js";
import type { AssistantStore } from "./assistant-store.js";
import type { CliProgram } from "./cli.js";
import { claudeOutput, LocalCli, runCli, textOutput } from "./cli.js";
import { askApi, listModels } from "./llm.js";
import type { SettingsStore } from "./settings.js";
import type { AppWindow } from "./windows.js";
import { errorMessage } from "./windows.js";

export interface AssistantIpcContext {
	readonly store: SettingsStore;
	readonly assistant: AssistantStore;
	readonly chats: ChatStore;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
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

export function registerAssistantIpc(ctx: AssistantIpcContext): void {
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
		if (!isProvider(request.provider) || isCli(PROVIDER_INFO[request.provider])) return [];
		const provider = request.provider;
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
		const sessionId =
			typeof request.sessionId === "string" && /^[\w-]{1,100}$/.test(request.sessionId)
				? request.sessionId
				: null;
		const sender = event.sender;
		const runKey = `${sender.id}:${chatId}`;
		running.get(runKey)?.();
		const t = ctx.strings();
		const { provider, connection, key } = await ctx.assistant.active();
		const forward = (assistantEvent: ClaudeEvent): void => {
			if (!sender.isDestroyed()) sender.send(CHANNEL.assistantEvent, chatId, assistantEvent);
		};

		const program = programOf(provider);
		if (program !== null) {
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
					forward({ ...cliEvent, folder });
				} else forward(cliEvent);
			};
			await locate(program);
			const launch = clis[program].launch;
			if (launch === null) {
				send({
					kind: "error",
					message: program === "claude" ? t.claudeNotFound : t.copilotNotFound,
				});
				return;
			}
			let args: string[];
			let question = prompt;
			if (program === "claude") {
				args = claudeArgs({ sessionId, systemPrompt: systemPrompt(t), model: connection.model });
			} else {
				// Copilot takes the conversation's id from us, and its instructions with the first question.
				const id = sessionId ?? randomUUID();
				if (sessionId === null) question = withInstructions(systemPrompt(t), prompt);
				send({ kind: "session", id });
				args = copilotArgs({ sessionId: id, model: connection.model });
			}
			const output = program === "claude" ? claudeOutput() : textOutput();
			await runCli(launch, folder, args, question, output, send, sender, (child) => {
				running.set(runKey, () => child.kill());
			});
			running.delete(runKey);
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
		const messages: ChatMessage[] = [...before, { role: "user", content: prompt }];
		const controller = new AbortController();
		running.set(runKey, () => controller.abort());
		const stop = (): void => controller.abort();
		sender.once("destroyed", stop);
		let reply = "";
		try {
			await askApi({
				provider: info,
				connection,
				key,
				system: systemPrompt(t),
				messages,
				signal: controller.signal,
				text: (chunk) => {
					reply += chunk;
					forward({ kind: "text", text: chunk });
				},
			});
			forward({ kind: "done" });
		} catch (error) {
			forward({ kind: "error", message: errorMessage(error) });
		} finally {
			sender.removeListener("destroyed", stop);
			running.delete(runKey);
		}
		// What was said stays, a stopped reply as far as it got; a question without
		// an answer is left out, so the messages keep taking turns.
		const answered: ChatMessage[] =
			reply === "" ? before : [...messages, { role: "assistant", content: reply }];
		histories.set(id, answered.slice(-MAX_HISTORY));
	});

	ipcMain.handle(CHANNEL.assistantStop, (event, chatId: unknown) => {
		if (typeof chatId !== "string") return;
		const runKey = `${event.sender.id}:${chatId}`;
		running.get(runKey)?.();
		running.delete(runKey);
	});
}
