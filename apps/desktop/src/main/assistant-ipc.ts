/**
 * The assistant's requests from the windows: which service it uses and how
 * that is set up, and the questions, sent to the Claude Code CLI or to a
 * service's API. An API keeps no conversation, so the messages of each
 * chat are kept here and sent again with every question.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { dialog, ipcMain } from "electron";
import type { AssistantStatus } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { ClaudeEvent } from "../shared/claude.js";
import { claudeArgs, systemPrompt } from "../shared/claude.js";
import type { Strings } from "../shared/i18n.js";
import type { ChatMessage } from "../shared/providers.js";
import { checkBaseUrl, isProvider, PROVIDER_INFO, providerLabel } from "../shared/providers.js";
import type { AssistantStore } from "./assistant-store.js";
import { ClaudeCli, runClaude } from "./claude.js";
import { askApi, listModels } from "./llm.js";
import type { SettingsStore } from "./settings.js";
import type { AppWindow } from "./windows.js";
import { errorMessage } from "./windows.js";

export interface AssistantIpcContext {
	readonly store: SettingsStore;
	readonly assistant: AssistantStore;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
}

/** How many past messages of a chat an API is sent again; older ones are dropped. */
const MAX_HISTORY = 40;

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

export function registerAssistantIpc(ctx: AssistantIpcContext): void {
	const cli = new ClaudeCli(ctx.store);
	/** The search for the CLI; shared, so a second request does not find it missing half-way. */
	let locating: Promise<unknown> | null = null;
	const locate = (again = false): Promise<unknown> => {
		if (locating === null || again) locating = cli.locate();
		return locating;
	};
	/** Running questions by window and chat; each can be stopped. */
	const running = new Map<string, () => void>();
	/** The folder each Claude Code conversation ran in. */
	const folders = new Map<string, string>();
	/** Each API conversation's messages. */
	const histories = new Map<string, ChatMessage[]>();

	const status = async (refresh = false): Promise<AssistantStatus> => {
		const t = ctx.strings();
		const { provider, connection, key } = await ctx.assistant.active();
		if (provider === "claude-code") {
			await locate(refresh);
			const found = cli.status();
			return found.found
				? { provider, ready: true, label: found.version, detail: found.path, missing: null }
				: { provider, ready: false, label: t.assistantNotFound, detail: "", missing: "cli" };
		}
		const info = PROVIDER_INFO[provider];
		const ready =
			connection.baseUrl !== "" && connection.model !== "" && (!info.needsKey || key !== null);
		return {
			provider,
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
		const model = typeof update.model === "string" ? update.model.trim().slice(0, 200) : "";
		const baseUrl =
			provider === "claude-code" ||
			typeof update.baseUrl !== "string" ||
			update.baseUrl.trim() === ""
				? PROVIDER_INFO[provider].baseUrl
				: checkBaseUrl(update.baseUrl);
		const key =
			update.key === null ? null : typeof update.key === "string" ? update.key.trim() : undefined;
		await ctx.assistant.update(provider, { baseUrl, model }, key);
		return status(provider === "claude-code");
	});

	ipcMain.handle(CHANNEL.assistantModels, async (_event, raw: unknown) => {
		const request = record(raw);
		if (!isProvider(request.provider) || request.provider === "claude-code") return [];
		const provider = request.provider;
		const baseUrl = checkBaseUrl(
			typeof request.baseUrl === "string" && request.baseUrl.trim() !== ""
				? request.baseUrl
				: PROVIDER_INFO[provider].baseUrl,
		);
		const key =
			typeof request.key === "string" && request.key.trim() !== ""
				? request.key.trim()
				: await ctx.assistant.key(provider);
		return listModels(PROVIDER_INFO[provider], { baseUrl, model: "" }, key);
	});

	ipcMain.handle(CHANNEL.claudeLocate, async (event) => {
		const win = ctx.senderOf(event);
		const t = ctx.strings();
		const result = await dialog.showOpenDialog(win.window, {
			title: t.claudeLocateTitle,
			properties: ["openFile", "dontAddToRecent"],
			...(process.platform === "win32"
				? { filters: [{ name: "Claude Code", extensions: ["exe", "cmd"] }] }
				: {}),
		});
		const path = result.filePaths[0];
		if (!result.canceled && path !== undefined) {
			await locate();
			if (await cli.check(path)) {
				ctx.store.updateSettings({ claudePath: path });
			} else {
				await dialog.showMessageBox(win.window, {
					type: "warning",
					message: t.claudeLocateFailed,
					detail: path,
				});
			}
		}
		return status();
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

		if (provider === "claude-code") {
			const tab = typeof request.tabId === "string" ? win.tabs.get(request.tabId) : undefined;
			// Claude Code keeps a conversation with the folder it ran in, and resumes
			// it only from there; a new one runs next to the active document.
			const folder =
				(sessionId === null ? undefined : folders.get(sessionId)) ??
				(tab !== undefined && tab.path !== null && tab.remote === null
					? dirname(tab.path)
					: homedir());
			const send = (claudeEvent: ClaudeEvent): void => {
				if (claudeEvent.kind === "session") folders.set(claudeEvent.id, folder);
				if (!sender.isDestroyed()) sender.send(CHANNEL.assistantEvent, chatId, claudeEvent);
			};
			await locate();
			const launch = cli.launch;
			if (launch === null) {
				send({ kind: "error", message: t.claudeNotFound });
				return;
			}
			const args = claudeArgs({ sessionId, systemPrompt: systemPrompt(t) });
			await runClaude(launch, folder, args, prompt, send, sender, (child) => {
				running.set(runKey, () => child.kill());
			});
			running.delete(runKey);
			return;
		}

		const send = (assistantEvent: ClaudeEvent): void => {
			if (!sender.isDestroyed()) sender.send(CHANNEL.assistantEvent, chatId, assistantEvent);
		};
		const info = PROVIDER_INFO[provider];
		if (connection.model === "" || (info.needsKey && key === null)) {
			send({ kind: "error", message: t.assistantNotSetUp });
			return;
		}
		// A conversation is continued only with the service it was started with.
		const id = sessionId !== null && histories.has(sessionId) ? sessionId : randomUUID();
		send({ kind: "session", id });
		const messages: ChatMessage[] = [
			...(histories.get(id) ?? []),
			{ role: "user", content: prompt },
		];
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
					send({ kind: "text", text: chunk });
				},
			});
			send({ kind: "done" });
		} catch (error) {
			send({ kind: "error", message: errorMessage(error) });
		} finally {
			sender.removeListener("destroyed", stop);
			running.delete(runKey);
		}
		// What was said stays, a stopped reply as far as it got; a question without
		// an answer is left out, so the messages keep taking turns.
		if (reply !== "") {
			const answered: ChatMessage[] = [...messages, { role: "assistant", content: reply }];
			histories.set(id, answered.slice(-MAX_HISTORY));
		}
	});

	ipcMain.handle(CHANNEL.assistantStop, (event, chatId: unknown) => {
		if (typeof chatId !== "string") return;
		const runKey = `${event.sender.id}:${chatId}`;
		running.get(runKey)?.();
		running.delete(runKey);
	});
}
