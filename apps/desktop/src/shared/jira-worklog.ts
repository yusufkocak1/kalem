/**
 * Logging work on a Jira issue: the time as people write it ("2h",
 * "1h 30m", "1,5"), Tempo Timesheets' work attributes ("Servis",
 * "Faturalandırılacak Şirket"…) and the requests that log it, through Tempo
 * where it is installed and through Jira's own work log elsewhere. Pure:
 * the main process sends the requests.
 */

/** The hours a quick button logs: Fibonacci, as efforts are estimated. */
export const QUICK_HOURS = [1, 2, 3, 5, 8] as const;

/** Hours in a working day, as Jira counts "1d" by default. */
const DAY_HOURS = 8;

/**
 * Seconds of "2h", "1h 30m", "90m", "1d", "1.5" or "1,5" (bare numbers
 * are hours); `null` when the text is not a duration or is zero.
 */
export function parseDuration(text: string): number | null {
	const value = text.trim().replace(",", ".");
	if (value === "") return null;
	if (/^\d+(\.\d+)?$/.test(value)) {
		const seconds = Math.round(Number(value) * 3600);
		return seconds > 0 ? seconds : null;
	}
	const units: Record<string, number> = { d: DAY_HOURS * 3600, h: 3600, m: 60 };
	let seconds = 0;
	let rest = value;
	// A unit's letter, in English or Turkish (g: gün, s: saat, dk: dakika).
	const part = /^(\d+(?:\.\d+)?)\s*(dk|d|g|h|s|m)(?![a-zçğıöşü])\s*/i;
	while (rest !== "") {
		const found = part.exec(rest);
		if (found === null) return null;
		const unit = (found[2] as string).toLocaleLowerCase("en");
		const size = units[unit === "g" ? "d" : unit === "s" ? "h" : unit === "dk" ? "m" : unit] ?? 0;
		seconds += Number(found[1]) * size;
		rest = rest.slice(found[0].length);
	}
	seconds = Math.round(seconds);
	return seconds > 0 ? seconds : null;
}

/** Seconds as Jira writes them: "8h", "1h 30m", "45m", "0h". */
export function formatDuration(seconds: number): string {
	const minutes = Math.max(0, Math.round(seconds / 60));
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0 && rest === 0) return "0h";
	return [hours > 0 ? `${hours}h` : "", rest > 0 ? `${rest}m` : ""].filter(Boolean).join(" ");
}

/**
 * An answer's JSON, also when it comes wrapped as JSONP (`callback([...])`,
 * as a ScriptRunner endpoint for Tempo's drop-downs answers); `null` for
 * an empty answer. Throws when it is neither.
 */
export function parseJsonOrJsonp(text: string): unknown {
	const body = text.trim();
	if (body === "") return null;
	try {
		return JSON.parse(body);
	} catch (error) {
		const wrapped = /^(?:\/\*\*\/\s*)?[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(body);
		if (wrapped === null) throw error;
		return JSON.parse(wrapped[1] as string);
	}
}

/** The kinds of Tempo work attribute Kalem asks for; others are typed as text. */
export type WorkAttributeKind = "list" | "text" | "number" | "checkbox";

export interface WorkAttributeOption {
	readonly value: string;
	readonly name: string;
}

/** A field Tempo asks for with each work log, as its administrators set it up. */
export interface WorkAttribute {
	readonly id: number;
	/** Tempo's key, as `_Servis_`. */
	readonly key: string;
	readonly name: string;
	/** Tempo's own type, as it is sent back with a log: `ACCOUNT`, `DYNAMIC_DROPDOWN`… */
	readonly type: string;
	readonly kind: WorkAttributeKind;
	readonly required: boolean;
	/** For a list: what can be chosen. */
	readonly options: readonly WorkAttributeOption[];
}

/** A work log as the issue shows it. */
export interface Worklog {
	readonly author: string;
	/** ISO date and time. */
	readonly started: string;
	readonly seconds: number;
	readonly comment: string;
}

/** What the work log form needs to know about an issue. */
export interface WorklogContext {
	/** Tempo Timesheets is installed: the log goes through it, with its work attributes. */
	readonly tempo: boolean;
	readonly attributes: readonly WorkAttribute[];
	/** What was chosen last time, by attribute key. */
	readonly defaults: Readonly<Record<string, string>>;
	readonly spentSeconds: number;
	/** `null` when the issue has no estimate. */
	readonly remainingSeconds: number | null;
	/** The user's own latest work logs on the issue, newest first. */
	readonly mine: readonly Worklog[];
	/** What Tempo said of its fields, for a report when a list comes empty. */
	readonly diagnostics: string;
}

/** A work log as the form gives it. */
export interface WorklogEntry {
	/** `YYYY-MM-DD`. */
	readonly date: string;
	readonly seconds: number;
	/** What is left after it; `null` leaves Jira to count it down. */
	readonly remainingSeconds: number | null;
	readonly comment: string;
	/** By attribute key. */
	readonly attributes: Readonly<Record<string, string>>;
	/** Whether the attributes chosen are the ones to start with next time. */
	readonly remember: boolean;
}

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string =>
	typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const KINDS: Record<string, WorkAttributeKind> = {
	STATIC_LIST: "list",
	ACCOUNT: "list",
	DYNAMIC_DROPDOWN: "list",
	INPUT_FIELD: "text",
	INPUT_NUMERIC: "number",
	CHECKBOX: "checkbox",
};

/** A Tempo work attribute's type, as its answer names it: `STATIC_LIST`, `ACCOUNT`… */
export const workAttributeType = (raw: unknown): string => {
	const attribute = asJson(raw);
	return asString(asJson(attribute.type).value) || asString(attribute.type);
};

/**
 * Choices as Tempo's answers give them, whatever their shape: a list, or
 * one under `values`/`results`; each choice `{value, name}`, `{key, value}`
 * (a dynamic drop-down's), `{key, name}` (an account, maybe under
 * `account`) or a plain text. Removed choices and closed accounts are left
 * out; the order is Tempo's (`sequence` first).
 */
export function tempoOptionsOf(raw: unknown): WorkAttributeOption[] {
	const root = asJson(raw);
	const list = Array.isArray(raw)
		? raw
		: asArray(root.values ?? root.results ?? root.staticListValues);
	const seen = new Set<string>();
	return list
		.map((item, index) => ({ item, index }))
		.sort((a, b) => {
			const sa = Number(asJson(a.item).sequence ?? a.index);
			const sb = Number(asJson(b.item).sequence ?? b.index);
			return sa - sb;
		})
		.flatMap(({ item }) => {
			if (typeof item === "string") return [{ value: item, name: item }];
			const outer = asJson(item);
			const option = Object.keys(asJson(outer.account)).length > 0 ? asJson(outer.account) : outer;
			if (option.removed === true || asString(option.status) === "CLOSED") return [];
			// `{key, value}`: the key is sent, the value shown; `{value, name}`: the value is sent.
			const value =
				"key" in option ? asString(option.key) : asString(option.value) || asString(option.id);
			const name =
				asString(option.name) ||
				asString(option.label) ||
				asString(option.text) ||
				("key" in option ? asString(option.value) : "") ||
				value;
			return value === "" ? [] : [{ value, name }];
		})
		.filter((option) => {
			if (seen.has(option.value)) return false;
			seen.add(option.value);
			return true;
		});
}

/**
 * Tempo's work attributes (`/rest/tempo-core/1/work-attribute`), with the
 * choices found for each elsewhere (`more`, by key: an account's project
 * accounts, a list asked for on its own, values used before) after its
 * own.
 */
export function workAttributesOf(
	raw: unknown,
	more: Readonly<Record<string, readonly WorkAttributeOption[]>> = {},
): WorkAttribute[] {
	return asArray(raw).flatMap((item) => {
		const attribute = asJson(item);
		const key = asString(attribute.key);
		const id = Number(attribute.id);
		if (key === "" || !Number.isFinite(id)) return [];
		const own = tempoOptionsOf(attribute.staticListValues);
		const options = [...own];
		for (const option of more[key] ?? []) {
			if (!options.some((known) => known.value === option.value)) options.push(option);
		}
		const type = workAttributeType(attribute);
		// A type Kalem does not know is a list when there is something to choose.
		const kind = KINDS[type] ?? (options.length > 0 ? "list" : "text");
		return [
			{
				id,
				key,
				name: asString(attribute.name) || key,
				type,
				kind,
				required: attribute.required === true,
				options: kind === "list" ? options : [],
			},
		];
	});
}

/**
 * The values the user gave each work attribute in their Tempo work logs
 * (`POST /rest/tempo-timesheets/4/worklogs/search`), by key, latest first.
 */
export function recentAttributeValues(raw: unknown): Record<string, string[]> {
	const logs = asArray(raw)
		.map(asJson)
		.sort((a, b) => {
			const sa = asString(a.started) || asString(a.dateStarted);
			const sb = asString(b.started) || asString(b.dateStarted);
			return sa < sb ? 1 : sa > sb ? -1 : 0;
		});
	const values: Record<string, string[]> = {};
	for (const log of logs) {
		const attributes = asJson(log.attributes);
		for (const [key, given] of Object.entries(attributes)) {
			const value = typeof given === "string" ? given : asString(asJson(given).value);
			if (value === "") continue;
			const list = values[key] ?? [];
			if (!list.includes(value)) list.push(value);
			values[key] = list;
		}
	}
	return values;
}

/** The attributes that must be given and are not; their names. */
export function missingAttributes(
	attributes: readonly WorkAttribute[],
	values: Readonly<Record<string, string>>,
): string[] {
	return attributes
		.filter((attribute) => attribute.required && (values[attribute.key] ?? "").trim() === "")
		.map((attribute) => attribute.name);
}

/**
 * Tempo's work log (`POST /rest/tempo-timesheets/4/worklogs`) for the
 * signed-in `worker`, as Tempo's own dialog sends it: the issue by its
 * numeric id, the billable time left to Tempo (setting it takes Tempo's
 * "Set Billable Hours" permission, refused with a 403 without it) and the
 * remaining estimate only when it was given.
 */
export function tempoWorklogBody(
	issueId: string,
	worker: string,
	entry: WorklogEntry,
	attributes: readonly WorkAttribute[],
): Json {
	const given: Json = {};
	for (const attribute of attributes) {
		const value = (entry.attributes[attribute.key] ?? "").trim();
		if (value === "") continue;
		given[attribute.key] = { name: attribute.name, workAttributeId: attribute.id, value };
	}
	return {
		attributes: given,
		billableSeconds: null,
		originId: -1,
		worker,
		comment: entry.comment.trim() === "" ? null : entry.comment,
		started: entry.date,
		timeSpentSeconds: entry.seconds,
		originTaskId: issueId,
		remainingEstimate: entry.remainingSeconds,
		endDate: null,
		includeNonWorkingDays: false,
	};
}

/** Jira's own work log (`POST /rest/api/2/issue/KEY/worklog`), started at 09:00 on its day, local time. */
export function jiraWorklogRequest(
	entry: WorklogEntry,
	offsetMinutes: number,
): { query: string; body: Json } {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const offset = Math.abs(offsetMinutes);
	const zone = `${sign}${String(Math.floor(offset / 60)).padStart(2, "0")}${String(offset % 60).padStart(2, "0")}`;
	const query =
		entry.remainingSeconds === null
			? "adjustEstimate=auto"
			: `adjustEstimate=new&newEstimate=${Math.round(entry.remainingSeconds / 60)}m`;
	return {
		query,
		body: {
			started: `${entry.date}T09:00:00.000${zone}`,
			timeSpentSeconds: entry.seconds,
			...(entry.comment === "" ? {} : { comment: entry.comment }),
		},
	};
}

/** The work logs of an issue (`/rest/api/2/issue/KEY/worklog`) written by `user`, newest first. */
export function worklogsOf(raw: unknown, user: { name: string; key: string }): Worklog[] {
	return asArray(asJson(raw).worklogs)
		.map(asJson)
		.filter((log) => {
			const author = asJson(log.author);
			return (
				(user.key !== "" && asString(author.key) === user.key) ||
				(user.key !== "" && asString(author.accountId) === user.key) ||
				(user.name !== "" && asString(author.name) === user.name)
			);
		})
		.map((log) => ({
			author: asString(asJson(log.author).displayName),
			started: asString(log.started),
			seconds: Number(log.timeSpentSeconds) || 0,
			comment: typeof log.comment === "string" ? log.comment : "",
		}))
		.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0));
}

/** The remaining estimate after logging `seconds`: what was left less it, never below zero. */
export function remainingAfter(remaining: number | null, seconds: number): number | null {
	return remaining === null ? null : Math.max(0, remaining - seconds);
}

/**
 * A quick log of `seconds` on `date` with the choices remembered, the
 * description Tempo would write; the estimate is left to Jira to count
 * down, as Tempo's own dialog leaves it. When a
 * required attribute has no remembered value, the names of those missing:
 * the full form has to ask.
 */
export function quickEntry(
	context: WorklogContext,
	issueKey: string,
	seconds: number,
	date: string,
): { readonly entry: WorklogEntry } | { readonly missing: readonly string[] } {
	const attributes: Record<string, string> = {};
	for (const attribute of context.attributes) {
		const value = context.defaults[attribute.key] ?? "";
		// A remembered choice that is no longer offered is not sent.
		if (attribute.kind === "list" && !attribute.options.some((option) => option.value === value)) {
			continue;
		}
		if (value !== "") attributes[attribute.key] = value;
	}
	const missing = missingAttributes(context.attributes, attributes);
	if (missing.length > 0) return { missing };
	return {
		entry: {
			date,
			seconds,
			remainingSeconds: null,
			comment: `Working on issue ${issueKey}`,
			attributes,
			remember: false,
		},
	};
}

/** What an attribute's address can name: Tempo fills these in for the issue being logged. */
export interface IssuePlaceholders {
	readonly issueKey: string;
	readonly issueId: string;
	readonly projectKey: string;
	readonly projectId: string;
}

/**
 * The path on this Jira that an attribute's `externalUrl` asks for its
 * choices (a Tempo account's `…/billingKeyList/{IssueKey}`, a ScriptRunner
 * endpoint), with `{IssueKey}`, `{IssueId}`, `{ProjectKey}` and
 * `{ProjectId}` filled in. `null` for an address on another host: the
 * login is never sent elsewhere.
 */
export function externalPath(
	address: string,
	site: string,
	issue: IssuePlaceholders,
): string | null {
	const filled = address.trim().replace(/\{(\w+)\}/g, (whole, name: string) => {
		const value = {
			issuekey: issue.issueKey,
			issueid: issue.issueId,
			projectkey: issue.projectKey,
			projectid: issue.projectId,
		}[name.toLocaleLowerCase("en")];
		return value === undefined ? whole : encodeURIComponent(value);
	});
	if (filled.startsWith("/") && !filled.startsWith("//")) return filled;
	const root = site.replace(/\/+$/, "");
	if (filled.startsWith(`${root}/`)) return filled.slice(root.length);
	// The same host on the other scheme or with its default port is still this Jira.
	try {
		const url = new URL(filled);
		const own = new URL(root);
		if (url.hostname !== own.hostname) return null;
		const base = own.pathname.replace(/\/+$/, "");
		if (!url.pathname.startsWith(`${base}/`)) return null;
		return `${url.pathname.slice(base.length)}${url.search}`;
	} catch {
		return null;
	}
}
