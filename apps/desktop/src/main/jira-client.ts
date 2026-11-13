import { markdownToWiki } from "../shared/confluence-wiki.js";
import type { JiraComment, JiraIssue, JiraIssueRow, JiraSearchResults } from "../shared/jira.js";
import {
	commentOf,
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
	JiraAttachment,
	JiraEditableField,
	JiraOption,
	JiraSprint,
	JiraUser,
} from "../shared/jira-fields.js";
import {
	assigneeBody,
	attachmentsOf,
	fieldValueBody,
	labelsBody,
	optionsOf,
	userOf,
} from "../shared/jira-fields.js";
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
import { RateGate, RateLimited, retryAfter } from "./jira-rate.js";

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
/** Every request to a Jira site goes through its gate: Jira's rate limit is the site's, not a window's. */
const gate = new RateGate();

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

	async #json(path: string, background = false): Promise<Json> {
		return asJson(await this.#get(path, background));
	}

	/** `background`: asked without the user waiting for it (a card, a list's choices); not sent while Jira's limit lasts. */
	async #get(path: string, background = false): Promise<unknown> {
		return this.#send("GET", path, undefined, background);
	}

	/** What the kept answers of this site and login are filed under. */
	get #keptKey(): string {
		return `${this.site}\n${this.#auth}`;
	}

	async #send(
		method: "GET" | "POST" | "PUT",
		path: string,
		body?: unknown,
		background = false,
	): Promise<unknown> {
		let response: Response;
		for (let attempt = 0; ; attempt++) {
			let done: () => void;
			try {
				done = await gate.enter(this.site, background);
			} catch (error) {
				if (error instanceof RateLimited) throw new JiraError(429, error.message);
				throw error;
			}
			try {
				response = await this.#fetch(`${this.site}${path}`, {
					method,
					headers: {
						Accept: "application/json",
						Authorization: this.#auth,
						...(body === undefined ? {} : { "Content-Type": "application/json" }),
						// Electron's user agent reads as a browser's: without this, Jira's
						// XSRF check refuses its writes with a 403.
						...(method === "GET" ? {} : { "X-Atlassian-Token": "no-check" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
				gate.record(this.site, response.headers);
			} finally {
				done();
			}
			if (response.status !== 429) break;
			// Jira turned it away before doing anything: every request to the site stops for the time it asks.
			const wait = retryAfter(response.headers.get("Retry-After"), 2000 * 2 ** attempt);
			const seconds = gate.block(this.site, wait);
			// It is sent once more after the wait, held by the gate until then: what the user
			// asked for waits up to a minute, what is asked in the background a few seconds.
			if (attempt > 0 || wait > (background ? 5_000 : 60_000)) {
				throw new JiraError(429, new RateLimited(seconds).message);
			}
			// The gate would turn a background request away while the stop lasts: it waits here.
			if (background) await new Promise((resolve) => setTimeout(resolve, wait));
		}
		if (!response.ok) {
			let detail = "";
			let text = "";
			try {
				text = await response.text();
				const body = asJson(JSON.parse(text));
				detail =
					asString(asArray(body.errorMessages)[0]) ||
					asString(Object.values(asJson(body.errors))[0]) ||
					// Tempo's: a list of errors, each with its message.
					asString(asJson(asArray(body.errors)[0]).message) ||
					asString(body.message);
			} catch {
				// Not JSON: Jira's own refusals ("XSRF check failed") are plain text.
				detail = text
					.replace(/<[^>]*>/g, " ")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 200);
			}
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
				`/rest/api/2/issue/${valid}?fields=*all&expand=renderedFields,names,schema,changelog,editmeta`,
			),
			// Links outside Jira (Confluence pages that mention it); an issue may have none to read.
			this.#get(`/rest/api/2/issue/${valid}/remotelink`, true).catch(() => []),
		]);
		const issue = issueOf(body, this.site);
		if (issue === null) throw new Error("Jira did not return the issue");
		let parentLink = issue.parentLink;
		if (parentLink !== null && parentLink.summary === "") {
			const key = parentLink.key;
			const row = await this.row(key).catch(() => null);
			parentLink = { key, summary: row?.summary ?? "" };
		}
		let team = issue.team;
		if (team !== null && /^\d+$/.test(team.name) && issue.teamField !== null) {
			const id = team.id;
			const found = await this.#json(`/rest/tempo-teams/2/team/${id}`, true).catch(() => null);
			const name = found === null ? "" : asString(found.name);
			if (name !== "") team = { id, name };
		}
		return { ...issue, parentLink, team, remoteLinks: remoteLinksOf(remote) };
	}

	/** An issue's key facts, for a card: summary, status, type, assignee. */
	async row(key: string): Promise<JiraIssueRow> {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		const row = issueRowOf(
			await keep(`${this.#keptKey}\nrow\n${valid}`, 2 * MINUTE, () =>
				this.#json(`/rest/api/2/issue/${valid}?fields=${ROW_FIELDS.join(",")}`, true),
			),
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
		return keep(`${this.#keptKey}\nme`, 12 * 60 * MINUTE, async () => {
			const me = await this.#json("/rest/api/2/myself");
			// Server's user key; Cloud's account id.
			return { key: asString(me.key) || asString(me.accountId), name: asString(me.name) };
		});
	}

	/** Tempo's work attributes as it lists them; `null` where Tempo is not installed. */
	async #tempoRaw(): Promise<unknown[] | null> {
		if (this.cloud) return null;
		return keep(`${this.#keptKey}\ntempo`, 30 * MINUTE, async () => {
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
			return await keep(`${this.#keptKey}\nget\n${path}`, 30 * MINUTE, () => this.#get(path, true));
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
			return await keep(`${this.#keptKey}\nrecent`, 30 * MINUTE, async () =>
				recentAttributeValues(
					await this.#send(
						"POST",
						"/rest/tempo-timesheets/4/worklogs/search",
						{ from: day(from), to: day(to), worker: [worker] },
						true,
					),
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
			this.#get(`/rest/api/2/issue/${valid}/worklog`, true).catch(() => ({})),
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

	#valid(key: string): string {
		const valid = issueKey(key);
		if (valid === null) throw new Error("Invalid issue key");
		return valid;
	}

	async attachment(id: string, name: string): Promise<Response> {
		if (!/^\d+$/.test(id)) throw new Error("Invalid attachment id");
		return this.#fetch(`${this.site}/secure/attachment/${id}/${encodeURIComponent(name)}`, {
			headers: { Accept: "*/*", Authorization: this.#auth },
		});
	}

	async assignableUsers(key: string, query: string): Promise<JiraUser[]> {
		const params = new URLSearchParams({
			issueKey: this.#valid(key),
			maxResults: "20",
			[this.cloud ? "query" : "username"]: query,
		});
		const raw = await this.#get(`/rest/api/2/user/assignable/search?${params.toString()}`);
		return asArray(raw).flatMap((item) => {
			const user = userOf(item, this.cloud);
			return user === null ? [] : [user];
		});
	}

	async assign(key: string, userId: string | null): Promise<void> {
		await this.#send(
			"PUT",
			`/rest/api/2/issue/${this.#valid(key)}/assignee`,
			assigneeBody(userId, this.cloud),
		);
	}

	async mentionUsers(query: string): Promise<JiraUser[]> {
		const params = new URLSearchParams({ query, maxResults: "10" });
		const raw = await this.#json(`/rest/api/2/user/picker?${params.toString()}`);
		return asArray(raw.users).flatMap((item) => {
			const user = userOf(item, this.cloud);
			return user === null ? [] : [user];
		});
	}

	async sprints(key: string, boardId: string | null): Promise<JiraSprint[]> {
		const valid = this.#valid(key);
		let board = boardId;
		if (board === null) {
			const project = valid.slice(0, valid.lastIndexOf("-"));
			const boards = await this.#json(
				`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}&type=scrum`,
			);
			const first = asJson(asArray(boards.values)[0]).id;
			board = first === undefined ? null : String(first);
		}
		if (board === null || !/^\d+$/.test(board)) return [];
		const raw = await this.#json(
			`/rest/agile/1.0/board/${board}/sprint?state=active,future&maxResults=50`,
		);
		const found = board;
		return asArray(raw.values).flatMap((item) => {
			const sprint = asJson(item);
			const id = String(sprint.id ?? "");
			if (id === "") return [];
			return [{ id, name: asString(sprint.name), state: asString(sprint.state), boardId: found }];
		});
	}

	async moveToSprint(key: string, sprintId: string | null): Promise<void> {
		const issues = [this.#valid(key)];
		if (sprintId === null) {
			await this.#send("POST", "/rest/agile/1.0/backlog/issue", { issues });
			return;
		}
		if (!/^\d+$/.test(sprintId)) throw new Error("Invalid sprint id");
		await this.#send("POST", `/rest/agile/1.0/sprint/${sprintId}/issue`, { issues });
	}

	async fieldOptions(key: string, field: JiraEditableField): Promise<JiraOption[]> {
		const meta = await this.#json(`/rest/api/2/issue/${this.#valid(key)}/editmeta`);
		const options = optionsOf(asJson(asJson(meta.fields)[field.fieldId]).allowedValues);
		if (options.length > 0 || !/tempo-teams/i.test(field.custom)) return options;
		return optionsOf(await this.#get("/rest/tempo-teams/2/team"));
	}

	async setField(key: string, field: JiraEditableField, option: JiraOption | null): Promise<void> {
		if (!/^customfield_\d+$/.test(field.fieldId)) throw new Error("Invalid field");
		await this.#send("PUT", `/rest/api/2/issue/${this.#valid(key)}`, {
			fields: { [field.fieldId]: fieldValueBody(field, option) },
		});
	}

	async setDescription(key: string, value: string): Promise<void> {
		await this.#send("PUT", `/rest/api/2/issue/${this.#valid(key)}`, {
			fields: { description: value },
		});
	}

	async updateLabels(
		key: string,
		add: readonly string[],
		remove: readonly string[],
	): Promise<void> {
		await this.#send("PUT", `/rest/api/2/issue/${this.#valid(key)}`, labelsBody(add, remove));
	}

	async labelSuggestions(query: string): Promise<string[]> {
		if (this.cloud) {
			const params = new URLSearchParams({ fieldName: "labels", fieldValue: query });
			const raw = await this.#json(
				`/rest/api/2/jql/autocompletedata/suggestions?${params.toString()}`,
			);
			return asArray(raw.results)
				.map((item) => asString(asJson(item).value))
				.filter(Boolean);
		}
		const raw = await this.#json(`/rest/api/1.0/labels/suggest?query=${encodeURIComponent(query)}`);
		return asArray(raw.suggestions)
			.map((item) => asString(asJson(item).label))
			.filter(Boolean);
	}

	async addCommentWiki(key: string, wiki: string): Promise<JiraComment> {
		const raw = await this.#send(
			"POST",
			`/rest/api/2/issue/${this.#valid(key)}/comment?expand=renderedBody`,
			{ body: wiki },
		);
		return commentOf(raw, asJson(raw).renderedBody);
	}

	async uploadAttachment(
		key: string,
		name: string,
		data: Uint8Array,
		mediaType: string,
	): Promise<JiraAttachment[]> {
		const valid = this.#valid(key);
		const boundary = `----kalem${Date.now().toString(16)}`;
		const safeName = name.replace(/["\r\n]/g, "_");
		const head = Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
		);
		const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
		const response = await this.#fetch(`${this.site}/rest/api/2/issue/${valid}/attachments`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				Authorization: this.#auth,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
				"X-Atlassian-Token": "no-check",
			},
			body: Buffer.concat([head, Buffer.from(data), tail]),
		});
		if (!response.ok) throw new JiraError(response.status, `HTTP ${response.status}`);
		return attachmentsOf(parseJsonOrJsonp(await response.text()));
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
				await keep(`${this.#keptKey}\ndev\n${issueId}`, 5 * MINUTE, () =>
					this.#get(`/rest/dev-status/1.0/issue/summary?issueId=${issueId}`, true),
				),
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
			const [me, issue] = await Promise.all([
				this.#me(),
				this.#json(`/rest/api/2/issue/${valid}?fields=id`),
			]);
			// Tempo names the issue by its id, as its own dialog does.
			const id = asString(issue.id);
			await this.#send(
				"POST",
				"/rest/tempo-timesheets/4/worklogs",
				tempoWorklogBody(/^\d+$/.test(id) ? id : valid, me.key, entry, attributes),
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
