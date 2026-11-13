/**
 * The assistant's further Jira tools: an issue's every field (its custom
 * ones too), what a create screen asks for, the projects; and the writes
 * beyond a comment or a status: a clone with all of its fields, fields set,
 * issues linked, an assignee changed. A write is shown to the user in full
 * and asked every time.
 */
import { format } from "../shared/i18n.js";
import { issueKey } from "../shared/jira.js";
import type { FieldMeta } from "../shared/jira-write.js";
import {
	clonePlan,
	fieldMetasOf,
	fieldMetasText,
	fieldValue,
	findField,
	issueFieldsText,
	linkBody,
	linkTypesOf,
} from "../shared/jira-write.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import type { JiraClient } from "./jira-client.js";
import { JiraError } from "./jira-client.js";

const REFUSED = "The user did not allow it: nothing was sent. Do not try again unless they ask.";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

const record = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

const jiraOf = (ctx: ToolContext): JiraClient => ctx.jiraClient as JiraClient;

const connected = (ctx: ToolContext): boolean => ctx.jiraClient !== null;

/** The key the model gave, or why it is not one. */
function keyOf(input: Record<string, unknown>, name = "key"): string | null {
	return issueKey(text(input, name));
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** A project's issue type by its name (or id); why not, with the types it has. */
export async function typeIdOf(
	jira: JiraClient,
	project: string,
	named: string,
): Promise<{ id: string; name: string } | string> {
	const types = await jira.issueTypes(project);
	const wanted = fold(named);
	const found =
		types.find((type) => type.id === named.trim() || fold(type.name) === wanted) ??
		types.find((type) => wanted !== "" && fold(type.name).includes(wanted));
	if (found !== undefined) return found;
	return `${project} has no issue type "${named}". Its types: ${types.map((type) => type.name).join(", ")}.`;
}

interface ResolvedFields {
	readonly fields: Record<string, unknown>;
	/** What changes, a line each: `Priority: High`. */
	readonly lines: readonly string[];
	readonly errors: readonly string[];
}

/** The fields the model gave by name or id, as Jira takes them on this screen. */
export function resolveFields(
	metas: readonly FieldMeta[],
	given: Record<string, unknown>,
	cloud: boolean,
): ResolvedFields {
	const fields: Record<string, unknown> = {};
	const lines: string[] = [];
	const errors: string[] = [];
	for (const [named, value] of Object.entries(given)) {
		const meta = findField(metas, named);
		if (meta === null) {
			errors.push(`No field "${named}" on this screen.`);
			continue;
		}
		const resolved = fieldValue(meta, value, cloud);
		if (!resolved.ok) {
			errors.push(resolved.error);
			continue;
		}
		fields[meta.id] = resolved.value;
		lines.push(`${meta.name}: ${resolved.shown.slice(0, 200)}`);
	}
	return { fields, lines, errors };
}

export const FIELDS_HELP =
	'"fields": {"Field name or id": value}. A choice by its name; a user by user name (Server) or account id (Cloud); a list as an array; text in a description or multi-line field is Markdown; null empties a field. Jira\'s own shape ({"id":"10001"}) goes as it is.';

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "jira_get_fields",
			description:
				"Reads every field of a Jira issue, the custom ones included (Service, Team, Sprint, Story Points…): each field's name, id, value, and for fields that can be changed their type and choices. Use it before cloning or changing an issue, or when jira_get_issue does not show a field.",
			parameters: {
				type: "object",
				properties: { key: { type: "string", description: "The issue key, e.g. ABC-123." } },
				required: ["key"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const key = keyOf(input);
			if (key === null) return "Give an issue key, e.g. ABC-123.";
			ctx.readExternal = true;
			const raw = await jiraOf(ctx).rawIssue(key);
			const summary = asString(record(raw.fields).summary);
			ctx.step({ tool: "jira_get_fields", detail: `${key} ${summary}` });
			const fields = issueFieldsText(raw);
			return `Fields of ${key}: ${summary}\n${fields === "" ? "(none)" : fields}`;
		},
	},
	{
		definition: {
			name: "jira_create_fields",
			description:
				"Lists the fields Jira asks for when creating an issue of a type in a project: which are required, their types and choices. Without a type it lists the project's issue types.",
			parameters: {
				type: "object",
				properties: {
					project: { type: "string", description: "The project's key, e.g. ABC." },
					type: { type: "string", description: "The issue type's name, e.g. Story." },
				},
				required: ["project"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const jira = jiraOf(ctx);
			const project = text(input, "project").toLocaleUpperCase("en");
			if (project === "") return "Give the project's key.";
			ctx.readExternal = true;
			const named = text(input, "type");
			if (named === "") {
				const types = await jira.issueTypes(project);
				ctx.step({ tool: "jira_create_fields", detail: project });
				return `Issue types of ${project}: ${types.map((type) => `${type.name}${type.subtask ? " (sub-task)" : ""}`).join(", ")}.`;
			}
			const type = await typeIdOf(jira, project, named);
			if (typeof type === "string") return type;
			ctx.step({ tool: "jira_create_fields", detail: `${project} ${type.name}` });
			return fieldMetasText(
				fieldMetasOf(await jira.createMeta(project, type.id)),
				`Fields to create a ${type.name} in ${project}`,
			);
		},
	},
	{
		definition: {
			name: "jira_list_projects",
			description: "Lists the Jira projects the user can see (key and name); `query` narrows them.",
			parameters: {
				type: "object",
				properties: { query: { type: "string", description: "Words in the key or name." } },
				required: [],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			ctx.readExternal = true;
			const wanted = fold(text(input, "query"));
			const projects = (await jiraOf(ctx).projects()).filter(
				(project) =>
					wanted === "" ||
					fold(project.key).includes(wanted) ||
					fold(project.name).includes(wanted),
			);
			ctx.step({ tool: "jira_list_projects", detail: text(input, "query") });
			if (projects.length === 0) return "No project found.";
			const shown = projects.slice(0, 200);
			return `${projects.length} projects${projects.length > shown.length ? `, the first ${shown.length}` : ""}:\n${shown.map((project) => `- ${project.key}: ${project.name}`).join("\n")}`;
		},
	},
	{
		definition: {
			name: "jira_clone_issue",
			description: `Copies a Jira issue as a new one, as Jira's own "Clone" does: every field its create screen has (custom fields like Service included) is copied from the issue; give the new summary, and optionally another project or type and fields to set instead (${FIELDS_HELP}). The new issue is linked to the original ("clones") unless link is false. The user sees it and is asked every time.`,
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue to copy, e.g. ABC-123." },
					summary: { type: "string", description: "The new issue's summary." },
					project: { type: "string", description: "Another project's key; the same by default." },
					type: { type: "string", description: "Another issue type; the same by default." },
					fields: { type: "object", description: "Fields to set instead of the copied ones." },
					link: { type: "boolean", description: "Link the copy to the original (default true)." },
				},
				required: ["key"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const jira = jiraOf(ctx);
			const key = keyOf(input);
			if (key === null) return "Give the key of the issue to copy.";
			ctx.readExternal = true;
			const raw = await jira.rawIssue(key);
			const source = record(raw.fields);
			const project =
				text(input, "project").toLocaleUpperCase("en") ||
				asString(record(source.project).key) ||
				key.slice(0, key.lastIndexOf("-"));
			const sourceType = record(source.issuetype);
			const type = await typeIdOf(
				jira,
				project,
				text(input, "type") || asString(sourceType.name) || String(sourceType.id ?? ""),
			);
			if (typeof type === "string") return type;
			const metas = fieldMetasOf(await jira.createMeta(project, type.id));
			const summary = text(input, "summary") || `CLONE - ${asString(source.summary)}`.slice(0, 254);
			const given = resolveFields(metas, record(input.fields), jira.cloud);
			if (given.errors.length > 0) return given.errors.join("\n");
			const plan = clonePlan(raw, metas, summary.slice(0, 254), given.fields, jira.cloud);
			if (plan.missing.length > 0) {
				return `${key} has no value for the required ${plan.missing.join(", ")}: give them in "fields" (jira_create_fields lists their choices).`;
			}
			const answer = await ctx.approve({
				tool: "jira_clone_issue",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraClone, key, project),
				lines: [
					`${type.name}: ${summary}`,
					...given.lines,
					...(plan.copied.length === 0 ? [] : [`↳ ${plan.copied.join(", ")}`]),
				],
			});
			if (!answer.approved) return REFUSED;
			let fields = { ...plan.fields, project: { key: project }, issuetype: { id: type.id } };
			const dropped: string[] = [];
			let made: { key: string; url: string };
			try {
				made = await jira.createWithFields(fields);
			} catch (error) {
				// A copied value Jira will not take (an inactive user, a closed version) is left out,
				// once; a field the model gave or a required one is not.
				if (!(error instanceof JiraError) || error.status !== 400) throw error;
				const refused = Object.keys(error.fields).filter((id) => {
					const meta = metas.find((each) => each.id === id);
					return id in plan.fields && !(id in given.fields) && meta?.required !== true;
				});
				if (refused.length === 0 || refused.length < Object.keys(error.fields).length) throw error;
				fields = Object.fromEntries(
					Object.entries(fields).filter(([id]) => !refused.includes(id)),
				) as typeof fields;
				for (const id of refused) {
					dropped.push(
						`${metas.find((each) => each.id === id)?.name ?? id} (${error.fields[id] ?? ""})`,
					);
				}
				made = await jira.createWithFields(fields);
			}
			ctx.step({ tool: "jira_clone_issue", detail: `${key} → ${made.key}` });
			const lines = [`Created ${made.key} as a copy of ${key}: ${summary} (${made.url})`];
			if (dropped.length > 0) lines.push(`Not copied, Jira refused them: ${dropped.join(", ")}.`);
			if (input.link !== false) {
				try {
					const link = linkBody(linkTypesOf(await jira.linkTypes()), "clones", made.key, key);
					if (link !== null) {
						await jira.link(link.body);
						lines.push(`Linked: ${link.shown}.`);
					}
				} catch (error) {
					lines.push(
						`Not linked to ${key}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			return lines.join("\n");
		},
	},
	{
		definition: {
			name: "jira_update_issue",
			description: `Changes fields of a Jira issue: summary, description, priority, labels, components, due date, custom fields… ${FIELDS_HELP} The user sees each change and is asked every time. jira_get_fields lists the fields and their choices.`,
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue key, e.g. ABC-123." },
					fields: { type: "object", description: "The fields to set, by name or id." },
				},
				required: ["key", "fields"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const jira = jiraOf(ctx);
			const key = keyOf(input);
			if (key === null) return "Give an issue key, e.g. ABC-123.";
			const given = record(input.fields);
			if (Object.keys(given).length === 0) return "Give the fields to set.";
			const metas = fieldMetasOf(await jira.editMeta(key));
			const resolved = resolveFields(metas, given, jira.cloud);
			if (resolved.errors.length > 0)
				return `${resolved.errors.join("\n")}\nNothing was changed. jira_get_fields lists the fields that can be changed.`;
			const answer = await ctx.approve({
				tool: "jira_update_issue",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraUpdate, key),
				lines: resolved.lines,
			});
			if (!answer.approved) return REFUSED;
			await jira.updateFields(key, resolved.fields);
			ctx.step({ tool: "jira_update_issue", detail: key });
			return `Changed ${key}: ${resolved.lines.join("; ")}.`;
		},
	},
	{
		definition: {
			name: "jira_link_issues",
			description:
				'Links two Jira issues: "from relation to", the relation a link type\'s name or its words ("blocks", "is blocked by", "relates to", "duplicates", "clones"). The user is asked every time.',
			parameters: {
				type: "object",
				properties: {
					from: { type: "string", description: "The first issue, e.g. ABC-1." },
					relation: { type: "string", description: 'e.g. "blocks".' },
					to: { type: "string", description: "The second issue, e.g. ABC-2." },
				},
				required: ["from", "relation", "to"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const jira = jiraOf(ctx);
			const from = keyOf(input, "from");
			const to = keyOf(input, "to");
			if (from === null || to === null) return "Give both issues' keys.";
			const types = linkTypesOf(await jira.linkTypes());
			const link = linkBody(types, text(input, "relation"), from, to);
			if (link === null) {
				return `No link type "${text(input, "relation")}". The types: ${types.map((type) => `${type.name} (${type.outward} / ${type.inward})`).join(", ")}.`;
			}
			const answer = await ctx.approve({
				tool: "jira_link_issues",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraLink, from, to),
				lines: [link.shown],
			});
			if (!answer.approved) return REFUSED;
			await jira.link(link.body);
			ctx.step({ tool: "jira_link_issues", detail: link.shown });
			return `Linked: ${link.shown}.`;
		},
	},
	{
		definition: {
			name: "jira_assign",
			description:
				'Assigns a Jira issue to someone found by name ("user"), or leaves it unassigned (user ""). The user is asked every time.',
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue key, e.g. ABC-123." },
					user: { type: "string", description: "A name, user name or e-mail; empty to unassign." },
				},
				required: ["key", "user"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const jira = jiraOf(ctx);
			const key = keyOf(input);
			if (key === null) return "Give an issue key, e.g. ABC-123.";
			const wanted = text(input, "user");
			let person: { id: string; name: string } | null = null;
			if (wanted !== "") {
				const users = await jira.assignableUsers(key, wanted);
				const folded = fold(wanted);
				person =
					users.find((user) => fold(user.id) === folded || fold(user.name) === folded) ??
					(users.length === 1 ? (users[0] ?? null) : null);
				if (person === null) {
					return users.length === 0
						? `Nobody named "${wanted}" can be assigned ${key}.`
						: `More than one person matches "${wanted}": ${users.map((user) => `${user.name} (${user.id})`).join(", ")}. Call again with one of them.`;
				}
			}
			const answer = await ctx.approve({
				tool: "jira_assign",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraAssign, key),
				lines: [`${key} → ${person === null ? "—" : person.name}`],
			});
			if (!answer.approved) return REFUSED;
			await jira.assign(key, person?.id ?? null);
			ctx.step({ tool: "jira_assign", detail: `${key} → ${person?.name ?? "—"}` });
			return person === null ? `${key} is unassigned.` : `${key} is assigned to ${person.name}.`;
		},
	},
];

registerTools(TOOLS);
