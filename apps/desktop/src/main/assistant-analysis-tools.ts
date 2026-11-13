/**
 * The assistant's tools for analysis work: the document templates it follows, the
 * rule checks a review starts with, the findings it reports to the review
 * list, the plan it keeps while it works, and the prompts it keeps for a
 * coding agent.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findingsText, lintAnalysis } from "../shared/analysis-lint.js";
import type { PlanStep } from "../shared/claude.js";
import { parseFindings } from "../shared/findings.js";
import { format } from "../shared/i18n.js";
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
];

registerTools(TOOLS);
