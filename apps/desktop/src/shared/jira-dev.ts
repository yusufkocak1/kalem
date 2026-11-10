/**
 * Moving an issue along its workflow (Jira's transitions), and what was
 * done for it in code: the branches, commits and pull requests Jira's
 * "Development" panel lists (`/rest/dev-status/1.0`, filled by Bitbucket,
 * GitHub, GitLab…). Pure: the main process asks the server.
 */
import type { StatusCategory } from "./jira.js";

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string =>
	typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const category = (status: Json): StatusCategory => {
	const key = asString(asJson(status.statusCategory).key);
	return key === "new" || key === "indeterminate" || key === "done" ? key : "";
};

/** A step the issue can take from its status. */
export interface JiraTransition {
	readonly id: string;
	/** The step's own name: "Start Progress", "Resolve Issue"… */
	readonly name: string;
	/** The status it moves to. */
	readonly to: string;
	readonly toCategory: StatusCategory;
	/** Fields its screen requires that Kalem cannot fill: it is taken in Jira. */
	readonly needs: readonly string[];
	/** The resolution sent with it, when its screen asks for one. */
	readonly resolution: string | null;
}

/** Resolutions chosen, in this order, when a step asks for one. */
const RESOLUTIONS = ["Done", "Fixed", "Tamamlandı", "Çözüldü"];

/** The steps of `/rest/api/2/issue/KEY/transitions?expand=transitions.fields`. */
export function transitionsOf(raw: unknown): JiraTransition[] {
	return asArray(asJson(raw).transitions).flatMap((item) => {
		const transition = asJson(item);
		const id = asString(transition.id);
		if (id === "") return [];
		const to = asJson(transition.to);
		const needs: string[] = [];
		let resolution: string | null = null;
		for (const [key, value] of Object.entries(asJson(transition.fields))) {
			const field = asJson(value);
			if (field.required !== true || field.hasDefaultValue === true) continue;
			const allowed = asArray(field.allowedValues).map((option) => asString(asJson(option).name));
			if (key === "resolution" && allowed.length > 0) {
				resolution = RESOLUTIONS.find((name) => allowed.includes(name)) ?? allowed[0] ?? null;
				continue;
			}
			needs.push(asString(field.name) || key);
		}
		return [
			{
				id,
				name: asString(transition.name),
				to: asString(to.name) || asString(transition.name),
				toCategory: category(to),
				needs,
				resolution,
			},
		];
	});
}

/** What `POST /rest/api/2/issue/KEY/transitions` is sent to take a step. */
export function transitionBody(transition: JiraTransition): Json {
	return {
		transition: { id: transition.id },
		...(transition.resolution === null
			? {}
			: { fields: { resolution: { name: transition.resolution } } }),
	};
}

// --- Development -----------------------------------------------------------------

/** One line of the Development panel: how many, and when the latest changed. */
export interface DevelopmentCount {
	readonly count: number;
	/** ISO date and time, or `null`. */
	readonly updated: string | null;
}

export interface DevelopmentSummary {
	readonly branches: DevelopmentCount;
	readonly commits: DevelopmentCount;
	readonly pullRequests: DevelopmentCount & {
		/** "MERGED", "OPEN", "DECLINED"… of the pull requests together; "" when unknown. */
		readonly state: string;
	};
	readonly builds: DevelopmentCount;
	/** The tools that hold them ("stash", "github"…): the details are asked of each. */
	readonly sources: readonly string[];
}

const count = (part: unknown): DevelopmentCount => {
	const overall = asJson(asJson(part).overall);
	const updated = asString(overall.lastUpdated);
	return { count: Number(overall.count) || 0, updated: updated === "" ? null : updated };
};

/** `/rest/dev-status/1.0/issue/summary?issueId=…`. */
export function developmentSummaryOf(raw: unknown): DevelopmentSummary {
	const summary = asJson(asJson(raw).summary);
	const sources = new Set<string>();
	for (const part of ["branch", "repository", "pullrequest"]) {
		for (const [type, value] of Object.entries(asJson(asJson(summary[part]).byInstanceType))) {
			if (Number(asJson(value).count) > 0) sources.add(type);
		}
	}
	return {
		branches: count(summary.branch),
		commits: count(summary.repository),
		pullRequests: {
			...count(summary.pullrequest),
			state: asString(asJson(asJson(summary.pullrequest).overall).state),
		},
		builds: count(summary.build),
		sources: [...sources],
	};
}

/** Whether the issue has anything in code at all. */
export const hasDevelopment = (summary: DevelopmentSummary): boolean =>
	summary.branches.count + summary.commits.count + summary.pullRequests.count > 0;

export type DevelopmentKind = "branches" | "commits" | "pullRequests";

/** The `dataType` each kind is asked by. */
export const DEVELOPMENT_DATA_TYPE: Record<DevelopmentKind, string> = {
	branches: "branch",
	commits: "repository",
	pullRequests: "pullrequest",
};

export interface DevelopmentItem {
	/** A branch's name, a commit's short id, a pull request's title. */
	readonly title: string;
	/** A commit's message, a pull request's branches. */
	readonly detail: string;
	readonly repository: string;
	readonly author: string;
	/** ISO date and time, or `null`. */
	readonly when: string | null;
	/** A pull request's state: "MERGED", "OPEN", "DECLINED"; "" for the others. */
	readonly state: string;
	readonly url: string;
}

/** A time as Jira's detail gives it: ISO text or milliseconds. */
const time = (value: unknown): string | null => {
	if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
	const text = asString(value);
	return text === "" ? null : text;
};

/** The branches, commits or pull requests of `/rest/dev-status/1.0/issue/detail`, newest first. */
export function developmentItemsOf(raw: unknown, kind: DevelopmentKind): DevelopmentItem[] {
	const items: DevelopmentItem[] = [];
	for (const instance of asArray(asJson(raw).detail).map(asJson)) {
		if (kind === "branches") {
			for (const branch of asArray(instance.branches).map(asJson)) {
				const last = asJson(branch.lastCommit);
				items.push({
					title: asString(branch.name),
					detail: asString(last.message),
					repository: asString(asJson(branch.repository).name),
					author: asString(asJson(last.author).name),
					when: time(last.authorTimestamp),
					state: "",
					url: asString(branch.url),
				});
			}
		} else if (kind === "commits") {
			for (const repository of asArray(instance.repositories).map(asJson)) {
				for (const commit of asArray(repository.commits).map(asJson)) {
					items.push({
						title: asString(commit.displayId) || asString(commit.id).slice(0, 11),
						detail: asString(commit.message).split("\n")[0] ?? "",
						repository: asString(repository.name),
						author: asString(asJson(commit.author).name),
						when: time(commit.authorTimestamp),
						state: "",
						url: asString(commit.url),
					});
				}
			}
		} else {
			for (const pull of asArray(instance.pullRequests).map(asJson)) {
				const source = asJson(pull.source);
				const destination = asJson(pull.destination);
				const from = asString(source.branch);
				const to = asString(destination.branch);
				items.push({
					title: asString(pull.name),
					detail: from === "" ? "" : `${from} → ${to}`,
					repository: asString(asJson(source.repository).name),
					author: asString(asJson(pull.author).name),
					when: time(pull.lastUpdate),
					state: asString(pull.status),
					url: asString(pull.url),
				});
			}
		}
	}
	return items.sort((a, b) =>
		(a.when ?? "") < (b.when ?? "") ? 1 : (a.when ?? "") > (b.when ?? "") ? -1 : 0,
	);
}
