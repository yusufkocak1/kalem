import type { AssistantStatus, CopilotLoginFailure, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { AssistantConfig, ProviderId } from "../shared/providers.js";
import { isCli, PROVIDER_INFO, PROVIDERS, providerLabel } from "../shared/providers.js";
import { el } from "./dom.js";

export interface AssistantSettingsOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	openLink(href: string): void;
	errorText(error: unknown): string;
	/** Closed: with the new status when saved (`changed` when the service is new), `null` when cancelled. */
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
	// One form is in the assistant's panel, another in the Settings window: each has its own list.
	const modelsId = `assistant-models-${++fieldCount}`;
	const models = el("datalist", { attrs: { id: modelsId } });
	const model = el("input", {
		attrs: {
			type: "text",
			list: modelsId,
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
	// The service in use, as found: a CLI's version, or a service and its model.
	const inUse = el("p", { class: "assistant-field-note assistant-in-use", attrs: { hidden: "" } });
	let status: AssistantStatus | null = null;
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

	// --- Copilot: signing in to GitHub with a device code ---------------------------

	const copilotState = el("p", { class: "assistant-field-note", attrs: { role: "status" } });
	const copilotSignIn = el("button", {
		class: "assistant-action",
		text: t.copilotDeviceSignIn,
		attrs: { type: "button" },
	});
	const copilotSignOut = el("button", {
		class: "assistant-link",
		text: t.copilotDeviceSignOut,
		attrs: { type: "button", hidden: "" },
	});
	const copilotCode = el("output", { class: "copilot-device-code" });
	const copilotOpen = el("button", {
		class: "assistant-primary",
		text: t.copilotDeviceCopyOpen,
		attrs: { type: "button" },
	});
	const copilotCancel = el("button", {
		class: "assistant-action",
		text: t.assistantCancel,
		attrs: { type: "button" },
	});
	const copilotWaiting = el("p", {
		class: "assistant-field-note",
		text: t.copilotDeviceWaiting,
		attrs: { role: "status" },
	});
	const copilotPanel = el("div", {
		class: "copilot-device",
		attrs: { hidden: "" },
		children: [
			el("p", { class: "assistant-field-note", text: t.copilotDeviceSteps }),
			copilotCode,
			el("div", { class: "assistant-missing-actions", children: [copilotOpen, copilotCancel] }),
			copilotWaiting,
		],
	});
	const copilotField = el("div", {
		class: "assistant-field copilot-login",
		attrs: { hidden: "" },
		children: [
			el("span", { class: "assistant-field-label", text: t.copilotDeviceTitle }),
			copilotState,
			el("div", { class: "assistant-field-links", children: [copilotSignIn, copilotSignOut] }),
			copilotPanel,
		],
	});
	let verificationUri = "https://github.com/login/device";

	const failureText = (reason: CopilotLoginFailure): string =>
		({
			denied: t.copilotDeviceDenied,
			expired: t.copilotDeviceExpired,
			cancelled: "",
			noCopilot: t.copilotDeviceNoCopilot,
			failed: t.copilotDeviceFailed,
		})[reason];

	async function renderCopilotAccount(): Promise<void> {
		const account = await bridge.copilotAccount().catch(() => null);
		copilotState.textContent =
			account === null ? t.copilotDeviceNone : format(t.copilotDeviceSignedIn, account.login);
		copilotSignOut.hidden = account === null;
		copilotSignIn.hidden = !copilotPanel.hidden;
	}

	function closeCopilotPanel(): void {
		copilotPanel.hidden = true;
		copilotSignIn.hidden = false;
	}

	copilotSignIn.addEventListener("click", async () => {
		copilotSignIn.disabled = true;
		try {
			const device = await bridge.copilotLoginBegin();
			verificationUri = device.verificationUri;
			copilotCode.textContent = device.userCode;
			copilotPanel.hidden = false;
			copilotSignIn.hidden = true;
			const result = await bridge.copilotLoginWait();
			closeCopilotPanel();
			await renderCopilotAccount();
			if ("error" in result && result.error !== "cancelled") {
				copilotState.textContent = result.detail ?? failureText(result.error);
			}
		} catch (failure) {
			closeCopilotPanel();
			copilotState.textContent = options.errorText(failure);
		} finally {
			copilotSignIn.disabled = false;
		}
	});
	copilotOpen.addEventListener("click", () => {
		void navigator.clipboard.writeText(copilotCode.textContent ?? "").catch(() => {});
		options.openLink(verificationUri);
	});
	copilotCancel.addEventListener("click", () => {
		void bridge.copilotLoginCancel();
		closeCopilotPanel();
	});
	copilotSignOut.addEventListener("click", async () => {
		await bridge.copilotLogout().catch(() => {});
		await renderCopilotAccount();
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
			field(t.assistantProvider, provider, [inUse]),
			cliNote,
			copilotField,
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
		const cli = isCli(info);
		forgetKey = false;
		cliNote.hidden = !cli;
		cliNote.textContent = id === "copilot" ? t.copilotCliNote : t.assistantCliNote;
		copilotField.hidden = id !== "copilot";
		if (id === "copilot") void renderCopilotAccount();
		urlField.hidden = cli;
		keyField.hidden = cli;
		fetchModels.hidden = cli;
		model.placeholder =
			id === "copilot"
				? t.copilotModelPlaceholder
				: id === "claude-code"
					? t.claudeModelPlaceholder
					: t.assistantModelPlaceholder;
		baseUrl.value = connection?.baseUrl ?? info.baseUrl;
		baseUrl.placeholder = info.baseUrl || "https://…/v1";
		model.value = connection?.model ?? info.defaultModel;
		key.value = "";
		models.replaceChildren();
		modelsNote.textContent = "";
		error.hidden = true;
		renderKey();
		renderInUse();
	}

	function renderInUse(): void {
		const shown = status !== null && status.ready && status.provider === selected();
		inUse.hidden = !shown;
		inUse.textContent = shown ? format(t.assistantInUse, status?.label ?? "") : "";
		inUse.title = shown ? (status?.detail ?? "") : "";
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
			models.replaceChildren(
				...found.map((option) =>
					el("option", {
						attrs: {
							value: option.id,
							...(option.label === option.id ? {} : { label: option.label }),
						},
					}),
				),
			);
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
		const before = config?.provider;
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
			options.done(status, before !== id);
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
			void bridge.assistantStatus().then((found) => {
				status = found;
				renderInUse();
			});
			provider.focus();
		},
	};
}
