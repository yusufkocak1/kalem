/**
 * What the assistant's Jira writes need beyond a summary and a description:
 * the fields a screen shows (`editmeta`, `createmeta`) with their types and
 * choices, a value the model gives turned into what Jira takes, an issue's
 * own values copied onto a new one (a clone), and link types. Pure: the
 * main process asks Jira.
 */
import { markdownToWiki } from "./confluence-wiki.js";
import { SPRINT_SCHEMA, sprintOf } from "./jira-fields.js";

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const fold = (text: string): string => text.trim().normalize("NFC").toLocaleLowerCase("tr");

/** One choice of a field: an option, a priority, a version, a component… */
export interface FieldChoice {
	readonly id: string;
	readonly name: string;
	/** An option's child choices (a cascading select). */
	readonly children: readonly FieldChoice[];
}

/** A field as a screen shows it. */
export interface FieldMeta {
	readonly id: string;
	readonly name: string;
	readonly required: boolean;
	readonly hasDefault: boolean;
	/** The schema's type: string, number, date, datetime, option, user, array, any… */
	readonly type: string;
	/** An array's items' type. */
	readonly items: string;
	/** A custom field's plug-in type (`com.atlassian.jira.plugin.system.customfieldtypes:select`). */
	readonly custom: string;
	/** A system field's name (`priority`, `components`). */
	readonly system: string;
	readonly choices: readonly FieldChoice[];
}

function choiceOf(raw: unknown): FieldChoice | null {
	const item = asJson(raw);
	const id = String(item.id ?? item.key ?? "");
	const name =
		asString(item.value) ||
		asString(item.name) ||
		asString(item.displayName) ||
		asString(item.title) ||
		asString(item.key) ||
		id;
	if (id === "" && name === "") return null;
	return {
		id: id || name,
		name,
		children: asArray(item.children).flatMap((child) => {
			const found = choiceOf(child);
			return found === null ? [] : [found];
		}),
	};
}

function metaOf(id: string, raw: unknown): FieldMeta | null {
	const field = asJson(raw);
	const schema = asJson(field.schema);
	const fieldId = id || asString(field.fieldId) || asString(field.key);
	if (fieldId === "") return null;
	return {
		id: fieldId,
		name: asString(field.name) || fieldId,
		required: field.required === true,
		hasDefault: field.hasDefaultValue === true,
		type: asString(schema.type),
		items: asString(schema.items),
		custom: asString(schema.custom),
		system: asString(schema.system),
		choices: asArray(field.allowedValues).flatMap((item) => {
			const choice = choiceOf(item);
			return choice === null ? [] : [choice];
		}),
	};
}

/**
 * The fields of a screen, in whichever shape Jira gave them: `editmeta`'s
 * and the old `createmeta`'s object by field id, or the newer
 * `createmeta/{project}/issuetypes/{type}` list (`values`, or `fields`).
 */
export function fieldMetasOf(raw: unknown): FieldMeta[] {
	const body = asJson(raw);
	const project = asJson(asArray(body.projects)[0]);
	const issueType = asJson(asArray(project.issuetypes)[0]);
	const source =
		body.fields ??
		(Object.keys(issueType).length > 0 ? issueType.fields : undefined) ??
		body.values;
	const metas = Array.isArray(source)
		? source.map((item) => metaOf("", item))
		: Object.entries(asJson(source)).map(([id, item]) => metaOf(id, item));
	return metas.filter((meta): meta is FieldMeta => meta !== null);
}

/** A field named by its id (`customfield_10010`, `priority`) or its name, as the screen shows it. */
export function findField(metas: readonly FieldMeta[], named: string): FieldMeta | null {
	const wanted = fold(named);
	if (wanted === "") return null;
	return (
		metas.find(
			(meta) => meta.id.toLocaleLowerCase("en") === named.trim().toLocaleLowerCase("en"),
		) ??
		metas.find((meta) => fold(meta.name) === wanted) ??
		null
	);
}

const TEXTAREA = /:textarea$/i;
const CASCADING = /:cascadingselect$/i;
const TEMPO_TEAM = /tempo-teams/i;
const EPIC_LINK = /:gh-epic-link$/i;

/** Whether a field's text is wiki markup, which Kalem writes from Markdown. */
const isRichText = (meta: FieldMeta): boolean =>
	meta.system === "description" || meta.system === "environment" || TEXTAREA.test(meta.custom);

export type FieldValue =
	| { readonly ok: true; readonly value: unknown; readonly shown: string }
	| { readonly ok: false; readonly error: string };

const fail = (error: string): FieldValue => ({ ok: false, error });

function pickChoice(choices: readonly FieldChoice[], given: string): FieldChoice | null {
	const wanted = fold(given);
	return (
		choices.find((choice) => choice.id === given.trim()) ??
		choices.find((choice) => fold(choice.name) === wanted) ??
		choices.find((choice) => fold(choice.name).includes(wanted) && wanted !== "") ??
		null
	);
}

const choiceList = (choices: readonly FieldChoice[]): string =>
	choices
		.slice(0, 40)
		.map((choice) => choice.name)
		.join(", ") + (choices.length > 40 ? ", …" : "");

/** The words of a list given as text: "a, b; c". */
const listOf = (value: unknown): unknown[] =>
	Array.isArray(value)
		? value
		: typeof value === "string"
			? value
					.split(/[,;\n]/)
					.map((part) => part.trim())
					.filter((part) => part !== "")
			: value === null || value === undefined
				? []
				: [value];

/** One item of a field (or of an array field's items) of a type. */
function itemValue(
	meta: FieldMeta,
	type: string,
	given: unknown,
	cloud: boolean,
): { value: unknown; shown: string } | string {
	// Jira's own shape ({ "id": "10001" }, { "accountId": … }) goes as it is.
	if (typeof given === "object" && given !== null && !Array.isArray(given)) {
		return { value: given, shown: JSON.stringify(given) };
	}
	const text = given === null || given === undefined ? "" : String(given).trim();
	switch (type) {
		case "number": {
			const number = Number(text.replace(",", "."));
			if (text === "" || !Number.isFinite(number)) return `${meta.name} takes a number.`;
			return { value: number, shown: String(number) };
		}
		case "date":
			if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${meta.name} takes a date: YYYY-MM-DD.`;
			return { value: text, shown: text };
		case "datetime":
			if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return `${meta.name} takes a date and time.`;
			return {
				value: /T\d{2}:\d{2}/.test(text) ? text : `${text.slice(0, 10)}T00:00:00.000+0000`,
				shown: text,
			};
		case "user":
			if (text === "") return `${meta.name} needs a user.`;
			return { value: cloud ? { accountId: text } : { name: text }, shown: text };
		case "issuelink":
		case "issuelinks":
			return { value: { key: text.toLocaleUpperCase("en") }, shown: text };
		case "string":
		case "any":
		case "":
			if (meta.choices.length === 0)
				return { value: isRichText(meta) ? markdownToWiki(text) : text, shown: text };
			break;
	}
	if (meta.choices.length > 0) {
		const choice = pickChoice(meta.choices, text);
		if (choice === null)
			return `${meta.name} has no choice "${text}". Its choices: ${choiceList(meta.choices)}.`;
		if (TEMPO_TEAM.test(meta.custom)) return { value: choice.id, shown: choice.name };
		return { value: { id: choice.id }, shown: choice.name };
	}
	if (text === "") return `${meta.name} needs a value.`;
	// A choice the screen does not list: named, as Jira takes priorities, versions and components.
	return { value: type === "option" ? { value: text } : { name: text }, shown: text };
}

/**
 * A value the model gave for a field, as Jira takes it; `null` or "" clears
 * it. Text is Markdown in a description or a multi-line field; a choice is
 * picked by its name or id; a user is a user name (Server) or account id
 * (Cloud); a list is an array or comma-separated text.
 */
export function fieldValue(meta: FieldMeta, given: unknown, cloud: boolean): FieldValue {
	const empty =
		given === null ||
		given === undefined ||
		(typeof given === "string" && given.trim() === "") ||
		(Array.isArray(given) && given.length === 0);
	if (empty) {
		if (meta.required) return fail(`${meta.name} is required: it cannot be emptied.`);
		return { ok: true, value: meta.type === "array" ? [] : null, shown: "—" };
	}
	if (CASCADING.test(meta.custom) && typeof given !== "object") {
		const [parentName = "", childName = ""] = String(given).split(/\s*(?:›|>|\/)\s*/);
		const parent = pickChoice(meta.choices, parentName);
		if (parent === null)
			return fail(
				`${meta.name} has no choice "${parentName}". Its choices: ${choiceList(meta.choices)}.`,
			);
		if (childName === "") return { ok: true, value: { id: parent.id }, shown: parent.name };
		const child = pickChoice(parent.children, childName);
		if (child === null)
			return fail(
				`${parent.name} has no choice "${childName}". Its choices: ${choiceList(parent.children)}.`,
			);
		return {
			ok: true,
			value: { id: parent.id, child: { id: child.id } },
			shown: `${parent.name} › ${child.name}`,
		};
	}
	if (meta.type === "array") {
		const values: unknown[] = [];
		const shown: string[] = [];
		for (const item of listOf(given)) {
			const one = itemValue(meta, meta.items, item, cloud);
			if (typeof one === "string") return fail(one);
			values.push(one.value);
			shown.push(one.shown);
		}
		return { ok: true, value: values, shown: shown.join(", ") };
	}
	if (EPIC_LINK.test(meta.custom))
		return { ok: true, value: String(given).trim().toLocaleUpperCase("en"), shown: String(given) };
	const one = itemValue(meta, meta.type, Array.isArray(given) ? given[0] : given, cloud);
	return typeof one === "string" ? fail(one) : { ok: true, ...one };
}

// --- A clone ---------------------------------------------------------------------------

/** Fields a clone never copies: Jira sets them, or they are the issue's own history. */
const NOT_COPIED = new Set([
	"summary",
	"project",
	"issuetype",
	"attachment",
	"issuelinks",
	"subtasks",
	"comment",
	"worklog",
	"timetracking",
	"votes",
	"watches",
	"status",
	"resolution",
	"resolutiondate",
	"created",
	"updated",
	"creator",
	"lastViewed",
]);

/** An issue's own value, as a create takes it; `undefined` when it cannot be copied. */
function copiedItem(meta: FieldMeta, type: string, raw: unknown, cloud: boolean): unknown {
	if (raw === null || raw === undefined) return undefined;
	if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
		if (type === "user") return cloud ? { accountId: raw } : { name: raw };
		return raw;
	}
	const item = asJson(raw);
	if (type === "user" || "accountId" in item || "emailAddress" in item) {
		const id = cloud ? asString(item.accountId) : asString(item.name) || asString(item.key);
		if (id === "") return undefined;
		return cloud ? { accountId: id } : { name: id };
	}
	if (type === "issuelink" || meta.system === "parent") {
		const key = asString(item.key);
		return key === "" ? undefined : { key };
	}
	const id = item.id === undefined || item.id === null ? "" : String(item.id);
	if (id !== "") {
		if (TEMPO_TEAM.test(meta.custom)) return id;
		const child = asJson(item.child);
		const childId = child.id === undefined || child.id === null ? "" : String(child.id);
		return childId === "" ? { id } : { id, child: { id: childId } };
	}
	if (asString(item.value) !== "") return { value: asString(item.value) };
	if (asString(item.name) !== "") return { name: asString(item.name) };
	return undefined;
}

/** A field's value on the issue copied for a create; `undefined` when there is nothing to copy. */
export function copiedValue(meta: FieldMeta, raw: unknown, cloud: boolean): unknown {
	if (raw === null || raw === undefined || raw === "") return undefined;
	if (meta.custom === SPRINT_SCHEMA) {
		// A new issue goes into the sprint only while it is open.
		const sprint = sprintOf(Array.isArray(raw) ? raw : [raw]);
		if (sprint === null || /^closed$/i.test(sprint.state)) return undefined;
		const id = Number(sprint.id);
		return Number.isInteger(id) ? id : undefined;
	}
	if (meta.type === "array" || Array.isArray(raw)) {
		const items = asArray(raw)
			.map((item) => copiedItem(meta, meta.items, item, cloud))
			.filter((item) => item !== undefined);
		return items.length === 0 ? undefined : items;
	}
	if (typeof raw === "object" && Object.keys(asJson(raw)).length === 0) return undefined;
	return copiedItem(meta, meta.type, raw, cloud);
}

export interface ClonePlan {
	/** The new issue's fields, by id: what is copied and what was given. */
	readonly fields: Record<string, unknown>;
	/** The names of the fields copied from the issue. */
	readonly copied: readonly string[];
	/** Required fields the issue has no value for and nobody gave. */
	readonly missing: readonly string[];
}

/**
 * The fields of a clone: each field the create screen has and the issue
 * holds, copied; then the summary and what the model gave over them.
 */
export function clonePlan(
	source: unknown,
	metas: readonly FieldMeta[],
	summary: string,
	given: Readonly<Record<string, unknown>>,
	cloud: boolean,
): ClonePlan {
	const values = asJson(asJson(source).fields);
	const fields: Record<string, unknown> = {};
	const copied: string[] = [];
	for (const meta of metas) {
		if (NOT_COPIED.has(meta.id) || /^rank\b/i.test(meta.name)) continue;
		const value = copiedValue(meta, values[meta.id], cloud);
		if (value === undefined) continue;
		fields[meta.id] = value;
		copied.push(meta.name);
	}
	fields.summary = summary;
	Object.assign(fields, given);
	const missing = metas
		.filter(
			(meta) =>
				meta.required &&
				!meta.hasDefault &&
				!["project", "issuetype"].includes(meta.id) &&
				fields[meta.id] === undefined,
		)
		.map((meta) => meta.name);
	return { fields, copied, missing };
}

/** A screen's fields for the model: id, name, whether required, type and choices. */
export function fieldMetasText(metas: readonly FieldMeta[], title: string): string {
	if (metas.length === 0) return `${title}: Jira listed no fields.`;
	const sorted = [...metas].sort(
		(a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name, "tr"),
	);
	const lines = sorted.map((meta) => {
		const type = meta.type === "array" ? `list of ${meta.items}` : meta.type || "any";
		const flags = [meta.required ? (meta.hasDefault ? "required, has a default" : "required") : ""]
			.filter(Boolean)
			.join("");
		const choices =
			meta.choices.length === 0
				? ""
				: `; choices: ${meta.choices
						.slice(0, 30)
						.map((choice) =>
							choice.children.length === 0
								? choice.name
								: `${choice.name} (› ${choice.children.map((child) => child.name).join(" | ")})`,
						)
						.join(", ")}${meta.choices.length > 30 ? `, … (${meta.choices.length})` : ""}`;
		return `- ${meta.name} [${meta.id}] ${type}${flags === "" ? "" : `, ${flags}`}${choices}`;
	});
	return `${title}:\n${lines.join("\n")}`;
}

// --- Links -----------------------------------------------------------------------------

export interface LinkType {
	readonly id: string;
	readonly name: string;
	/** What the first issue does to the second: "blocks". */
	readonly outward: string;
	/** What the second issue does to the first: "is blocked by". */
	readonly inward: string;
}

export function linkTypesOf(raw: unknown): LinkType[] {
	return asArray(asJson(raw).issueLinkTypes).flatMap((item) => {
		const type = asJson(item);
		const id = String(type.id ?? "");
		if (id === "") return [];
		return [
			{
				id,
				name: asString(type.name),
				outward: asString(type.outward),
				inward: asString(type.inward),
			},
		];
	});
}

/**
 * The link "from relation to" as Jira takes it: the relation is a type's
 * name or its outward words (from blocks to), or its inward words (from is
 * blocked by to). Jira's request names the issue a link goes out of
 * `inwardIssue`.
 */
export function linkBody(
	types: readonly LinkType[],
	relation: string,
	from: string,
	to: string,
): { body: Json; shown: string } | null {
	const wanted = fold(relation);
	const exact = (text: string): boolean => fold(text) === wanted;
	const near = (text: string): boolean => wanted !== "" && fold(text).includes(wanted);
	for (const match of [exact, near]) {
		const outward = types.find((type) => match(type.name) || match(type.outward));
		if (outward !== undefined) {
			return {
				body: {
					type: { name: outward.name },
					inwardIssue: { key: from },
					outwardIssue: { key: to },
				},
				shown: `${from} ${outward.outward || outward.name} ${to}`,
			};
		}
		const inward = types.find((type) => match(type.inward));
		if (inward !== undefined) {
			return {
				body: {
					type: { name: inward.name },
					inwardIssue: { key: to },
					outwardIssue: { key: from },
				},
				shown: `${from} ${inward.inward} ${to}`,
			};
		}
	}
	return null;
}

/**
 * Every field an issue holds a value in, and every field its edit screen
 * has, for the model: name, id, value, and for an editable field its type
 * and choices. `raw` is the issue read with `names` and `editmeta`.
 */
export function issueFieldsText(raw: unknown): string {
	const issue = asJson(raw);
	const fields = asJson(issue.fields);
	const names = asJson(issue.names);
	const editable = new Map(
		fieldMetasOf(asJson(issue.editmeta)).map((meta) => [meta.id, meta] as const),
	);
	const ids = new Set([...Object.keys(fields), ...editable.keys()]);
	const lines: string[] = [];
	for (const id of ids) {
		if (["comment", "worklog", "attachment", "issuelinks", "subtasks", "description"].includes(id))
			continue;
		const meta = editable.get(id);
		const name = asString(names[id]) || meta?.name || id;
		if (/^rank\b/i.test(name)) continue;
		const text = valueText(fields[id]);
		const shown =
			text === "" || /^[\w$.]+@[0-9a-f]{4,}\b/.test(text) ? "(empty)" : text.slice(0, 300);
		if (meta === undefined && shown === "(empty)") continue;
		const type =
			meta === undefined
				? "read only"
				: `${meta.type === "array" ? `list of ${meta.items}` : meta.type || "any"}${meta.required ? ", required" : ""}${
						meta.choices.length === 0
							? ""
							: `; choices: ${meta.choices
									.slice(0, 20)
									.map((choice) => choice.name)
									.join(", ")}${meta.choices.length > 20 ? ", …" : ""}`
					}`;
		lines.push(`- ${name} [${id}]: ${shown} (${type})`);
	}
	return lines.sort((a, b) => a.localeCompare(b, "tr")).join("\n");
}

function valueText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") {
		if (/^com\.atlassian\.greenhopper\.service\.sprint\.Sprint@/.test(value))
			return sprintOf([value])?.name ?? "";
		return value.replace(/\s+/g, " ").trim();
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value))
		return value
			.map(valueText)
			.filter((text) => text !== "")
			.join(", ");
	const record = asJson(value);
	const own =
		asString(record.displayName) ||
		asString(record.value) ||
		asString(record.name) ||
		asString(record.title) ||
		asString(record.key) ||
		asString(asJson(record.data).key);
	const child = record.child === undefined ? "" : valueText(record.child);
	return [own, child].filter((part) => part !== "").join(" › ");
}
