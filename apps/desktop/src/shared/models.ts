/**
 * The models a service offers, as the model picker shows them: the id it
 * is asked for, and a name a person reads. Claude Code lists none, so its
 * aliases are named by the model each answered with last (and by
 * Anthropic's list, with a key); the Copilot CLI is given the models the
 * user's GitHub account has, as VS Code shows them. Pure.
 */

export interface ModelOption {
	/** What the service is asked for: an alias (`opus`) or a model's id. */
	readonly id: string;
	/** What the user reads: `opus · Opus 5.5`, `Claude Opus 5.5`. */
	readonly label: string;
}

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * A Claude model's id as a name: `claude-opus-5-5` is "Opus 5.5",
 * `claude-sonnet-4-5-20250929` is "Sonnet 4.5"; another id stays as it is.
 */
export function claudeModelName(id: string): string {
	const found = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id);
	if (found === null) {
		// The older order: claude-3-5-sonnet-20241022.
		const older = /^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{8})?$/.exec(id);
		if (older === null) return id;
		const family = older[3] as string;
		return `${family[0]?.toLocaleUpperCase("en")}${family.slice(1)} ${older[1]}${older[2] === undefined ? "" : `.${older[2]}`}`;
	}
	const family = found[1] as string;
	const version = `${found[2]}${found[3] === undefined ? "" : `.${found[3]}`}`;
	return `${family[0]?.toLocaleUpperCase("en")}${family.slice(1)} ${version}`;
}

/** The model Claude Code's stream says it answers with (its `init` line); `null` when none. */
export function claudeInitModel(line: unknown): string | null {
	const data = asJson(line);
	if (data.type !== "system" || data.subtype !== "init") return null;
	const model = asString(data.model);
	return model === "" ? null : model;
}

/** Anthropic's model list (`/v1/models`): ids with their names. */
export function anthropicModelsOf(raw: unknown): ModelOption[] {
	const list = Array.isArray(raw) ? raw : ((asJson(raw).data as unknown[] | undefined) ?? []);
	return list.flatMap((item) => {
		const model = asJson(item);
		const id = asString(model.id);
		return id === "" ? [] : [{ id, label: asString(model.display_name) || claudeModelName(id) }];
	});
}

/**
 * Claude Code's choices: its aliases first, each named by the model it
 * answered with last (`opus · Opus 5.5`), then the models the user can
 * name in full: Anthropic's list (with a key), those learned, those its
 * help names.
 */
export function claudeModelOptions(
	aliases: readonly string[],
	learned: Readonly<Record<string, string>>,
	listed: readonly ModelOption[],
	fromHelp: readonly string[],
): ModelOption[] {
	const names = new Map(listed.map((option) => [option.id, option.label]));
	const nameOf = (id: string): string => names.get(id) ?? claudeModelName(id);
	const options: ModelOption[] = [];
	const seen = new Set<string>();
	const add = (option: ModelOption): void => {
		if (option.id === "" || seen.has(option.id)) return;
		seen.add(option.id);
		options.push(option);
	};
	for (const alias of [...aliases, ...fromHelp.filter((name) => !name.includes("-"))]) {
		const model = learned[alias];
		add({ id: alias, label: model === undefined ? alias : `${alias} · ${nameOf(model)}` });
	}
	for (const option of listed) add(option);
	for (const model of Object.values(learned)) add({ id: model, label: nameOf(model) });
	for (const name of fromHelp) add({ id: name, label: name.includes("-") ? nameOf(name) : name });
	return options;
}

/**
 * The models of GitHub Copilot's list (`<api>/models`, as VS Code asks
 * it): those a person can pick for chat, not turned off by the account's
 * policy, with their names; the account's own (an organization's) too.
 */
export function copilotModelsOf(raw: unknown): ModelOption[] {
	const list = (asJson(raw).data as unknown[] | undefined) ?? (Array.isArray(raw) ? raw : []);
	const seen = new Set<string>();
	return list.flatMap((item) => {
		const model = asJson(item);
		const id = asString(model.id);
		if (id === "" || seen.has(id)) return [];
		if (model.model_picker_enabled === false) return [];
		const type = asString(asJson(model.capabilities).type);
		if (type !== "" && type !== "chat") return [];
		if (asString(asJson(model.policy).state) === "disabled") return [];
		seen.add(id);
		const name = asString(model.name) || id;
		const preview = model.preview === true ? " (Preview)" : "";
		return [{ id, label: `${name}${preview}` }];
	});
}

/**
 * The Copilot CLI's choices: when its help lists the models it takes
 * (`choices: …`), only those, named as the account's list names them;
 * otherwise every model of the account's list.
 */
export function copilotModelOptions(
	fromHelp: readonly string[],
	account: readonly ModelOption[],
): ModelOption[] {
	if (fromHelp.length === 0) return [...account];
	const names = new Map(account.map((option) => [option.id, option.label]));
	return fromHelp.map((id) => ({ id, label: names.get(id) ?? id }));
}

/**
 * The GitHub login the Copilot plugins keep (`github-copilot/apps.json`
 * or `hosts.json`): its OAuth token, which GitHub exchanges for Copilot's.
 */
export function copilotOauthToken(raw: unknown): string | null {
	for (const entry of Object.values(asJson(raw))) {
		const token = asString(asJson(entry).oauth_token);
		if (token !== "") return token;
	}
	return null;
}
