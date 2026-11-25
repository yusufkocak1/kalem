/**
 * Runs the extensions: each one's host code in a hidden, sandboxed page
 * of its own session, which can reach nothing but its own files. All it
 * does goes through the `kalem` object (see `extension-preload.ts`) and is
 * checked here against the permissions the user granted: the servers it
 * may reach, whether it may give the assistant tools.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IpcMainInvokeEvent, Session, WebContents } from "electron";
import { BrowserWindow, dialog, ipcMain, net, session, shell, WebContentsView } from "electron";
import type { ExtensionStatusItem } from "../shared/bridge.js";
import type {
	ExtensionCall,
	ExtensionHttpResponse,
	ExtensionToolSpec,
} from "../shared/extension-api.js";
import {
	contentTypeOf,
	EXTENSION_CHANNEL,
	EXTENSION_CSP,
	HOST_PAGE,
	hostStartScript,
	MAX_HTTP_RESPONSE,
	MAX_REDIRECTS,
	parseHttpRequest,
	UI_SCRIPT,
	UI_STYLE,
} from "../shared/extension-api.js";
import type { ExtensionManifest, ExtensionPermissions } from "../shared/extensions.js";
import { hostOfSetting, isAllowedUrl, isToolName, safeEntryPath } from "../shared/extensions.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { KalemTool } from "./assistant-tools.js";
import { registerTools, toolNamed, unregisterTools } from "./assistant-tools.js";
import { fileCall } from "./extension-files.js";
import { ExtensionProcesses, parseSpawnRequest } from "./extension-process.js";
import type { ExtensionStore } from "./extension-store.js";
import { networkLog } from "./network-log.js";
import { EXTENSION_SCHEME } from "./protocol.js";

export type ExtensionStatus = "stopped" | "starting" | "running" | "failed";

export interface ExtensionRuntimeState {
	readonly status: ExtensionStatus;
	readonly error: string | null;
	readonly log: readonly string[];
}

interface Running {
	readonly manifest: ExtensionManifest;
	readonly granted: ExtensionPermissions;
	readonly view: WebContentsView;
	readonly contents: WebContents;
	status: ExtensionStatus;
	error: string | null;
	readonly tools: Set<string>;
	readonly commands: Set<string>;
	readonly uiHandlers: Set<string>;
}

interface Waiting {
	readonly owner: number;
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export interface ExtensionHostOptions {
	readonly store: ExtensionStore;
	readonly preloadPath: string;
	strings(): Strings;
	/** Something the menu or the settings show changed. */
	changed(): void;
	/** Sends the extension's panes a message from its host code. */
	postToUi(id: string, message: unknown): void;
	/** Brings one of the extension's panes into view. */
	showPane(id: string, pane: string): void;
	/** The app's language (`tr`, `en`). */
	language(): string;
	/** The open folders, the first one first. */
	workspaceFolders(): readonly string[];
	/** The status bar items of every extension changed. */
	statusItemsChanged(): void;
}

const MAX_LOG_LINES = 200;
const TOOL_TIMEOUT = 5 * 60_000;

const fetchTraced = networkLog.trace("extensions", (url: string, init?: RequestInit) =>
	net.fetch(url, init),
);

const partitionOf = (id: string): string => `persist:kalem-ext-${id}`;

export class ExtensionHost {
	readonly #options: ExtensionHostOptions;
	readonly #running = new Map<string, Running>();
	readonly #byContents = new Map<number, string>();
	readonly #waiting = new Map<string, Waiting>();
	readonly #logs = new Map<string, string[]>();
	readonly #sessions = new Set<string>();
	readonly #stopped = new Map<string, string | null>();
	readonly #processes = new ExtensionProcesses();
	readonly #statusItems = new Map<string, ExtensionStatusItem>();

	constructor(options: ExtensionHostOptions) {
		this.#options = options;
		ipcMain.handle(EXTENSION_CHANNEL.request, (event, method: unknown, args: unknown) =>
			this.#request(event, method, Array.isArray(args) ? args : []),
		);
		ipcMain.on(EXTENSION_CHANNEL.result, (event, raw: unknown) =>
			this.#result(event.sender.id, raw),
		);
	}

	async startAll(): Promise<void> {
		for (const extension of await this.#options.store.list()) {
			if (extension.enabled) await this.start(extension.manifest.id).catch(() => {});
		}
	}

	async start(id: string): Promise<void> {
		this.stop(id);
		const extension = await this.#options.store.get(id);
		if (extension === null || !extension.enabled) return;
		const { manifest } = extension;
		this.#stopped.delete(id);
		if (manifest.host === null) {
			this.#options.changed();
			return;
		}
		this.#session(id);
		const view = new WebContentsView({
			webPreferences: {
				partition: partitionOf(id),
				preload: this.#options.preloadPath,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				webSecurity: true,
				spellcheck: false,
			},
		});
		const contents = view.webContents;
		contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
		contents.setWindowOpenHandler(() => ({ action: "deny" }));
		contents.on("will-navigate", (event) => event.preventDefault());
		const running: Running = {
			manifest,
			granted: extension.granted,
			view,
			contents,
			status: "starting",
			error: null,
			tools: new Set(),
			commands: new Set(),
			uiHandlers: new Set(),
		};
		this.#running.set(id, running);
		const contentsId = contents.id;
		this.#byContents.set(contentsId, id);
		contents.on("render-process-gone", (_event, details) => {
			this.#fail(id, `The extension's process stopped (${details.reason}).`);
		});
		contents.on("destroyed", () => {
			this.#byContents.delete(contentsId);
			this.#rejectWaiting(contentsId, "The extension stopped.");
		});
		this.#append(id, `Starting ${manifest.name} ${manifest.version}`);
		this.#options.changed();
		await contents
			.loadURL(`${EXTENSION_SCHEME}://${id}/__kalem/host.html?lang=${this.#options.language()}`)
			.catch((error: unknown) => {
				this.#fail(id, error instanceof Error ? error.message : String(error));
			});
	}

	stop(id: string): void {
		const running = this.#running.get(id);
		if (running === undefined) return;
		this.#running.delete(id);
		this.#stopped.set(id, running.status === "failed" ? running.error : null);
		unregisterTools([...running.tools]);
		this.#processes.killAll(id);
		this.#clearStatusItems(id);
		if (!running.contents.isDestroyed()) running.contents.close();
		this.#options.changed();
	}

	/** The extensions' items in the status bar. */
	statusItems(): ExtensionStatusItem[] {
		return [...this.#statusItems.values()];
	}

	#setStatusItem(id: string, running: Running, rawKey: unknown, raw: unknown): void {
		const key = typeof rawKey === "string" ? rawKey.slice(0, 40) : "";
		if (key === "") throw new Error("A status item needs a key.");
		const slot = `${id}\n${key}`;
		if (raw === null || raw === undefined) {
			this.#statusItems.delete(slot);
		} else {
			const item = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
			const command = typeof item.command === "string" ? item.command : null;
			if (command !== null && !running.manifest.commands.some((known) => known.id === command)) {
				throw new Error(`"${command}" is not a command of the manifest.`);
			}
			if (
				!this.#statusItems.has(slot) &&
				[...this.#statusItems.values()].filter((each) => each.extension === id).length >= 3
			) {
				throw new Error("An extension may show at most 3 status items.");
			}
			this.#statusItems.set(slot, {
				extension: id,
				key,
				text: String(item.text ?? "").slice(0, 60),
				tooltip: String(item.tooltip ?? "").slice(0, 200),
				command,
			});
		}
		this.#options.statusItemsChanged();
	}

	#clearStatusItems(id: string): void {
		let changed = false;
		for (const [slot, item] of this.#statusItems) {
			if (item.extension === id) {
				this.#statusItems.delete(slot);
				changed = true;
			}
		}
		if (changed) this.#options.statusItemsChanged();
	}

	async #pickPath(raw: unknown): Promise<string | null> {
		const options = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const parent = BrowserWindow.getFocusedWindow();
		const request: Electron.OpenDialogOptions = {
			...(typeof options.title === "string" ? { title: options.title.slice(0, 200) } : {}),
			...(typeof options.defaultPath === "string" ? { defaultPath: options.defaultPath } : {}),
			properties: [options.folder === true ? "openDirectory" : "openFile"],
		};
		const picked = await (parent === null
			? dialog.showOpenDialog(request)
			: dialog.showOpenDialog(parent, request));
		return picked.canceled ? null : (picked.filePaths[0] ?? null);
	}

	stopAll(): void {
		for (const id of [...this.#running.keys()]) this.stop(id);
	}

	state(id: string): ExtensionRuntimeState {
		const running = this.#running.get(id);
		const log = this.#logs.get(id) ?? [];
		if (running === undefined) {
			const error = this.#stopped.get(id) ?? null;
			return { status: error === null ? "stopped" : "failed", error, log };
		}
		return { status: running.status, error: running.error, log };
	}

	clearLog(id: string): void {
		this.#logs.delete(id);
	}

	openDevTools(id: string): void {
		const running = this.#running.get(id);
		if (running !== undefined && !running.contents.isDestroyed()) {
			running.contents.openDevTools({ mode: "detach" });
		}
	}

	/** The extensions' commands, as the menu lists them. */
	menuCommands(): { extension: string; name: string; command: string; title: string }[] {
		const found: { extension: string; name: string; command: string; title: string }[] = [];
		for (const [id, running] of this.#running) {
			for (const command of running.manifest.commands) {
				found.push({
					extension: id,
					name: running.manifest.name,
					command: command.id,
					title: command.title,
				});
			}
		}
		return found.sort((a, b) => a.name.localeCompare(b.name, "tr"));
	}

	async runCommand(id: string, command: string): Promise<void> {
		const t = this.#options.strings();
		const running = this.#running.get(id);
		try {
			if (running === undefined || running.status !== "running") {
				throw new Error(format(t.extensionNotRunning, running?.manifest.name ?? id));
			}
			if (!running.commands.has(command))
				throw new Error(`The extension did not register "${command}".`);
			await this.#call(running, { kind: "command", name: command, input: null }, null);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#append(id, `Command ${command}: ${message}`);
			const parent = BrowserWindow.getFocusedWindow();
			const options = {
				type: "error" as const,
				message: format(t.extensionCommandFailed, running?.manifest.name ?? id),
				detail: message,
			};
			void (parent === null
				? dialog.showMessageBox(options)
				: dialog.showMessageBox(parent, options));
		}
	}

	#session(id: string): Session {
		const ses = session.fromPartition(partitionOf(id));
		if (this.#sessions.has(id)) return ses;
		this.#sessions.add(id);
		ses.webRequest.onBeforeRequest((details, callback) => {
			const allowed = /^(?:kalem-ext|data|blob|devtools|chrome-extension):/.test(details.url);
			callback({ cancel: !allowed });
		});
		ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
		ses.setPermissionCheckHandler(() => false);
		ses.protocol.handle(EXTENSION_SCHEME, (request) => this.#serve(id, request));
		return ses;
	}

	async #serve(id: string, request: Request): Promise<Response> {
		const url = new URL(request.url);
		const headers = {
			"Content-Security-Policy": EXTENSION_CSP,
			"X-Content-Type-Options": "nosniff",
		};
		if (url.hostname !== id) return new Response(null, { status: 404 });
		const manifest = this.#running.get(id)?.manifest;
		const path = decodeURIComponent(url.pathname.slice(1));
		if (path === "__kalem/host.html") {
			return new Response(HOST_PAGE, {
				headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
			});
		}
		if (path === "__kalem/start.js" && manifest?.host != null) {
			return new Response(hostStartScript(manifest.host), {
				headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
			});
		}
		return this.#serveFile(id, path);
	}

	/** An extension's pane and its files, as the app's windows load them. */
	async serveUi(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const extension = await this.#options.store.get(url.hostname);
		if (extension === null || !extension.enabled || extension.manifest.ui === null) {
			return new Response(null, { status: 404 });
		}
		const path = decodeURIComponent(url.pathname.slice(1));
		if (path === "__kalem/ui.js") return this.#text(UI_SCRIPT, "text/javascript; charset=utf-8");
		if (path === "__kalem/ui.css") return this.#text(UI_STYLE, "text/css; charset=utf-8");
		return this.#serveFile(extension.manifest.id, path);
	}

	#text(body: string, type: string): Response {
		return new Response(body, {
			headers: {
				"Content-Security-Policy": EXTENSION_CSP,
				"X-Content-Type-Options": "nosniff",
				"Content-Type": type,
			},
		});
	}

	async #serveFile(id: string, path: string): Promise<Response> {
		const safe = safeEntryPath(path);
		if (safe === null || safe.startsWith("__kalem/")) return new Response(null, { status: 404 });
		try {
			const data = await readFile(join(this.#options.store.folderOf(id), ...safe.split("/")));
			return new Response(data, {
				headers: {
					"Content-Security-Policy": EXTENSION_CSP,
					"X-Content-Type-Options": "nosniff",
					"Content-Type": contentTypeOf(safe),
				},
			});
		} catch {
			return new Response(null, { status: 404 });
		}
	}

	/** A call from one of the extension's panes to its host code (`kalem.ui.handle`). */
	async uiCall(id: string, name: string, input: unknown): Promise<unknown> {
		const until = Date.now() + 15_000;
		while (this.#running.get(id)?.status === "starting" && Date.now() < until) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const running = this.#running.get(id);
		if (running === undefined || running.status !== "running") {
			throw new Error(
				format(this.#options.strings().extensionNotRunning, running?.manifest.name ?? id),
			);
		}
		if (!running.uiHandlers.has(name)) throw new Error(`The extension handles no "${name}".`);
		return this.#call(running, { kind: "ui", name, input }, TOOL_TIMEOUT);
	}

	async #request(event: IpcMainInvokeEvent, method: unknown, args: unknown[]): Promise<unknown> {
		const id = this.#byContents.get(event.sender.id);
		const running = id === undefined ? undefined : this.#running.get(id);
		if (id === undefined || running === undefined) throw new Error("Not an extension.");
		const store = this.#options.store;
		const [first, second] = args;
		switch (method) {
			case "settings.get": {
				const values = await store.settingsOf(id);
				return typeof first === "string" && Object.hasOwn(values, first) ? values[first] : null;
			}
			case "settings.all":
				return store.settingsOf(id);
			case "secrets.get":
				if (
					typeof first !== "string" ||
					!running.manifest.secrets.some((secret) => secret.key === first)
				) {
					throw new Error(`"${String(first)}" is not a secret of the manifest.`);
				}
				return store.secret(id, first);
			case "http.fetch":
				return this.#fetch(running, first, second);
			case "assistant.registerTool":
				return this.#registerTool(id, running, first);
			case "commands.register":
				if (
					typeof first !== "string" ||
					!running.manifest.commands.some((command) => command.id === first)
				) {
					throw new Error(`"${String(first)}" is not a command of the manifest.`);
				}
				running.commands.add(first);
				return null;
			case "process.spawn": {
				if (!running.granted.process)
					throw new Error(
						`The extension may not run programs: add "process": true to its permissions.`,
					);
				const contents = running.contents;
				return this.#processes.spawn(id, parseSpawnRequest(first), (process, event) => {
					if (!contents.isDestroyed()) contents.send(EXTENSION_CHANNEL.event, { process, event });
				});
			}
			case "process.kill":
				this.#processes.kill(id, String(first));
				return null;
			case "process.write":
				if (!running.granted.process) throw new Error("The extension may not run programs.");
				this.#processes.write(id, String(first), String(second ?? ""));
				return null;
			case "workspace.folders":
				if (!running.granted.files)
					throw new Error(`The extension may not see files: add "files": true to its permissions.`);
				return [...this.#options.workspaceFolders()];
			case "ui.pickPath":
				return this.#pickPath(first);
			case "ui.openExternal": {
				const url = typeof first === "string" ? first : "";
				if (!/^https?:\/\//i.test(url))
					throw new Error("Only http and https addresses can be opened.");
				await shell.openExternal(url);
				return null;
			}
			case "ui.setStatusItem":
				this.#setStatusItem(id, running, first, second);
				return null;
			case "ui.showMessage": {
				const parent = BrowserWindow.getFocusedWindow();
				const options = {
					message: running.manifest.name,
					detail: String(first ?? "").slice(0, 4000),
				};
				await (parent === null
					? dialog.showMessageBox(options)
					: dialog.showMessageBox(parent, options));
				return null;
			}
			case "ui.handle":
				if (typeof first !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(first)) {
					throw new Error(`Bad handler name: ${String(first)}`);
				}
				running.uiHandlers.add(first);
				return null;
			case "ui.showPane":
				if (
					typeof first !== "string" ||
					!running.manifest.panes.some((pane) => pane.id === first)
				) {
					throw new Error(`"${String(first)}" is not a pane of the manifest.`);
				}
				this.#options.showPane(id, first);
				return null;
			case "ui.post":
				this.#options.postToUi(id, first ?? null);
				return null;
			default:
				if (typeof method === "string" && method.startsWith("fs.")) {
					if (!running.granted.files) {
						throw new Error(
							`The extension may not read or write files: add "files": true to its permissions.`,
						);
					}
					return fileCall(method, args, this.#options.workspaceFolders()[0] ?? null);
				}
				break;
		}
		switch (method) {
			case "log":
				for (const line of Array.isArray(first) ? first : []) this.#append(id, String(line));
				return null;
			case "host.ready":
				running.status = "running";
				this.#append(id, "Started");
				this.#options.changed();
				return null;
			case "host.failed":
				this.#fail(id, String(first ?? "Unknown error"));
				return null;
			default:
				throw new Error(`Unknown call: ${String(method)}`);
		}
	}

	async #fetch(
		running: Running,
		rawUrl: unknown,
		rawInit: unknown,
	): Promise<ExtensionHttpResponse> {
		const request = parseHttpRequest(rawInit);
		let url = typeof rawUrl === "string" ? rawUrl : "";
		const values = await this.#options.store.settingsOf(running.manifest.id);
		const hosts = [
			...running.granted.http,
			...running.granted.httpFromSettings.flatMap((key) => hostOfSetting(values[key]) ?? []),
		];
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			if (!isAllowedUrl(url, hosts)) {
				throw new Error(
					`The extension may not reach ${url || "(no address)"}: add its host to "permissions.http".`,
				);
			}
			const response = await fetchTraced(url, {
				method: request.method,
				headers: request.headers,
				...(request.body === null ? {} : { body: request.body }),
				redirect: "manual",
				signal: AbortSignal.timeout(request.timeoutMs),
			});
			const location = response.headers.get("location");
			if (response.status >= 300 && response.status < 400 && location !== null) {
				await response.body?.cancel().catch(() => {});
				url = new URL(location, url).toString();
				continue;
			}
			const length = Number(response.headers.get("content-length") ?? 0);
			if (length > MAX_HTTP_RESPONSE) {
				await response.body?.cancel().catch(() => {});
				throw new Error("The answer is too large.");
			}
			const body = await response.text();
			return {
				ok: response.ok,
				status: response.status,
				statusText: response.statusText,
				url,
				headers: Object.fromEntries(response.headers.entries()),
				body: body.length > MAX_HTTP_RESPONSE ? body.slice(0, MAX_HTTP_RESPONSE) : body,
			};
		}
		throw new Error("Too many redirects.");
	}

	#registerTool(id: string, running: Running, raw: unknown): null {
		if (!running.granted.assistantTools) {
			throw new Error(
				`The extension may not give the assistant tools: add "assistantTools": true to its permissions.`,
			);
		}
		const spec = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ExtensionToolSpec>;
		const name = typeof spec.name === "string" ? spec.name : "";
		if (!isToolName(name))
			throw new Error(`Bad tool name: "${name}" (letters, digits, _ and -, at most 64).`);
		const known = toolNamed(name);
		if (known !== undefined && !running.tools.has(name)) {
			throw new Error(`There is already a tool named "${name}".`);
		}
		const description = typeof spec.description === "string" ? spec.description.slice(0, 4000) : "";
		if (description === "") throw new Error("A tool needs a description.");
		const parameters =
			typeof spec.parameters === "object" && spec.parameters !== null
				? (spec.parameters as KalemTool["definition"]["parameters"])
				: { type: "object" as const, properties: {}, required: [] };
		const writes = spec.writes === true;
		const extensionName = running.manifest.name;
		const tool: KalemTool = {
			definition: { name, description: `[${extensionName}] ${description}`, parameters },
			risk: writes ? "external" : "read",
			available: () => this.#running.get(id)?.status === "running",
			run: async (input, ctx) => {
				const current = this.#running.get(id);
				if (current === undefined) return `${extensionName} is not running.`;
				if (writes) {
					const answer = await ctx.approve({
						tool: name,
						risk: "external",
						permission: `extension:${id}`,
						title: format(ctx.t.extensionToolApproval, extensionName, name),
						lines: [],
						preview: JSON.stringify(input, null, 2).slice(0, 4000),
					});
					if (!answer.approved)
						return "The user did not allow it: nothing was done. Do not try again unless they ask.";
				}
				ctx.readExternal = true;
				ctx.step({ tool: name, detail: extensionName });
				const value = await this.#call(current, { kind: "tool", name, input }, TOOL_TIMEOUT);
				return typeof value === "string" ? value : JSON.stringify(value ?? null, null, 1);
			},
		};
		running.tools.add(name);
		registerTools([tool]);
		return null;
	}

	#call(
		running: Running,
		call: Omit<ExtensionCall, "id">,
		timeout: number | null,
	): Promise<unknown> {
		const { contents } = running;
		if (contents.isDestroyed()) return Promise.reject(new Error("The extension stopped."));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer =
				timeout === null
					? null
					: setTimeout(() => {
							this.#waiting.delete(id);
							reject(new Error("The extension did not answer in time."));
						}, timeout);
			this.#waiting.set(id, {
				owner: contents.id,
				resolve: (value) => {
					if (timer !== null) clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					if (timer !== null) clearTimeout(timer);
					reject(error);
				},
			});
			contents.send(EXTENSION_CHANNEL.call, { id, ...call } satisfies ExtensionCall);
		});
	}

	#result(sender: number, raw: unknown): void {
		const result = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const id = typeof result.id === "string" ? result.id : "";
		const waiting = this.#waiting.get(id);
		if (waiting === undefined || waiting.owner !== sender) return;
		this.#waiting.delete(id);
		if (result.ok === true) waiting.resolve(result.value);
		else
			waiting.reject(
				new Error(typeof result.error === "string" ? result.error.slice(0, 4000) : "Failed."),
			);
	}

	#rejectWaiting(owner: number, message: string): void {
		for (const [id, waiting] of this.#waiting) {
			if (waiting.owner !== owner) continue;
			this.#waiting.delete(id);
			waiting.reject(new Error(message));
		}
	}

	#fail(id: string, error: string): void {
		const running = this.#running.get(id);
		this.#append(id, `Failed: ${error}`);
		if (running === undefined) return;
		running.status = "failed";
		running.error = error.slice(0, 4000);
		unregisterTools([...running.tools]);
		running.tools.clear();
		this.#options.changed();
	}

	#append(id: string, line: string): void {
		const log = this.#logs.get(id) ?? [];
		log.push(`${new Date().toISOString().slice(11, 19)} ${line.slice(0, 2000)}`);
		if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
		this.#logs.set(id, log);
	}
}
