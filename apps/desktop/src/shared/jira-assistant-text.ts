/**
 * What the assistant's further Jira look-ups tell the model: an issue's
 * change history, its comments a page at a time, its work logs, its
 * development (branches, commits, pull requests) and a board's sprints.
 * Pure: the main process asks Jira.
 */
import type { JiraComment } from "./jira.js";
import type { DevelopmentItem, DevelopmentKind, DevelopmentSummary } from "./jira-dev.js";
import type { JiraSprint } from "./jira-fields.js";
import { formatDuration } from "./jira-worklog.js";

/** A board's sprint, with its dates and goal. */
export interface BoardSprint extends JiraSprint {
	/** ISO, or "" */
	readonly startDate: string;
	readonly endDate: string;
	readonly goal: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const personOf = (value: unknown): string => {
	const person = asRecord(value);
	return asString(person.displayName) || asString(person.name) || "someone";
};

/** `2026-01-02 14:05` of Jira's time; "" for none. */
export function dateTime(value: string): string {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
	return match === null ? value.slice(0, 16) : `${match[1]} ${match[2]}`;
}

const clip = (value: string, length: number): string => {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > length ? `${flat.slice(0, length)}…` : flat;
};

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

/** The longest text a look-up returns. */
const MAX_TEXT = 60_000;

/**
 * An issue's change history for the model, newest first: who changed which
 * field from what to what, and when. `field` keeps the changes of one field.
 */
export function historyText(key: string, histories: readonly unknown[], field = ""): string {
	const wanted = fold(field);
	const entries: { at: string; line: string }[] = [];
	for (const raw of histories) {
		const history = asRecord(raw);
		const at = asString(history.created);
		const changes = (Array.isArray(history.items) ? history.items : [])
			.map(asRecord)
			.filter((item) => wanted === "" || fold(asString(item.field)).includes(wanted))
			.map((item) => {
				const name = asString(item.field) || asString(item.fieldId) || "?";
				const from = clip(asString(item.fromString) || asString(item.from), 200) || "—";
				const to = clip(asString(item.toString) || asString(item.to), 200) || "—";
				return `${name}: ${from} → ${to}`;
			});
		if (changes.length === 0) continue;
		entries.push({
			at,
			line: `- ${dateTime(at)}, ${personOf(history.author)}: ${changes.join("; ")}`,
		});
	}
	if (entries.length === 0) {
		return wanted === ""
			? `${key} has no recorded changes.`
			: `${key} has no recorded changes of "${field}".`;
	}
	entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
	const lines: string[] = [];
	let length = 0;
	for (const entry of entries) {
		if (length + entry.line.length > MAX_TEXT) break;
		lines.push(entry.line);
		length += entry.line.length + 1;
	}
	const cut =
		lines.length < entries.length
			? `\n\n[${entries.length - lines.length} older changes left out; ask for one field to see them.]`
			: "";
	return `Change history of ${key}${wanted === "" ? "" : ` (${field})`}, newest first (${entries.length} changes):\n${lines.join("\n")}${cut}`;
}

/** A page of an issue's comments for the model, each in full. */
export function commentsText(
	key: string,
	comments: readonly JiraComment[],
	total: number,
	start: number,
): string {
	if (total === 0 || comments.length === 0) {
		return total === 0 ? `${key} has no comments.` : `${key} has no comments from ${start + 1} on.`;
	}
	const blocks: string[] = [];
	let length = 0;
	for (const [i, comment] of comments.entries()) {
		const block = `### ${start + i + 1}. ${comment.author}${comment.created === null ? "" : `, ${dateTime(comment.created)}`}\n${comment.body.trim() || "(empty)"}`;
		if (blocks.length > 0 && length + block.length > MAX_TEXT) break;
		blocks.push(block.length > MAX_TEXT ? `${block.slice(0, MAX_TEXT)}…` : block);
		length += block.length + 2;
	}
	const end = start + blocks.length;
	const more =
		end < total
			? `\n\n[More comments follow: call jira_get_comments again with "start": ${end + 1}.]`
			: "";
	return `Comments ${start + 1}–${end} of ${total} on ${key}, oldest first:\n\n${blocks.join("\n\n")}${more}`;
}

/** Time tracking as a line: estimate, spent, remaining; "" when there is none. */
export function timeTrackingLine(time: {
	readonly estimate: number | null;
	readonly spent: number | null;
	readonly remaining: number | null;
}): string {
	const parts = [
		time.estimate === null ? "" : `original estimate ${formatDuration(time.estimate)}`,
		time.spent === null ? "" : `logged ${formatDuration(time.spent)}`,
		time.remaining === null ? "" : `remaining ${formatDuration(time.remaining)}`,
	].filter((part) => part !== "");
	return parts.join(", ");
}

const secondsOf = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** An issue's work logs for the model: the time tracking, the total by person, each log. */
export function worklogsText(
	key: string,
	worklogs: readonly unknown[],
	timetracking: Record<string, unknown>,
): string {
	const time = timeTrackingLine({
		estimate: secondsOf(timetracking.originalEstimateSeconds),
		spent: secondsOf(timetracking.timeSpentSeconds),
		remaining: secondsOf(timetracking.remainingEstimateSeconds),
	});
	const logs = worklogs
		.map(asRecord)
		.map((log) => ({
			author: personOf(log.author),
			started: asString(log.started),
			seconds: secondsOf(log.timeSpentSeconds) ?? 0,
			comment: typeof log.comment === "string" ? log.comment : "",
		}))
		.sort((a, b) => (a.started < b.started ? 1 : a.started > b.started ? -1 : 0));
	const head = `Work logged on ${key}${time === "" ? "" : ` (${time})`}`;
	if (logs.length === 0) return `${head}: no work logs.`;
	const byPerson = new Map<string, number>();
	for (const log of logs) byPerson.set(log.author, (byPerson.get(log.author) ?? 0) + log.seconds);
	const totals = [...byPerson.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([author, seconds]) => `- ${author}: ${formatDuration(seconds)}`);
	const shown = logs.slice(0, 300);
	const lines = shown.map(
		(log) =>
			`- ${dateTime(log.started)}, ${log.author}: ${formatDuration(log.seconds)}${log.comment.trim() === "" ? "" : ` — ${clip(log.comment, 300)}`}`,
	);
	return `${head}:\n\nBy person:\n${totals.join("\n")}\n\nWork logs (${logs.length}, newest first${shown.length < logs.length ? `, the latest ${shown.length}` : ""}):\n${lines.join("\n")}`;
}

const KIND_NAMES: Record<DevelopmentKind, string> = {
	branches: "Branches",
	commits: "Commits",
	pullRequests: "Pull requests",
};

/** An issue's development for the model: the counts, then each branch, commit and pull request. */
export function developmentText(
	key: string,
	summary: DevelopmentSummary | null,
	details: readonly {
		readonly kind: DevelopmentKind;
		readonly items: readonly DevelopmentItem[];
	}[],
): string {
	if (summary === null) {
		return `Jira has no development information for ${key} (no repository tool is connected to it, or it cannot be read).`;
	}
	const counts = [
		`${summary.branches.count} branches`,
		`${summary.commits.count} commits`,
		`${summary.pullRequests.count} pull requests${summary.pullRequests.state === "" ? "" : ` (${summary.pullRequests.state})`}`,
		`${summary.builds.count} builds`,
	];
	const lines = [`Development of ${key}: ${counts.join(", ")}.`];
	for (const { kind, items } of details) {
		if (items.length === 0) continue;
		lines.push(
			"",
			`${KIND_NAMES[kind]}:`,
			...items.slice(0, 100).map((item) => {
				const facts = [
					item.repository,
					item.author,
					item.when === null ? "" : dateTime(item.when),
					item.state,
				].filter((part) => part !== "");
				const detail = item.detail.trim() === "" ? "" : ` — ${clip(item.detail, 300)}`;
				return `- ${item.title}${facts.length === 0 ? "" : ` (${facts.join(", ")})`}${detail}${item.url === "" ? "" : ` ${item.url}`}`;
			}),
		);
	}
	return lines.join("\n");
}

/** A board's sprints for the model. */
export function sprintsText(
	board: { readonly id: string; readonly name: string },
	sprints: readonly BoardSprint[],
): string {
	const head = `Sprints of the board ${board.name} (id ${board.id})`;
	if (sprints.length === 0) return `${head}: none in these states.`;
	const lines = sprints.map((sprint) => {
		const dates = [sprint.startDate.slice(0, 10), sprint.endDate.slice(0, 10)].filter(
			(part) => part !== "",
		);
		return `- ${sprint.name} (id ${sprint.id}, ${sprint.state || "?"}${dates.length === 0 ? "" : `, ${dates.join(" → ")}`})${sprint.goal.trim() === "" ? "" : ` — goal: ${clip(sprint.goal, 300)}`}`;
	});
	return `${head}:\n${lines.join("\n")}\n\nThe issues of a sprint: jira_search with \`sprint = <id>\`.`;
}

/** The sprint the model named (id, exact name or part of it); why not otherwise. */
export function findSprint(sprints: readonly BoardSprint[], named: string): BoardSprint | string {
	const wanted = fold(named);
	const found =
		sprints.find((sprint) => sprint.id === named.trim()) ??
		sprints.find((sprint) => fold(sprint.name) === wanted);
	if (found !== undefined) return found;
	const partial = sprints.filter((sprint) => wanted !== "" && fold(sprint.name).includes(wanted));
	if (partial.length === 1) return partial[0] as BoardSprint;
	const names = (partial.length > 1 ? partial : sprints)
		.map((sprint) => `${sprint.name} (id ${sprint.id})`)
		.join(", ");
	return partial.length > 1
		? `More than one sprint matches "${named}": ${names}. Call again with its id.`
		: `No open sprint named "${named}". The sprints: ${names || "none"}.`;
}
