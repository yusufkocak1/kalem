/**
 * Jira issues as Kalem shows them: what the REST API's answer holds (an
 * issue with its fields, comments, sub-tasks and links; a search's issues),
 * the keys and addresses that name an issue, and the JQL a search box's
 * words become. Pure: the main process asks the server.
 */
import { wikiToMarkdown } from "./confluence-wiki.js";

/** Jira's three kinds of status, which give a status its colour. */
export type StatusCategory = "new" | "indeterminate" | "done" | "";

/** An issue as a list shows it. */
export interface JiraIssueRef {
	readonly key: string;
	readonly summary: string;
	readonly status: string;
	readonly statusCategory: StatusCategory;
	/** The issue type: Task, Bug, Story, Sub-task… */
	readonly type: string;
}

/** An issue in a search's results. */
export interface JiraIssueRow extends JiraIssueRef {
	readonly assignee: string;
	readonly priority: string;
	/** ISO date, or `null`. */
	readonly updated: string | null;
	/** The issue a sub-task belongs to; `null` for any other issue. */
	readonly parent: JiraIssueRef | null;
}

export interface JiraComment {
	readonly author: string;
	readonly created: string | null;
	/** As Markdown (for HTML, its text). */
	readonly body: string;
	/** The comment as HTML, when Jira keeps it so (an HTML editor plug-in); `null` for wiki markup. */
	readonly html: string | null;
}

/** A link to something outside Jira: a Confluence page that mentions the issue, a web page. */
export interface JiraRemoteLink {
	/** "mentioned in", "wiki page", "links to"… */
	readonly relation: string;
	readonly title: string;
	readonly url: string;
	/** The Confluence page's id, when it is on the Confluence site the app is connected to. */
	readonly pageId: string | null;
}

export interface JiraIssueLink {
	/** How it is linked, as seen from this issue: "blocks", "is blocked by", "relates to"… */
	readonly relation: string;
	readonly issue: JiraIssueRef;
}

export interface JiraIssue extends JiraIssueRow {
	/** Jira's number for it, which its development information is asked by. */
	readonly id: string;
	/** Its address in the browser. */
	readonly url: string;
	readonly project: string;
	readonly reporter: string;
	readonly created: string | null;
	readonly due: string | null;
	readonly resolution: string;
	readonly labels: readonly string[];
	readonly components: readonly string[];
	readonly fixVersions: readonly string[];
	/** As Markdown (for HTML, its text). */
	readonly description: string;
	/** The description as HTML, when Jira keeps it so (an HTML editor plug-in); `null` for wiki markup. */
	readonly descriptionHtml: string | null;
	readonly parent: JiraIssueRef | null;
	readonly subtasks: readonly JiraIssueRef[];
	readonly links: readonly JiraIssueLink[];
	/** Links outside Jira (Confluence pages…), as the issue's "Issue Links" lists them. */
	readonly remoteLinks: readonly JiraRemoteLink[];
	/** The latest comments, oldest first. */
	readonly comments: readonly JiraComment[];
	/** How many comments the issue has in all. */
	readonly commentTotal: number;
	/** Time tracking, in seconds; `null` where Jira keeps none (or does not track time). */
	readonly time: {
		readonly spent: number | null;
		readonly remaining: number | null;
		readonly estimate: number | null;
	};
}

export interface JiraSearchResults {
	readonly jql: string;
	readonly issues: readonly JiraIssueRow[];
	/** `null` where the server does not count them (Cloud). */
	readonly total: number | null;
	/** Continues the search; `null` when there are no more. */
	readonly next: string | null;
}

/** What the app knows of its Jira connection. */
export interface JiraAccount {
	readonly site: string;
	readonly username: string;
	readonly cloud: boolean;
	/** True when it is Confluence Cloud's own login, on the same Atlassian site. */
	readonly shared: boolean;
}

/** The fields an issue is asked for with; the rest would only make the answer longer. */
export const ISSUE_FIELDS = [
	"summary",
	"status",
	"issuetype",
	"priority",
	"assignee",
	"reporter",
	"created",
	"updated",
	"duedate",
	"resolution",
	"labels",
	"components",
	"fixVersions",
	"description",
	"comment",
	"subtasks",
	"issuelinks",
	"parent",
	"project",
	"timetracking",
] as const;

export const ROW_FIELDS = [
	"summary",
	"status",
	"issuetype",
	"priority",
	"assignee",
	"updated",
	"parent",
] as const;

/** Comments kept of an issue: the latest ones. */
export const MAX_COMMENTS = 20;

const KEY = /^[A-Z][A-Z0-9_]*-[1-9]\d*$/;

/** The issue key in upper case, or `null` when the text is not one. */
export function issueKey(text: string): string | null {
	// kalem-locale-ok: issue keys are ASCII
	const key = text.trim().toUpperCase();
	return KEY.test(key) ? key : null;
}

/**
 * The issue an address points to: `/browse/KEY`, a board's
 * `selectedIssue=KEY`, Cloud's `/issues/KEY` and `/jira/…/issues/KEY`.
 * `null` for any other address.
 */
export function issueKeyFromUrl(text: string): string | null {
	let url: URL;
	try {
		url = new URL(text.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const selected = url.searchParams.get("selectedIssue");
	if (selected !== null && issueKey(selected) !== null) return issueKey(selected);
	const path = /\/(?:browse|issues)\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/.exec(url.pathname);
	return path?.[1] === undefined ? null : issueKey(path[1]);
}

/** Words that make a search box's text JQL rather than words to look for. */
const JQL_SIGNS =
	/(?:[=~<>]|!=|\b(?:AND|OR|NOT|IN|IS|WAS|ORDER\s+BY|EMPTY|NULL|currentUser\(\))\b)/;

const jqlString = (text: string): string => `"${text.replace(/["\\]/g, "\\$&")}"`;

/**
 * The JQL for what is typed in the search box: a key is that issue, JQL
 * stays JQL, other words are looked for in the issues' text.
 */
export function searchJql(query: string): string {
	const text = query.trim();
	if (text === "") return "ORDER BY updated DESC";
	const key = issueKey(text) ?? issueKeyFromUrl(text);
	if (key !== null) return `key = ${key}`;
	if (JQL_SIGNS.test(text)) return text;
	return `text ~ ${jqlString(text)} ORDER BY updated DESC`;
}

/** A Jira site as the user typed it: its root, without a page's path. Cloud sites are their origin. */
export function normalizeJiraSite(input: string): string {
	let raw = input.trim();
	if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
	const url = new URL(raw);
	if (/\.(atlassian\.net|jira\.com)$/i.test(url.hostname)) return url.origin;
	const path = url.pathname
		.replace(/\/+$/, "")
		.replace(/\/(browse|secure|rest|projects|issues|plugins|login\.jsp)(\/.*)?$/i, "");
	return `${url.protocol}//${url.host}${path}`;
}

export const issueUrl = (site: string, key: string): string =>
	`${site.replace(/\/+$/, "")}/browse/${key}`;

export const searchUrl = (site: string, jql: string): string =>
	`${site.replace(/\/+$/, "")}/issues/?jql=${encodeURIComponent(jql)}`;

// --- The REST API's answers ---------------------------------------------------

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const nameOf = (value: unknown): string => {
	const record = asJson(value);
	return asString(record.displayName) || asString(record.name) || asString(record.value);
};
const names = (value: unknown): string[] =>
	asArray(value)
		.map((item) => (typeof item === "string" ? item : nameOf(item)))
		.filter((name) => name !== "");
const date = (value: unknown): string | null => asString(value) || null;

function category(status: Json): StatusCategory {
	const key = asString(asJson(status.statusCategory).key);
	return key === "new" || key === "indeterminate" || key === "done" ? key : "";
}

/**
 * Whether Jira keeps the text as HTML rather than wiki markup: some sites
 * have an HTML editor plug-in (JEditor) that writes `<div class="jePanel_…">`
 * and `<p>` into the field.
 */
export function looksLikeHtml(text: string): boolean {
	return (
		/^\s*<(?:div|p|span|table|ul|ol|h[1-6]|b|strong|font|br|pre|blockquote)\b[^>]*>/i.test(text) &&
		/<\/(?:div|p|span|li|td|b|strong|font|pre|blockquote|h[1-6])>/i.test(text)
	);
}

/** The HTML as an HTML editor plug-in stores it: lines it continued with a backslash are joined. */
export function cleanJiraHtml(html: string): string {
	return html.replace(/\\(?=\s*(?:<|$))/gm, "").trim();
}

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** HTML's text, a block a line, for the assistant: no tags, entities read. */
export function htmlText(html: string): string {
	return cleanJiraHtml(html)
		.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "\n- ")
		.replace(/<\/(?:p|div|h[1-6]|tr|table|ul|ol|blockquote|pre)>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
			if (name.startsWith("#")) {
				const code =
					name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
				return Number.isFinite(code) && code > 0 && code < 0x110000
					? String.fromCodePoint(code)
					: whole;
			}
			return ENTITIES[name.toLowerCase()] ?? whole; // kalem-locale-ok: entity names are ASCII
		})
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** A text field: Markdown for the model, and its HTML when Jira keeps HTML (`rendered` is Jira's own rendering). */
function textField(value: unknown, rendered: unknown): { text: string; html: string | null } {
	if (typeof value === "string" && looksLikeHtml(value)) {
		const html =
			typeof rendered === "string" && rendered.trim() !== "" ? rendered : cleanJiraHtml(value);
		return { text: htmlText(html), html };
	}
	return { text: jiraText(value), html: null };
}

/** Jira's text: wiki markup from the v2 API; an Atlassian document (Cloud's v3) is read for its text. */
export function jiraText(value: unknown): string {
	if (typeof value === "string") return wikiToMarkdown(value).trim();
	if (typeof value !== "object" || value === null) return "";
	return adfText(value).trim();
}

/** The text of an Atlassian document, a paragraph a line. */
function adfText(node: unknown): string {
	const record = asJson(node);
	if (record.type === "text") return asString(record.text);
	if (record.type === "hardBreak") return "\n";
	if (record.type === "mention" || record.type === "emoji") {
		return asString(asJson(record.attrs).text);
	}
	const inner = asArray(record.content).map(adfText).join("");
	const block = ["paragraph", "heading", "listItem", "codeBlock", "blockquote", "panel"];
	return block.includes(asString(record.type)) ? `${inner}\n\n` : inner;
}

/** An issue as lists show it; `null` when the answer has no key. */
export function issueRefOf(raw: unknown): JiraIssueRef | null {
	const issue = asJson(raw);
	const key = asString(issue.key);
	if (key === "") return null;
	const fields = asJson(issue.fields);
	const status = asJson(fields.status);
	return {
		key,
		summary: asString(fields.summary),
		status: asString(status.name),
		statusCategory: category(status),
		type: nameOf(fields.issuetype),
	};
}

export function issueRowOf(raw: unknown): JiraIssueRow | null {
	const ref = issueRefOf(raw);
	if (ref === null) return null;
	const fields = asJson(asJson(raw).fields);
	return {
		...ref,
		assignee: nameOf(fields.assignee),
		priority: nameOf(fields.priority),
		updated: date(fields.updated),
		parent: issueRefOf(fields.parent),
	};
}

/** A parent issue with its sub-tasks, as a list shows them: the sub-tasks under it. */
export interface IssueGroup {
	readonly parent: JiraIssueRef;
	/** The parent's own row when the search found it; `null` when only its sub-tasks matched. */
	readonly row: JiraIssueRow | null;
	readonly children: readonly JiraIssueRow[];
}

/**
 * A search's issues as a tree: each sub-task under its parent, in the
 * order the search gave (a group where its parent or first sub-task was).
 * A parent the search did not find still heads its sub-tasks.
 */
export function groupByParent(rows: readonly JiraIssueRow[]): IssueGroup[] {
	const groups = new Map<
		string,
		{ parent: JiraIssueRef; row: JiraIssueRow | null; children: JiraIssueRow[] }
	>();
	for (const row of rows) {
		const parent = row.parent;
		if (parent !== null && parent.key !== row.key) {
			const group = groups.get(parent.key) ?? {
				parent,
				row: null,
				children: [],
			};
			group.children.push(row);
			groups.set(parent.key, group);
			continue;
		}
		const group = groups.get(row.key);
		if (group === undefined) groups.set(row.key, { parent: row, row, children: [] });
		else {
			group.row = row;
			group.parent = row;
		}
	}
	// A parent found after its sub-tasks keeps their place.
	return [...groups.values()];
}

/** The families of issue types a list draws with their own colour and mark. */
export type IssueTypeKind =
	| "bug"
	| "story"
	| "task"
	| "subtask"
	| "epic"
	| "feature"
	| "improvement"
	| "other";

/** Type names, in English and Turkish, by the family they belong to. */
const TYPE_KINDS: readonly (readonly [IssueTypeKind, RegExp])[] = [
	["subtask", /^(sub[- ]?task|alt[- ]?görev|technical sub[- ]?task)/],
	["bug", /(bug|defect|hata|incident|problem)/],
	["epic", /^(epic|destan)/],
	["story", /(story|hikaye|hikâye)/],
	["feature", /(feature|özellik)/],
	["improvement", /(improvement|iyileştirme|enhancement)/],
	["task", /(task|görev|^iş$)/],
];

/** The family an issue type belongs to, for its colour and mark; `other` when it is none of them. */
export function issueTypeKind(type: string): IssueTypeKind {
	const text = type.trim();
	if (text === "") return "other";
	// Lower-cased both ways: "IMPROVEMENT" is English, "İYİLEŞTİRME" Turkish.
	const names = [text.toLocaleLowerCase("en"), text.toLocaleLowerCase("tr")];
	for (const [kind, pattern] of TYPE_KINDS) {
		if (names.some((name) => pattern.test(name))) return kind;
	}
	return "other";
}

/** The issue types among rows, with how many of each, most first (ties by first seen). */
export function typeCounts(
	rows: readonly JiraIssueRow[],
): { readonly type: string; readonly count: number }[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (row.type === "") continue;
		counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
	}
	return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

/** The whole issue, with its description and comments as Markdown. */
export function issueOf(raw: unknown, site: string): JiraIssue | null {
	const row = issueRowOf(raw);
	if (row === null) return null;
	const fields = asJson(asJson(raw).fields);
	const comment = asJson(fields.comment);
	const comments = asArray(comment.comments);
	// What Jira shows (`expand=renderedFields`): the HTML of the fields it keeps as HTML.
	const rendered = asJson(asJson(raw).renderedFields);
	const renderedComments = asArray(asJson(rendered.comment).comments);
	const description = textField(fields.description, rendered.description);
	const links = asArray(fields.issuelinks).flatMap((item): JiraIssueLink[] => {
		const link = asJson(item);
		const type = asJson(link.type);
		const outward = issueRefOf(link.outwardIssue);
		if (outward !== null) {
			return [{ relation: asString(type.outward) || asString(type.name), issue: outward }];
		}
		const inward = issueRefOf(link.inwardIssue);
		if (inward !== null) {
			return [{ relation: asString(type.inward) || asString(type.name), issue: inward }];
		}
		return [];
	});
	return {
		...row,
		id: asString(asJson(raw).id),
		url: issueUrl(site, row.key),
		project: nameOf(fields.project),
		reporter: nameOf(fields.reporter),
		created: date(fields.created),
		due: date(fields.duedate),
		resolution: nameOf(fields.resolution),
		labels: names(fields.labels),
		components: names(fields.components),
		fixVersions: names(fields.fixVersions),
		description: description.text,
		descriptionHtml: description.html,
		parent: issueRefOf(fields.parent),
		subtasks: asArray(fields.subtasks).flatMap((item) => {
			const ref = issueRefOf(item);
			return ref === null ? [] : [ref];
		}),
		links,
		remoteLinks: [],
		comments: comments.slice(-MAX_COMMENTS).map((item, index) => {
			const entry = asJson(item);
			const at = comments.length - Math.min(MAX_COMMENTS, comments.length) + index;
			const body = textField(entry.body, asJson(renderedComments[at]).body);
			return {
				author: nameOf(entry.author),
				created: date(entry.created),
				body: body.text,
				html: body.html,
			};
		}),
		commentTotal: typeof comment.total === "number" ? comment.total : comments.length,
		time: {
			spent: seconds(asJson(fields.timetracking).timeSpentSeconds),
			remaining: seconds(asJson(fields.timetracking).remainingEstimateSeconds),
			estimate: seconds(asJson(fields.timetracking).originalEstimateSeconds),
		},
	};
}

/** A number of seconds Jira sent; `null` for anything else. */
function seconds(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// --- For the assistant -------------------------------------------------------

const refText = (ref: JiraIssueRef): string =>
	`${ref.key} ${ref.summary}${ref.status === "" ? "" : ` [${ref.status}]`}`;

/** An issue for the model: its fields, description, sub-tasks, links and comments. */
export function issueText(issue: JiraIssue): string {
	const facts: [string, string][] = [
		["Type", issue.type],
		["Status", issue.status],
		["Resolution", issue.resolution],
		["Priority", issue.priority],
		["Project", issue.project],
		["Assignee", issue.assignee || "Unassigned"],
		["Reporter", issue.reporter],
		["Created", issue.created?.slice(0, 10) ?? ""],
		["Updated", issue.updated?.slice(0, 10) ?? ""],
		["Due", issue.due ?? ""],
		["Labels", issue.labels.join(", ")],
		["Components", issue.components.join(", ")],
		["Fix versions", issue.fixVersions.join(", ")],
		["Parent", issue.parent === null ? "" : refText(issue.parent)],
	];
	const lines = [
		`Issue ${issue.key}: ${issue.summary}`,
		issue.url,
		"",
		...facts.filter(([, value]) => value !== "").map(([name, value]) => `${name}: ${value}`),
		"",
		"Description:",
		issue.description === "" ? "(none)" : issue.description,
	];
	if (issue.subtasks.length > 0) {
		lines.push("", "Sub-tasks:", ...issue.subtasks.map((ref) => `- ${refText(ref)}`));
	}
	if (issue.links.length > 0) {
		lines.push(
			"",
			"Linked issues:",
			...issue.links.map((link) => `- ${link.relation}: ${refText(link.issue)}`),
		);
	}
	if (issue.remoteLinks.length > 0) {
		lines.push(
			"",
			"Links outside Jira:",
			...issue.remoteLinks.map(
				(link) =>
					`- ${link.relation}: ${link.title} ${link.url}${link.pageId === null ? "" : ` (Confluence page id ${link.pageId})`}`,
			),
		);
	}
	if (issue.comments.length > 0) {
		const skipped = issue.commentTotal - issue.comments.length;
		lines.push(
			"",
			`Comments (${issue.commentTotal}${skipped > 0 ? `, the latest ${issue.comments.length}` : ""}):`,
			...issue.comments.map(
				(entry) =>
					`- ${entry.author}${entry.created === null ? "" : `, ${entry.created.slice(0, 10)}`}: ${entry.body.replace(/\n+/g, " ")}`,
			),
		);
	}
	return lines.join("\n");
}

/** A search's issues for the model. */
export function searchText(found: JiraSearchResults, site: string, shown = 25): string {
	const count =
		found.total === null
			? `${found.issues.length}${found.next === null ? "" : "+"} issues`
			: `${found.total} issues`;
	const head = `Jira search \`${found.jql}\`: ${count}${found.issues.length < (found.total ?? 0) || found.next !== null ? `, the first ${Math.min(shown, found.issues.length)} below` : ""}.`;
	if (found.issues.length === 0) {
		return `${head}\nNothing found. Try other words, or a wider JQL (fewer conditions, another project).`;
	}
	const lines = found.issues.slice(0, shown).map((row) => {
		const facts = [
			row.type,
			row.status,
			row.assignee === "" ? "unassigned" : `assignee ${row.assignee}`,
			row.updated === null ? "" : `updated ${row.updated.slice(0, 10)}`,
		].filter((part) => part !== "");
		return `- ${row.key} ${row.summary} (${facts.join(", ")}) ${issueUrl(site, row.key)}`;
	});
	return `${head}\n${lines.join("\n")}`;
}

/**
 * The issue's links outside Jira (`/rest/api/2/issue/KEY/remotelink`):
 * Confluence's "mentioned in" and "wiki page" links, web links. Their page
 * ids are filled in by the main process, which knows the Confluence site.
 */
export function remoteLinksOf(raw: unknown): JiraRemoteLink[] {
	return asArray(raw).flatMap((item): JiraRemoteLink[] => {
		const link = asJson(item);
		const object = asJson(link.object);
		const url = asString(object.url);
		if (!/^https?:\/\//i.test(url)) return [];
		const confluence = /confluence/i.test(asString(asJson(link.application).type));
		return [
			{
				relation: asString(link.relationship) || (confluence ? "wiki page" : "links to"),
				title: asString(object.title) || url,
				url,
				pageId: null,
			},
		];
	});
}
