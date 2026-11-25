/** Requests as the client keeps them, and what they become on the wire. Pure. */

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const BODY_MODES = ["none", "json", "xml", "text", "form"];
export const AUTH_TYPES = ["none", "bearer", "basic", "apikey"];

let counter = 0;
export const newId = () =>
	`${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const rows = (value) =>
	Array.isArray(value)
		? value
				.filter((row) => row && typeof row === "object")
				.map((row) => ({
					key: String(row.key ?? ""),
					value: String(row.value ?? ""),
					on: row.on !== false,
				}))
		: [];

export function newRequest(partial = {}) {
	return normalize({ id: newId(), name: "", method: "GET", url: "", ...partial });
}

export function normalize(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	const body = source.body && typeof source.body === "object" ? source.body : {};
	const auth = source.auth && typeof source.auth === "object" ? source.auth : {};
	return {
		id: typeof source.id === "string" && source.id !== "" ? source.id : newId(),
		name: String(source.name ?? ""),
		// kalem-locale-ok: HTTP methods and header names are ASCII
		method: METHODS.includes(String(source.method).toUpperCase())
			? String(source.method).toUpperCase()
			: "GET",
		url: String(source.url ?? ""),
		headers: rows(source.headers),
		body: {
			mode: BODY_MODES.includes(body.mode) ? body.mode : "none",
			text: String(body.text ?? ""),
			form: rows(body.form),
		},
		auth: {
			type: AUTH_TYPES.includes(auth.type) ? auth.type : "none",
			token: String(auth.token ?? ""),
			username: String(auth.username ?? ""),
			password: String(auth.password ?? ""),
			key: String(auth.key ?? ""),
			value: String(auth.value ?? ""),
			in: auth.in === "query" ? "query" : "header",
		},
	};
}

/** `{{name}}` with the environment's value; an unknown name stays as it is. */
export function substitute(text, vars) {
	return String(text).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) =>
		Object.hasOwn(vars, name) ? vars[name] : match,
	);
}

export function variablesOf(environment) {
	const vars = {};
	for (const row of environment?.vars ?? [])
		if (row.on !== false && row.key !== "") vars[row.key] = row.value;
	return vars;
}

/** The URL's query as rows, and the URL with other rows as its query. */
export function paramsOf(url) {
	const at = url.indexOf("?");
	if (at === -1) return [];
	const query = url.slice(at + 1).split("#")[0];
	return query
		.split("&")
		.filter((part) => part !== "")
		.map((part) => {
			const equals = part.indexOf("=");
			const decode = (text) => {
				try {
					return decodeURIComponent(text.replace(/\+/g, " "));
				} catch {
					return text;
				}
			};
			return equals === -1
				? { key: decode(part), value: "", on: true }
				: { key: decode(part.slice(0, equals)), value: decode(part.slice(equals + 1)), on: true };
		});
}

export function withParams(url, params) {
	const base = url.split("?")[0];
	const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
	const query = params
		.filter((row) => row.on && row.key !== "")
		.map((row) => `${encodeQuery(row.key)}${row.value === "" ? "" : `=${encodeQuery(row.value)}`}`)
		.join("&");
	return `${base}${query === "" ? "" : `?${query}`}${hash}`;
}

const encodeQuery = (text) => encodeURIComponent(text).replace(/%7B/g, "{").replace(/%7D/g, "}");

const CONTENT_TYPES = {
	json: "application/json",
	xml: "application/xml",
	text: "text/plain",
	form: "application/x-www-form-urlencoded",
};

/** What is sent: the address, headers and body, with the environment's variables in. */
export function resolveRequest(request, vars) {
	const sub = (text) => substitute(text, vars);
	let url = sub(request.url.trim());
	if (url !== "" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
	const headers = {};
	for (const row of request.headers)
		if (row.on && row.key.trim() !== "") headers[sub(row.key.trim())] = sub(row.value);
	// kalem-locale-ok: HTTP methods and header names are ASCII
	const has = (name) =>
		Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
	const { auth } = request;
	if (auth.type === "bearer" && auth.token !== "")
		headers.Authorization = `Bearer ${sub(auth.token)}`;
	if (auth.type === "basic")
		headers.Authorization = `Basic ${toBase64(`${sub(auth.username)}:${sub(auth.password)}`)}`;
	if (auth.type === "apikey" && auth.key !== "") {
		if (auth.in === "query") {
			url = withParams(url, [
				...paramsOf(url),
				{ key: sub(auth.key), value: sub(auth.value), on: true },
			]);
		} else headers[sub(auth.key)] = sub(auth.value);
	}
	let body = null;
	if (request.method !== "GET" && request.method !== "HEAD" && request.body.mode !== "none") {
		body =
			request.body.mode === "form"
				? request.body.form
						.filter((row) => row.on && row.key !== "")
						.map(
							(row) => `${encodeURIComponent(sub(row.key))}=${encodeURIComponent(sub(row.value))}`,
						)
						.join("&")
				: sub(request.body.text);
		if (!has("content-type")) headers["Content-Type"] = CONTENT_TYPES[request.body.mode];
	}
	return { method: request.method, url, headers, body };
}

function toBase64(text) {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

const shellQuote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;

export function toCurl(resolved) {
	const parts = ["curl"];
	if (resolved.method !== "GET") parts.push("-X", resolved.method);
	parts.push(shellQuote(resolved.url));
	for (const [name, value] of Object.entries(resolved.headers))
		parts.push("\\\n  -H", shellQuote(`${name}: ${value}`));
	if (resolved.body !== null) parts.push("\\\n  --data-raw", shellQuote(resolved.body));
	return parts.join(" ");
}

export function statusKind(status) {
	if (status >= 200 && status < 300) return "ok";
	if (status >= 300 && status < 400) return "info";
	if (status >= 400 && status < 500) return "warn";
	return "error";
}
