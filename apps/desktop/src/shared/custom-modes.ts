/**
 * Modes the user makes: a name and an icon, the instructions the model is
 * given, steps of their own, the Kalem tools it may use (all, or a few),
 * and MCP servers of their own (a program run on this computer, or an
 * address) that Claude Code and the Copilot CLI connect to while the mode
 * is on. Pure: the main process writes the CLIs' configurations.
 */
import type { McpServer } from "./mcp-servers.js";
import { mcpInstructions, parseMcpServers } from "./mcp-servers.js";
import type { Detail, ReplyLanguage, StoredStep } from "./mode-config.js";
import { DETAILS, REPLY_LANGUAGES } from "./mode-config.js";

export type { McpServer } from "./mcp-servers.js";
export { serverName } from "./mcp-servers.js";

/** The icons a mode of the user's may take (Kalem's own icon names). */
export const CUSTOM_ICONS = [
	"assistant",
	"star",
	"target",
	"pencil",
	"check",
	"find",
	"code",
	"send",
	"chats",
	"diagram",
	"table",
	"link",
	"attachments",
	"settings",
	"wand",
	"branch",
] as const;
export type CustomIcon = (typeof CUSTOM_ICONS)[number];

export interface CustomMode {
	/** `custom-…`, so it is never one of Kalem's modes. */
	readonly id: string;
	readonly name: string;
	readonly icon: CustomIcon;
	/** What it is for, in a line, as the picker shows it. */
	readonly description: string;
	/** What the model is told in this mode, before its steps. */
	readonly prompt: string;
	readonly steps: readonly StoredStep[];
	/** Kalem's tools it may use: all of them, or only these. */
	readonly tools: "all" | readonly string[];
	readonly mcp: readonly McpServer[];
	readonly keywords: readonly string[];
	readonly detail: Detail;
	readonly language: ReplyLanguage;
	readonly enabled: boolean;
}

export const isCustomModeId = (value: unknown): value is string =>
	typeof value === "string" && /^custom-[a-z0-9-]{1,40}$/.test(value);

const text = (value: unknown, max: number): string =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

const list = (value: unknown, max: number, each = 200): string[] =>
	Array.isArray(value)
		? [...new Set(value.map((item) => text(item, each)).filter((item) => item !== ""))].slice(
				0,
				max,
			)
		: [];

/** The user's modes as the settings file holds them, validated: anything else is dropped. */
export function parseCustomModes(raw: unknown): CustomMode[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	return raw
		.flatMap((item): CustomMode[] => {
			if (typeof item !== "object" || item === null) return [];
			const mode = item as Record<string, unknown>;
			const id = text(mode.id, 60);
			const name = text(mode.name, 80);
			if (!isCustomModeId(id) || seen.has(id) || name === "") return [];
			seen.add(id);
			const steps = Array.isArray(mode.steps)
				? mode.steps.flatMap((raw): StoredStep[] => {
						if (typeof raw !== "object" || raw === null) return [];
						const step = raw as Record<string, unknown>;
						const instruction = text(step.instruction, 2000);
						const stepId = text(step.id, 60);
						if (instruction === "" || !/^[a-z0-9][a-z0-9-]*$/.test(stepId)) return [];
						return [
							{
								id: stepId,
								on: step.on !== false,
								title: text(step.title, 120) || instruction.slice(0, 60),
								instruction,
								custom: true,
							},
						];
					})
				: [];
			return [
				{
					id,
					name,
					icon: CUSTOM_ICONS.includes(mode.icon as CustomIcon) ? (mode.icon as CustomIcon) : "star",
					description: text(mode.description, 200),
					prompt: text(mode.prompt, 8000),
					steps: steps.slice(0, 40),
					tools:
						mode.tools === "all" || !Array.isArray(mode.tools) ? "all" : list(mode.tools, 200, 100),
					mcp: parseMcpServers(mode.mcp),
					keywords: list(mode.keywords, 50, 60),
					detail: DETAILS.includes(mode.detail as Detail) ? (mode.detail as Detail) : "normal",
					language: REPLY_LANGUAGES.includes(mode.language as ReplyLanguage)
						? (mode.language as ReplyLanguage)
						: "auto",
					enabled: mode.enabled !== false,
				},
			];
		})
		.slice(0, 30);
}

/** A new mode of the user's: a name, everything else to fill in. */
export function newCustomMode(name: string, taken: readonly CustomMode[]): CustomMode {
	const ids = new Set(taken.map((mode) => mode.id));
	let n = taken.length + 1;
	while (ids.has(`custom-${n}`)) n++;
	return {
		id: `custom-${n}`,
		name,
		icon: "star",
		description: "",
		prompt: "",
		steps: [],
		tools: "all",
		mcp: [],
		keywords: [],
		detail: "normal",
		language: "auto",
		enabled: true,
	};
}

const DETAIL_LINES: Readonly<Record<Detail, string>> = {
	short: "Keep the reply short: the essentials only, no preamble.",
	normal: "",
	detailed: "Be thorough: explain your reasoning and cover the details.",
};

const LANGUAGE_LINES: Readonly<Record<ReplyLanguage, string>> = {
	auto: "",
	tr: "Reply in Turkish.",
	en: "Reply in English.",
};

/** What the model is told in a mode of the user's. */
export function customInstructions(mode: CustomMode): string {
	const steps = mode.steps.filter((step) => step.on && step.instruction !== undefined);
	return [
		`## Mode: ${mode.name}`,
		mode.prompt,
		steps.length === 0
			? ""
			: [
					"Work in these steps, in order:",
					...steps.map((step, index) => `${index + 1}. ${step.instruction}`),
				].join("\n"),
		mcpInstructions(mode.mcp),
		DETAIL_LINES[mode.detail],
		LANGUAGE_LINES[mode.language],
	]
		.filter((part) => part !== "")
		.join("\n\n");
}

/** The Kalem tools a mode of the user's leaves out: every one not chosen. */
export function customExcluded(mode: CustomMode, allTools: readonly string[]): Set<string> {
	if (mode.tools === "all") return new Set();
	const chosen = new Set(mode.tools);
	return new Set(allTools.filter((name) => !chosen.has(name)));
}
