/**
 * The assistant's tools for the work a coding agent does from an analysis:
 * keeping the analysis as spec files (`spec_export`), seeing the specs and
 * how far each is (`spec_status`), writing the Jira issues made for its
 * tasks back into them (`spec_link_jira`), and reading or starting the
 * repository's rules for agents (`agent_rules`, `agent_rules_open`).
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AGENT_RULE_FILES, agentRulesText, agentsStarter } from "../shared/agent-rules.js";
import { format, stringsFor } from "../shared/i18n.js";
import type { SpecParts, TaskLink } from "../shared/spec-export.js";
import {
	chooseProfile,
	linkTasks,
	SPEC_PROFILES,
	specBase,
	specCoverage,
	specFiles,
	specFolder,
	specProgress,
	withSource,
} from "../shared/spec-export.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import { documentHash, findSpecs, readAgentRules } from "./specs.js";
import type { TemplateStore } from "./templates.js";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string) : "";

const withEnd = (markdown: string): string =>
	markdown.endsWith("\n") ? markdown : `${markdown}\n`;

const isFolder = (path: string): Promise<boolean> =>
	stat(path).then(
		(found) => found.isDirectory(),
		() => false,
	);

const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

/** The folders in a folder; none when it is not there. */
const foldersIn = (path: string): Promise<string[]> =>
	readdir(path, { withFileTypes: true }).then(
		(entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
		() => [],
	);

/** The template the document follows: the one picked for the question, else the user's default. */
async function templateOf(ctx: ToolContext) {
	if (ctx.templates === null) return null;
	const store = ctx.templates as TemplateStore;
	const wanted = ctx.template ?? ctx.settings().defaultTemplate;
	return (
		(wanted === "" ? null : await store.find(wanted)) ?? (await store.find("builtin:best-practice"))
	);
}

const roots = (ctx: ToolContext): readonly string[] => ctx.workspace?.roots ?? [];

/** Shows a preview of files as an approval card does: each under its path, every line marked. */
const filesPreview = (files: readonly { path: string; text: string }[]): string =>
	files
		.map((file) => `# ${file.path}\n${file.text}`)
		.join("\n")
		.slice(0, 6000)
		.split("\n")
		.map((line) => `+ ${line}`)
		.join("\n");

const SPEC_PARTS: readonly (keyof SpecParts)[] = ["requirements", "design", "tasks"];

/** The spec a name means: its folder (`specs/001-x`), the folder's last part, or a part of it. */
async function specNamed(ctx: ToolContext, name: string) {
	const all = await findSpecs(roots(ctx));
	const wanted = name.trim().replace(/\/+$/, "").toLocaleLowerCase("tr");
	return (
		all.find((spec) => spec.folder.toLocaleLowerCase("tr") === wanted) ??
		all.find((spec) => spec.folder.split("/").pop()?.toLocaleLowerCase("tr") === wanted) ??
		all.find((spec) => spec.folder.toLocaleLowerCase("tr").includes(wanted)) ??
		null
	);
}

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "spec_export",
			description:
				"Keeps the analysis in the workspace as spec files a coding agent works from: the requirements, the design and the tasks, in the layout the user chose (GitHub Spec Kit: specs/NNN-name/spec.md, plan.md, tasks.md; Kiro: .kiro/specs/name/requirements.md, design.md, tasks.md; Kalem: .kalem/specs/name/…). A spec of the same name is updated. The tasks are checked against the document: each functional requirement needs a task that names its id, and no task may name an id the document does not have; when one does not, nothing is written and you are told what to fix. The user is asked first.",
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "The feature's name; its folder is made from it." },
					requirements: {
						type: "string",
						description:
							"Markdown: the goal, the scope, and each requirement under its id from the document, with its acceptance criteria (WHEN … THE SYSTEM SHALL …).",
					},
					design: {
						type: "string",
						description:
							"Markdown: how it is built: the code it touches (paths), the data, the constraints, the risks.",
					},
					tasks: {
						type: "string",
						description:
							"Markdown: a `- [ ]` list in the order to do them; each task starts with its id (T1, T2…), names the requirement ids it does, the files it touches and its test.",
					},
					profile: {
						type: "string",
						enum: [...SPEC_PROFILES],
						description: "Only when the user asks for another layout than the one set.",
					},
					accept_gaps: {
						type: "boolean",
						description:
							"True only when the user wants it kept although requirements have no task (part of the work, on purpose).",
					},
				},
				required: ["title", "requirements", "design", "tasks"],
			},
		},
		risk: "document",
		available: (ctx) => ctx.workspace !== null,
		async run(input, ctx) {
			const title = text(input, "title").trim().slice(0, 120);
			if (title === "") return "Give the feature's title.";
			const parts: SpecParts = {
				requirements: text(input, "requirements"),
				design: text(input, "design"),
				tasks: text(input, "tasks"),
			};
			const empty = SPEC_PARTS.filter((part) => parts[part].trim() === "");
			if (empty.length > 0) return `Give the ${empty.join(", ")} too.`;

			const coverage = specCoverage(ctx.document?.text ?? null, parts.tasks, await templateOf(ctx));
			if (coverage.tasks === 0) {
				return "Nothing written: write the tasks as a `- [ ] …` list, each naming the requirement ids it does.";
			}
			const gaps: string[] = [];
			if (coverage.unknown.length > 0) {
				gaps.push(
					`Tasks name ids the document does not define: ${coverage.unknown.join(", ")}. Use the document's ids, or add the requirement to the document first.`,
				);
			}
			if (coverage.uncovered.length > 0 && input.accept_gaps !== true) {
				gaps.push(
					`No task names ${coverage.uncovered.join(", ")}. Add tasks for them, or, when the user wants only part of the work, call again with accept_gaps.`,
				);
			}
			if (gaps.length > 0) return `Nothing written. ${gaps.join(" ")}`;

			const root = roots(ctx)[0] as string;
			const profile = chooseProfile(
				typeof input.profile === "string" ? input.profile : ctx.settings().specProfile,
				{
					kiro: await isFolder(join(root, ".kiro")),
					specKit:
						(await isFolder(join(root, ".specify"))) || (await isFolder(join(root, "specs"))),
				},
			);
			const { folder, exists: updating } = specFolder(
				profile,
				title,
				await foldersIn(join(root, ...specBase(profile).split("/"))),
			);
			const files = specFiles(profile, folder);
			const source = {
				name: ctx.document?.name ?? "",
				hash: ctx.document === null ? "" : documentHash(ctx.document.text),
			};
			const written = SPEC_PARTS.map((part) => ({
				path: files[part],
				text: source.name === "" ? withEnd(parts[part]) : withSource(parts[part], source),
			}));

			const answer = await ctx.approve({
				tool: "spec_export",
				risk: "document",
				permission: "prompts",
				title: ctx.t.approvalSaveSpec,
				lines: [
					format(updating ? ctx.t.approvalSaveSpecUpdates : ctx.t.approvalSaveSpecTo, folder),
					...written.map((file) => file.path),
					...(coverage.uncovered.length > 0
						? [format(ctx.t.approvalSpecGaps, coverage.uncovered.join(", "))]
						: []),
				],
				preview: filesPreview(written),
			});
			if (!answer.approved)
				return "The user did not allow it; they can copy the spec from your reply.";
			for (const file of written) {
				const path = join(root, ...file.path.split("/"));
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.text);
			}
			ctx.step({ tool: "spec_export", detail: folder });
			const covered =
				coverage.required.length === 0
					? ""
					: ` ${coverage.required.length - coverage.uncovered.length} of the document's ${coverage.required.length} functional requirements have tasks${coverage.uncovered.length > 0 ? ` (not ${coverage.uncovered.join(", ")})` : ""}.`;
			return `${updating ? "Updated" : "Saved"} the spec in ${folder} (${profile}): ${written.map((file) => file.path).join(", ")}.${covered} Tell the user they can give the agent the folder: "implement the tasks in ${files.tasks}".`;
		},
	},
	{
		definition: {
			name: "spec_status",
			description:
				"Lists the spec files in the workspace (Spec Kit, Kiro or Kalem's): each one's folder, the document it was made from and whether that document changed since (when it is the active one), and how far its tasks are: done of all, the requirements finished and those still open. With `spec`, that one only, with its task list.",
			parameters: {
				type: "object",
				properties: {
					spec: { type: "string", description: "A spec's folder or name; all of them without it." },
				},
				required: [],
			},
		},
		risk: "read",
		available: (ctx) => ctx.workspace !== null,
		async run(input, ctx) {
			const wanted = text(input, "spec").trim();
			const all =
				wanted === ""
					? await findSpecs(roots(ctx))
					: await specNamed(ctx, wanted).then((one) => (one === null ? [] : [one]));
			ctx.step({ tool: "spec_status", detail: wanted });
			if (all.length === 0) {
				return wanted === ""
					? "The workspace has no spec files yet; spec_export makes them from the analysis."
					: `There is no spec named "${wanted}"; call spec_status without it to list them.`;
			}
			const template = await templateOf(ctx);
			const active = ctx.document;
			const hash = active === null ? "" : documentHash(active.text);
			return all
				.map((spec) => {
					const progress = specProgress(spec.tasks, template);
					const source =
						spec.source === null
							? "made from no document Kalem knows"
							: spec.source.name === active?.name && spec.source.hash !== ""
								? `made from ${spec.source.name} (the active document), which ${spec.source.hash === hash ? "has not changed since" : "CHANGED since: the spec is out of date; offer to update it with spec_export, the same title"}`
								: `made from ${spec.source.name}`;
					const lines = [
						`- ${spec.folder} (${spec.profile}): ${source}. Tasks: ${progress.done} of ${progress.total} done.${progress.finished.length > 0 ? ` Finished: ${progress.finished.join(", ")}.` : ""}${progress.open.length > 0 ? ` Open: ${progress.open.join(", ")}.` : ""}`,
					];
					if (wanted !== "")
						lines.push(`<tasks file="${spec.files.tasks}">\n${spec.tasks}\n</tasks>`);
					return lines.join("\n");
				})
				.join("\n");
		},
	},
	{
		definition: {
			name: "spec_link_jira",
			description:
				'Writes the Jira issues made for a spec\'s tasks into its task list, as " [ABC-12]" at the end of each task\'s line, so the agent and the team see them. Make the issues first with jira_create_issues (one for each task, the task\'s id in the summary), then call this with the keys it returned. Each link: {"task":"T1","key":"ABC-12"}. The user is asked first.',
			parameters: {
				type: "object",
				properties: {
					spec: {
						type: "string",
						description: "The spec's folder or name, as spec_status lists it.",
					},
					links: { type: "array", items: { type: "object" } },
				},
				required: ["spec", "links"],
			},
		},
		risk: "document",
		available: (ctx) => ctx.workspace !== null,
		async run(input, ctx) {
			const spec = await specNamed(ctx, text(input, "spec"));
			if (spec === null) return "There is no such spec; list them with spec_status.";
			const links: TaskLink[] = (Array.isArray(input.links) ? input.links : [])
				.slice(0, 200)
				.flatMap((raw): TaskLink[] => {
					if (typeof raw !== "object" || raw === null) return [];
					const { task, key } = raw as Record<string, unknown>;
					return typeof task === "string" && typeof key === "string" ? [{ task, key }] : [];
				});
			if (links.length === 0) return 'Give the links: [{"task":"T1","key":"ABC-12"}].';
			const current = await readFile(spec.files.tasks, "utf8").catch(() => null);
			if (current === null) return `${spec.folder} has no task list.`;
			const result = linkTasks(current, links);
			if (result.linked.length === 0) {
				return `No task found for ${result.missing.join(", ")}: give each task's id as it starts its line in the task list (spec_status with the spec shows it).`;
			}
			const answer = await ctx.approve({
				tool: "spec_link_jira",
				risk: "document",
				permission: "prompts",
				title: format(ctx.t.approvalSpecJira, spec.folder),
				lines: [spec.files.tasks, ...result.linked],
			});
			if (!answer.approved) return "The user did not allow it: nothing was written.";
			await writeFile(spec.files.tasks, result.text);
			ctx.step({ tool: "spec_link_jira", detail: spec.folder });
			return `Wrote ${result.linked.length} keys into ${spec.files.tasks}.${result.missing.length > 0 ? ` No task was found for ${result.missing.join(", ")}.` : ""}`;
		},
	},
	{
		definition: {
			name: "agent_rules",
			description: `Reads the repository's rules for coding agents (${AGENT_RULE_FILES.join(", ")}): its commands, code layout, conventions and what agents must not do. Read it before writing a prompt or spec for an agent, so they keep to these rules and name the right commands.`,
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: (ctx) => ctx.workspace !== null,
		async run(_input, ctx) {
			const found = await readAgentRules(roots(ctx));
			ctx.step({ tool: "agent_rules", detail: found.map((file) => file.path).join(", ") });
			return agentRulesText(found);
		},
	},
	{
		definition: {
			name: "agent_rules_open",
			description:
				"Opens the repository's AGENTS.md (or another of the agents' rule files) in a tab, where the user edits it as any document; when it is not there, starts it from an outline the team fills in. The user is asked first.",
			parameters: {
				type: "object",
				properties: { file: { type: "string", enum: [...AGENT_RULE_FILES] } },
				required: [],
			},
		},
		risk: "document",
		available: (ctx) => ctx.workspace !== null,
		async run(input, ctx) {
			const file = AGENT_RULE_FILES.includes(text(input, "file"))
				? text(input, "file")
				: "AGENTS.md";
			const root = roots(ctx)[0] as string;
			const path = join(root, ...file.split("/"));
			const there = await exists(path);
			const starter = agentsStarter(ctx.t === stringsFor("tr") ? "tr" : "en");
			const answer = await ctx.approve({
				tool: "agent_rules_open",
				risk: there ? "ui" : "document",
				permission: there ? "view" : "prompts",
				title: there ? ctx.t.approvalAgentsOpen : ctx.t.approvalAgentsCreate,
				lines: [path],
				...(there ? {} : { preview: filesPreview([{ path: file, text: starter }]) }),
			});
			if (!answer.approved) return "The user did not allow it.";
			if (!there) {
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, starter, { flag: "wx" });
			}
			const opened = await ctx.renderer("open_path", { path });
			ctx.step({ tool: "agent_rules_open", detail: file });
			if (!opened.ok)
				return `${there ? "" : `Started ${path}, but `}could not open it: ${opened.text}`;
			return there
				? `Opened ${file}; it is the active document now.`
				: `Started ${file} from an outline and opened it: offer to fill it in from the workspace (the commands in its package files, its folders), with document_edit.`;
		},
	},
];

registerTools(TOOLS);
