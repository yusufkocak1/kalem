/** What goes between an extension's host window and the main process. */

export const EXTENSION_CHANNEL = {
	request: "kalem-ext:request",
	call: "kalem-ext:call",
	result: "kalem-ext:result",
	event: "kalem-ext:event",
} as const;

export interface ExtensionCall {
	readonly id: string;
	readonly kind: "command" | "tool" | "ui";
	readonly name: string;
	readonly input: unknown;
}

export interface ExtensionToolSpec {
	readonly name: string;
	readonly description: string;
	readonly parameters?: unknown;
	/** It changes something outside Kalem: the user is asked before each call. */
	readonly writes?: boolean;
}

export interface ExtensionHttpRequest {
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string | null;
	readonly timeoutMs: number;
}

export interface ExtensionHttpResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly statusText: string;
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

export const MAX_HTTP_RESPONSE = 10 * 1024 * 1024;
export const DEFAULT_HTTP_TIMEOUT = 60_000;
export const MAX_HTTP_TIMEOUT = 300_000;
export const MAX_REDIRECTS = 5;

const FORBIDDEN_HEADERS = new Set(["host", "cookie", "proxy-authorization", "content-length"]);

export function parseHttpRequest(raw: unknown): ExtensionHttpRequest {
	const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	// kalem-locale-ok: ASCII protocol values
	const method = typeof source.method === "string" ? source.method.toUpperCase() : "GET";
	if (!/^[A-Z]{3,7}$/.test(method)) throw new Error(`Bad method: ${method}`);
	const headers: Record<string, string> = {};
	const given = typeof source.headers === "object" && source.headers !== null ? source.headers : {};
	for (const [name, value] of Object.entries(given)) {
		if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(name)) continue;
		// kalem-locale-ok: ASCII protocol values
		if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
		headers[name] = value;
	}
	const body =
		source.body === undefined || source.body === null
			? null
			: typeof source.body === "string"
				? source.body
				: JSON.stringify(source.body);
	const timeout =
		typeof source.timeoutMs === "number" && Number.isFinite(source.timeoutMs)
			? source.timeoutMs
			: DEFAULT_HTTP_TIMEOUT;
	return { method, headers, body, timeoutMs: Math.min(Math.max(timeout, 1000), MAX_HTTP_TIMEOUT) };
}

/** The file a host window starts with: it loads the extension's host code and calls `activate`. */
export function hostStartScript(hostPath: string): string {
	return `try {
	const extension = await import(${JSON.stringify(`/${hostPath}`)});
	if (typeof extension.activate !== "function") throw new Error("The host file exports no activate(kalem) function.");
	await extension.activate(window.kalem);
	await window.kalem._ready();
} catch (error) {
	await window.kalem._failed(error);
}
`;
}

export const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>host</title><script type="module" src="/__kalem/start.js"></script>`;

export const EXTENSION_CSP =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	html: "text/html; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	json: "application/json; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	woff: "font/woff",
	woff2: "font/woff2",
	txt: "text/plain; charset=utf-8",
};

export function contentTypeOf(path: string): string {
	const dot = path.lastIndexOf(".");
	return (
		// kalem-locale-ok: ASCII protocol values
		CONTENT_TYPES[dot === -1 ? "" : path.slice(dot + 1).toLowerCase()] ?? "application/octet-stream"
	);
}

/** The script an extension's pane loads as `/__kalem/ui.js`: `window.kalem` talks to its host code through Kalem. */
export const UI_SCRIPT = `(() => {
	const pending = new Map();
	const listeners = [];
	const settingsListeners = [];
	let next = 0;
	const params = new URLSearchParams(location.search);
	window.addEventListener("message", (event) => {
		if (event.source !== window.parent) return;
		const data = event.data;
		if (data === null || typeof data !== "object") return;
		if (data.kalem === "reply") {
			const waiting = pending.get(data.id);
			if (waiting === undefined) return;
			pending.delete(data.id);
			if (data.ok) waiting.resolve(data.value);
			else waiting.reject(new Error(data.error));
		} else if (data.kalem === "message") {
			for (const listener of listeners) listener(data.data);
		} else if (data.kalem === "settings") {
			for (const listener of settingsListeners) listener();
		} else if (data.kalem === "theme") {
			for (const [name, value] of Object.entries(data.vars)) document.documentElement.style.setProperty(name, value);
			document.documentElement.dataset.theme = data.dark ? "dark" : "light";
		}
	});
	window.kalem = {
		pane: params.get("pane"),
		language: params.get("lang") || "en",
		call(name, input) {
			return new Promise((resolve, reject) => {
				const id = ++next;
				pending.set(id, { resolve, reject });
				window.parent.postMessage({ kalem: "call", id, name, input: input ?? null }, "*");
			});
		},
		onMessage(listener) {
			listeners.push(listener);
		},
		onSettingsChanged(listener) {
			settingsListeners.push(listener);
		},
	};
	window.parent.postMessage({ kalem: "ready" }, "*");
})();
`;

/** `/__kalem/ui.css`: the app's look for a pane, from the colours Kalem sends. */
export const UI_STYLE = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { padding: 10px; background: var(--app-surface, #fff); color: var(--app-text, #222); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--app-accent, #0b5); }
input, select, textarea, button { font: inherit; color: inherit; }
input, select, textarea { padding: 5px 8px; border: 1px solid var(--app-border, #ccc); border-radius: 6px; background: var(--app-raised, #fff); }
input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--app-accent, #0b5); outline-offset: 1px; }
button { padding: 5px 12px; border: 1px solid var(--app-border, #ccc); border-radius: 6px; background: var(--app-surface, #fff); cursor: pointer; }
button:hover { background: var(--app-hover, #eee); }
button.primary { border-color: var(--app-accent, #0b5); background: var(--app-accent, #0b5); color: var(--app-accent-text, #fff); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 4px 6px; border-bottom: 1px solid var(--app-border, #ddd); text-align: left; vertical-align: top; }
th { color: var(--app-muted, #666); font-weight: 600; }
.muted { color: var(--app-muted, #666); }
.error { color: var(--app-error, #c00); }
code, pre, .mono { font-family: var(--app-mono, ui-monospace, monospace); font-size: 12px; }
`;
