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
	INPUT_FIELD: "text",
	INPUT_NUMERIC: "number",
	CHECKBOX: "checkbox",
};

/**
 * Tempo's work attributes (`/rest/tempo-core/1/work-attribute`); an
 * account attribute takes its choices from `accounts`
 * (`/rest/tempo-accounts/1/account`). Removed choices and closed accounts
 * are left out.
 */
export function workAttributesOf(raw: unknown, accounts: unknown = []): WorkAttribute[] {
	const accountOptions = asArray(accounts)
		.map(asJson)
		.filter((account) => asString(account.status) !== "CLOSED" && asString(account.key) !== "")
		.map((account) => ({ value: asString(account.key), name: asString(account.name) }));
	return asArray(raw).flatMap((item) => {
		const attribute = asJson(item);
		const key = asString(attribute.key);
		const id = Number(attribute.id);
		if (key === "" || !Number.isFinite(id)) return [];
		const type = asString(asJson(attribute.type).value) || asString(attribute.type);
		const kind = KINDS[type] ?? "text";
		const options =
			type === "ACCOUNT"
				? accountOptions
				: asArray(attribute.staticListValues)
						.map(asJson)
						.filter((option) => option.removed !== true)
						.sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0))
						.map((option) => ({
							value: asString(option.value),
							name: asString(option.name) || asString(option.value),
						}))
						.filter((option) => option.value !== "");
		return [
			{
				id,
				key,
				name: asString(attribute.name) || key,
				kind,
				required: attribute.required === true,
				options,
			},
		];
	});
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

/** Tempo's work log (`POST /rest/tempo-timesheets/4/worklogs`) for the signed-in `worker`. */
export function tempoWorklogBody(
	issueKey: string,
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
		worker,
		originTaskId: issueKey,
		started: entry.date,
		timeSpentSeconds: entry.seconds,
		billableSeconds: entry.seconds,
		comment: entry.comment,
		includeNonWorkingDays: false,
		...(entry.remainingSeconds === null ? {} : { remainingEstimate: entry.remainingSeconds }),
		attributes: given,
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
 * A quick log of `seconds` on `date` with the choices remembered: the
 * estimate counted down, the description Tempo would write. When a
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
			remainingSeconds: remainingAfter(context.remainingSeconds, seconds),
			comment: `Working on issue ${issueKey}`,
			attributes,
			remember: false,
		},
	};
}
