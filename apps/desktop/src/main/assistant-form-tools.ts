/**
 * Forms in the chat: the assistant asks for what a change needs with
 * fields the user fills in, each with its type checked, and Kalem does the
 * change with what was typed.
 *
 * - `app_form` opens one of the app's form actions: settings (any of them,
 *   typed by the settings schema), a Jira or Confluence login, removing a
 *   login. What is typed goes to Kalem, not to the model: a token never
 *   becomes part of the chat. A feature that wants to be set up this way
 *   registers a `FormAction` (`registerFormActions`).
 * - `ask_form` asks the user for anything else the model needs before it
 *   uses another tool; the values, checked, go back to the model. It may
 *   not ask for secrets.
 */
import type { Settings } from "../shared/bridge.js";
import { format } from "../shared/i18n.js";
import type { SettingDef } from "../shared/settings-schema.js";
import {
	isSettingKey,
	parseSetting,
	SETTINGS_SCHEMA,
	valueLabel,
} from "../shared/settings-schema.js";
import type { FormField, FormFieldType, FormValue, FormValues } from "../shared/tool-form.js";
import { checkForm } from "../shared/tool-form.js";
import { applySettings } from "./assistant-app-tools.js";
import type { ConnectionService, KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";

/** What a form action shows: its title, the fields, and lines saying what it does. */
export interface PreparedForm {
	readonly title: string;
	readonly fields: readonly FormField[];
	readonly lines?: readonly string[];
}

export type AppliedForm = { ok: true; text: string } | { ok: false; error: string };

/** A feature of the app the user sets up with a form the assistant opens. */
export interface FormAction {
	readonly name: string;
	/** What it does and which inputs it takes, for the model. */
	readonly description: string;
	available(ctx: ToolContext): boolean;
	/** The form; a text when it cannot be opened (said to the model). */
	prepare(ctx: ToolContext, input: Record<string, unknown>): Promise<PreparedForm | string>;
	/** Does the change with the checked values; an error shows on the form again. */
	apply(ctx: ToolContext, values: FormValues, input: Record<string, unknown>): Promise<AppliedForm>;
}

/** How many times a form is shown again after what was typed did not work. */
const MAX_TRIES = 3;

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string) : "";

const errorText = (error: unknown): string =>
	(error instanceof Error ? error.message : String(error)).slice(0, 500);

/**
 * Shows the form until what is typed works, the user cancels, or it was
 * tried enough. A secret is never filled in again; the other values are.
 */
async function runForm(
	ctx: ToolContext,
	tool: string,
	form: PreparedForm,
	reason: string,
	apply: (values: FormValues) => Promise<AppliedForm>,
): Promise<{ done: true; text: string } | { done: false; text: string }> {
	let fields = form.fields;
	let error: string | undefined;
	for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
		const answer = await ctx.approve({
			tool,
			risk: "ui",
			permission: `form:${tool}`,
			title: form.title,
			lines: form.lines ?? [],
			fields,
			...(reason === "" ? {} : { reason: reason.slice(0, 300) }),
			...(error === undefined ? {} : { error }),
		});
		if (!answer.approved) {
			return {
				done: false,
				text: "The user cancelled the form. Do not open it again unless they ask.",
			};
		}
		const checked = checkForm(ctx.t, fields, answer.values ?? {});
		const given = answer.values ?? {};
		fields = fields.map((field) => {
			const value = given[field.name];
			return field.type === "secret" || value === undefined ? field : { ...field, value };
		});
		if (!checked.ok) {
			error = Object.entries(checked.errors)
				.map(
					([name, problem]) => `${fields.find((f) => f.name === name)?.label ?? name}: ${problem}`,
				)
				.join("; ");
			continue;
		}
		const applied = await apply(checked.values).catch(
			(failure: unknown): AppliedForm => ({ ok: false, error: errorText(failure) }),
		);
		if (applied.ok) return { done: true, text: applied.text };
		error = applied.error;
	}
	return {
		done: false,
		text: `It did not work: ${error ?? "unknown error"}. Tell the user, and ask before trying again.`,
	};
}

// --- Settings ---------------------------------------------------------------------------

/** A setting as a field of its type: a switch, a choice of its values, a number in its range. */
function settingField(ctx: ToolContext, def: SettingDef): FormField | null {
	if (def.assistant !== "write" || def.type === "custom") return null;
	const label = def.label === null ? def.key : ctx.t[def.label];
	const now = ctx.settings()[def.key];
	const base = { name: def.key, label, required: true };
	switch (def.type) {
		case "boolean":
			return { ...base, type: "boolean", value: now === true };
		case "number":
			return {
				...base,
				type: "number",
				value: typeof now === "number" ? now : 0,
				min: def.min,
				max: def.max,
				step: def.step,
			};
		case "string":
			return {
				...base,
				type: "text",
				required: false,
				value: typeof now === "string" ? now : "",
				maxLength: def.maxLength,
			};
		case "enum":
			return {
				...base,
				type: "choice",
				value: JSON.stringify(now) ?? "null",
				options: def.values.map((value) => ({
					value: JSON.stringify(value) ?? "null",
					label: valueLabel(ctx.t, def, value),
				})),
			};
	}
}

const SETTINGS_ACTION: FormAction = {
	name: "settings",
	description:
		'Settings, each as a field of its own type with its value now; give "keys" (from settings_find). The user changes them on the form and Kalem applies what changed.',
	available: () => true,
	async prepare(ctx, input) {
		const keys = Array.isArray(input.keys) ? input.keys : [];
		if (keys.length === 0)
			return 'Give "keys": the settings to show (find them with settings_find).';
		const fields: FormField[] = [];
		const problems: string[] = [];
		for (const key of keys.slice(0, 20)) {
			if (!isSettingKey(key) || SETTINGS_SCHEMA[key].assistant === "hidden") {
				problems.push(`${String(key)}: no such setting`);
				continue;
			}
			const field = settingField(ctx, SETTINGS_SCHEMA[key]);
			if (field === null) problems.push(`${key}: it cannot be changed on a form`);
			else fields.push(field);
		}
		if (fields.length === 0) return `No setting to show. ${problems.join("; ")}`;
		return { title: ctx.t.approvalSettings, fields };
	},
	async apply(ctx, values) {
		const patch: Record<string, unknown> = {};
		const lines: string[] = [];
		for (const [key, raw] of Object.entries(values)) {
			if (!isSettingKey(key)) continue;
			const def: SettingDef = SETTINGS_SCHEMA[key];
			let meant: unknown = raw;
			if (def.type === "enum") {
				try {
					meant = JSON.parse(String(raw));
				} catch {
					return { ok: false, error: `${key}: ${ctx.t.formInvalidChoice}` };
				}
			}
			const value = parseSetting(key, meant);
			const now = ctx.settings()[key];
			if (value === now) continue;
			patch[key] = value;
			const label = def.label === null ? key : ctx.t[def.label];
			lines.push(`${label}: ${valueLabel(ctx.t, def, now)} → ${valueLabel(ctx.t, def, value)}`);
		}
		if (lines.length === 0) return { ok: true, text: "Nothing changed: the user kept the values." };
		applySettings(ctx, patch as Partial<Settings>, lines.join("; "));
		ctx.step({ tool: "app_form", detail: lines.join("; ") });
		return { ok: true, text: `Changed: ${lines.join("; ")}.` };
	},
};

// --- Connections ------------------------------------------------------------------------

const SERVICE_NAMES: Readonly<Record<ConnectionService, string>> = {
	jira: "Jira",
	confluence: "Confluence",
};

function connectionAction(service: ConnectionService): FormAction {
	const name = SERVICE_NAMES[service];
	return {
		name: `${service}_connection`,
		description: `Connects Kalem to ${name}, or changes its connection: the user types the address, the user name and the token on the form. Never ask for a token in the chat: you do not see what is typed.`,
		available: (ctx) => ctx.connections !== null,
		async prepare(ctx) {
			const connections = ctx.connections;
			if (connections === null) return "Connections cannot be set up here.";
			const now = await connections.account(service).catch(() => null);
			const site = now?.site ?? (await connections.suggestedSite(service).catch(() => null)) ?? "";
			const t = ctx.t;
			return {
				title: format(t.formConnectTitle, name),
				lines:
					now === null
						? []
						: [format(t.formConnectedNow, now.site, now.username === "" ? "—" : now.username)],
				fields: [
					{
						name: "site",
						label: service === "jira" ? t.jiraSite : t.confluenceSite,
						type: "url",
						required: true,
						placeholder: `https://${service}.example.com`,
						...(site === "" ? {} : { value: site }),
					},
					{
						name: "username",
						label: t.confluenceUsername,
						type: "text",
						required: false,
						maxLength: 200,
						...(now === null || now.username === "" ? {} : { value: now.username }),
					},
					{
						name: "token",
						label: t.confluenceToken,
						type: "secret",
						required: true,
						maxLength: 5000,
						hint: service === "jira" ? t.jiraLoginHint : t.confluenceLoginHint,
					},
				],
			};
		},
		async apply(ctx, values) {
			const connections = ctx.connections;
			if (connections === null) return { ok: false, error: "Connections cannot be set up here." };
			try {
				const account = await connections.connect(service, {
					site: String(values.site ?? ""),
					username: String(values.username ?? ""),
					token: String(values.token ?? ""),
				});
				await ctx.renderer("accounts_changed", {}).catch(() => {});
				ctx.step({ tool: "app_form", detail: `${name}: ${account.site}` });
				return {
					ok: true,
					text: `Connected to ${name} at ${account.site}${account.username === "" ? "" : ` as ${account.username}`}. Its panel and tools are there from the user's next question.`,
				};
			} catch (error) {
				const failed = service === "jira" ? ctx.t.jiraConnectFailed : ctx.t.confluenceConnectFailed;
				return { ok: false, error: format(failed, errorText(error)) };
			}
		},
	};
}

const DISCONNECT_ACTION: FormAction = {
	name: "disconnect",
	description: "Removes Kalem's login to Jira or Confluence; the user picks which.",
	available: (ctx) => ctx.connections !== null,
	async prepare(ctx) {
		const connections = ctx.connections;
		if (connections === null) return "Connections cannot be changed here.";
		const options = [];
		for (const service of ["jira", "confluence"] as const) {
			const account = await connections.account(service).catch(() => null);
			// Jira reached with Confluence's login goes when Confluence's does.
			if (account !== null && account.shared !== true) {
				options.push({ value: service, label: `${SERVICE_NAMES[service]} (${account.site})` });
			}
		}
		if (options.length === 0) return "Kalem is not connected to Jira or Confluence.";
		return {
			title: ctx.t.formDisconnectTitle,
			fields: [
				{
					name: "service",
					label: ctx.t.formService,
					type: "choice",
					required: true,
					options,
					value: options[0]?.value ?? "",
				},
			],
		};
	},
	async apply(ctx, values) {
		const service = values.service;
		if ((service !== "jira" && service !== "confluence") || ctx.connections === null) {
			return { ok: false, error: ctx.t.formInvalidChoice };
		}
		await ctx.connections.disconnect(service);
		await ctx.renderer("accounts_changed", {}).catch(() => {});
		return { ok: true, text: `Disconnected from ${SERVICE_NAMES[service]}.` };
	},
};

// --- The tools ----------------------------------------------------------------------------

const actions: FormAction[] = [];

function appFormTool(): KalemTool {
	return {
		definition: {
			name: "app_form",
			description: `Opens a form in the chat for one of Kalem's features: the user fills in its fields (each checked for its type) and Kalem makes the change. Use it when a change needs details from the user, instead of asking for them in the chat. Actions: ${actions
				.map((action) => `${action.name} (${action.description})`)
				.join("; ")}`,
			parameters: {
				type: "object",
				properties: {
					action: { type: "string", enum: actions.map((action) => action.name) },
					keys: {
						type: "array",
						items: { type: "string" },
						description: "For settings: the settings' keys.",
					},
					reason: { type: "string", description: "Why, in a few words, in the user's language." },
				},
				required: ["action"],
			},
		},
		risk: "ui",
		available: () => true,
		async run(input, ctx) {
			const action = actions.find((known) => known.name === text(input, "action"));
			if (action === undefined || !action.available(ctx)) {
				return `No such form. Forms: ${actions
					.filter((known) => known.available(ctx))
					.map((known) => known.name)
					.join(", ")}.`;
			}
			const form = await action.prepare(ctx, input);
			if (typeof form === "string") return form;
			const result = await runForm(ctx, "app_form", form, text(input, "reason"), (values) =>
				action.apply(ctx, values, input),
			);
			return result.text;
		},
	};
}

/** Adds features the assistant can set up with a form; one of the same name is replaced. */
export function registerFormActions(added: readonly FormAction[]): void {
	for (const action of added) {
		const at = actions.findIndex((known) => known.name === action.name);
		if (at === -1) actions.push(action);
		else actions[at] = action;
	}
	registerTools([appFormTool()]);
}

/** The field types the model may ask for: a secret is asked for by an app form only. */
const ASKED_TYPES: readonly FormFieldType[] = [
	"text",
	"url",
	"email",
	"number",
	"boolean",
	"choice",
];

/** A field as the model described it, or why it cannot be asked. */
function askedField(raw: unknown, index: number): FormField | string {
	const given = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
	const name =
		typeof given.name === "string" && /^[\w.-]{1,60}$/.test(given.name) ? given.name : "";
	if (name === "") return `field ${index + 1}: give it a "name" of letters, digits, _ . -`;
	const type = given.type ?? "text";
	if (!ASKED_TYPES.includes(type as FormFieldType)) {
		return `${name}: the type is one of ${ASKED_TYPES.join(", ")} (secrets are asked by app_form only)`;
	}
	const options = Array.isArray(given.options)
		? given.options
				.filter((option): option is string => typeof option === "string")
				.slice(0, 50)
				.map((option) => ({ value: option.slice(0, 200), label: option.slice(0, 200) }))
		: [];
	if (type === "choice" && options.length === 0) return `${name}: a choice needs "options"`;
	const number = (key: string): number | undefined =>
		typeof given[key] === "number" && Number.isFinite(given[key])
			? (given[key] as number)
			: undefined;
	const value = given.default;
	const numbers: { min?: number; max?: number; step?: number; maxLength?: number } = {};
	for (const [key, to] of [
		["min", "min"],
		["max", "max"],
		["step", "step"],
		["max_length", "maxLength"],
	] as const) {
		const found = number(key);
		if (found !== undefined) numbers[to] = found;
	}
	const field: FormField = {
		name,
		label: (typeof given.label === "string" && given.label !== "" ? given.label : name).slice(
			0,
			200,
		),
		type: type as FormFieldType,
		required: given.required !== false,
		...(typeof given.hint === "string" ? { hint: given.hint.slice(0, 500) } : {}),
		...(typeof given.placeholder === "string"
			? { placeholder: given.placeholder.slice(0, 200) }
			: {}),
		...numbers,
		...(options.length === 0 ? {} : { options }),
		...(typeof value === "string" || typeof value === "number" || typeof value === "boolean"
			? { value: value as FormValue }
			: {}),
	};
	return field;
}

const ASK_FORM: KalemTool = {
	definition: {
		name: "ask_form",
		description:
			'Asks the user for details with a form in the chat, before you use another tool or feature that needs them: each field has a type that is checked (text, url, email, number with min/max, boolean, choice with options), and you get the values back. Use it instead of asking in the chat when you need several details or ones with a type. Never ask for passwords or tokens with it: app_form asks for a login. Fields: [{"name","label","type","required"?,"default"?,"options"?,"min"?,"max"?,"step"?,"max_length"?,"hint"?,"placeholder"?}].',
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", description: "What the form is for, in the user's language." },
				fields: { type: "array", items: { type: "object" } },
				reason: { type: "string", description: "Why you need it, in a few words." },
			},
			required: ["title", "fields"],
		},
	},
	risk: "ui",
	available: () => true,
	async run(input, ctx) {
		const raw = Array.isArray(input.fields) ? input.fields.slice(0, 20) : [];
		if (raw.length === 0) return 'Give "fields": at least one.';
		const fields: FormField[] = [];
		const problems: string[] = [];
		raw.forEach((item, index) => {
			const field = askedField(item, index);
			if (typeof field === "string") problems.push(field);
			else if (fields.some((known) => known.name === field.name))
				problems.push(`${field.name}: named twice`);
			else fields.push(field);
		});
		if (problems.length > 0) return `The form was not shown: ${problems.join("; ")}.`;
		const title = (text(input, "title") || ctx.t.formTitle).slice(0, 200);
		let values: FormValues = {};
		const result = await runForm(
			ctx,
			"ask_form",
			{ title, fields },
			text(input, "reason"),
			async (checked) => {
				values = checked;
				return { ok: true, text: "" };
			},
		);
		if (!result.done) return result.text;
		ctx.step({ tool: "ask_form", detail: title });
		return `The user filled in the form: ${JSON.stringify(values)}`;
	},
};

registerTools([ASK_FORM]);
registerFormActions([
	SETTINGS_ACTION,
	connectionAction("jira"),
	connectionAction("confluence"),
	DISCONNECT_ACTION,
]);
