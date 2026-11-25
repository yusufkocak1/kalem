/** Jenkins' parameter definitions as QuickPipeline keeps them, and job paths. Pure. */

export function classifyParam(rawClass, hasChoices) {
	// kalem-locale-ok: Jenkins class names are ASCII
	const name = rawClass.toLowerCase();
	if (name.includes("booleanparameter")) return "boolean";
	if (name.includes("passwordparameter") || name.includes("credentialsparameter"))
		return "password";
	if (name.includes("textparameter")) return "text";
	if (name.includes("choiceparameter")) return hasChoices ? "choice" : "unknown";
	if (name.includes("stringparameter")) return "string";
	if (name.includes("choice") || name.includes("cascade") || name.includes("dynamic"))
		return hasChoices ? "choice" : "unknown";
	return hasChoices ? "choice" : "unknown";
}

function normalizeChoices(raw) {
	if (Array.isArray(raw)) return raw.map(String);
	if (raw && typeof raw === "object") {
		const values = Object.values(raw);
		if (values.length > 0) return values.map(String);
	}
	if (typeof raw === "string" && raw.trim())
		return raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
	return undefined;
}

export function mapParameterDefinitions(properties) {
	if (!Array.isArray(properties)) return [];
	const out = [];
	for (const property of properties) {
		if (!Array.isArray(property?.parameterDefinitions)) continue;
		for (const raw of property.parameterDefinitions) {
			if (!raw?.name) continue;
			const rawClass = raw._class || raw.type || "";
			const choices = normalizeChoices(raw.choices);
			const type = classifyParam(rawClass, Boolean(choices?.length));
			const def = { name: raw.name, type, rawClass };
			if (raw.description) def.description = stripHtml(raw.description);
			const value = raw.defaultParameterValue?.value;
			if (value !== undefined && value !== null && type !== "password" && typeof value !== "object")
				def.defaultValue = String(value);
			if (choices?.length) def.choices = choices;
			out.push(def);
		}
	}
	return out;
}

export function stripHtml(html) {
	return String(html)
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_match, href, text) =>
			text && text !== href ? `${text} (${href})` : href,
		)
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.trim();
}

const safeDecode = (text) => {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
};

/** A job's address, or a short path, as `job/A/job/B`. */
export function parseJobPath(input, baseUrl = "") {
	let path = String(input).trim();
	if (!path) throw new Error("The job path is empty.");
	const base = baseUrl.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(path)) {
		// kalem-locale-ok: URLs are compared as ASCII
		if (base && path.toLowerCase().startsWith(base.toLowerCase())) path = path.slice(base.length);
		else {
			path = new URL(path).pathname;
			const basePath = base ? new URL(base).pathname.replace(/\/+$/, "") : "";
			// kalem-locale-ok: URLs are compared as ASCII
			if (basePath && path.toLowerCase().startsWith(basePath.toLowerCase()))
				path = path.slice(basePath.length);
		}
	}
	path = path
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/(build|buildWithParameters|configure|api(\/json)?|lastBuild|\d+)$/i, "");
	const parts = path
		.replace(/^\/+|\/+$/g, "")
		.split("/")
		.filter(Boolean);
	if (parts.length === 0) throw new Error("The job path could not be read.");
	const names = [];
	if (parts.includes("job")) {
		for (let i = 0; i < parts.length; i++)
			if (parts[i] === "job" && parts[i + 1]) names.push(parts[++i]);
	} else names.push(...parts);
	if (names.length === 0) throw new Error("The job path could not be read.");
	return names.map((name) => `job/${encodeURIComponent(safeDecode(name))}`).join("/");
}

/** `job/A/job/B` → `A / B`. */
export const jobLabel = (jobPath) =>
	String(jobPath)
		.split("/")
		.filter((_part, index) => index % 2 === 1)
		.map(safeDecode)
		.join(" / ");
