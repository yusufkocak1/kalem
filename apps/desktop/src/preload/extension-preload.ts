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

const api = {
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
