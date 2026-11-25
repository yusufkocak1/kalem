/**
 * The proxy the app's requests go through: the system's, none, or one the
 * user names. Pure: the main process hands the result to Chromium and to the
 * programs it starts (the assistant's CLIs, MCP servers, git).
 */

export type ProxyMode = "system" | "direct" | "manual";

export const PROXY_MODES: readonly ProxyMode[] = ["system", "direct", "manual"];

export interface ProxySettings {
	readonly proxyMode: ProxyMode;
	readonly proxyServer: string;
	readonly proxyBypass: string;
}

export interface ProxyCredentials {
	readonly username: string;
	readonly password: string;
}

/** What Chromium takes (`session.setProxy`). */
export interface ChromiumProxy {
	readonly mode: "system" | "direct" | "fixed_servers";
	readonly proxyRules?: string;
	readonly proxyBypassRules?: string;
}

const SCHEMES = ["http", "https", "socks4", "socks5"] as const;

/**
 * "proxy.corp:8080", "http://proxy.corp:8080/" or "socks5://10.0.0.1:1080"
 * as `scheme://host:port`; `null` for what is not an address.
 */
export function normalizeProxyServer(raw: string): string | null {
	const text = raw.trim();
	if (text === "") return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	const scheme = url.protocol.slice(0, -1);
	if (!(SCHEMES as readonly string[]).includes(scheme)) return null;
	if (url.hostname === "" || url.username !== "" || url.password !== "") return null;
	if (url.pathname !== "/" && url.pathname !== "") return null;
	if (url.search !== "" || url.hash !== "") return null;
	const port = url.port === "" ? defaultPort(scheme) : url.port;
	return `${scheme}://${url.hostname}:${port}`;
}

function defaultPort(scheme: string): string {
	if (scheme === "https") return "443";
	if (scheme.startsWith("socks")) return "1080";
	return "80";
}

/** The hosts that skip the proxy, one by one: separated by commas, semicolons, spaces or lines. */
export const bypassList = (raw: string): string[] => [
	...new Set(
		raw
			.split(/[\s,;]+/)
			.map((each) => each.trim())
			.filter((each) => each !== ""),
	),
];

/** Chromium's setting; a manual proxy without a valid address falls back to the system's. */
export function chromiumProxy(settings: ProxySettings): ChromiumProxy {
	if (settings.proxyMode === "direct") return { mode: "direct" };
	if (settings.proxyMode === "system") return { mode: "system" };
	const server = normalizeProxyServer(settings.proxyServer);
	if (server === null) return { mode: "system" };
	// The computer itself is never reached through the proxy.
	const bypass = [...bypassList(settings.proxyBypass), "<local>"];
	return {
		mode: "fixed_servers",
		proxyRules: server,
		proxyBypassRules: [...new Set(bypass)].join(","),
	};
}

export const PROXY_ENV_NAMES = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"all_proxy",
	"no_proxy",
] as const;

export type ProxyEnvName = (typeof PROXY_ENV_NAMES)[number];

/**
 * The variables the programs the app starts read: set for a manual proxy,
 * removed for none, left as the system has them otherwise (`undefined`).
 * A value of `null` removes the variable.
 */
export function proxyEnv(
	settings: ProxySettings,
	credentials: ProxyCredentials | null,
): Partial<Record<ProxyEnvName, string | null>> | undefined {
	if (settings.proxyMode === "system") return undefined;
	if (settings.proxyMode === "direct") {
		return Object.fromEntries(PROXY_ENV_NAMES.map((name) => [name, null]));
	}
	const server = normalizeProxyServer(settings.proxyServer);
	if (server === null) return undefined;
	const url = new URL(server);
	if (credentials !== null && credentials.username !== "") {
		url.username = encodeURIComponent(credentials.username);
		url.password = encodeURIComponent(credentials.password);
	}
	const address = url.toString().replace(/\/$/, "");
	const noProxy = [
		...new Set([
			"localhost",
			"127.0.0.1",
			"::1",
			...bypassList(settings.proxyBypass)
				.filter((each) => each !== "<local>")
				.map((each) => each.replace(/^\*\./, ".")),
		]),
	].join(",");
	const socks = url.protocol.startsWith("socks");
	return {
		HTTP_PROXY: socks ? null : address,
		HTTPS_PROXY: socks ? null : address,
		ALL_PROXY: address,
		NO_PROXY: noProxy,
		http_proxy: socks ? null : address,
		https_proxy: socks ? null : address,
		all_proxy: address,
		no_proxy: noProxy,
	};
}
