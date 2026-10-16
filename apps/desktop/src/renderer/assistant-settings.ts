import type { AssistantStatus, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { AssistantConfig, ProviderId } from "../shared/providers.js";
import { PROVIDER_INFO, PROVIDERS, providerLabel } from "../shared/providers.js";
import { el } from "./dom.js";

export interface AssistantSettingsOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	openLink(href: string): void;
	errorText(error: unknown): string;
	/** Closed: with the new status when saved (`changed` when the service or model is new), `null` when cancelled. */
	done(status: AssistantStatus | null, changed: boolean): void;
}

export interface AssistantSettings {
	readonly element: HTMLElement;
	show(): Promise<void>;
}

let fieldCount = 0;

function field(
	label: string,
	control: HTMLElement,
	extra: readonly HTMLElement[] = [],
): HTMLElement {
	const id = `assistant-field-${++fieldCount}`;
	control.id = id;
	return el("div", {
		class: "assistant-field",
		children: [el("label", { text: label, attrs: { for: id } }), control, ...extra],
	});
}

/** The assistant's connection: which service, its address, key and model. */
export function createAssistantSettings(options: AssistantSettingsOptions): AssistantSettings {
	const { t, bridge } = options;
	let config: AssistantConfig | null = null;
	let forgetKey = false;

	const provider = el("select", {
		children: PROVIDERS.map((id) =>
			el("option", { text: providerLabel(t, id), attrs: { value: id } }),
		),
	});
	const baseUrl = el("input", { attrs: { type: "url", spellcheck: "false" } });
	const key = el("input", {
		attrs: { type: "password", autocomplete: "off", spellcheck: "false" },
	});
	const forget = el("button", {
		class: "assistant-link",
		text: t.assistantKeyForget,
		attrs: { type: "button" },
	});
	const getKey = el("button", {
		class: "assistant-link",
		text: t.assistantGetKey,
		attrs: { type: "button" },
	});
	const models = el("datalist", { attrs: { id: "assistant-models" } });
	const model = el("input", {
		attrs: {
			type: "text",
			list: "assistant-models",
			spellcheck: "false",
			placeholder: t.assistantModelPlaceholder,
		},
	});
	const fetchModels = el("button", {
		class: "assistant-action",
		text: t.assistantFetchModels,
		attrs: { type: "button" },
	});
	const modelsNote = el("p", { class: "assistant-field-note", attrs: { role: "status" } });
	const cliNote = el("p", { class: "assistant-empty-hint", text: t.assistantCliNote });
	const keyNote = el("p", { class: "assistant-field-note" });
	const error = el("p", { class: "assistant-error", attrs: { role: "alert", hidden: "" } });
	const save = el("button", {
		class: "assistant-primary",
		text: t.assistantSave,
		attrs: { type: "button" },
	});
	const cancel = el("button", {
		class: "assistant-action",
		text: t.assistantCancel,
		attrs: { type: "button" },
	});

	const urlField = field(t.assistantBaseUrl, baseUrl);
	const keyField = field(t.assistantKey, key, [
		el("div", { class: "assistant-field-links", children: [getKey, forget] }),
		keyNote,
	]);
	const modelField = field(t.assistantModel, model, [
		models,
		el("div", { class: "assistant-field-links", children: [fetchModels] }),
		modelsNote,
	]);

	const element = el("form", {
		class: "assistant-settings",
		attrs: { "aria-label": t.assistantSettings, hidden: "" },
		children: [
			el("p", { class: "assistant-empty-title", text: t.assistantSettings }),
			field(t.assistantProvider, provider),
			cliNote,
			urlField,
			keyField,
			modelField,
			el("p", { class: "assistant-field-note", text: t.assistantPrivacy }),
			error,
			el("div", { class: "assistant-missing-actions", children: [save, cancel] }),
		],
	});
	element.addEventListener("submit", (event) => event.preventDefault());

	const selected = (): ProviderId => provider.value as ProviderId;

	function fill(): void {
		const id = selected();
		const info = PROVIDER_INFO[id];
		const connection = config?.connections[id];
		const cli = info.protocol === "cli";
		forgetKey = false;
		cliNote.hidden = !cli;
		urlField.hidden = cli;
		keyField.hidden = cli;
		modelField.hidden = cli;
		baseUrl.value = connection?.baseUrl ?? info.baseUrl;
		baseUrl.placeholder = info.baseUrl || "https://…/v1";
		model.value = connection?.model ?? info.defaultModel;
		key.value = "";
		models.replaceChildren();
		modelsNote.textContent = "";
		error.hidden = true;
		renderKey();
	}

	function renderKey(): void {
		const id = selected();
		const info = PROVIDER_INFO[id];
		const kept = config?.connections[id].hasKey === true && !forgetKey;
		key.placeholder = kept
			? t.assistantKeyKept
			: info.needsKey
				? t.assistantKeyRequired
				: t.assistantKeyOptional;
		forget.hidden = !(config?.connections[id].hasKey === true) || forgetKey;
		getKey.hidden = info.keyUrl === null;
		keyNote.textContent = forgetKey
			? t.assistantKeyForgotten
			: config?.encrypted === false
				? t.assistantKeyMemory
				: t.assistantKeyStorage;
	}

	provider.addEventListener("change", fill);
	forget.addEventListener("click", () => {
		forgetKey = true;
		key.value = "";
		renderKey();
	});
	getKey.addEventListener("click", () => {
		const url = PROVIDER_INFO[selected()].keyUrl;
		if (url !== null) options.openLink(url);
	});

	fetchModels.addEventListener("click", async () => {
		fetchModels.disabled = true;
		modelsNote.textContent = t.assistantLoading;
		try {
			const found = await bridge.assistantModels({
				provider: selected(),
				baseUrl: baseUrl.value,
				...(key.value.trim() === "" ? {} : { key: key.value }),
			});
			models.replaceChildren(...found.map((id) => el("option", { attrs: { value: id } })));
			modelsNote.textContent =
				found.length === 0 ? t.assistantModelsNone : format(t.assistantModelsFound, found.length);
			if (found.length > 0 && model.value.trim() === "") model.focus();
		} catch (failure) {
			modelsNote.textContent = format(t.assistantActionFailed, options.errorText(failure));
		} finally {
			fetchModels.disabled = false;
		}
	});

	save.addEventListener("click", async () => {
		const id = selected();
		const before =
			config === null
				? null
				: { provider: config.provider, model: config.connections[config.provider].model };
		save.disabled = true;
		error.hidden = true;
		try {
			const status = await bridge.assistantConfigure({
				provider: id,
				baseUrl: baseUrl.value,
				model: model.value,
				...(forgetKey ? { key: null } : key.value.trim() === "" ? {} : { key: key.value }),
			});
			key.value = "";
			options.done(status, before?.provider !== id || before.model !== model.value.trim());
		} catch (failure) {
			error.textContent = format(t.assistantActionFailed, options.errorText(failure));
			error.hidden = false;
		} finally {
			save.disabled = false;
		}
	});
	cancel.addEventListener("click", () => options.done(null, false));

	return {
		element,
		async show() {
			config = await bridge.assistantConfig();
			provider.value = config.provider;
			fill();
			provider.focus();
		},
	};
}
