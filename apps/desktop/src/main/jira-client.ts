import type { JiraIssue, JiraIssueRow, JiraSearchResults } from "../shared/jira.js";
import {
	ISSUE_FIELDS,
	issueKey,
	issueOf,
	issueRowOf,
	normalizeJiraSite,
	ROW_FIELDS,
	remoteLinksOf,
} from "../shared/jira.js";
import type { WorkAttribute, WorklogContext, WorklogEntry } from "../shared/jira-worklog.js";
import {
	jiraWorklogRequest,
	missingAttributes,
	tempoWorklogBody,
	workAttributesOf,
	worklogsOf,
} from "../shared/jira-worklog.js";
import type { ConfluenceCredentials, Fetch } from "./confluence-client.js";
import { isCloudHost } from "./confluence-client.js";

/** Issues of one search's page. */
export const JIRA_PAGE_SIZE = 25;

export class JiraError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "JiraError";
		this.status = status;
	}
}

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Jira's REST API, version 2 on both Cloud and Server / Data Center: its
 * text fields are wiki markup, which Kalem reads like Confluence's. It
 * reads, and writes only work logs (through Tempo Timesheets where it is
 * installed). Cloud searches with `/search/jql` (the older `/search` is gone
 * there), Server with `/search`.
 */
export class JiraClient {
	readonly site: string;
	readonly cloud: boolean;
	#auth: string;
	readonly #token: string;
	readonly #fetch: Fetch;

	constructor(credentials: ConfluenceCredentials, fetchImpl: Fetch) {
		this.site = normalizeJiraSite(credentials.site);
		this.cloud = isCloudHost(new URL(this.site).hostname);
		this.#auth =
			credentials.username === ""
				? `Bearer ${credentials.token}`
				: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString("base64")}`;
		this.#token = credentials.token;
		this.#fetch = fetchImpl;
	}

	/** True when requests carry the token alone (a personal access token). */
	get bearer(): boolean {
		return this.#auth.startsWith("Bearer ");
	}

	async #json(path: string): Promise<Json> {
		return asJson(await this.#get(path));
	}

	async #get(path: string): Promise<unknown> {
		return this.#send("GET", path);
	}

	async #send(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
		const response = await this.#fetch(`${this.site}${path}`, {
			method,
			headers: {
				Accept: "application/json",
				Authorization: this.#auth,
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok) {
			let detail = "";
			try {
				const body = asJson(await response.json());
				detail =
					asString(asArray(body.errorMessages)[0]) ||
					asString(Object.values(asJson(body.errors))[0]) ||
					// Tempo's: a list of errors, each with its message.
					asString(asJson(asArray(body.errors)[0]).message) ||
					asString(body.message);
			} catch {}
			throw new JiraError(
				response.status,
				detail === "" ? `HTTP ${response.status}` : `HTTP ${response.status}: ${detail}`,
			);
		}
		const text = await response.text();
		return text === "" ? null : JSON.parse(text);
	}

	/** Who is signed in; fails when the site or the login is wrong. */
	async verify(): Promise<string> {
		try {
			return nameOf(await this.#json("/rest/api/2/myself"));
		} catch (error) {
			// Server / Data Center rejects a personal access token sent with a
			// user name; it is tried again as a bearer token.
			if (this.cloud || this.bearer || !(error instanceof JiraError) || error.status !== 401) {
				throw error;
			}
			const basic = this.#auth;
			this.#auth = `Bearer ${this.#token}`;
			try {
				return nameOf(await this.#json("/rest/api/2/myself"));
			} catch {
				this.#auth = basic;
				throw error;
			}
		}
	}

	/** One issue, with its description, comments, sub-tasks and links. */
	async issue(key: string): Promise<JiraIssue> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		// Jira's own rendering too: a site with an HTML editor plug-in keeps its fields as HTML.
		const [body, remote] = await Promise.all([
			this.#json(
				`/rest/api/2/issue/${valid}?fields=${ISSUE_FIELDS.join(",")}&expand=renderedFields`,
			),
			// Links outside Jira (Confluence pages that mention it); an issue may have none to read.
			this.#get(`/rest/api/2/issue/${valid}/remotelink`).catch(() => []),
		]);
		const issue = issueOf(body, this.site);
		if (issue === null) throw new Error("Jira did not return the issue");
		return { ...issue, remoteLinks: remoteLinksOf(remote) };
	}

	/** An issue's key facts, for a card: summary, status, type, assignee. */
	async row(key: string): Promise<JiraIssueRow> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		const row = issueRowOf(
			await this.#json(`/rest/api/2/issue/${valid}?fields=${ROW_FIELDS.join(",")}`),
		);
		if (row === null) throw new Error("Jira did not return the issue");
		return row;
	}

	/** A JQL search's issues; `next` continues an earlier answer. */
	async search(jql: string, next: string | null = null): Promise<JiraSearchResults> {
		const params = new URLSearchParams({
			jql,
			maxResults: String(JIRA_PAGE_SIZE),
			fields: ROW_FIELDS.join(","),
		});
		if (this.cloud) {
			if (next !== null) params.set("nextPageToken", next);
			const body = await this.#json(`/rest/api/2/search/jql?${params.toString()}`);
			const token = asString(body.nextPageToken);
			return {
				jql,
				issues: rows(body.issues),
				total: typeof body.total === "number" ? body.total : null,
				next: token === "" || body.isLast === true ? null : token,
			};
		}
		const start = next === null ? 0 : Number(next);
		if (!Number.isInteger(start) || start < 0) throw new Error("Invalid search cursor");
		params.set("startAt", String(start));
		const body = await this.#json(`/rest/api/2/search?${params.toString()}`);
		const issues = rows(body.issues);
		const total = typeof body.total === "number" ? body.total : null;
		const end = start + issues.length;
		return {
			jql,
			issues,
			total,
			next: issues.length > 0 && total !== null && end < total ? String(end) : null,
		};
	}

	/** Who is signed in: the key Tempo names a worker by, and the name. */
	async #me(): Promise<{ key: string; name: string }> {
		this.#user ??= this.#json("/rest/api/2/myself").then((me) => ({
			// Server's user key; Cloud's account id.
			key: asString(me.key) || asString(me.accountId),
			name: asString(me.name),
		}));
		try {
			return await this.#user;
		} catch (error) {
			this.#user = null;
			throw error;
		}
	}

	#user: Promise<{ key: string; name: string }> | null = null;

	/**
	 * Tempo's work attributes; `null` where Tempo Timesheets is not
	 * installed (or on Cloud, whose Tempo has its own API and login).
	 */
	async #tempoAttributes(): Promise<WorkAttribute[] | null> {
		if (this.cloud) return null;
		let raw: unknown;
		try {
			raw = await this.#get("/rest/tempo-core/1/work-attribute");
		} catch (error) {
			if (error instanceof JiraError && (error.status === 404 || error.status === 403)) return null;
			throw error;
		}
		const accounts = Array.isArray(raw)
			? raw.some((item) => JSON.stringify(item).includes('"ACCOUNT"'))
				? await this.#get("/rest/tempo-accounts/1/account").catch(() => [])
				: []
			: [];
		return workAttributesOf(raw, accounts);
	}

	/** What the work log form needs: Tempo's fields, the time spent and left, the user's own logs. */
	async worklogContext(
		key: string,
		defaults: Readonly<Record<string, string>>,
	): Promise<WorklogContext> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		const [attributes, issue, logs, me] = await Promise.all([
			this.#tempoAttributes(),
			this.#json(`/rest/api/2/issue/${valid}?fields=timetracking`),
			this.#get(`/rest/api/2/issue/${valid}/worklog`).catch(() => ({})),
			this.#me(),
		]);
		const tracking = asJson(asJson(issue.fields).timetracking);
		const remaining = tracking.remainingEstimateSeconds;
		return {
			tempo: attributes !== null,
			attributes: attributes ?? [],
			defaults,
			spentSeconds: Number(tracking.timeSpentSeconds) || 0,
			remainingSeconds: typeof remaining === "number" ? remaining : null,
			mine: worklogsOf(logs, me).slice(0, 5),
		};
	}

	/** Logs work on an issue: through Tempo, with its work attributes, where it is installed. */
	async logWork(key: string, entry: WorklogEntry, offsetMinutes: number): Promise<void> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) throw new Error("Invalid date");
		if (!Number.isInteger(entry.seconds) || entry.seconds <= 0 || entry.seconds > 24 * 3600) {
			throw new Error("Invalid time");
		}
		const attributes = await this.#tempoAttributes();
		if (attributes !== null) {
			const missing = missingAttributes(attributes, entry.attributes);
			if (missing.length > 0) throw new Error(`Required: ${missing.join(", ")}`);
			const me = await this.#me();
			await this.#send(
				"POST",
				"/rest/tempo-timesheets/4/worklogs",
				tempoWorklogBody(valid, me.key, entry, attributes),
			);
			return;
		}
		const request = jiraWorklogRequest(entry, offsetMinutes);
		await this.#send("POST", `/rest/api/2/issue/${valid}/worklog?${request.query}`, request.body);
	}
}

const nameOf = (value: unknown): string => {
	const record = asJson(value);
	return asString(record.displayName) || asString(record.name);
};

const rows = (value: unknown) =>
	asArray(value).flatMap((item) => {
		const row = issueRowOf(item);
		return row === null ? [] : [row];
	});
