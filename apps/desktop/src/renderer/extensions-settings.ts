/** Settings › Extensions: what is installed, the market, and the catalogs it reads. */
import type { ExtensionInfo, ExtensionPreview, KalemBridge } from "../shared/bridge.js";
import type { Registry } from "../shared/extension-registry.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { createExtensionMarket } from "./extension-market.js";
import {
	avatar,
	button,
	createConsentDialog,
	installedIcon,
	permissionChips,
	permissionLines,
} from "./extension-ui.js";
import { icon } from "./icons.js";

export interface ExtensionsSectionOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	errorText(error: unknown): string;
	registries(): readonly Registry[];
	setRegistries(registries: readonly Registry[]): void;
}

export interface ExtensionsSection {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
}

type View = "installed" | "market" | "catalogs";

/** An extension that cannot work until the user fills something in (its token). */
const needsSetup = (info: ExtensionInfo): boolean =>
	info.manifest.secrets.some((secret) => info.secrets[secret.key] !== true) ||
	info.manifest.settings.some(
		(setting) => setting.type === "string" && info.settings[setting.key] === "",
	);

export function createExtensionsSection(options: ExtensionsSectionOptions): ExtensionsSection {
	const { t, bridge } = options;
	const status = el("p", { class: "ext-status", attrs: { role: "status", hidden: "" } });
	const list = el("div", { class: "ext-installed" });
	const opened = new Set<string>();
	const logs = new Set<string>();
	let infos: readonly ExtensionInfo[] = [];

	const say = (text: string, error = false): void => {
		status.textContent = text;
		status.hidden = text === "";
		status.toggleAttribute("data-error", error);
	};

	const run = async (work: () => Promise<unknown>): Promise<void> => {
		say("");
		try {
			await work();
		} catch (error) {
			say(options.errorText(error), true);
		}
		await refresh();
	};

	const catalogName = (url: string | null): string | null =>
		url === null ? null : (options.registries().find((each) => each.url === url)?.name ?? url);

	const consent = createConsentDialog(
		t,
		(picked) => void run(() => bridge.extensionInstall(picked.token)),
	);
	const showPreview = (picked: ExtensionPreview): void => {
		const catalog = catalogName(picked.registry);
		consent.open(
			picked,
			catalog === null ? t.extensionFromFile : format(t.extensionVerified, catalog),
		);
	};

	const pickFile = (): void => {
		say("");
		void bridge
			.extensionPick()
			.then((picked) => {
				if (picked !== null) showPreview(picked);
			})
			.catch((error: unknown) => say(options.errorText(error), true));
	};

	const market = createExtensionMarket({
		t,
		bridge,
		errorText: options.errorText,
		registries: options.registries,
		setRegistries: options.setRegistries,
		showPreview,
		say,
		changed: () => void refresh(),
	});

	// --- An installed extension ----------------------------------------------------------

	function settingsOf(info: ExtensionInfo): HTMLElement[] {
		const { id } = info.manifest;
		const rows: HTMLElement[] = [];
		for (const setting of info.manifest.settings) {
			const value = info.settings[setting.key];
			const input = el("input", {
				class: "ext-input",
				attrs: {
					type:
						setting.type === "boolean" ? "checkbox" : setting.type === "number" ? "number" : "text",
					spellcheck: "false",
				},
			});
			if (setting.type === "boolean") input.checked = value === true;
			else input.value = String(value ?? "");
			input.addEventListener("change", () => {
				const next =
					setting.type === "boolean"
						? input.checked
						: setting.type === "number"
							? Number(input.value)
							: input.value;
				void bridge
					.extensionSetSetting(id, setting.key, next)
					.catch((error: unknown) => say(options.errorText(error), true));
			});
			rows.push(
				el("label", {
					class: `ext-field${setting.type === "boolean" ? " ext-field-check" : ""}`,
					children: [
						el("span", { class: "ext-field-label", text: setting.title }),
						input,
						...(setting.description === ""
							? []
							: [el("span", { class: "ext-field-hint", text: setting.description })]),
					],
				}),
			);
		}
		for (const secret of info.manifest.secrets) {
			const set = info.secrets[secret.key] === true;
			const input = el("input", {
				class: "ext-input",
				attrs: {
					type: "password",
					autocomplete: "new-password",
					placeholder: set ? t.extensionSecretSet : "",
				},
			});
			const save = button(t.save, () => {
				if (input.value !== "")
					void run(() => bridge.extensionSetSecret(id, secret.key, input.value));
			});
			const forget = button(
				t.extensionSecretForget,
				() => void run(() => bridge.extensionSetSecret(id, secret.key, null)),
				"ghost",
			);
			forget.hidden = !set;
			rows.push(
				el("div", {
					class: "ext-field",
					children: [
						el("span", {
							class: "ext-field-label",
							children: [
								document.createTextNode(secret.title),
								...(set
									? [
											el("span", {
												class: "ext-saved",
												children: [icon("check"), el("span", { text: t.extensionSecretSet })],
											}),
										]
									: []),
							],
						}),
						el("div", { class: "ext-secret", children: [input, save, forget] }),
						...(secret.description === ""
							? []
							: [el("span", { class: "ext-field-hint", text: secret.description })]),
					],
				}),
			);
		}
		return rows;
	}

	function card(info: ExtensionInfo): HTMLElement {
		const { manifest } = info;
		const toggle = el("input", {
			class: "mode-switch-input",
			attrs: { type: "checkbox", "aria-label": format(t.extensionEnable, manifest.name) },
		});
		toggle.checked = info.enabled;
		toggle.disabled = info.blocked !== null;
		toggle.addEventListener(
			"change",
			() => void run(() => bridge.extensionSetEnabled(manifest.id, toggle.checked)),
		);

		const state = info.enabled ? info.status : "stopped";
		const stateLabel: Record<ExtensionInfo["status"], string> = {
			running: t.extensionRunning,
			starting: t.extensionStarting,
			failed: t.extensionFailed,
			stopped: info.enabled && manifest.host === null ? t.extensionActive : t.extensionStopped,
		};
		const setup = info.enabled && needsSetup(info);
		const hasSettings = manifest.settings.length + manifest.secrets.length > 0;
		if (setup && !opened.has(`closed:${manifest.id}`)) opened.add(manifest.id);
		const open = opened.has(manifest.id);

		const actions: HTMLElement[] = [];
		const update = market.updateFor(manifest.id);
		if (update !== undefined) {
			const target = button(
				format(t.extensionUpdateTo, update.version),
				() => {
					target.disabled = true;
					void bridge
						.extensionMarketPick(update.registry, update.id)
						.then(showPreview, (error: unknown) => say(options.errorText(error), true))
						.finally(() => {
							target.disabled = false;
						});
				},
				"primary",
			);
			actions.push(target);
		}
		if (hasSettings) {
			const toggleSettings = button(
				t.extensionSettings,
				() => {
					if (open) {
						opened.delete(manifest.id);
						opened.add(`closed:${manifest.id}`);
					} else {
						opened.add(manifest.id);
						opened.delete(`closed:${manifest.id}`);
					}
					draw();
				},
				"ghost",
			);
			toggleSettings.setAttribute("aria-expanded", String(open));
			actions.push(toggleSettings);
		}
		if (info.enabled && manifest.host !== null) {
			actions.push(
				button(
					t.extensionRestart,
					() => void run(() => bridge.extensionRestart(manifest.id)),
					"ghost",
				),
			);
			actions.push(
				button(t.extensionDevTools, () => void bridge.extensionDevTools(manifest.id), "ghost"),
			);
		}
		const logButton = button(
			t.extensionLog,
			() => {
				if (logs.has(manifest.id)) logs.delete(manifest.id);
				else logs.add(manifest.id);
				draw();
			},
			"ghost",
		);
		logButton.setAttribute("aria-expanded", String(logs.has(manifest.id)));
		actions.push(logButton, el("span", { class: "ext-spacer" }));
		actions.push(
			button(
				t.extensionUninstall,
				() => {
					if (window.confirm(format(t.extensionUninstallConfirm, manifest.name))) {
						void run(() => bridge.extensionUninstall(manifest.id));
					}
				},
				"danger",
			),
		);

		const catalog = catalogName(info.registry);
		const notices: HTMLElement[] = [];
		if (info.blocked !== null) {
			notices.push(
				el("pre", { class: "ext-error", text: format(t.extensionBlocked, info.blocked) }),
			);
		} else if (info.error !== null && info.enabled) {
			notices.push(el("pre", { class: "ext-error", text: info.error }));
		}
		return el("article", {
			class: "ext-card",
			attrs: {
				"data-extension": manifest.id,
				"data-state": state,
				...(info.enabled ? {} : { "data-off": "" }),
			},
			children: [
				el("div", {
					class: "ext-head",
					children: [
						avatar(manifest.id, manifest.name, installedIcon(manifest)),
						el("div", {
							class: "ext-title",
							children: [
								el("div", {
									class: "ext-name-row",
									children: [
										el("strong", { class: "ext-name", text: manifest.name }),
										el("span", { class: "ext-badge", text: stateLabel[state] }),
										...(setup
											? [
													el("span", {
														class: "ext-pill ext-pill-warning",
														text: t.extensionNeedsSetup,
													}),
												]
											: []),
										...(update === undefined
											? []
											: [
													el("span", {
														class: "ext-pill ext-pill-accent",
														text: format(t.extensionUpdateAvailable, update.version),
													}),
												]),
									],
								}),
								el("span", {
									class: "ext-meta",
									text: [
										manifest.version,
										manifest.publisher,
										...(catalog === null ? [] : [format(t.extensionFromCatalog, catalog)]),
									].join(" · "),
								}),
							],
						}),
						el("label", {
							class: "mode-switch",
							children: [toggle, el("span", { class: "mode-switch-track" })],
						}),
					],
				}),
				...(manifest.description === ""
					? []
					: [el("p", { class: "ext-description", text: manifest.description })]),
				permissionChips(t, permissionLines(t, info.granted, manifest)),
				...notices,
				...(open && hasSettings
					? [el("div", { class: "ext-settings", children: settingsOf(info) })]
					: []),
				...(logs.has(manifest.id)
					? [
							el("pre", {
								class: "ext-log",
								text: info.log.length === 0 ? "—" : info.log.join("\n"),
							}),
						]
					: []),
				el("div", { class: "ext-actions", children: actions }),
			],
		});
	}

	function emptyState(): HTMLElement {
		const browse = button(t.extensionBrowseMarket, () => show("market"), "primary");
		return el("div", {
			class: "ext-empty",
			children: [
				el("span", { class: "ext-empty-icon", children: [icon("extension")] }),
				el("strong", { text: t.extensionsEmptyTitle }),
				el("p", { text: t.extensionsEmpty }),
				el("div", {
					class: "ext-empty-actions",
					children: [browse, button(t.extensionInstallFromFile, pickFile)],
				}),
			],
		});
	}

	// --- Tabs -------------------------------------------------------------------------------
	const installedCount = el("span", {
		class: "ext-count",
		attrs: { "aria-hidden": "true", hidden: "" },
	});
	const updateDot = el("span", {
		class: "ext-update-dot",
		attrs: { "aria-hidden": "true", hidden: "" },
	});
	const tabs = el("div", { class: "ext-tabs", attrs: { role: "tablist" } });
	const views: Record<View, HTMLElement> = {
		installed: el("div", { class: "ext-view", children: [list] }),
		market: market.element,
		catalogs: market.catalogs,
	};
	let marketLoaded = false;

	function draw(): void {
		if (
			list.contains(document.activeElement) &&
			document.activeElement?.matches("input:not([type=checkbox])")
		)
			return;
		list.replaceChildren(...(infos.length === 0 ? [emptyState()] : infos.map(card)));
		const updates = infos.filter((info) => market.updateFor(info.manifest.id) !== undefined).length;
		installedCount.textContent = String(infos.length);
		installedCount.hidden = infos.length === 0;
		updateDot.hidden = updates === 0;
	}

	let drawing = Promise.resolve();
	async function refresh(): Promise<void> {
		drawing = drawing.then(async () => {
			infos = await bridge.extensions().catch(() => []);
			draw();
		});
		return drawing;
	}

	function show(which: View): void {
		for (const [name, view] of Object.entries(views)) view.hidden = name !== which;
		for (const tab of tabs.children) {
			tab.setAttribute("aria-selected", String((tab as HTMLElement).dataset.tab === which));
		}
		if (which === "market" && !marketLoaded) {
			marketLoaded = true;
			void market.refresh(false);
		}
	}
	for (const [which, label, extra] of [
		["installed", t.extensionsInstalled, [installedCount, updateDot]],
		["market", t.extensionsMarket, []],
		["catalogs", t.extensionRegistries, []],
	] as const) {
		const tab = el("button", {
			class: "ext-tab",
			attrs: { type: "button", role: "tab", "data-tab": which },
			children: [el("span", { text: label }), ...extra],
		});
		tab.addEventListener("click", () => show(which));
		tabs.append(tab);
	}
	show("installed");
	market.onAdded(() => show("market"));
	bridge.onExtensionsChanged(() => {
		void refresh();
		if (marketLoaded) void market.refresh(false);
	});
	if (options.registries().length > 0) {
		marketLoaded = true;
		void market.refresh(false);
	}
	void refresh();

	const fromFile = button(t.extensionInstallFromFile, pickFile);
	fromFile.prepend(icon("open"));

	return {
		element: el("div", {
			class: "settings-block ext-page",
			attrs: { "data-block": "extensions" },
			children: [
				el("div", {
					class: "ext-intro",
					children: [el("p", { class: "ext-hint", text: t.extensionsHint }), fromFile],
				}),
				el("div", { class: "ext-toolbar", children: [tabs] }),
				status,
				views.installed,
				views.market,
				views.catalogs,
				consent.element,
			],
		}),
		refresh,
	};
}
