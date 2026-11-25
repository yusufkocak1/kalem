/**
 * The network log of the hidden debug mode: what the main process asked of
 * Jira, Confluence, the assistant's service, MCP servers and GitHub, as a
 * browser's Network tab shows it. Secrets are masked when a request is
 * recorded, so they are never kept, shown, copied or exported.
 */

/** Who made the request. */
export const NETWORK_SOURCES = [
	"jira",
	"confluence",
	"assistant",
	"mcp",
	"updates",
	"extensions",
] as const;
export type NetworkSource = (typeof NETWORK_SOURCES)[number];

export type NetworkState = "pending" | "done" | "failed" | "aborted";

export interface NetworkHeader {
	readonly name: string;
	readonly value: string;
}

/** A request's or a response's body as it was kept. */
export interface NetworkBody {
	/** `null` when it was not text (an image, a file) or could not be read. */
	readonly text: string | null;
	/** In bytes; `null` when unknown. */
	readonly size: number | null;
	/** Only the first `MAX_BODY_BYTES` were kept. */
	readonly truncated: boolean;
	/** What the body was, when it is not kept as text: "FormData", "stream", "image/png"… */
	readonly kind?: string;
}

/** One row of the log. */
export interface NetworkSummary {
	readonly id: number;
	readonly source: NetworkSource;
	readonly method: string;
	readonly url: string;
	/** `null` until the response's headers come, and when it failed before them. */
	readonly status: number | null;
	readonly statusText: string;
	readonly state: NetworkState;
	readonly error?: string;
	/** When it was sent (ms since the epoch). */
	readonly started: number;
	/** Until the response's headers (ms). */
	readonly waiting: number | null;
	/** Until the whole response was read (ms). */
	readonly duration: number | null;
	/** The response's size in bytes, when known. */
	readonly size: number | null;
	readonly mimeType: string;
}

/** A row with all that was kept of it, for the details. */
export interface NetworkEntry extends NetworkSummary {
	/** The address the answer came from, when a redirect was followed. */
	readonly finalUrl?: string;
	readonly requestHeaders: readonly NetworkHeader[];
	readonly responseHeaders: readonly NetworkHeader[];
	readonly requestBody: NetworkBody | null;
	readonly responseBody: NetworkBody | null;
}

export interface NetworkLogState {
	readonly recording: boolean;
	readonly entries: readonly NetworkSummary[];
}

/**
 * What the panel hears: one row came or changed (`first` is the oldest row
 * still kept), or the whole log did: cleared, paused, debug mode turned off.
 */
export type NetworkEvent =
	| { readonly type: "entry"; readonly entry: NetworkSummary; readonly first: number }
	| { readonly type: "state"; readonly state: NetworkLogState };

/** A body is kept up to this many bytes. */
export const MAX_BODY_BYTES = 256 * 1024;
/** The log keeps the newest this many requests… */
export const MAX_ENTRIES = 500;
/** …and no more than this much body text in all. */
export const MAX_LOG_BYTES = 24 * 1024 * 1024;

export const MASK = "••••••";

/** Header names whose values are credentials. */
const SECRET_HEADERS = new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"api-key",
	"x-goog-api-key",
]);
/** These say "token" or "auth" but carry nothing secret, and they help to debug. */
const PLAIN_HEADERS = new Set(["x-atlassian-token", "www-authenticate"]);
const SECRET_WORDS = /auth|token|secret|passw|api[-_]?key|cookie|session/i;

/** JSON and form fields that hold credentials. Not `key`: every Jira issue has one. */
const SECRET_FIELD =
	/^(?:.*[-_])?(?:token|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key|secret|client[-_]?secret|password|passwd)$/i;
/** Query parameters that hold credentials: the same, and Google's `key` and signed URLs' `sig`. */
const SECRET_QUERY = /^(?:key|sig|signature|x-amz-signature|x-amz-credential)$/i;

function isSecretQuery(name: string): boolean {
	return SECRET_FIELD.test(name) || SECRET_QUERY.test(name);
}

/** Whether a header's value is a credential. MCP servers' own headers are guessed by name. */
export function isSecretHeader(name: string): boolean {
	// kalem-locale-ok: HTTP header names are ASCII
	const lower = name.toLowerCase();
	if (PLAIN_HEADERS.has(lower)) return false;
	return SECRET_HEADERS.has(lower) || SECRET_WORDS.test(lower);
}

/** The header as it is kept: a credential's scheme stays ("Bearer ••••••"), the rest is masked. */
export function maskHeader(header: NetworkHeader): NetworkHeader {
	if (!isSecretHeader(header.name) || header.value === "") return header;
	const scheme = /^(Basic|Bearer|Token|Digest|Negotiate|NTLM|ApiKey|Key)\s+\S/i.exec(header.value);
	return { name: header.name, value: scheme === null ? MASK : `${scheme[1]} ${MASK}` };
}

export function maskHeaders(headers: readonly NetworkHeader[]): NetworkHeader[] {
	return headers.map(maskHeader);
}

/** `a=1&token=x` with the values of the secret names masked; the rest as it was written. */
function maskPairs(query: string, secret: (name: string) => boolean): string {
	return query
		.split("&")
		.map((pair) => {
			const equals = pair.indexOf("=");
			if (equals === -1) return pair;
			const name = decodeURIComponentSafe(pair.slice(0, equals).replace(/\+/g, " "));
			return secret(name) ? `${pair.slice(0, equals)}=${MASK}` : pair;
		})
		.join("&");
}

/** The address with credentials in its query string or its user part masked; nothing else changes. */
export function maskUrl(raw: string): string {
	const hashAt = raw.indexOf("#");
	const hash = hashAt === -1 ? "" : raw.slice(hashAt);
	const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
	const queryAt = beforeHash.indexOf("?");
	const base = (queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)).replace(
		/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i,
		`$1${MASK}@`,
	);
	if (queryAt === -1) return `${base}${hash}`;
	return `${base}?${maskPairs(beforeHash.slice(queryAt + 1), isSecretQuery)}${hash}`;
}

function maskValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(maskValue);
	if (typeof value !== "object" || value === null) return value;
	const masked: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		masked[key] =
			SECRET_FIELD.test(key) && (typeof item === "string" || typeof item === "number")
				? MASK
				: maskValue(item);
	}
	return masked;
}

/**
 * A body with the credentials in it masked: the fields of a JSON body named
 * `token`, `api_key`, `password`… and the same names in a form. Other text
 * is kept as it is.
 */
export function maskBody(text: string, mimeType: string): string {
	const type = baseType(mimeType);
	if (type === "application/x-www-form-urlencoded") {
		return maskPairs(text, (name) => SECRET_FIELD.test(name));
	}
	const trimmed = text.trimStart();
	if (!(type.endsWith("json") || trimmed.startsWith("{") || trimmed.startsWith("["))) return text;
	try {
		const parsed: unknown = JSON.parse(text);
		const masked = maskValue(parsed);
		return JSON.stringify(masked) === JSON.stringify(parsed) ? text : JSON.stringify(masked);
	} catch {
		return text;
	}
}

/** "application/json; charset=utf-8" → "application/json". */
export function baseType(mimeType: string): string {
	// kalem-locale-ok: MIME types are ASCII
	return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

/** Whether a body of this type is read as text and kept. */
export function isTextType(mimeType: string): boolean {
	const type = baseType(mimeType);
	if (type === "") return false;
	return (
		type.startsWith("text/") ||
		type.endsWith("+json") ||
		type.endsWith("+xml") ||
		[
			"application/json",
			"application/xml",
			"application/javascript",
			"application/x-www-form-urlencoded",
			"application/x-yaml",
			"application/yaml",
			"application/graphql",
			"application/x-ndjson",
		].includes(type)
	);
}

/** "12 B", "4.2 kB", "1.3 MB". */
export function formatBytes(bytes: number | null): string {
	if (bytes === null) return "—";
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "84 ms", "1.24 s", "2.1 min". */
export function formatDuration(ms: number | null): string {
	if (ms === null) return "—";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
	return `${(ms / 60_000).toFixed(1)} min`;
}

/** The row's name, as the Network tab shows it: the last part of the path and the query. */
export function shortName(raw: string): string {
	try {
		const url = new URL(raw);
		const parts = url.pathname.split("/").filter((part) => part !== "");
		const last = parts.at(-1);
		return `${last === undefined ? url.host : decodeURIComponentSafe(last)}${url.search}`;
	} catch {
		return raw;
	}
}

function decodeURIComponentSafe(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/** JSON indented, anything else as it is. */
export function prettyBody(text: string, mimeType: string): string {
	const type = baseType(mimeType);
	const trimmed = text.trimStart();
	if (!(type.endsWith("json") || trimmed.startsWith("{") || trimmed.startsWith("["))) return text;
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

/** Whether the row matches the filter box: words in its address, method, status or source. */
export function matchesFilter(entry: NetworkSummary, filter: string): boolean {
	// kalem-locale-ok: addresses and methods are ASCII; the filter is folded the same way
	const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	// kalem-locale-ok: as above
	const haystack = [entry.method, entry.url, String(entry.status ?? ""), entry.source, entry.state]
		.join(" ")
		.toLowerCase();
	return words.every((word) =>
		word.startsWith("-") && word.length > 1
			? !haystack.includes(word.slice(1))
			: haystack.includes(word),
	);
}

function shellQuote(text: string): string {
	return `'${text.replace(/'/g, "'\\''")}'`;
}

/**
 * The request as a curl command, to run it again in a terminal. Masked
 * credentials stay masked: whoever runs it puts their own back.
 */
export function curlCommand(entry: NetworkEntry): string {
	const lines = [`curl ${shellQuote(entry.url)}`];
	if (entry.method !== "GET") lines.push(`-X ${entry.method}`);
	for (const header of entry.requestHeaders) {
		lines.push(`-H ${shellQuote(`${header.name}: ${header.value}`)}`);
	}
	const body = entry.requestBody;
	if (body !== null && body.text !== null) lines.push(`--data-raw ${shellQuote(body.text)}`);
	return lines.join(" \\\n  ");
}

interface HarCreator {
	readonly name: string;
	readonly version: string;
}

/** The entries as a HAR file (HTTP Archive 1.2), which browsers' Network tabs open. */
export function harLog(entries: readonly NetworkEntry[], creator: HarCreator): unknown {
	return {
		log: {
			version: "1.2",
			creator,
			pages: [],
			entries: entries.map((entry) => {
				const query = (() => {
					try {
						return [...new URL(entry.url).searchParams].map(([name, value]) => ({ name, value }));
					} catch {
						return [];
					}
				})();
				const requestType =
					entry.requestHeaders.find((header) => header.name === "content-type")?.value ?? "";
				const responseText = entry.responseBody?.text ?? null;
				return {
					startedDateTime: new Date(entry.started).toISOString(),
					time: entry.duration ?? entry.waiting ?? 0,
					request: {
						method: entry.method,
						url: entry.url,
						httpVersion: "HTTP/1.1",
						cookies: [],
						headers: entry.requestHeaders,
						queryString: query,
						...(entry.requestBody?.text == null
							? {}
							: { postData: { mimeType: requestType, text: entry.requestBody.text } }),
						headersSize: -1,
						bodySize: entry.requestBody?.size ?? 0,
					},
					response: {
						status: entry.status ?? 0,
						statusText: entry.statusText,
						httpVersion: "HTTP/1.1",
						cookies: [],
						headers: entry.responseHeaders,
						content: {
							size: entry.size ?? -1,
							mimeType: entry.mimeType,
							...(responseText === null ? {} : { text: responseText }),
							...(entry.responseBody?.truncated === true
								? { comment: `truncated to ${MAX_BODY_BYTES} bytes` }
								: {}),
						},
						redirectURL: entry.finalUrl ?? "",
						headersSize: -1,
						bodySize: entry.size ?? -1,
						...(entry.error === undefined ? {} : { _error: entry.error }),
					},
					cache: {},
					timings: {
						send: 0,
						wait: entry.waiting ?? -1,
						receive:
							entry.duration !== null && entry.waiting !== null
								? Math.max(0, entry.duration - entry.waiting)
								: -1,
					},
					_source: entry.source,
				};
			}),
		},
	};
}
