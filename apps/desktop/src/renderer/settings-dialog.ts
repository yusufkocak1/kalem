import type { AssistantStatus, KalemBridge, Settings } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type {
	PaletteChoice,
	PaletteColors,
	PaletteTheme,
	PaletteToken,
} from "../shared/palette.js";
import { PALETTE_IDS, PALETTE_TOKENS, PALETTES, paletteColors } from "../shared/palette.js";
import type { PanePlace, ToolPane } from "../shared/panes.js";
import { movePane, placesFor, TOOL_PANES } from "../shared/panes.js";
import { PROVIDERS, providerLabel } from "../shared/providers.js";
import type { SettingCategory, SettingDef } from "../shared/settings-schema.js";
import {
	CATEGORY_LABELS,
	foldSearch,
	matchesQuery,
	parseSetting,
	permissionLabel,
	resetPatch,
	SETTING_CATEGORIES,
	SETTING_DEFS,
	searchText,
	settingDef,
	valueLabel,
} from "../shared/settings-schema.js";
import type { TemplateInfo } from "../shared/templates.js";
import { createAssistantSettings } from "./assistant-settings.js";
import { el } from "./dom.js";
import { createModeEditor } from "./mode-settings.js";
import { sourceLabel } from "./template-picker.js";
import { createToolSettings } from "./tool-settings.js";

export interface SettingsDialogOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	settings(): Settings;
	update(patch: Partial<Settings>): void;
	/** The panes' names, as their tabs show them. */
	paneLabel(pane: ToolPane): string;
	/** Opens the Confluence login. */
	connectConfluence(): void;
	/** Opens the Jira login. */
	connectJira(): void;
	/** After a disconnect: the panes that need a connection are hidden again. */
	onAccountChange(): void;
	/** The assistant's service or model was saved; `changed` when it is another service. */
	assistantConfigured(status: AssistantStatus, changed: boolean): void;
	openLink(href: string): void;
	errorText(error: unknown): string;
	/** The active document's name and text, to keep as a template. */
	activeDocument(): Promise<{ readonly name: string; readonly text: string }>;
}

export interface SettingsDialog {
	/** Opens it on a category; the last one shown, or the first, when none is given. */
	show(category?: SettingCategory): Promise<void>;
	/** Re-reads the connections and the values while it is open. */
	refresh(): Promise<void>;
}

let fieldCount = 0;

/**
 * The app's settings in one place, as in an IDE: categories at the left, a
 * search over all of them at the top. The rows come from the settings'
 * schema; where the panels dock, the connections and the assistant's
 * service have parts of their own. The menus keep their quick ways to the
 * same settings.
 */
export function createSettingsDialog(options: SettingsDialogOptions): SettingsDialog {
	const { t, bridge } = options;
	let current: SettingCategory = SETTING_CATEGORIES[0];
	let connected = { confluence: false, jira: false };

	const search = el("input", {
		class: "settings-search",
		attrs: { type: "search", placeholder: t.settingsSearch, "aria-label": t.settingsSearch },
	});
	const nav = el("nav", {
		class: "settings-nav",
		attrs: { "aria-label": t.settingsCategories },
	});
	const body = el("div", { class: "settings-body" });
	const empty = el("p", { class: "settings-empty", attrs: { hidden: "", role: "status" } });
	const done = el("button", {
		class: "confluence-primary",
		text: t.settingsDone,
		attrs: { type: "button" },
	});
	const dialog = el("dialog", {
		class: "settings-dialog",
		attrs: { "aria-label": t.settingsTitle },
		children: [
			el("div", {
				class: "settings-head",
				children: [el("h2", { text: t.settingsTitle }), search],
			}),
			el("div", {
				class: "settings-layout",
				children: [nav, el("div", { class: "settings-main", children: [body, empty] })],
			}),
			el("div", { class: "confluence-actions", children: [done] }),
		],
	});
	document.body.append(dialog);
	done.addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});

	// --- Categories ------------------------------------------------------------

	const navButtons = new Map<SettingCategory, HTMLButtonElement>();
	const sections = new Map<SettingCategory, HTMLElement>();
	const contents = new Map<SettingCategory, HTMLElement>();
	for (const category of SETTING_CATEGORIES) {
		const label = t[CATEGORY_LABELS[category]];
		const button = el("button", {
			class: "settings-nav-item",
			text: label,
			attrs: { type: "button", "data-category": category },
		});
		button.addEventListener("click", () => {
			search.value = "";
			select(category);
		});
		navButtons.set(category, button);
		nav.append(button);
		const content = el("div", { class: "settings-items" });
		const reset = el("button", {
			class: "jira-button settings-reset",
			text: t.settingsReset,
			attrs: { type: "button" },
		});
		reset.addEventListener("click", () => {
			options.update(resetPatch(category));
			renderValues();
		});
		const hasReset = category !== "connections";
		const section = el("section", {
			class: "settings-section",
			attrs: { "data-section": category, "aria-label": label },
			children: [
				el("div", {
					class: "settings-section-head",
					children: [el("h3", { text: label }), ...(hasReset ? [reset] : [])],
				}),
				content,
			],
		});
		sections.set(category, section);
		contents.set(category, content);
		body.append(section);
	}

	function select(category: SettingCategory): void {
		current = category;
		filter();
	}

	// --- Rows from the schema --------------------------------------------------

	/** Puts a row's control back to the setting's value. */
	const refreshers: (() => void)[] = [];

	function item(category: SettingCategory, words: string, child: HTMLElement): HTMLElement {
		child.classList.add("settings-item");
		child.dataset.search = foldSearch(words);
		contents.get(category)?.append(child);
		return child;
	}

	function row(def: SettingDef): HTMLElement | null {
		if (def.label === null) return null;
		const label = t[def.label];
		const id = `settings-field-${++fieldCount}`;
		const words = searchText(t, def);
		const change = (value: unknown): void => {
			options.update({ [def.key]: parseSetting(def.key, value) } as Partial<Settings>);
		};
		switch (def.type) {
			case "boolean": {
				const box = el("input", { attrs: { id, type: "checkbox", "data-setting": def.key } });
				box.addEventListener("change", () => change(box.checked));
				refreshers.push(() => {
					box.checked = options.settings()[def.key] === true;
				});
				return item(
					def.category,
					words,
					el("label", { class: "settings-check", children: [box, label] }),
				);
			}
			case "enum": {
				const values = def.values as readonly unknown[];
				const control = el("select", {
					attrs: { id, "data-setting": def.key },
					children: values.map((value, index) =>
						el("option", { text: valueLabel(t, def, value), attrs: { value: String(index) } }),
					),
				});
				control.addEventListener("change", () => change(values[Number(control.value)]));
				refreshers.push(() => {
					control.value = String(values.indexOf(options.settings()[def.key]));
				});
				return item(def.category, words, field(id, label, control));
			}
			case "number": {
				const control = el("input", {
					attrs: {
						id,
						type: "number",
						min: String(def.min),
						max: String(def.max),
						step: String(def.step),
						"data-setting": def.key,
					},
				});
				control.addEventListener("change", () => {
					const value = Number(control.value);
					if (control.value.trim() === "" || !Number.isFinite(value)) {
						control.value = String(options.settings()[def.key]);
						return;
					}
					change(value);
					control.value = String(options.settings()[def.key]);
				});
				refreshers.push(() => {
					control.value = String(options.settings()[def.key]);
				});
				return item(def.category, words, field(id, label, control));
			}
			default:
				return null;
		}
	}

	function field(id: string, label: string, control: HTMLElement): HTMLElement {
		return el("div", {
			class: "settings-grid",
			children: [el("label", { text: label, attrs: { for: id } }), control],
		});
	}

	// --- Appearance: the colour palette ------------------------------------------

	const PALETTE_NAMES: Readonly<Record<PaletteChoice, string>> = {
		kalem: t.paletteKalem,
		ocean: t.paletteOcean,
		forest: t.paletteForest,
		sunset: t.paletteSunset,
		violet: t.paletteViolet,
		graphite: t.paletteGraphite,
		rose: t.paletteRose,
		sand: t.paletteSand,
		nord: t.paletteNord,
		midnight: t.paletteMidnight,
		custom: t.paletteCustom,
	};
	const TOKEN_NAMES: Readonly<Record<PaletteToken, string>> = {
		accent: t.paletteAccent,
		desk: t.paletteDesk,
		surface: t.paletteSurface,
		page: t.palettePage,
		text: t.paletteText,
	};
	const swatches = el("div", {
		class: "palette-swatches",
		attrs: { role: "radiogroup", "aria-label": t.settingsPalette },
	});
	const ownColors = el("div", { class: "palette-own" });
	const resetPalette = el("button", {
		class: "jira-button",
		text: t.settingsPaletteReset,
		attrs: { type: "button" },
	});
	resetPalette.addEventListener("click", () => {
		options.update({ palette: "kalem" });
		renderValues();
	});
	item(
		"appearance",
		[
			t.settingsPalette,
			t.settingsPaletteOwn,
			...Object.values(PALETTE_NAMES),
			...Object.values(TOKEN_NAMES),
			...settingDef("palette").keywords,
		].join(" "),
		el("div", {
			class: "settings-block",
			attrs: { "data-block": "palette" },
			children: [
				el("h4", { text: t.settingsPalette }),
				el("p", { class: "confluence-hint", text: t.settingsPaletteHint }),
				swatches,
				el("h5", { class: "palette-own-title", text: t.settingsPaletteOwn }),
				ownColors,
				resetPalette,
			],
		}),
	);

	/** A palette's card: its page, panels and accent as a small picture of the app, both themes. */
	function swatch(
		choice: PaletteChoice,
		colors: PaletteTheme,
		current: PaletteChoice,
	): HTMLElement {
		const half = (side: PaletteColors): HTMLElement =>
			el("span", {
				class: "palette-preview-half",
				attrs: {
					style: `--p-desk:${side.desk};--p-surface:${side.surface};--p-page:${side.page};--p-accent:${side.accent};--p-text:${side.text}`,
				},
				children: [
					el("span", { class: "palette-preview-bar" }),
					el("span", {
						class: "palette-preview-page",
						children: [
							el("span", { class: "palette-preview-line" }),
							el("span", { class: "palette-preview-line short" }),
						],
					}),
				],
			});
		const button = el("button", {
			class: "palette-swatch",
			attrs: {
				type: "button",
				role: "radio",
				"aria-checked": String(choice === current),
				"data-palette": choice,
			},
			children: [
				el("span", {
					class: "palette-preview",
					children: [half(colors.light), half(colors.dark)],
				}),
				el("span", { class: "palette-swatch-name", text: PALETTE_NAMES[choice] }),
			],
		});
		button.addEventListener("click", () => {
			options.update({ palette: choice });
			renderValues();
		});
		return button;
	}

	function renderPalette(): void {
		const settings = options.settings();
		const current = settings.palette;
		swatches.replaceChildren(
			...PALETTE_IDS.map((id) => swatch(id, PALETTES[id], current)),
			swatch("custom", settings.paletteCustom, current),
		);
		// The colours shown are the palette's in use: changing one makes them the user's own.
		const shown = paletteColors(current, settings.paletteCustom);
		const column = (side: "light" | "dark"): HTMLElement[] =>
			PALETTE_TOKENS.map((token) => {
				const input = el("input", {
					class: "palette-color",
					attrs: {
						type: "color",
						"aria-label": `${TOKEN_NAMES[token]} · ${side === "light" ? t.settingsPaletteLight : t.settingsPaletteDark}`,
						"data-token": token,
						"data-side": side,
					},
				});
				input.value = shown[side][token];
				input.addEventListener("change", () => {
					const now = options.settings();
					const base = paletteColors(now.palette, now.paletteCustom);
					options.update({
						palette: "custom",
						paletteCustom: { ...base, [side]: { ...base[side], [token]: input.value } },
					});
					renderValues();
				});
				return input;
			});
		const light = column("light");
		const dark = column("dark");
		ownColors.replaceChildren(
			el("span"),
			el("span", { class: "palette-own-head", text: t.settingsPaletteLight }),
			el("span", { class: "palette-own-head", text: t.settingsPaletteDark }),
			...PALETTE_TOKENS.flatMap((token, index) => [
				el("span", { class: "palette-own-name", text: TOKEN_NAMES[token] }),
				light[index] as HTMLElement,
				dark[index] as HTMLElement,
			]),
		);
		resetPalette.disabled = current === "kalem";
	}

	// --- Panels: where each one docks --------------------------------------------

	const placeLabel: Readonly<Record<PanePlace, string>> = {
		left: t.placeLeft,
		right: t.placeRight,
		bottom: t.placeBottom,
		hidden: t.placeHidden,
	};
	const panes = el("div", { class: "settings-grid" });
	item(
		"panels",
		[
			t.settingsPanes,
			t.settingsPanePlaces,
			...TOOL_PANES.map((pane) => options.paneLabel(pane)),
			...Object.values(placeLabel),
			...settingDef("panePlaces").keywords,
		].join(" "),
		el("div", {
			class: "settings-block",
			children: [
				el("h4", { text: t.settingsPanePlaces }),
				el("p", { class: "confluence-hint", text: t.settingsPanesHint }),
				panes,
			],
		}),
	);

	function renderPanes(): void {
		const settings = options.settings();
		panes.replaceChildren(
			...TOOL_PANES.flatMap((pane) => {
				const id = `settings-pane-${++fieldCount}`;
				const control = el("select", {
					attrs: { id, "data-pane": pane },
					children: placesFor(pane).map((place) =>
						el("option", { text: placeLabel[place], attrs: { value: place } }),
					),
				});
				control.value = settings.panePlaces[pane];
				control.addEventListener("change", () => {
					options.update(movePane(options.settings(), pane, control.value as PanePlace));
					renderValues();
				});
				const needs = (pane === "confluence" || pane === "jira") && !connected[pane];
				return [
					el("label", {
						attrs: { for: id },
						children: [
							options.paneLabel(pane),
							...(needs
								? [
										el("span", {
											class: "settings-note",
											text: ` (${t.settingsShownWhenConnected})`,
										}),
									]
								: []),
						],
					}),
					control,
				];
			}),
		);
	}

	// --- Assistant: the service and its model --------------------------------------

	const assistantForm = createAssistantSettings({
		t,
		bridge,
		openLink: options.openLink,
		errorText: options.errorText,
		done(status, changed) {
			if (status !== null) options.assistantConfigured(status, changed);
			// Saved or cancelled, the form shows what is kept.
			void assistantForm.show();
		},
	});
	assistantForm.element.hidden = false;
	item(
		"assistant",
		[
			t.settingsAssistantConnection,
			t.assistantSettings,
			...PROVIDERS.map((id) => providerLabel(t, id)),
			"model api key anahtar claude copilot",
		].join(" "),
		el("div", {
			class: "settings-block",
			children: [el("h4", { text: t.settingsAssistantConnection }), assistantForm.element],
		}),
	);

	// --- Assistant: what it may change without asking ------------------------------

	const permissions = el("div", { class: "settings-permissions" });
	const forgetSession = el("button", {
		class: "jira-button",
		text: t.settingsPermissionsSession,
		attrs: { type: "button" },
	});
	forgetSession.addEventListener("click", () => void bridge.assistantForgetPermissions());
	item(
		"assistant",
		[t.settingsPermissions, ...settingDef("assistantPermissions").keywords].join(" "),
		el("div", {
			class: "settings-block",
			attrs: { "data-block": "permissions" },
			children: [el("h4", { text: t.settingsPermissions }), permissions, forgetSession],
		}),
	);

	function renderPermissions(): void {
		const allowed = options.settings().assistantPermissions;
		if (allowed.length === 0) {
			permissions.replaceChildren(
				el("p", { class: "confluence-hint", text: t.settingsPermissionsNone }),
			);
			return;
		}
		permissions.replaceChildren(
			...allowed.map((permission) => {
				const remove = el("button", {
					class: "assistant-link",
					text: t.settingsPermissionsForget,
					attrs: { type: "button", "data-permission": permission },
				});
				remove.addEventListener("click", () => {
					options.update({
						assistantPermissions: options
							.settings()
							.assistantPermissions.filter((kept) => kept !== permission),
					});
					renderPermissions();
				});
				return el("div", {
					class: "settings-permission",
					children: [el("span", { text: permissionLabel(t, permission) }), remove],
				});
			}),
		);
	}

	// --- Assistant: each tool on, off, asked about or not -----------------------

	const toolSettings = createToolSettings({
		t,
		settings: options.settings,
		update: options.update,
		catalog: () => bridge.assistantToolCatalog(),
	});
	item(
		"assistant",
		[t.toolSettingsTitle, t.toolSettingsHint, ...settingDef("assistantToolPolicies").keywords].join(
			" ",
		),
		toolSettings.element,
	);
	refreshers.push(() => toolSettings.refresh());

	// --- The assistant's modes --------------------------------------------------

	const modeEditor = createModeEditor({
		t,
		settings: options.settings,
		update: options.update,
		toolCatalog: () => bridge.assistantToolCatalog(),
	});
	item(
		"modes",
		[t.settingsCatModes, t.modesHint, ...settingDef("assistantModes").keywords].join(" "),
		modeEditor.element,
	);
	refreshers.push(() => modeEditor.refresh());

	// --- Templates ---------------------------------------------------------------

	const templateList = el("ul", { class: "template-list settings-templates" });
	const templateError = el("p", { class: "assistant-error", attrs: { hidden: "", role: "alert" } });
	const templateNote = el("p", { class: "confluence-hint", attrs: { hidden: "", role: "status" } });
	const keepName = el("input", {
		attrs: {
			type: "text",
			"aria-label": t.templateFromDocumentName,
			placeholder: t.templateFromDocumentName,
		},
	});
	const keepTeam = el("input", { attrs: { type: "checkbox" } });
	const keepSave = el("button", {
		class: "jira-button",
		text: t.assistantSave,
		attrs: { type: "button" },
	});
	const keepForm = el("div", {
		class: "settings-template-keep",
		attrs: { hidden: "" },
		children: [
			keepName,
			el("label", { class: "settings-check", children: [keepTeam, t.templateForTeam] }),
			keepSave,
		],
	});
	const keepOpen = el("button", {
		class: "jira-button",
		text: t.templateFromDocument,
		attrs: { type: "button" },
	});
	const importButton = el("button", {
		class: "jira-button",
		text: t.templateImport,
		attrs: { type: "button" },
	});
	item(
		"templates",
		[
			t.settingsCatTemplates,
			t.templatesHint,
			t.templateFromDocument,
			t.templateImport,
			...settingDef("defaultTemplate").keywords,
		].join(" "),
		el("div", {
			class: "settings-block",
			attrs: { "data-block": "templates" },
			children: [
				el("p", { class: "confluence-hint", text: t.templatesHint }),
				templateList,
				el("div", { class: "jira-actions", children: [keepOpen, importButton] }),
				keepForm,
				templateNote,
				templateError,
			],
		}),
	);

	const templateFailed = (error: unknown): void => {
		templateError.textContent = options.errorText(error);
		templateError.hidden = false;
	};
	const templateAction = (label: string, run: () => Promise<unknown>): HTMLButtonElement => {
		const action = el("button", {
			class: "assistant-link",
			text: label,
			attrs: { type: "button" },
		});
		action.addEventListener("click", () => {
			templateError.hidden = true;
			run().then(() => renderTemplates(), templateFailed);
		});
		return action;
	};

	async function renderTemplates(): Promise<void> {
		let templates: readonly TemplateInfo[];
		try {
			templates = await bridge.templates();
		} catch (error) {
			templateFailed(error);
			return;
		}
		const preferred = options.settings().defaultTemplate;
		const known = templates.some((template) => template.id === preferred);
		templateList.replaceChildren(
			...templates.map((template) => {
				const isDefault =
					template.id === preferred ||
					(template.source === "builtin" && (preferred === "" || !known));
				const radio = el("input", {
					attrs: {
						type: "radio",
						name: "default-template",
						"aria-label": `${t.templateDefault}: ${template.name}`,
					},
				});
				radio.checked = isDefault;
				radio.addEventListener("change", () => {
					options.update({ defaultTemplate: template.source === "builtin" ? "" : template.id });
				});
				const actions: HTMLElement[] = [
					templateAction(t.templateNewDoc, async () => {
						await bridge.templateNew(template.id);
						dialog.close();
					}),
				];
				if (template.path !== null) {
					actions.push(
						templateAction(t.templateEdit, async () => {
							await bridge.templateOpen(template.id);
							dialog.close();
						}),
					);
				}
				actions.push(
					templateAction(t.templateCopy, async () => {
						await bridge.templateCopy(template.id);
						dialog.close();
					}),
				);
				if (template.path !== null) {
					actions.push(
						templateAction(t.templateDelete, async () => {
							if (!window.confirm(format(t.templateDeleteConfirm, template.name))) return;
							await bridge.templateDelete(template.id);
							if (template.id === options.settings().defaultTemplate)
								options.update({ defaultTemplate: "" });
						}),
					);
				}
				return el("li", {
					class: "settings-template",
					attrs: { "data-template": template.id },
					children: [
						radio,
						el("div", {
							class: "settings-template-text",
							children: [
								el("strong", { text: template.name }),
								el("span", {
									class: "template-meta",
									text: `${sourceLabel(t, template)} · ${format(t.templateRequired, template.required.length)}${isDefault ? ` · ${t.templateDefault}` : ""}`,
								}),
							],
						}),
						el("div", { class: "settings-template-actions", children: actions }),
					],
				});
			}),
		);
	}

	keepOpen.addEventListener("click", async () => {
		keepForm.hidden = !keepForm.hidden;
		if (!keepForm.hidden) {
			keepName.value = (await options.activeDocument().catch(() => ({ name: "" }))).name.replace(
				/\.md$/i,
				"",
			);
			keepName.focus();
		}
	});
	keepSave.addEventListener("click", async () => {
		templateError.hidden = true;
		try {
			const { text } = await options.activeDocument();
			const name = keepName.value.trim();
			if (name === "") return;
			await bridge.templateSave({ name, text, where: keepTeam.checked ? "workspace" : "personal" });
			keepForm.hidden = true;
			await renderTemplates();
		} catch (error) {
			templateFailed(error);
		}
	});
	importButton.addEventListener("click", async () => {
		templateError.hidden = true;
		templateNote.hidden = true;
		try {
			const imported = await bridge.templateImport();
			if (imported === "word") {
				templateNote.textContent = t.templateImportedWord;
				templateNote.hidden = false;
			}
			await renderTemplates();
		} catch (error) {
			templateFailed(error);
		}
	});

	// --- Connections -------------------------------------------------------------

	const connections = el("div", { class: "settings-connections" });
	item(
		"connections",
		`${t.settingsConnections} confluence jira atlassian bağlan connect login`,
		connections,
	);

	async function renderConnections(): Promise<void> {
		const [confluence, jira] = await Promise.all([
			bridge.confluenceAccount().catch(() => null),
			bridge.jiraAccount().catch(() => null),
		]);
		connected = { confluence: confluence !== null, jira: jira !== null };
		const connection = (
			name: string,
			connectLabel: string,
			site: string | null,
			connect: () => void,
			disconnect: (() => Promise<void>) | null,
		): HTMLElement => {
			const buttons: HTMLElement[] = [];
			const connectButton = el("button", {
				class: "jira-button",
				text: connectLabel,
				attrs: { type: "button" },
			});
			connectButton.addEventListener("click", () => {
				dialog.close();
				connect();
			});
			buttons.push(connectButton);
			if (site !== null && disconnect !== null) {
				const off = el("button", {
					class: "jira-button",
					text: t.confluenceDisconnect,
					attrs: { type: "button" },
				});
				off.addEventListener("click", async () => {
					await disconnect();
					options.onAccountChange();
					await refresh();
				});
				buttons.push(off);
			}
			return el("div", {
				class: "settings-connection",
				attrs: { "data-connection": name },
				children: [
					el("strong", { text: name }),
					el("span", {
						class: "settings-connection-state",
						text: site === null ? t.settingsNotConnected : format(t.settingsConnectedTo, site),
					}),
					el("div", { class: "jira-actions", children: buttons }),
				],
			});
		};
		connections.replaceChildren(
			connection(
				"Confluence",
				t.confluenceConnectTitle,
				confluence?.site ?? null,
				options.connectConfluence,
				() => bridge.confluenceDisconnect(),
			),
			connection(
				"Jira",
				t.jiraConnectTitle,
				jira === null ? null : jira.shared ? `${jira.site} (${t.jiraSharedLogin})` : jira.site,
				options.connectJira,
				// Confluence Cloud's own login is disconnected with Confluence.
				jira?.shared === true ? null : () => bridge.jiraDisconnect(),
			),
		);
	}

	// The schema's rows, in each category after its own parts.
	for (const def of SETTING_DEFS) row(def);

	// --- Search ------------------------------------------------------------------

	/** Shows the chosen category, or, while searching, every item the search finds. */
	function filter(): void {
		const query = search.value.trim();
		const searching = query !== "";
		let found = 0;
		for (const category of SETTING_CATEGORIES) {
			let shown = 0;
			for (const child of contents.get(category)?.children ?? []) {
				const item = child as HTMLElement;
				const match = !searching || matchesQuery(item.dataset.search ?? "", query);
				item.hidden = !match;
				if (match) shown++;
			}
			found += shown;
			const section = sections.get(category) as HTMLElement;
			section.hidden = searching ? shown === 0 : category !== current;
			const button = navButtons.get(category) as HTMLButtonElement;
			button.classList.toggle("settings-nav-current", !searching && category === current);
			button.classList.toggle("settings-nav-dim", searching && shown === 0);
			if (!searching && category === current) button.setAttribute("aria-current", "true");
			else button.removeAttribute("aria-current");
		}
		empty.hidden = !searching || found > 0;
		empty.textContent = searching ? format(t.settingsNoResults, query) : "";
	}
	search.addEventListener("input", filter);
	search.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && search.value !== "") {
			event.preventDefault();
			search.value = "";
			filter();
		}
	});

	function renderValues(): void {
		for (const refresh of refreshers) refresh();
		renderPalette();
		renderPanes();
		renderPermissions();
	}

	async function refresh(): Promise<void> {
		await Promise.all([renderConnections(), renderTemplates()]);
		renderValues();
		filter();
	}

	return {
		async show(category) {
			if (category !== undefined) {
				current = category;
				search.value = "";
			}
			await refresh();
			if (!dialog.open) {
				dialog.showModal();
				void assistantForm.show().then(() => {
					// The form takes the focus to its first field: the search keeps it.
					search.focus();
				});
			}
		},
		async refresh() {
			if (dialog.open) await refresh();
		},
	};
}
