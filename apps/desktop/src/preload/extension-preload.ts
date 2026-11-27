/**
 * The `kalem` object an extension's host code gets in `activate(kalem)`.
 * Every call goes to the main process, which knows which extension asks
 * by the window it comes from and checks it against its permissions.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { ExtensionCall, ExtensionToolSpec } from "../shared/extension-api.js";
import { EXTENSION_CHANNEL } from "../shared/extension-api.js";

type Handler = (input: unknown) => unknown;

const commands = new Map<string, Handler>();
const tools = new Map<string, Handler>();
const uiHandlers = new Map<string, Handler>();
const processListeners = new Map<string, (event: unknown) => void>();
/** Events of a program that came before `spawn` told its id: given to its listener once there is one. */
const earlyEvents = new Map<string, { type: string }[]>();
const knownProcesses = new Set<string>();

const invoke = (method: string, ...args: unknown[]): Promise<unknown> =>
	ipcRenderer.invoke(EXTENSION_CHANNEL.request, method, args).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
	});

const describe = (error: unknown): string =>
	error instanceof Error ? (error.stack ?? error.message) : String(error);

ipcRenderer.on(EXTENSION_CHANNEL.call, async (_event, call: ExtensionCall) => {
	const handler = (
		call.kind === "command" ? commands : call.kind === "tool" ? tools : uiHandlers
	).get(call.name);
	try {
		if (handler === undefined)
			throw new Error(`Nothing is registered as ${call.kind} "${call.name}".`);
		const value = await handler(call.input);
		ipcRenderer.send(EXTENSION_CHANNEL.result, { id: call.id, ok: true, value: value ?? null });
	} catch (error) {
		ipcRenderer.send(EXTENSION_CHANNEL.result, { id: call.id, ok: false, error: describe(error) });
	}
});

ipcRenderer.on(
	EXTENSION_CHANNEL.event,
	(_event, message: { process: string; event: { type: string } }) => {
		const listener = processListeners.get(message.process);
		if (listener === undefined && !knownProcesses.has(message.process)) {
			const early = earlyEvents.get(message.process) ?? [];
			early.push(message.event);
			earlyEvents.set(message.process, early);
			return;
		}
		if (message.event.type === "exit" || message.event.type === "error") {
			processListeners.delete(message.process);
			knownProcesses.delete(message.process);
		}
		try {
			listener?.(message.event);
		} catch (error) {
			void invoke("log", [`Process listener: ${describe(error)}`]);
		}
	},
);

const fsCall =
	(method: string) =>
	(...args: unknown[]) =>
		invoke(`fs.${method}`, ...args);

const api = {
	platform: process.platform,
	language: new URLSearchParams(location.search).get("lang") ?? "en",
	process: {
		spawn: async (request: unknown, listener?: (event: unknown) => void) => {
			const id = (await invoke("process.spawn", request)) as string;
			const early = earlyEvents.get(id) ?? [];
			earlyEvents.delete(id);
			const ended = early.some((event) => event.type === "exit" || event.type === "error");
			if (typeof listener === "function" && !ended) processListeners.set(id, listener);
			if (!ended) knownProcesses.add(id);
			for (const event of early) {
				try {
					if (typeof listener === "function") listener(event);
				} catch (error) {
					void invoke("log", [`Process listener: ${describe(error)}`]);
				}
			}
			return id;
		},
		kill: (id: string) => invoke("process.kill", id),
		write: (id: string, text: string) => invoke("process.write", id, text),
	},
	fs: {
		readText: fsCall("readText"),
		readRange: fsCall("readRange"),
		writeText: fsCall("writeText"),
		exists: fsCall("exists"),
		stat: fsCall("stat"),
		list: fsCall("list"),
		mkdir: fsCall("mkdir"),
		copy: fsCall("copy"),
		resolve: fsCall("resolve"),
	},
	storage: {
		get: (key: string) => invoke("storage.get", key),
		set: (key: string, value: unknown) => invoke("storage.set", key, value),
		remove: (key: string) => invoke("storage.set", key, null),
		keys: () => invoke("storage.keys"),
	},
	workspace: {
		folders: () => invoke("workspace.folders"),
		addFolder: (folder: string) => invoke("workspace.addFolder", folder),
	},
	settings: {
		get: (key: string) => invoke("settings.get", key),
		all: () => invoke("settings.all"),
	},
	secrets: {
		get: (key: string) => invoke("secrets.get", key),
	},
	http: {
		fetch: (url: string, init?: unknown) => invoke("http.fetch", url, init ?? {}),
	},
	assistant: {
		complete: (system: string, prompt: string) => invoke("assistant.complete", system, prompt),
		registerTool: async (spec: ExtensionToolSpec, run: Handler) => {
			if (typeof run !== "function")
				throw new Error("registerTool needs a function to run the tool.");
			await invoke("assistant.registerTool", spec);
			tools.set(spec.name, run);
		},
	},
	commands: {
		register: async (id: string, run: Handler) => {
			if (typeof run !== "function")
				throw new Error("register needs a function to run the command.");
			await invoke("commands.register", id);
			commands.set(id, run);
		},
	},
	ui: {
		showMessage: (message: string) => invoke("ui.showMessage", message),
		handle: async (name: string, run: Handler) => {
			if (typeof run !== "function") throw new Error("handle needs a function.");
			await invoke("ui.handle", name);
			uiHandlers.set(name, run);
		},
		post: (message: unknown) => invoke("ui.post", message),
		showPane: (pane: string) => invoke("ui.showPane", pane),
		openEditor: (editor: string, options?: unknown) =>
			invoke("ui.openEditor", editor, options ?? {}),
		closeEditor: (key: string) => invoke("ui.closeEditor", key),
		pickPath: (options?: unknown) => invoke("ui.pickPath", options ?? {}),
		openExternal: (url: string) => invoke("ui.openExternal", url),
		setStatusItem: (key: string, item: unknown) => invoke("ui.setStatusItem", key, item ?? null),
	},
	log: (...values: unknown[]) =>
		invoke(
			"log",
			values.map((value) => (typeof value === "string" ? value : describe(value))),
		),
	_ready: () => invoke("host.ready"),
	_failed: (error: unknown) => invoke("host.failed", describe(error)),
};

contextBridge.exposeInMainWorld("kalem", api);

window.addEventListener(
	"error",
	(event) => void invoke("log", [`Uncaught: ${describe(event.error ?? event.message)}`]),
);
window.addEventListener(
	"unhandledrejection",
	(event) => void invoke("log", [`Unhandled: ${describe(event.reason)}`]),
);
