type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export interface JiraAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly url: string;
}

export interface JiraOption {
	readonly id: string;
	readonly name: string;
}

export interface JiraSprint extends JiraOption {
	readonly state: string;
	readonly boardId: string | null;
}

export interface JiraUser {
	readonly id: string;
	readonly name: string;
}

export interface JiraEditableField {
	readonly fieldId: string;
	readonly name: string;
	readonly custom: string;
}

export interface JiraParentLink {
	readonly key: string;
	readonly summary: string;
}

export interface JiraFieldEntry {
	readonly id: string;
	readonly name: string;
	readonly kind: "text" | "person" | "duration" | "date";
	readonly value: string;
	readonly durationMs: number | null;
	readonly empty: boolean;
	readonly field: JiraEditableField | null;
	readonly option: JiraOption | null;
}

export interface JiraStatusChange {
	readonly at: string;
	readonly from: string;
	readonly to: string;
}

export const SPRINT_SCHEMA = "com.pyxis.greenhopper.jira:gh-sprint";
const TEAM_FIELD = /^(?:takım|takim|TAKIM)$/i;
const PARENT_LINK_FIELD = /^parent link$/i;
const EPIC_LINK_FIELD = /^epic link$/i;

export function attachmentsOf(value: unknown): JiraAttachment[] {
	return asArray(value).flatMap((item) => {
		const file = asJson(item);
		const id = String(file.id ?? "");
		const filename = asString(file.filename);
		if (id === "" || filename === "") return [];
		return [{ id, filename, mimeType: asString(file.mimeType), url: asString(file.content) }];
	});
}

export function attachmentPathOf(src: string): { id: string; name: string } | null {
	const match = /\/secure\/(?:attachment|thumbnail)\/(\d+)\/([^?#]+)/.exec(src);
	if (match === null) return null;
	let name = match[2] as string;
	try {
		name = decodeURIComponent(name);
	} catch {}
	return { id: match[1] as string, name: name.replace(/^_thumb_\d+\.png$/, "") };
}

export function attachmentFor(
	src: string,
	attachments: readonly JiraAttachment[],
): JiraAttachment | null {
	const path = attachmentPathOf(src);
	if (path !== null) {
		const byId = attachments.find((file) => file.id === path.id);
		if (byId !== undefined) return byId;
		if (path.name !== "") return { id: path.id, filename: path.name, mimeType: "", url: "" };
	}
	let name = src.split(/[?#]/)[0]?.split("/").pop() ?? "";
	try {
		name = decodeURIComponent(name);
	} catch {}
	if (name === "") return null;
	const matches = attachments.filter((file) => file.filename === name);
	return matches.at(-1) ?? null;
}

export function sprintOf(value: unknown): JiraSprint | null {
	const all = asArray(value).map((item): JiraSprint | null => {
		if (typeof item === "string") {
			const pairs = new Map<string, string>();
			const body = /\[(.*)\]$/.exec(item)?.[1] ?? "";
			for (const match of body.matchAll(/(\w+)=([^,]*?)(?=,\w+=|$)/g)) {
				pairs.set(match[1] as string, match[2] as string);
			}
			const id = pairs.get("id") ?? "";
			if (id === "") return null;
			const board = pairs.get("rapidViewId") ?? "";
			return {
				id,
				name: pairs.get("name") ?? id,
				state: pairs.get("state") ?? "",
				boardId: board === "" || board === "<null>" ? null : board,
			};
		}
		const record = asJson(item);
		const id = String(record.id ?? "");
		if (id === "") return null;
		const board = record.boardId ?? record.originBoardId;
		return {
			id,
			name: asString(record.name) || id,
			state: asString(record.state),
			boardId: board === undefined || board === null ? null : String(board),
		};
	});
	const sprints = all.filter((sprint): sprint is JiraSprint => sprint !== null);
	const open = sprints.filter((sprint) => !/^closed$/i.test(sprint.state));
	return open.at(-1) ?? sprints.at(-1) ?? null;
}

export function optionOf(value: unknown): JiraOption | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "string" || typeof value === "number") {
		return { id: String(value), name: String(value) };
	}
	const record = asJson(value);
	const id = String(record.id ?? record.key ?? record.value ?? record.name ?? "");
	const name =
		asString(record.title) ||
		asString(record.name) ||
		asString(record.value) ||
		asString(record.displayName) ||
		id;
	return id === "" && name === "" ? null : { id: id || name, name };
}

export function fieldText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") {
		if (/^\{summaryBean=|^\{\}$|^[0-9]+\|[a-z0-9]+:/i.test(value)) return "";
		if (/^com\.atlassian\.greenhopper\.service\.sprint\.Sprint@/.test(value)) {
			return sprintOf([value])?.name ?? "";
		}
		return value.trim();
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		return value
			.map(fieldText)
			.filter((text) => text !== "")
			.join(", ");
	}
	const record = asJson(value);
	const child = record.child === undefined ? "" : fieldText(record.child);
	const own =
		asString(record.displayName) ||
		asString(record.name) ||
		asString(record.value) ||
		asString(record.title) ||
		asString(record.key) ||
		fieldText(asJson(record.data).key);
	return [own, child].filter((part) => part !== "").join(" › ");
}

export function isEmptyFieldText(text: string): boolean {
	return /^(?:|none|null|yok|-|—)$/i.test(text.trim());
}

const SHOWN_ELSEWHERE = new Set([
	"summary",
	"status",
	"issuetype",
	"project",
	"created",
	"updated",
	"assignee",
	"labels",
	"description",
	"comment",
	"subtasks",
	"issuelinks",
	"parent",
	"timetracking",
	"attachment",
	"worklog",
	"watches",
	"votes",
	"lastViewed",
	"timespent",
	"timeoriginalestimate",
	"timeestimate",
	"aggregatetimespent",
	"aggregatetimeoriginalestimate",
	"aggregatetimeestimate",
	"aggregateprogress",
	"progress",
	"workratio",
	"statuscategorychangedate",
	"thumbnail",
	"environment",
	"reporter",
	"priority",
	"resolution",
	"components",
	"fixVersions",
	"duedate",
	"resolutiondate",
]);

export interface IssueCustomFields {
	readonly sprint: JiraEditableField | null;
	readonly sprintValue: JiraSprint | null;
	readonly team: JiraEditableField | null;
	readonly teamValue: JiraOption | null;
	readonly parentLink: JiraParentLink | null;
	readonly allFields: readonly JiraFieldEntry[];
}

function parentLinkOf(value: unknown): JiraParentLink | null {
	if (typeof value === "string") {
		return /^[A-Z][A-Z0-9_]*-\d+$/.test(value.trim()) ? { key: value.trim(), summary: "" } : null;
	}
	const record = asJson(value);
	const data = asJson(record.data);
	const key = asString(data.key) || asString(record.key);
	if (key === "") return null;
	const summary =
		asString(data.summary) || asString(asJson(record.fields).summary) || asString(record.summary);
	return { key, summary };
}

export interface TimeInStatusValue {
	readonly ms: number;
	readonly running: boolean;
	readonly updated: number;
}

export function timeInStatusOf(value: unknown): TimeInStatusValue | null {
	if (typeof value !== "string") return null;
	const match = /^\s*TimeInStatus\((.*)\)\s*$/.exec(value);
	if (match === null) return null;
	const pairs = new Map<string, string>();
	for (const part of (match[1] ?? "").split(",")) {
		const [key, ...rest] = part.split("=");
		if (key !== undefined) pairs.set(key.trim(), rest.join("=").trim());
	}
	const ms = Number(pairs.get("timeInStatus"));
	const updated = Number(pairs.get("updateTime"));
	return {
		ms: Number.isFinite(ms) && ms > 0 ? ms : 0,
		running: pairs.get("running") === "true",
		updated: Number.isFinite(updated) ? updated : 0,
	};
}

const INTERNAL_VALUE = /^[\w$.]+@[0-9a-f]{4,}\b|^[A-Z]\w*\(\w+=.*\)$|_\*:\*_/;

function isEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "string") return isEmptyFieldText(value);
	return false;
}

const isPerson = (value: unknown): boolean => {
	const record = asJson(value);
	return (
		asString(record.displayName) !== "" &&
		(asString(record.name) !== "" || asString(record.accountId) !== "" || "emailAddress" in record)
	);
};

export function customFieldsOf(raw: unknown, now = Date.now()): IssueCustomFields {
	const issue = asJson(raw);
	const fields = asJson(issue.fields);
	const names = asJson(issue.names);
	const schema = asJson(issue.schema);
	const editmeta = asJson(asJson(issue.editmeta).fields);
	const nameOf = (id: string): string => asString(names[id]) || id;
	const customOf = (id: string): string => asString(asJson(schema[id]).custom);
	const typeOf = (id: string): string => asString(asJson(schema[id]).type);
	const allowedOf = (id: string): JiraOption[] => optionsOf(asJson(editmeta[id]).allowedValues);

	const sprintIds: string[] = [];
	const teamIds: string[] = [];
	let parentLink: JiraParentLink | null = null;
	let epicLink: JiraParentLink | null = null;
	const used = new Set<string>();
	for (const id of Object.keys(fields)) {
		const name = nameOf(id).trim().normalize("NFC");
		const custom = customOf(id);
		if (custom === SPRINT_SCHEMA || (custom === "" && /^sprint$/i.test(name))) {
			sprintIds.push(id);
			used.add(id);
		} else if (TEAM_FIELD.test(name)) {
			teamIds.push(id);
			used.add(id);
		} else if (PARENT_LINK_FIELD.test(name)) {
			parentLink = parentLinkOf(fields[id]) ?? parentLink;
			used.add(id);
		} else if (EPIC_LINK_FIELD.test(name)) {
			epicLink = parentLinkOf(fields[id]);
		}
	}
	const pick = (ids: readonly string[]): string | null =>
		ids.find((id) => !isEmptyValue(fields[id])) ?? ids[0] ?? null;
	const sprintId = pick(sprintIds);
	const teamId = pick(teamIds);
	const editable = (id: string): JiraEditableField => ({
		fieldId: id,
		name: nameOf(id),
		custom: customOf(id),
	});
	const optionWithName = (id: string, value: unknown): JiraOption | null => {
		const option = optionOf(value);
		if (option === null || option.name !== option.id) return option;
		return allowedOf(id).find((allowed) => allowed.id === option.id) ?? option;
	};

	const parentField = asJson(fields.parent);
	const parent =
		parentLink ??
		(asString(parentField.key) === ""
			? epicLink
			: {
					key: asString(parentField.key),
					summary: asString(asJson(parentField.fields).summary),
				});

	const allFields: JiraFieldEntry[] = [];
	for (const [id, value] of Object.entries(fields)) {
		if (used.has(id) || SHOWN_ELSEWHERE.has(id)) continue;
		const name = nameOf(id);
		if (/^rank\b/i.test(name) || name === id) continue;
		const custom = customOf(id);
		const type = typeOf(id);
		const selectable =
			allowedOf(id).length > 0 && (type === "option" || /tempo-teams/i.test(custom));
		const base = {
			id,
			name,
			field: selectable ? editable(id) : null,
			option: selectable ? optionWithName(id, value) : null,
		};
		const time = timeInStatusOf(value);
		if (time !== null) {
			const ms = time.ms + (time.running && time.updated > 0 ? Math.max(0, now - time.updated) : 0);
			allFields.push({ ...base, kind: "duration", value: "", durationMs: ms, empty: ms === 0 });
			continue;
		}
		if ((type === "user" || isPerson(value)) && !Array.isArray(value)) {
			const text = fieldText(value);
			allFields.push({
				...base,
				kind: "person",
				value: text,
				durationMs: null,
				empty: text === "",
			});
			continue;
		}
		const text = fieldText(value);
		const internal = INTERNAL_VALUE.test(text);
		const date = type === "date" || type === "datetime" || /^\d{4}-\d{2}-\d{2}(T|$)/.test(text);
		allFields.push({
			...base,
			kind: date ? "date" : "text",
			value: internal ? "" : text,
			durationMs: null,
			empty: internal || isEmptyFieldText(text),
		});
	}
	allFields.sort((a, b) => a.name.localeCompare(b.name, "tr"));

	return {
		sprint: sprintId === null ? null : editable(sprintId),
		sprintValue: sprintId === null ? null : sprintOf(fields[sprintId]),
		team: teamId === null ? null : editable(teamId),
		teamValue: teamId === null ? null : optionWithName(teamId, fields[teamId]),
		parentLink: parent,
		allFields,
	};
}

export function statusChangesOf(raw: unknown): JiraStatusChange[] {
	const histories = asArray(asJson(asJson(raw).changelog).histories);
	const changes: JiraStatusChange[] = [];
	for (const history of histories.map(asJson)) {
		const at = asString(history.created);
		for (const item of asArray(history.items).map(asJson)) {
			if (asString(item.field) !== "status" || at === "") continue;
			changes.push({ at, from: asString(item.fromString), to: asString(item.toString) });
		}
	}
	return changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function userOf(raw: unknown, cloud: boolean): JiraUser | null {
	const record = asJson(raw);
	const id = cloud ? asString(record.accountId) : asString(record.name) || asString(record.key);
	if (id === "") return null;
	return { id, name: asString(record.displayName) || id };
}

export function mentionMarkup(user: JiraUser, cloud: boolean): string {
	return cloud ? `[~accountid:${user.id}]` : `[~${user.id}]`;
}

export function assigneeBody(userId: string | null, cloud: boolean): Json {
	return cloud ? { accountId: userId } : { name: userId };
}

export function fieldValueBody(field: JiraEditableField, option: JiraOption | null): unknown {
	if (option === null) return null;
	if (/tempo-teams/i.test(field.custom)) return option.id;
	if (/:(?:multiselect|multicheckboxes)$/i.test(field.custom)) return [{ id: option.id }];
	return { id: option.id };
}

export function labelsBody(add: readonly string[], remove: readonly string[]): Json {
	return {
		update: {
			labels: [
				...add.map((label) => ({ add: label })),
				...remove.map((label) => ({ remove: label })),
			],
		},
	};
}

export function normalizeLabel(text: string): string {
	return text.trim().replace(/\s+/g, "_");
}

export function optionsOf(raw: unknown): JiraOption[] {
	return asArray(raw).flatMap((item) => {
		const option = optionOf(item);
		return option === null ? [] : [option];
	});
}
