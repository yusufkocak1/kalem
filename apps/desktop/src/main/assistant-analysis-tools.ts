/**
 * The assistant's tools for analysis work: the document templates it follows, the
 * rule checks a review starts with, the findings it reports to the review
 * list, the plan it keeps while it works, and the prompts and spec files it
 * keeps for a coding agent.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findingsText, lintAnalysis } from "../shared/analysis-lint.js";
import type { PlanStep } from "../shared/claude.js";
import { parseFindings } from "../shared/findings.js";
import { format } from "../shared/i18n.js";
import type { SpecParts } from "../shared/spec-export.js";
import {
	chooseProfile,
	SPEC_PROFILES,
	specBase,
	specCoverage,
	specFiles,
	specFolder,
	withSource,
} from "../shared/spec-export.js";
import { templateFileName } from "../shared/templates.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import type { TemplateStore } from "./templates.js";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string) : "";

/** The template a tool works by: the one named, else the one picked for the question, else the user's default. */
async function templateFor(ctx: ToolContext, named: string) {
	const store = ctx.templates as TemplateStore;
	const picked = ctx.template ?? "";
	const wanted = named !== "" ? named : picked !== "" ? picked : ctx.settings().defaultTemplate;
	return (
		(wanted === "" ? null : await store.find(wanted)) ?? (await store.find("builtin:best-practice"))
	);
}

const isFolder = (path: string): Promise<boolean> =>
	stat(path).then(
		(found) => found.isDirectory(),
		() => false,
	);

/** The folders in a folder; none when it is not there. */
const foldersIn = (path: string): Promise<string[]> =>
	readdir(path, { withFileTypes: true }).then(
		(entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
		() => [],
	);

const withEnd = (markdown: string): string =>
	markdown.endsWith("\n") ? markdown : `${markdown}\n`;

const SPEC_PARTS: readonly (keyof SpecParts)[] = ["requirements", "design", "tasks"];

const PLAN_STATUSES = new Set(["pending", "active", "done"]);

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "analysis_templates",
			description:
				"Lists the user's document templates (the team's, their own, the built-in one: analyses, reports, notes, plans…) with the sections each requires; the default one and the one picked for this question are marked.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		risk: "read",
		available: (ctx) => ctx.templates !== null,
		async run(_input, ctx) {
			const all = await (ctx.templates as TemplateStore).list();
			const preferred = ctx.settings().defaultTemplate;
			const picked = ctx.template ?? "";
			ctx.step({ tool: "analysis_templates", detail: "" });
			return all
				.map(
					(template) =>
						`- "${template.name}" (id ${template.id}; ${template.source}${template.id === preferred || (preferred === "" && template.source === "builtin") ? "; the user's default" : ""}${template.id === picked ? "; picked for this question" : ""}): requires ${template.required.join(", ") || "nothing"}`,
				)
				.join("\n");
		},
	},
	{
		definition: {
			name: "analysis_template",
			description:
				"Reads a document template's Markdown by its name or id (without either: the one picked for this question, else the user's default): follow its sections, order and <!-- guide --> comments when writing, and check, analyse or report by it.",
			parameters: { type: "object", properties: { template: { type: "string" } }, required: [] },
		},
		risk: "read",
		available: (ctx) => ctx.templates !== null,
		async run(input, ctx) {
			const info = await templateFor(ctx, text(input, "template"));
			if (info === null) return "There is no such template; list them with analysis_templates.";
			ctx.step({ tool: "analysis_template", detail: info.name });
			return (await (ctx.templates as TemplateStore).read(info.id)).text;
		},
	},
	{
		definition: {
			name: "analysis_lint",
			description:
				"Checks the active document with rules, at once and for free: the template's missing or empty sections, vague words, TBDs, requirement ids repeated or skipped, requirements without acceptance criteria, broken links to headings. Its findings go to the user's review list by themselves.",
			parameters: {
				type: "object",
				properties: {
					template: {
						type: "string",
						description:
							"A document template's name or id; the one picked for this question, else the default, without it.",
					},
				},
				required: [],
			},
		},
		risk: "read",
		available: (ctx) => ctx.document !== null && ctx.templates !== null,
		async run(input, ctx) {
			const document = ctx.document as NonNullable<ToolContext["document"]>;
			const template = await templateFor(ctx, text(input, "template"));
			const t = ctx.t;
			// The user reads them in the interface's language; the model reads either.
			const findings = lintAnalysis(document.text, template, 80, {
				missingSection: t.lintMissingSection,
				emptySection: t.lintEmptySection,
				openPoint: t.lintOpenPoint,
				notMeasurable: t.lintNotMeasurable,
				definedTwice: t.lintDefinedTwice,
				idsSkipped: t.lintIdsSkipped,
				noCriteria: t.lintNoCriteria,
				brokenLink: t.lintBrokenLink,
			});
			ctx.step({ tool: "analysis_lint", detail: template?.name ?? "" });
			if (findings.length > 0) ctx.emit({ kind: "findings", findings });
			return `Checked against the template "${template?.name ?? "none"}". The user already sees these findings; do not report them again.\n${findingsText(findings)}`;
		},
	},
	{
		definition: {
			name: "report_findings",
			description:
				'Reports problems you found in the document to the user\'s review list, where each can be shown, fixed or turned into an open question. Each finding: {"severity":"high"|"medium"|"low","kind":"ambiguity"|"missing"|"contradiction"|"testability"|"consistency"|"security"|"code"|"other","section":"its heading","quote":"text copied exactly from the document, or empty","problem":"why","suggestion":"text to put in place of the quote, or empty","question":"what to ask the business, or empty"}.',
			parameters: {
				type: "object",
				properties: { findings: { type: "array", items: { type: "object" } } },
				required: ["findings"],
			},
		},
		risk: "read",
		available: () => true,
		async run(input, ctx) {
			const findings = parseFindings(input.findings).map((finding, index) => ({
				...finding,
				id: finding.id.startsWith("F-") ? finding.id : `F-${String(index + 1).padStart(2, "0")}`,
			}));
			if (findings.length === 0) return 'No finding it understands: each needs at least "problem".';
			const missing =
				ctx.document === null
					? []
					: findings.filter(
							(finding) => finding.quote !== "" && !ctx.document?.text.includes(finding.quote),
						);
			ctx.emit({ kind: "findings", findings });
			ctx.step({ tool: "report_findings", detail: String(findings.length) });
			return `Reported ${findings.length} findings.${missing.length > 0 ? ` These quotes are not in the document as written, so the user cannot find or fix them in place: ${missing.map((finding) => finding.id).join(", ")}.` : ""}`;
		},
	},
	{
		definition: {
			name: "plan_update",
			description:
				'Shows the user your plan for this answer, and its progress: call it with every step each time a step starts or ends. Steps: {"title":"…","status":"pending"|"active"|"done"}.',
			parameters: {
				type: "object",
				properties: { steps: { type: "array", items: { type: "object" } } },
				required: ["steps"],
			},
		},
		risk: "read",
		available: () => true,
		async run(input, ctx) {
			const steps: PlanStep[] = (Array.isArray(input.steps) ? input.steps : [])
				.slice(0, 30)
				.flatMap((raw): PlanStep[] => {
					if (typeof raw !== "object" || raw === null) return [];
					const step = raw as Record<string, unknown>;
					const title = typeof step.title === "string" ? step.title.trim().slice(0, 200) : "";
					if (title === "") return [];
					const status = PLAN_STATUSES.has(step.status as string)
						? (step.status as PlanStep["status"])
						: "pending";
					return [{ title, status }];
				});
			if (steps.length === 0) return "Give the steps.";
			ctx.emit({ kind: "plan", steps });
			return "The user sees the plan.";
		},
	},
	{
		definition: {
			name: "save_prompt",
			description:
				"Keeps a prompt for a coding agent as a Markdown file in the workspace's .kalem/prompts folder; the user is asked first.",
			parameters: {
				type: "object",
				properties: { title: { type: "string" }, prompt: { type: "string" } },
				required: ["title", "prompt"],
			},
		},
		risk: "document",
		available: (ctx) => ctx.workspace !== null,
		async run(input, ctx) {
			const title = text(input, "title").trim().slice(0, 120) || "prompt";
			const body = text(input, "prompt");
			if (body.trim() === "") return "Give the prompt's text.";
			const root = ctx.workspace?.roots[0] as string;
			const folder = join(root, ".kalem", "prompts");
			const path = join(folder, templateFileName(title));
			const answer = await ctx.approve({
				tool: "save_prompt",
				risk: "document",
				permission: "prompts",
				title: ctx.t.approvalSavePrompt,
				lines: [format(ctx.t.approvalSavePromptTo, path)],
				preview: body
					.slice(0, 4000)
					.split("\n")
					.map((line) => `+ ${line}`)
					.join("\n"),
			});
			if (!answer.approved)
				return "The user did not allow it; they can copy the prompt from your reply.";
			await mkdir(folder, { recursive: true });
			await writeFile(path, body.endsWith("\n") ? body : `${body}\n`);
			ctx.step({ tool: "save_prompt", detail: path });
			return `Saved to ${path}.`;
		},
	},
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
							"Markdown: a `- [ ]` list in the order to do them; each task names the requirement ids it does, the files it touches and its test.",
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

			const template = ctx.templates === null ? null : await templateFor(ctx, "");
			const coverage = specCoverage(ctx.document?.text ?? null, parts.tasks, template);
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

			const root = ctx.workspace?.roots[0] as string;
			const profile = chooseProfile(
				typeof input.profile === "string" ? input.profile : ctx.settings().specProfile,
				{
					kiro: await isFolder(join(root, ".kiro")),
					specKit:
						(await isFolder(join(root, ".specify"))) || (await isFolder(join(root, "specs"))),
				},
			);
			const { folder, exists } = specFolder(
				profile,
				title,
				await foldersIn(join(root, ...specBase(profile).split("/"))),
			);
			const files = specFiles(profile, folder);
			const source = {
				name: ctx.document?.name ?? "",
				hash:
					ctx.document === null
						? ""
						: createHash("sha256").update(ctx.document.text).digest("hex").slice(0, 12),
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
					format(exists ? ctx.t.approvalSaveSpecUpdates : ctx.t.approvalSaveSpecTo, folder),
					...written.map((file) => file.path),
					...(coverage.uncovered.length > 0
						? [format(ctx.t.approvalSpecGaps, coverage.uncovered.join(", "))]
						: []),
				],
				preview: written
					.map((file) => `# ${file.path}\n${file.text}`)
					.join("\n")
					.slice(0, 6000)
					.split("\n")
					.map((line) => `+ ${line}`)
					.join("\n"),
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
			return `${exists ? "Updated" : "Saved"} the spec in ${folder} (${profile}): ${written.map((file) => file.path).join(", ")}.${covered} Tell the user they can give the agent the folder: "implement the tasks in ${files.tasks}".`;
		},
	},
];

registerTools(TOOLS);
