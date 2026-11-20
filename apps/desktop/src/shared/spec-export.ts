/**
 * An analysis kept in the repository as spec files a coding agent reads:
 * requirements, a design and a task list, in the layout the agent's tools
 * expect (GitHub Spec Kit, Kiro, or Kalem's own). Each file says which
 * document it came from and that document's hash, so a later change can be
 * seen; the task list is checked against the analysis, so each functional
 * requirement has a task and no task names a requirement the analysis does
 * not have. Pure.
 */
import { definedIds, idPrefixes } from "./analysis-lint.js";
import type { TemplateMeta } from "./templates.js";

/** The layouts a spec is written in. */
export const SPEC_PROFILES = ["spec-kit", "kiro", "kalem"] as const;
export type SpecProfile = (typeof SPEC_PROFILES)[number];
/** What the user picks: a layout, or the one the workspace already uses. */
export type SpecProfileChoice = "auto" | SpecProfile;
export const SPEC_PROFILE_CHOICES: readonly SpecProfileChoice[] = ["auto", ...SPEC_PROFILES];

export const isSpecProfile = (value: unknown): value is SpecProfile =>
	typeof value === "string" && (SPEC_PROFILES as readonly string[]).includes(value);

/** The three parts of a spec, as Markdown. */
export interface SpecParts {
	readonly requirements: string;
	readonly design: string;
	readonly tasks: string;
}

interface Layout {
	/** The folder the specs are kept in, relative to the workspace, `/`-separated. */
	readonly base: string;
	/** Whether a spec's folder starts with a number (`001-…`). */
	readonly numbered: boolean;
	readonly files: { readonly [K in keyof SpecParts]: string };
}

const LAYOUTS: Readonly<Record<SpecProfile, Layout>> = {
	"spec-kit": {
		base: "specs",
		numbered: true,
		files: { requirements: "spec.md", design: "plan.md", tasks: "tasks.md" },
	},
	kiro: {
		base: ".kiro/specs",
		numbered: false,
		files: { requirements: "requirements.md", design: "design.md", tasks: "tasks.md" },
	},
	kalem: {
		base: ".kalem/specs",
		numbered: false,
		files: { requirements: "requirements.md", design: "design.md", tasks: "tasks.md" },
	},
};

/** The folder a layout keeps its specs in, relative to the workspace. */
export const specBase = (profile: SpecProfile): string => LAYOUTS[profile].base;

/**
 * The layout to write in: the one the user chose, else the one the
 * workspace already has (a `.kiro` folder is Kiro's, a `.specify` or
 * `specs` folder Spec Kit's), else Spec Kit's.
 */
export function chooseProfile(
	choice: unknown,
	has: { readonly kiro: boolean; readonly specKit: boolean },
): SpecProfile {
	if (isSpecProfile(choice)) return choice;
	if (has.kiro && !has.specKit) return "kiro";
	return "spec-kit";
}

const FOLD: Readonly<Record<string, string>> = {
	ç: "c",
	ğ: "g",
	ı: "i",
	ö: "o",
	ş: "s",
	ü: "u",
};

/** A title as a folder name: lower-case ASCII words joined by dashes. */
export function specSlug(title: string): string {
	const words = title
		.toLocaleLowerCase("tr")
		.replace(/[çğıöşü]/g, (letter) => FOLD[letter] ?? letter)
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter((word) => word !== "");
	let slug = "";
	for (const word of words) {
		const next = slug === "" ? word : `${slug}-${word}`;
		if (next.length > 50) break;
		slug = next;
	}
	return slug === "" ? (words[0]?.slice(0, 50) ?? "spec") || "spec" : slug;
}

/**
 * The folder a spec goes in, relative to the workspace: the one it already
 * has when a spec of that name is there (it is updated), else a new one;
 * Spec Kit's take the next number.
 */
export function specFolder(
	profile: SpecProfile,
	title: string,
	existing: readonly string[],
): { readonly folder: string; readonly exists: boolean } {
	const layout = LAYOUTS[profile];
	const slug = specSlug(title);
	if (!layout.numbered) {
		return { folder: `${layout.base}/${slug}`, exists: existing.includes(slug) };
	}
	const numbered = existing
		.map((name) => /^(\d{3,})-(.+)$/.exec(name))
		.filter((match): match is RegExpExecArray => match !== null);
	const same = numbered.find((match) => match[2] === slug);
	if (same !== undefined) return { folder: `${layout.base}/${same[0]}`, exists: true };
	const next = Math.max(0, ...numbered.map((match) => Number(match[1]))) + 1;
	return { folder: `${layout.base}/${String(next).padStart(3, "0")}-${slug}`, exists: false };
}

/** Where each part is written, relative to the workspace. */
export function specFiles(
	profile: SpecProfile,
	folder: string,
): { readonly [K in keyof SpecParts]: string } {
	const { files } = LAYOUTS[profile];
	return {
		requirements: `${folder}/${files.requirements}`,
		design: `${folder}/${files.design}`,
		tasks: `${folder}/${files.tasks}`,
	};
}

const SOURCE_LINE = /^<!-- kalem-source: .* -->\r?\n(?:\r?\n)?/;

/**
 * A part as it is written: its first line names the document it came from
 * and that document's hash (a comment, so it does not show and the agent's
 * tools read the rest as they expect), and it ends with a new line.
 */
export function withSource(markdown: string, source: { name: string; hash: string }): string {
	const name = source.name.replace(/-->|[\r\n"]/g, " ").trim();
	const body = markdown.replace(SOURCE_LINE, "").replace(/^\n+/, "");
	const line =
		source.hash === ""
			? `<!-- kalem-source: "${name}" -->`
			: `<!-- kalem-source: "${name}" hash=${source.hash} -->`;
	return `${line}\n\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

/** The document and hash a written part names; `null` when it names none. */
export function sourceOf(markdown: string): { name: string; hash: string } | null {
	const match = /^<!-- kalem-source: "([^"]*)"(?: hash=([0-9a-f]+))? -->/.exec(markdown);
	return match === null ? null : { name: match[1] as string, hash: match[2] ?? "" };
}

/** How a task list covers the analysis. */
export interface SpecCoverage {
	/** Its tasks: the `- [ ]` items. */
	readonly tasks: number;
	/** The analysis's functional requirements, as written. */
	readonly required: readonly string[];
	/** Functional requirements no task names. */
	readonly uncovered: readonly string[];
	/** Requirement ids tasks name that the analysis does not define. */
	readonly unknown: readonly string[];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Checks a task list against the analysis it was made from: each
 * functional requirement (`FR-…`, or the template's prefix for it) should
 * have a task that names it, and every id a task names should be one the
 * analysis defines. Without the analysis only the tasks are counted. Ids are
 * compared by number, so `FR-1` is `FR-01`.
 */
export function specCoverage(
	analysis: string | null,
	tasks: string,
	template: Pick<TemplateMeta, "ids"> | null,
): SpecCoverage {
	const count = tasks
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s+\S/.test(line)).length;
	if (analysis === null) return { tasks: count, required: [], uncovered: [], unknown: [] };

	const prefixes = idPrefixes(template);
	const functional = template?.ids.FR ?? "FR-";
	const key = (prefix: string, number: string | number): string => `${prefix}${Number(number)}`;
	const defined = definedIds(analysis, template);
	const definedKeys = new Set([...defined.values()].map((id) => key(id.prefix, id.number)));

	const named = new Map<string, string>();
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}])(${prefixes.map(escapeRegExp).join("|")})(\\d+)(?![\\p{L}\\p{N}])`,
		"gu",
	);
	for (const match of tasks.matchAll(pattern)) {
		const at = key(match[1] as string, match[2] as string);
		if (!named.has(at)) named.set(at, match[0]);
	}

	const required = [...defined.entries()]
		.filter(([, id]) => id.prefix === functional)
		.sort(([, a], [, b]) => a.number - b.number)
		.map(([written]) => written);
	const uncovered = required.filter((written) => {
		const id = defined.get(written);
		return id !== undefined && !named.has(key(id.prefix, id.number));
	});
	const unknown = [...named.entries()]
		.filter(([at]) => !definedKeys.has(at))
		.map(([, written]) => written);
	return { tasks: count, required, uncovered, unknown };
}

/** The layouts, each with the folder its specs are in and its files' names: where to look for specs. */
export function specLayouts(): readonly {
	readonly profile: SpecProfile;
	readonly base: string;
	readonly files: { readonly [K in keyof SpecParts]: string };
}[] {
	return SPEC_PROFILES.map((profile) => ({
		profile,
		base: LAYOUTS[profile].base,
		files: LAYOUTS[profile].files,
	}));
}

const TASK = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

/** How far the work on a spec is: its tasks, and the requirements whose tasks are all done. */
export interface SpecProgress {
	readonly total: number;
	readonly done: number;
	/** Requirement ids every task naming them is done for, as written in the tasks. */
	readonly finished: readonly string[];
	/** Requirement ids some task naming them is still open for. */
	readonly open: readonly string[];
}

/** Reads a task list's progress: `- [x]` is done; a requirement is finished when all its tasks are. */
export function specProgress(
	tasks: string,
	template: Pick<TemplateMeta, "ids"> | null,
): SpecProgress {
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}])(${idPrefixes(template).map(escapeRegExp).join("|")})(\\d+)(?![\\p{L}\\p{N}])`,
		"gu",
	);
	const state = new Map<string, { written: string; open: boolean }>();
	let total = 0;
	let done = 0;
	for (const line of tasks.replace(/\r\n?/g, "\n").split("\n")) {
		const match = TASK.exec(line);
		if (match === null || (match[4] as string).trim() === "") continue;
		total++;
		const checked = match[2] !== " ";
		if (checked) done++;
		for (const id of (match[4] as string).matchAll(pattern)) {
			const key = `${id[1]}${Number(id[2])}`;
			const known = state.get(key) ?? { written: id[0], open: false };
			if (!checked) known.open = true;
			state.set(key, known);
		}
	}
	const all = [...state.values()];
	return {
		total,
		done,
		finished: all.filter((id) => !id.open).map((id) => id.written),
		open: all.filter((id) => id.open).map((id) => id.written),
	};
}

/** A task and the Jira issue made for it. */
export interface TaskLink {
	/** The task's own id at the start of its text (`T1`), or a few words of it. */
	readonly task: string;
	/** The issue's key: `ABC-12`. */
	readonly key: string;
}

const JIRA_KEY = /^[A-Z][A-Z0-9_]{0,9}-\d{1,7}$/;

/**
 * Writes Jira keys into a task list: ` [ABC-12]` at the end of each task's
 * line, found by its id (`T1`, as a word at the start of its text) or by
 * the start of its text. A key already on the line is not written again.
 */
export function linkTasks(
	tasks: string,
	links: readonly TaskLink[],
): {
	readonly text: string;
	readonly linked: readonly string[];
	readonly missing: readonly string[];
} {
	const newline = tasks.includes("\r\n") ? "\r\n" : "\n";
	const lines = tasks.split(/\r?\n/);
	const linked: string[] = [];
	const missing: string[] = [];
	for (const link of links) {
		const key = link.key.trim().toLocaleUpperCase("en");
		const task = link.task.trim();
		if (!JIRA_KEY.test(key) || task === "") {
			missing.push(task === "" ? key : task);
			continue;
		}
		const byId = new RegExp(`^(?:\\*\\*)?${escapeRegExp(task)}(?:\\*\\*)?(?![\\p{L}\\p{N}])`, "iu");
		const byText = new RegExp(`^${escapeRegExp(task)}(?![\\p{L}\\p{N}])`, "iu");
		const bodies = lines.map((line) => TASK.exec(line)?.[4]?.trim() ?? null);
		let at = bodies.findIndex((body) => body !== null && byId.test(body));
		if (at === -1) at = bodies.findIndex((body) => body !== null && byText.test(body));
		if (at === -1) {
			missing.push(task);
			continue;
		}
		const line = lines[at] as string;
		if (!new RegExp(`(?<![A-Z0-9_])${escapeRegExp(key)}(?!\\d)`).test(line)) {
			lines[at] = `${line.replace(/\s+$/, "")} [${key}]`;
		}
		linked.push(`${task} → ${key}`);
	}
	return { text: lines.join(newline), linked, missing };
}

/** A spec made from a document, as the window shows it under the document. */
export interface SpecSummary {
	/** Its folder, relative to its workspace folder. */
	readonly folder: string;
	/** Its task list's file. */
	readonly tasksPath: string;
	readonly profile: SpecProfile;
	/** Whether the document changed since the spec was made; `null` when the spec keeps no hash. */
	readonly stale: boolean | null;
	readonly total: number;
	readonly done: number;
}
