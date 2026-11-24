/**
 * The assistant's Jira look-ups beyond an issue's fields: its whole change
 * history, all of its comments, its work logs, its development (branches,
 * commits, pull requests) and the sprints of its board; and the writes that
 * go with them: work logged, an issue moved to a sprint. A write is shown
 * to the user and asked every time.
 */
import { format } from "../shared/i18n.js";
import { issueKey } from "../shared/jira.js";
import type { BoardSprint } from "../shared/jira-assistant-text.js";
import {
	commentsText,
	developmentText,
	findSprint,
	historyText,
	sprintsText,
	worklogsText,
} from "../shared/jira-assistant-text.js";
import type { DevelopmentKind } from "../shared/jira-dev.js";
import type { WorkAttribute, WorklogEntry } from "../shared/jira-worklog.js";
import {
	formatDuration,
	missingAttributes,
	parseDuration,
	parseEstimate,
} from "../shared/jira-worklog.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import type { JiraClient } from "./jira-client.js";

const REFUSED = "The user did not allow it: nothing was sent. Do not try again unless they ask.";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

const jiraOf = (ctx: ToolContext): JiraClient => ctx.jiraClient as JiraClient;

const connected = (ctx: ToolContext): boolean => ctx.jiraClient !== null;

const keyOf = (input: Record<string, unknown>): string | null => issueKey(text(input, "key"));

const NO_KEY = "Give an issue key, e.g. ABC-123.";

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

/** How many comments a call reads at most. */
const COMMENT_PAGE = 50;

/** Today on this computer, `YYYY-MM-DD`. */
function today(): string {
	const now = new Date();
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The Tempo attributes the model gave by key or name, with list choices by name or value. */
export function resolveAttributes(
	attributes: readonly WorkAttribute[],
	given: Record<string, unknown>,
): { values: Record<string, string>; errors: string[] } {
	const values: Record<string, string> = {};
	const errors: string[] = [];
	for (const [named, raw] of Object.entries(given)) {
		const value =
			typeof raw === "string"
				? raw.trim()
				: typeof raw === "number" || typeof raw === "boolean"
					? String(raw)
					: "";
		const attribute = attributes.find(
			(known) => known.key === named || fold(known.name) === fold(named),
		);
		if (attribute === undefined) {
			errors.push(`No work attribute "${named}".`);
			continue;
		}
		if (attribute.kind === "list" && attribute.options.length > 0) {
			const option =
				attribute.options.find((known) => known.value === value) ??
				attribute.options.find((known) => fold(known.name) === fold(value));
			if (option === undefined) {
				errors.push(
					`"${value}" is not a choice of ${attribute.name}. Its choices: ${attribute.options
						.slice(0, 50)
						.map((known) => known.name)
						.join(", ")}.`,
				);
				continue;
			}
			values[attribute.key] = option.value;
			continue;
		}
		values[attribute.key] = value;
	}
	return { values, errors };
}

/** The attributes a work log asks for, for the model. */
function attributesText(attributes: readonly WorkAttribute[]): string {
	return attributes
		.map((attribute) => {
			const choices =
				attribute.options.length === 0
					? ""
					: `; choices: ${attribute.options
							.slice(0, 30)
							.map((option) => option.name)
							.join(", ")}${attribute.options.length > 30 ? "…" : ""}`;
			return `- ${attribute.name} (key ${attribute.key}, ${attribute.kind}${attribute.required ? ", required" : ""}${choices})`;
		})
		.join("\n");
}

/** The board the model means, or the project's first scrum board; why not otherwise. */
async function boardOf(
	jira: JiraClient,
	project: string,
	named: string,
): Promise<{ id: string; name: string } | string> {
	if (/^\d+$/.test(named)) return { id: named, name: named };
	const boards = await jira.boards(project);
	if (boards.length === 0) return `${project} has no scrum board: it has no sprints.`;
	if (named === "") return boards[0] as { id: string; name: string };
	const found =
		boards.find((board) => fold(board.name) === fold(named)) ??
		boards.find((board) => fold(board.name).includes(fold(named)));
	return (
		found ??
		`${project} has no board named "${named}". Its boards: ${boards.map((board) => `${board.name} (id ${board.id})`).join(", ")}.`
	);
}

const projectOf = (input: Record<string, unknown>): string => {
	const key = keyOf(input);
	if (key !== null) return key.slice(0, key.lastIndexOf("-"));
	return text(input, "project").toLocaleUpperCase("en");
};

const DEVELOPMENT_KINDS: readonly DevelopmentKind[] = ["pullRequests", "branches", "commits"];

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "jira_get_history",
			description:
				"Reads a Jira issue's change history, newest first: who changed which field (status, assignee, priority, sprint, description…) from what to what, and when. `field` keeps the changes of one field. Use it for questions like when an issue moved to a status, who changed it, how long it stayed somewhere.",
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue key, e.g. ABC-123." },
					field: { type: "string", description: "Only this field's changes, e.g. status." },
				},
				required: ["key"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const key = keyOf(input);
			if (key === null) return NO_KEY;
			ctx.readExternal = true;
			const field = text(input, "field");
			ctx.step({ tool: "jira_get_history", detail: field === "" ? key : `${key} ${field}` });
			return historyText(key, await jiraOf(ctx).changelog(key), field);
		},
	},
	{
		definition: {
			name: "jira_get_comments",
			description: `Reads a Jira issue's comments in full, oldest first, ${COMMENT_PAGE} at a time: jira_get_issue shows only the latest ones. \`start\` is the number of the first comment to read (1 by default); the answer says where the next ones start.`,
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue key, e.g. ABC-123." },
					start: { type: "number", description: "The first comment's number, from 1." },
				},
				required: ["key"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const key = keyOf(input);
			if (key === null) return NO_KEY;
			ctx.readExternal = true;
			const start =
				typeof input.start === "number" && Number.isFinite(input.start)
					? Math.max(1, Math.floor(input.start))
					: 1;
			ctx.step({ tool: "jira_get_comments", detail: key });
			const page = await jiraOf(ctx).comments(key, start - 1, COMMENT_PAGE);
			return commentsText(key, page.comments, page.total, page.start);
		},
	},
	{
		definition: {
			name: "jira_get_worklogs",
			description:
				"Reads the work logged on a Jira issue: its estimate, time logged and remaining, the total by person, and each work log (when, who, how long, its comment).",
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
			if (key === null) return NO_KEY;
			ctx.readExternal = true;
			ctx.step({ tool: "jira_get_worklogs", detail: key });
			const found = await jiraOf(ctx).worklogs(key);
			return worklogsText(key, found.worklogs, found.timetracking);
		},
	},
	{
		definition: {
			name: "jira_log_work",
			description:
				'Logs work on a Jira issue for the signed-in user, as Jira\'s "Log work" does (through Tempo where it is installed). `time` as "2h", "1h 30m", "1d"; `date` YYYY-MM-DD (today by default); `remaining` sets the remaining estimate ("0" when done; Jira counts it down by default). Where Tempo asks for work attributes, give them in `attributes` ({"name or key": "choice"}); a call without the required ones lists them. The user sees it and is asked every time.',
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue key, e.g. ABC-123." },
					time: { type: "string", description: 'Time spent, e.g. "2h" or "1h 30m".' },
					date: { type: "string", description: "The day the work was done, YYYY-MM-DD." },
					comment: { type: "string", description: "What was done." },
					remaining: { type: "string", description: 'The new remaining estimate, e.g. "4h".' },
					attributes: { type: "object", description: "Tempo's work attributes, by name or key." },
				},
				required: ["key", "time"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const jira = jiraOf(ctx);
			const key = keyOf(input);
			if (key === null) return NO_KEY;
			const seconds = parseDuration(text(input, "time"));
			if (seconds === null || seconds > 24 * 3600) {
				return 'Give the time spent as "2h", "1h 30m" or "45m" (at most a day).';
			}
			const date = text(input, "date") || today();
			if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
				return "Give the date as YYYY-MM-DD.";
			}
			const remainingText = text(input, "remaining");
			const remaining = remainingText === "" ? null : parseEstimate(remainingText);
			if (remainingText !== "" && remaining === null) {
				return 'Give the remaining estimate as "4h", "1d" or "0".';
			}
			ctx.readExternal = true;
			const context = await jira.worklogContext(key, {});
			const givenAttributes =
				typeof input.attributes === "object" &&
				input.attributes !== null &&
				!Array.isArray(input.attributes)
					? (input.attributes as Record<string, unknown>)
					: {};
			const resolved = resolveAttributes(context.attributes, givenAttributes);
			const missing = missingAttributes(context.attributes, resolved.values);
			if (resolved.errors.length > 0 || missing.length > 0) {
				return [
					...resolved.errors,
					...(missing.length === 0 ? [] : [`Required: ${missing.join(", ")}.`]),
					"Nothing was logged. The work attributes this log asks for:",
					attributesText(context.attributes),
				].join("\n");
			}
			const comment = text(input, "comment").slice(0, 5000);
			const shown = context.attributes
				.filter((attribute) => (resolved.values[attribute.key] ?? "") !== "")
				.map((attribute) => {
					const value = resolved.values[attribute.key] ?? "";
					const option = attribute.options.find((known) => known.value === value);
					return `${attribute.name}: ${option?.name ?? value}`;
				});
			const answer = await ctx.approve({
				tool: "jira_log_work",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraLogWork, key),
				lines: [
					`${key}: ${formatDuration(seconds)}, ${date}`,
					...(remaining === null ? [] : [`Remaining: ${formatDuration(remaining)}`]),
					...shown,
				],
				...(comment === "" ? {} : { preview: comment }),
			});
			if (!answer.approved) return REFUSED;
			const entry: WorklogEntry = {
				date,
				seconds,
				remainingSeconds: remaining,
				comment,
				attributes: resolved.values,
				remember: false,
			};
			await jira.logWork(key, entry, -new Date(`${date}T09:00:00`).getTimezoneOffset());
			ctx.step({ tool: "jira_log_work", detail: `${key} ${formatDuration(seconds)}` });
			return `Logged ${formatDuration(seconds)} on ${key} for ${date}${context.tempo ? " (through Tempo)" : ""}.`;
		},
	},
	{
		definition: {
			name: "jira_get_development",
			description:
				"Reads a Jira issue's development: the branches, commits and pull requests (with their state, repository, author, date and address) that Bitbucket, GitHub, GitLab… linked to it, as Jira's Development panel shows them.",
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
			if (key === null) return NO_KEY;
			ctx.readExternal = true;
			const jira = jiraOf(ctx);
			ctx.step({ tool: "jira_get_development", detail: key });
			const id = await jira.issueId(key);
			const summary = await jira.development(id);
			if (summary === null) return developmentText(key, null, []);
			const details = await Promise.all(
				DEVELOPMENT_KINDS.filter((kind) => summary[kind].count > 0).map(async (kind) => ({
					kind,
					items: await jira.developmentDetail(id, kind).catch(() => []),
				})),
			);
			return developmentText(key, summary, details);
		},
	},
	{
		definition: {
			name: "jira_list_sprints",
			description:
				"Lists the sprints of a project's scrum board (by an issue key or a project key): name, id, state, dates, goal. By default the active and future ones; `states` can ask for closed ones too. `board` picks a board by its name or id when the project has several. The issues of a sprint: jira_search with `sprint = <id>`.",
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "An issue of the project, e.g. ABC-123." },
					project: { type: "string", description: "The project's key, e.g. ABC." },
					board: { type: "string", description: "The board's name or id." },
					states: {
						type: "array",
						items: { type: "string", enum: ["active", "future", "closed"] },
						description: "The sprints' states; active and future by default.",
					},
				},
				required: [],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const project = projectOf(input);
			if (project === "") return "Give an issue key or a project key.";
			ctx.readExternal = true;
			const jira = jiraOf(ctx);
			const board = await boardOf(jira, project, text(input, "board"));
			if (typeof board === "string") return board;
			const states = Array.isArray(input.states)
				? input.states.filter((state): state is string => typeof state === "string")
				: [];
			ctx.step({ tool: "jira_list_sprints", detail: `${project} ${board.name}` });
			let sprints = await jira.boardSprints(board.id, states);
			// Closed sprints run long: the latest are what is asked about.
			if (sprints.length > 60) sprints = sprints.slice(-60);
			return sprintsText(board, sprints);
		},
	},
	{
		definition: {
			name: "jira_move_to_sprint",
			description:
				'Moves a Jira issue to an active or future sprint of its board (by the sprint\'s name or id), or to the backlog with `sprint` "backlog". The user sees it and is asked every time.',
			parameters: {
				type: "object",
				properties: {
					key: { type: "string", description: "The issue key, e.g. ABC-123." },
					sprint: { type: "string", description: 'The sprint\'s name or id, or "backlog".' },
					board: {
						type: "string",
						description: "The board's name or id, when the project has several.",
					},
				},
				required: ["key", "sprint"],
			},
		},
		risk: "external",
		available: connected,
		async run(input, ctx) {
			const key = keyOf(input);
			if (key === null) return NO_KEY;
			const named = text(input, "sprint");
			if (named === "") return 'Give the sprint\'s name or id, or "backlog".';
			const jira = jiraOf(ctx);
			ctx.readExternal = true;
			let sprint: BoardSprint | null = null;
			if (fold(named) !== "backlog") {
				const board = await boardOf(jira, projectOf(input), text(input, "board"));
				if (typeof board === "string") return board;
				const found = findSprint(await jira.boardSprints(board.id, ["active", "future"]), named);
				if (typeof found === "string") return found;
				sprint = found;
			}
			const target = sprint === null ? "Backlog" : `${sprint.name} (${sprint.state})`;
			const answer = await ctx.approve({
				tool: "jira_move_to_sprint",
				risk: "external",
				permission: "jira",
				title: format(ctx.t.approvalJiraSprint, key),
				lines: [`${key} → ${target}`],
			});
			if (!answer.approved) return REFUSED;
			await jira.moveToSprint(key, sprint?.id ?? null);
			ctx.step({ tool: "jira_move_to_sprint", detail: `${key} → ${target}` });
			return `${key} is now in ${target}.`;
		},
	},
];

registerTools(TOOLS);
