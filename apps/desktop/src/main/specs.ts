/**
 * The spec files in the workspace's folders, in any of the layouts Kalem
 * writes (`spec-export.ts`): where each is, the document it was made from,
 * and its task list. The assistant's spec tools and the window's "the spec
 * is out of date" notice both read them here.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AGENT_RULE_FILES } from "../shared/agent-rules.js";
import type { SpecProfile, SpecSummary } from "../shared/spec-export.js";
import { sourceOf, specLayouts, specProgress } from "../shared/spec-export.js";

/** How many specs are looked at in each layout's folder. */
const MAX_SPECS = 200;
/** The most of a spec file that is read. */
const MAX_FILE = 512 * 1024;

/** The hash a spec keeps of the document it was made from. */
export const documentHash = (text: string): string =>
	createHash("sha256").update(text).digest("hex").slice(0, 12);

/** A spec found in a workspace folder. */
export interface FoundSpec {
	readonly root: string;
	readonly profile: SpecProfile;
	/** Its folder, relative to `root`, `/`-separated. */
	readonly folder: string;
	/** Its files' full paths. */
	readonly files: {
		readonly requirements: string;
		readonly design: string;
		readonly tasks: string;
	};
	/** The document it was made from, and that document's hash; `null` when it names none. */
	readonly source: { readonly name: string; readonly hash: string } | null;
	/** Its task list's text; empty when it has none. */
	readonly tasks: string;
}

const readText = (path: string): Promise<string | null> =>
	readFile(path, "utf8").then(
		(text) => text.slice(0, MAX_FILE),
		() => null,
	);

/** Every spec in the folders: those with a task list or requirements, in each layout's place. */
export async function findSpecs(roots: readonly string[]): Promise<FoundSpec[]> {
	const found: FoundSpec[] = [];
	for (const root of roots) {
		for (const layout of specLayouts()) {
			const base = join(root, ...layout.base.split("/"));
			const folders = await readdir(base, { withFileTypes: true }).then(
				(entries) =>
					entries
						.filter((entry) => entry.isDirectory())
						.map((entry) => entry.name)
						.sort()
						.slice(0, MAX_SPECS),
				() => [] as string[],
			);
			for (const name of folders) {
				const files = {
					requirements: join(base, name, layout.files.requirements),
					design: join(base, name, layout.files.design),
					tasks: join(base, name, layout.files.tasks),
				};
				const tasks = await readText(files.tasks);
				const requirements = await readText(files.requirements);
				if (tasks === null && requirements === null) continue;
				found.push({
					root,
					profile: layout.profile,
					folder: `${layout.base}/${name}`,
					files,
					source: sourceOf(tasks ?? "") ?? sourceOf(requirements ?? ""),
					tasks: tasks ?? "",
				});
			}
		}
	}
	return found;
}

/** The specs made from a document (by its file's name), and whether each is behind it. */
export async function specsOf(
	roots: readonly string[],
	name: string,
	text: string,
): Promise<SpecSummary[]> {
	if (name === "") return [];
	const hash = documentHash(text);
	return (await findSpecs(roots))
		.filter((spec) => spec.source?.name === name)
		.map((spec) => {
			const progress = specProgress(spec.tasks, null);
			const kept = spec.source?.hash ?? "";
			return {
				folder: spec.folder,
				tasksPath: spec.files.tasks,
				profile: spec.profile,
				stale: kept === "" ? null : kept !== hash,
				total: progress.total,
				done: progress.done,
			};
		});
}

/** The agents' rule files the folders have, each with its path relative to its folder. */
export async function readAgentRules(
	roots: readonly string[],
): Promise<{ path: string; full: string; text: string }[]> {
	const found: { path: string; full: string; text: string }[] = [];
	for (const root of roots) {
		for (const file of AGENT_RULE_FILES) {
			const full = join(root, ...file.split("/"));
			const text = await readText(full);
			if (text === null) continue;
			found.push({ path: roots.length > 1 ? `${root}/${file}` : file, full, text });
		}
	}
	return found;
}
