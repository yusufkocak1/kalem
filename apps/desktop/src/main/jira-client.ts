import { markdownToWiki } from "../shared/confluence-wiki.js";
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
import type {
	DevelopmentItem,
	DevelopmentKind,
	DevelopmentSummary,
	JiraTransition,
} from "../shared/jira-dev.js";
import {
	DEVELOPMENT_DATA_TYPE,
	developmentItemsOf,
	developmentSummaryOf,
	transitionBody,
	transitionsOf,
} from "../shared/jira-dev.js";
import type {
	IssuePlaceholders,
	WorkAttribute,
	WorkAttributeOption,
	WorklogContext,
	WorklogEntry,
} from "../shared/jira-worklog.js";
import {
	externalPath,
	jiraWorklogRequest,
	missingAttributes,
	parseJsonOrJsonp,
	recentAttributeValues,
	tempoOptionsOf,
	tempoWorklogBody,
	workAttributesOf,
	workAttributeType,
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
 * installed) and status changes. Cloud searches with `/search/jql` (the older `/search` is gone
 * there), Server with `/search`.
 */
/** Requests one Jira site is sent at the same time; the rest wait their turn. */
const MAX_PARALLEL = 4;
/** Times a request Jira turned away for its rate limit (429) is sent again. */
const RATE_RETRIES = 3;
/** The longest wait before sending again, whatever Jira says. */
const MAX_RETRY_WAIT = 15_000;

/** Each site's turns, shared by every client of it: a client is made for each request from a window. */
const turns = new Map<string, { running: number; waiting: (() => void)[] }>();

async function takeTurn(site: string): Promise<() => void> {
	let state = turns.get(site);
	if (state === undefined) {
		state = { running: 0, waiting: [] };
		turns.set(site, state);
	}
	const own = state;
	if (own.running >= MAX_PARALLEL) await new Promise<void>((resolve) => own.waiting.push(resolve));
	own.running++;
	return () => {
		own.running--;
		own.waiting.shift()?.();
	};
}

/** Answers that seldom change, kept a while by site and login: who is signed in, Tempo's fields. */
const kept = new Map<string, { until: number; value: Promise<unknown> }>();

function keep<T>(key: string, lifetime: number, make: () => Promise<T>): Promise<T> {
	const now = Date.now();
	const found = kept.get(key);
	if (found !== undefined && found.until > now) return found.value as Promise<T>;
	const value = make();
	kept.set(key, { until: now + lifetime, value });
	// A failure is not kept: the next look asks again.
	value.catch(() => {
		if (kept.get(key)?.value === value) kept.delete(key);
	});
	return value;
}

const MINUTE = 60_000;

/** How long to wait before sending again, from Jira's `Retry-After` (seconds or a date). */
export function retryWait(header: string | null, attempt: number): number {
	let wait = Number.NaN;
	if (header !== null && header.trim() !== "") {
		const seconds = Number(header);
		wait = Number.isFinite(seconds) ? seconds * 1000 : new Date(header).getTime() - Date.now();
	}
	if (!Number.isFinite(wait) || wait < 0) wait = 1000 * 2 ** attempt;
	return Math.min(wait, MAX_RETRY_WAIT);
}

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

	/** What the kept answers of this site and login are filed under. */
	get #keptKey(): string {
		return `${this.site}\n${this.#auth}`;
	}

	async #send(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
		let response: Response;
		for (let attempt = 0; ; attempt++) {
			const done = await takeTurn(this.site);
			try {
				response = await this.#fetch(`${this.site}${path}`, {
					method,
					headers: {
						Accept: "application/json",
						Authorization: this.#auth,
						...(body === undefined ? {} : { "Content-Type": "application/json" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
			} finally {
				done();
			}
			// Jira's rate limit turned it away before doing anything: it is sent again after the wait asked.
			if (response.status !== 429 || attempt >= RATE_RETRIES) break;
			await new Promise((resolve) =>
				setTimeout(resolve, retryWait(response.headers.get("Retry-After"), attempt)),
			);
		}
		if (response.status === 429) {
			throw new JiraError(
				429,
				"HTTP 429: Jira is limiting requests (rate limit); try again in a minute.",
			);
		}
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
		return parseJsonOrJsonp(await response.text());
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
		return keep(`${this.#keptKey}\nme`, 30 * MINUTE, async () => {
			const me = await this.#json("/rest/api/2/myself");
			// Server's user key; Cloud's account id.
			return { key: asString(me.key) || asString(me.accountId), name: asString(me.name) };
		});
	}

	/** Tempo's work attributes as it lists them; `null` where Tempo is not installed. */
	async #tempoRaw(): Promise<unknown[] | null> {
		if (this.cloud) return null;
		return keep(`${this.#keptKey}\ntempo`, 10 * MINUTE, async () => {
			try {
				const raw = await this.#get("/rest/tempo-core/1/work-attribute");
				return Array.isArray(raw) ? raw : [];
			} catch (error) {
				if (error instanceof JiraError && (error.status === 404 || error.status === 403))
					return null;
				throw error;
			}
		});
	}

	/** A request whose failure only means fewer choices; why it failed goes to the report. */
	async #tryGet(path: string, report: string[], label: string): Promise<unknown> {
		try {
			return await keep(`${this.#keptKey}\nget\n${path}`, 10 * MINUTE, () => this.#get(path));
		} catch (error) {
			report.push(`${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
			return null;
		}
	}

	/**
	 * The choices of each list attribute, by key, from wherever Tempo keeps
	 * them: a static list asked for on its own when the attribute list has
	 * none, the project's accounts (all accounts are for administrators), a
	 * dynamic drop-down's address on this Jira; then the values the user
	 * gave in their own Tempo logs of the last months.
	 */
	async #tempoChoices(
		raw: readonly unknown[],
		issue: IssuePlaceholders,
		recent: Readonly<Record<string, readonly string[]>>,
		report: string[],
	): Promise<Record<string, WorkAttributeOption[]>> {
		const choices: Record<string, WorkAttributeOption[]> = {};
		await Promise.all(
			raw.map(async (item) => {
				const attribute = asJson(item);
				const key = asString(attribute.key);
				const id = asString(attribute.id);
				const type = workAttributeType(attribute);
				const found: WorkAttributeOption[] = [];
				// Where Tempo's own dialog asks: the attribute's `externalUrl` (an account's
				// billing keys for the issue, a dynamic drop-down's endpoint).
				const external = asString(attribute.externalUrl);
				if (external !== "") {
					const path = externalPath(external, this.site, issue);
					if (path === null) {
						report.push(`${key}: choices at another host, not asked: ${external}`);
					} else {
						// Tempo asks a dynamic drop-down with a JSONP callback; some endpoints answer only so.
						const asked =
							type === "DYNAMIC_DROPDOWN" && !/[?&]callback=/.test(path)
								? `${path}${path.includes("?") ? "&" : "?"}callback=kalem`
								: path;
						found.push(...tempoOptionsOf(await this.#tryGet(asked, report, key)));
					}
				}
				if (type === "STATIC_LIST" && tempoOptionsOf(attribute.staticListValues).length === 0) {
					found.push(
						...tempoOptionsOf(
							await this.#tryGet(
								`/rest/tempo-core/1/work-attribute/${id}/static-list-value`,
								report,
								key,
							),
						),
					);
				}
				if (type === "ACCOUNT" && found.length === 0) {
					const projectId = issue.projectId;
					if (/^\d+$/.test(projectId)) {
						found.push(
							...tempoOptionsOf(
								await this.#tryGet(
									`/rest/tempo-accounts/1/account/project/${projectId}`,
									report,
									key,
								),
							),
						);
					}
					if (found.length === 0) {
						found.push(
							...tempoOptionsOf(await this.#tryGet("/rest/tempo-accounts/1/account", report, key)),
						);
					}
				}
				if (type === "DYNAMIC_DROPDOWN" && external === "") {
					report.push(`${key}: a dynamic drop-down without an address`);
				}
				const known = new Set(found.map((option) => option.value));
				for (const value of recent[key] ?? []) {
					if (!known.has(value)) found.push({ value, name: value });
				}
				choices[key] = found;
			}),
		);
		return choices;
	}

	/** The work attribute values the user gave in Tempo in the last four months, latest first. */
	async #recentValues(worker: string, report: string[]): Promise<Record<string, string[]>> {
		const day = (date: Date): string => date.toISOString().slice(0, 10);
		const to = new Date();
		const from = new Date(to.getTime() - 120 * 24 * 3600 * 1000);
		try {
			return await keep(`${this.#keptKey}\nrecent`, 2 * MINUTE, async () =>
				recentAttributeValues(
					await this.#send("POST", "/rest/tempo-timesheets/4/worklogs/search", {
						from: day(from),
						to: day(to),
						worker: [worker],
					}),
				),
			);
		} catch (error) {
			report.push(`recent logs: ${error instanceof Error ? error.message : String(error)}`);
			return {};
		}
	}

	/**
	 * Tempo's work attributes; `null` where Tempo Timesheets is not
	 * installed (or on Cloud, whose Tempo has its own API and login).
	 */
	async #tempoAttributes(): Promise<WorkAttribute[] | null> {
		const raw = await this.#tempoRaw();
		return raw === null ? null : workAttributesOf(raw);
	}

	/** What the work log form needs: Tempo's fields, the time spent and left, the user's own logs. */
	async worklogContext(
		key: string,
		defaults: Readonly<Record<string, string>>,
	): Promise<WorklogContext> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		const [raw, issue, logs, me] = await Promise.all([
			this.#tempoRaw(),
			this.#json(`/rest/api/2/issue/${valid}?fields=timetracking,project`),
			this.#get(`/rest/api/2/issue/${valid}/worklog`).catch(() => ({})),
			this.#me(),
		]);
		const fields = asJson(issue.fields);
		const tracking = asJson(fields.timetracking);
		const remaining = tracking.remainingEstimateSeconds;
		const report: string[] = [];
		let attributes: WorkAttribute[] = [];
		let starting: Record<string, string> = { ...defaults };
		if (raw !== null) {
			const recent = await this.#recentValues(me.key, report);
			const project = asJson(fields.project);
			const choices = await this.#tempoChoices(
				raw,
				{
					issueKey: valid,
					issueId: asString(issue.id),
					projectKey: asString(project.key),
					projectId: asString(project.id),
				},
				recent,
				report,
			);
			attributes = workAttributesOf(raw, choices);
			// What was given last in Tempo starts the form when nothing was remembered here.
			starting = Object.fromEntries(
				attributes.flatMap((attribute) => {
					const value = defaults[attribute.key] ?? recent[attribute.key]?.[0] ?? "";
					return value === "" ? [] : [[attribute.key, value]];
				}),
			);
			const described = attributes.map((attribute) => {
				const own = asJson(raw.find((item) => asString(asJson(item).key) === attribute.key));
				return `${attribute.name} (${attribute.key}): ${workAttributeType(own)}${attribute.required ? ", required" : ""}, ${attribute.options.length} choices; fields: ${Object.keys(own).join(", ")}`;
			});
			report.unshift(...described);
		}
		return {
			tempo: raw !== null,
			attributes,
			defaults: starting,
			spentSeconds: Number(tracking.timeSpentSeconds) || 0,
			remainingSeconds: typeof remaining === "number" ? remaining : null,
			mine: worklogsOf(logs, me).slice(0, 5),
			diagnostics: report.join("\n"),
		};
	}

	/** The steps the issue can take from its status, with what their screens ask for. */
	async transitions(key: string): Promise<JiraTransition[]> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		return transitionsOf(
			await this.#get(`/rest/api/2/issue/${valid}/transitions?expand=transitions.fields`),
		);
	}

	/** Takes a step; one whose screen asks for more than a resolution is refused, to be taken in Jira. */
	async transition(key: string, id: string): Promise<void> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		// Asked again here: the step and its fields are Jira's, not what the window says.
		const step = (await this.transitions(valid)).find((each) => each.id === id);
		if (step === undefined) throw new Error("This status change is no longer available.");
		if (step.needs.length > 0) throw new Error(`Needs ${step.needs.join(", ")}`);
		await this.#send("POST", `/rest/api/2/issue/${valid}/transitions`, transitionBody(step));
	}

	/**
	 * Creates an issue; the description is Markdown, sent as Jira's wiki markup.
	 * A sub-task names its parent.
	 */
	async createIssue(request: {
		readonly project: string;
		readonly type: string;
		readonly summary: string;
		readonly description: string;
		readonly parent?: string;
	}): Promise<{ key: string; url: string }> {
		const project = request.project.trim();
		if (!/^[A-Z][A-Z0-9_]*$/i.test(project)) throw new Error("Invalid project key");
		const parent = request.parent === undefined ? null : issueKey(request.parent);
		const body = asJson(
			await this.#send("POST", "/rest/api/2/issue", {
				fields: {
					project: { key: project.toLocaleUpperCase("en") },
					issuetype: { name: request.type.trim() || "Story" },
					summary: request.summary.trim().slice(0, 254),
					...(request.description.trim() === ""
						? {}
						: { description: markdownToWiki(request.description) }),
					...(parent === null ? {} : { parent: { key: parent } }),
				},
			}),
		);
		const key = asString(body.key);
		if (issueKey(key) === null) throw new Error("Jira did not return the new issue");
		return { key, url: `${this.site}/browse/${key}` };
	}

	/** Adds a comment; the text is Markdown, sent as Jira's wiki markup. */
	async addComment(key: string, markdown: string): Promise<void> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		await this.#send("POST", `/rest/api/2/issue/${valid}/comment`, {
			body: markdownToWiki(markdown),
		});
	}

	/** The Development panel's counts; `null` where Jira has no development information. */
	async development(issueId: string): Promise<DevelopmentSummary | null> {
		if (!/^\d+$/.test(issueId)) throw new Error("Invalid issue id");
		try {
			return developmentSummaryOf(
				await this.#get(`/rest/dev-status/1.0/issue/summary?issueId=${issueId}`),
			);
		} catch (error) {
			if (error instanceof JiraError && (error.status === 404 || error.status === 403)) return null;
			throw error;
		}
	}

	/** The branches, commits or pull requests behind a count, from every tool that holds them. */
	async developmentDetail(issueId: string, kind: DevelopmentKind): Promise<DevelopmentItem[]> {
		const summary = await this.development(issueId);
		if (summary === null) return [];
		const lists = await Promise.all(
			summary.sources.map(async (source) =>
				developmentItemsOf(
					await this.#get(
						`/rest/dev-status/1.0/issue/detail?${new URLSearchParams({
							issueId,
							applicationType: source,
							dataType: DEVELOPMENT_DATA_TYPE[kind],
						}).toString()}`,
					),
					kind,
				),
			),
		);
		return lists
			.flat()
			.sort((a, b) =>
				(a.when ?? "") < (b.when ?? "") ? 1 : (a.when ?? "") > (b.when ?? "") ? -1 : 0,
			);
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
