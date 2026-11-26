import type { AssistantPlace, AssistantStatus, KalemBridge, Settings } from "../shared/bridge.js";
import { DEFAULT_SETTINGS } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { modesUsingServers, renameServerRefs } from "../shared/modes.js";
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
import { bypassList, normalizeProxyServer } from "../shared/proxy.js";
import type { SettingPage } from "../shared/settings-pages.js";
import {
	changedKeys,
	pageLabel,
	pageOf,
	pageResetPatch,
	pageResettable,
	pageTitle,
	permissionLabel,
	SETTING_GROUPS,
	SETTING_PAGES,
} from "../shared/settings-pages.js";
import type { SettingDef } from "../shared/settings-schema.js";
import {
	foldSearch,
	matchesQuery,
	matchesStems,
	parseSetting,
	SETTING_DEFS,
	searchText,
	settingDef,
	valueLabel,
} from "../shared/settings-schema.js";
import type { TemplateInfo } from "../shared/templates.js";
import { BUILTIN_ID } from "../shared/templates.js";
import { createAssistantSettings } from "./assistant-settings.js";
import { el } from "./dom.js";
import { createExtensionsSection } from "./extensions-settings.js";
import { icon } from "./icons.js";
import { createMcpSection } from "./mcp-editor.js";
import { createModeEditor } from "./mode-settings.js";
import { installFolds } from "./settings-fold.js";
import { installHints } from "./settings-hints.js";
import { sourceLabel } from "./template-picker.js";
import { createToolSettings } from "./tool-settings.js";
import { createTypographyPanel } from "./typography-panel.js";

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
	/** The app's version, shown small at the bottom. */
	readonly version: string;
	/** The version was clicked seven times in a row: the hidden debug mode. */
	unlockDebug(): void;
	/**
	 * Where Settings is shown as a page of its own (a tab beside the
	 * documents) instead of a window over them; none for the window.
	 */
	readonly host?: HTMLElement;
	/** Settings was closed: by itself (a template opened, a login asked for) or by `close`. */
	closed?(): void;
}

export interface SettingsDialog {
	/** Opens it on a page; the last one shown, or the first, when none is given. */
	show(page?: SettingPage): Promise<void>;
	/** Re-reads the connections and the values while it is open. */
	refresh(): Promise<void>;
	/** Closes it, as its own Done does. */
	close(): void;
}

let fieldCount = 0;

/** Clicks on the version that open the hidden debug mode, each within `TAP_GAP` ms of the last. */
const TAPS_TO_DEBUG = 7;
const TAP_GAP = 800;

/**
 * The app's settings in one place, as in an IDE: categories at the left, a
 * search over all of them at the top. The rows come from the settings'
 * schema; where the panels dock, the connections and the assistant's
 * service have parts of their own. The menus keep their quick ways to the
 * same settings.
 */
export function createSettingsDialog(options: SettingsDialogOptions): SettingsDialog {
	const { t, bridge } = options;
	let current: SettingPage = SETTING_PAGES[0] as SettingPage;
	let connected = { confluence: false, jira: false };

	const search = el("input", {
		class: "settings-search",
		attrs: { type: "search", placeholder: t.settingsSearch, "aria-label": t.settingsSearch },
	});
	// Only what is not as it was installed: across every page, like a search.
	const changedOnly = el("button", {
		class: "jira-button settings-changed-only",
		text: t.settingsChangedOnly,
		attrs: { type: "button", "aria-pressed": "false", title: t.settingsChangedOnlyHint },
	});
	changedOnly.addEventListener("click", () => {
		changedOnly.setAttribute(
			"aria-pressed",
			String(changedOnly.getAttribute("aria-pressed") !== "true"),
		);
		filter();
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
	// Nothing says it can be clicked: the debug mode is for whoever is told about it.
	const version = el("span", {
		class: "settings-version",
		text: `${t.appName} ${options.version}`,
	});
	let taps = 0;
	let lastTap = 0;
	version.addEventListener("click", () => {
		const now = Date.now();
		taps = now - lastTap <= TAP_GAP ? taps + 1 : 1;
		lastTap = now;
		if (taps < TAPS_TO_DEBUG) return;
		taps = 0;
		dialog.close();
		options.unlockDebug();
	});
	const dialog = el("dialog", {
		class: "settings-dialog",
		attrs: { "aria-label": t.settingsTitle },
		children: [
			el("div", {
				class: "settings-head",
				children: [el("h2", { text: t.settingsTitle }), search, changedOnly],
			}),
			el("div", {
				class: "settings-layout",
				children: [nav, el("div", { class: "settings-main", children: [body, empty] })],
			}),
			el("div", { class: "confluence-actions settings-actions", children: [version, done] }),
		],
	});
	const docked = options.host !== undefined;
	dialog.toggleAttribute("data-docked", docked);
	(options.host ?? document.body).append(dialog);
	dialog.addEventListener("close", () => options.closed?.());
	// Long parts fold under their headings; a search shows them whole.
	installFolds(body);
	// Long notes are a line until opened.
	installHints(body, t);
	done.addEventListener("click", () => dialog.close());
	// Escape closes a window by itself; a tab of its own closes the same way.
	dialog.addEventListener("keydown", (event) => {
		if (!docked || event.key !== "Escape" || event.defaultPrevented) return;
		event.preventDefault();
		dialog.close();
	});
	// Outside the window closes it; a page of its own has no outside.
	dialog.addEventListener("click", (event) => {
		if (!docked && event.target === dialog) dialog.close();
	});

	// --- Categories ------------------------------------------------------------

	// Every change made here goes through `update`: the marks of what is changed follow it.
	const update = (patch: Partial<Settings>): void => {
		options.update(patch);
		markChanged();
	};

	const navButtons = new Map<SettingPage, HTMLButtonElement>();
	const sections = new Map<SettingPage, HTMLElement>();
	const contents = new Map<SettingPage, HTMLElement>();
	for (const group of SETTING_GROUPS) {
		const list = el("div", {
			class: "settings-nav-group",
			attrs: { role: "group", ...(group.label === null ? {} : { "aria-label": t[group.label] }) },
			children:
				group.label === null
					? []
					: [el("span", { class: "settings-nav-heading", text: t[group.label] })],
		});
		nav.append(list);
		for (const page of group.pages) {
			const label = pageLabel(t, page);
			const button = el("button", {
				class: "settings-nav-item",
				text: label,
				attrs: { type: "button", "data-category": page },
			});
			button.addEventListener("click", () => {
				search.value = "";
				changedOnly.setAttribute("aria-pressed", "false");
				select(page);
			});
			navButtons.set(page, button);
			list.append(button);
			const content = el("div", { class: "settings-items" });
			const reset = el("button", {
				class: "jira-button settings-reset",
				text: t.settingsReset,
				attrs: { type: "button" },
			});
			reset.addEventListener("click", () => {
				update(pageResetPatch(page));
				renderValues();
			});
			const hasReset = pageResettable(page).length > 0;
			const title = pageTitle(t, page);
			const section = el("section", {
				class: "settings-section",
				attrs: { "data-section": page, "aria-label": title },
				children: [
					el("div", {
						class: "settings-section-head",
						children: [el("h3", { text: title }), ...(hasReset ? [reset] : [])],
					}),
					content,
				],
			});
			sections.set(page, section);
			contents.set(page, content);
			body.append(section);
		}
	}

	function select(page: SettingPage): void {
		current = page;
		filter();
		body.parentElement?.scrollTo({ top: 0 });
	}

	// --- Rows from the schema --------------------------------------------------

	/** Puts a row's control back to the setting's value. */
	const refreshers: (() => void)[] = [];

	/** The settings each item shows, to mark it when one is not as it was installed. */
	const itemKeys = new Map<HTMLElement, readonly (keyof Settings)[]>();

	function item(
		page: SettingPage,
		words: string,
		child: HTMLElement,
		keys: readonly (keyof Settings)[] = [],
	): HTMLElement {
		child.classList.add("settings-item");
		child.dataset.search = foldSearch(words);
		if (keys.length > 0) itemKeys.set(child, keys);
		contents.get(page)?.append(child);
		return child;
	}

	/** Marks the items whose settings differ from their defaults. */
	function markChanged(): void {
		const settings = options.settings();
		for (const [child, keys] of itemKeys) {
			const changed = changedKeys(settings, keys).length > 0;
			if (child.hasAttribute("data-changed") !== changed) {
				child.toggleAttribute("data-changed", changed);
			}
		}
	}

	/**
	 * A row of the schema with what it needs at its end: a mark when it is
	 * changed, and a button that puts it back.
	 */
	function settingRow(def: SettingDef, words: string, control: HTMLElement): HTMLElement {
		// The setting's name describes the button, so the setting alone is found by its name.
		const named = `settings-name-${++fieldCount}`;
		const back = el("button", {
			class: "settings-row-reset",
			attrs: {
				type: "button",
				"aria-label": t.settingsResetOne,
				"aria-describedby": named,
				title: t.settingsResetOne,
			},
			children: [icon("undo")],
		});
		const name = control.matches("label") ? control : control.querySelector("label");
		if (name !== null) name.id = named;
		back.addEventListener("click", () => {
			update({ [def.key]: DEFAULT_SETTINGS[def.key] } as Partial<Settings>);
			renderValues();
		});
		return item(
			pageOf(def.key),
			words,
			el("div", {
				class: "settings-row",
				attrs: { "data-key": def.key },
				children: [
					el("span", {
						class: "settings-changed-mark",
						attrs: { title: t.settingsModified, "aria-hidden": "true" },
					}),
					control,
					back,
				],
			}),
			[def.key],
		);
	}

	function row(def: SettingDef): HTMLElement | null {
		if (def.label === null) return null;
		// Where the assistant's panel is: a line of the panels' places, as the others'.
		if (def.key === "assistantPlace") return null;
		const label = t[def.label];
		const id = `settings-field-${++fieldCount}`;
		const words = searchText(t, def);
		const change = (value: unknown): void => {
			update({ [def.key]: parseSetting(def.key, value) } as Partial<Settings>);
		};
		switch (def.type) {
			case "boolean": {
				const box = el("input", { attrs: { id, type: "checkbox", "data-setting": def.key } });
				box.addEventListener("change", () => change(box.checked));
				refreshers.push(() => {
					box.checked = options.settings()[def.key] === true;
				});
				return settingRow(
					def,
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
				return settingRow(def, words, field(id, label, control));
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
				return settingRow(def, words, field(id, label, control));
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
		update({ palette: "kalem" });
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
		["palette", "paletteCustom"],
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
			update({ palette: choice });
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
					update({
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
			t.assistantPane,
			t.settingsAssistantPlace,
			...settingDef("assistantPlace").keywords,
		].join(" "),
		el("div", {
			class: "settings-block",
			children: [
				el("h4", { text: t.settingsPanePlaces }),
				el("p", { class: "confluence-hint", text: t.settingsPanesHint }),
				panes,
			],
		}),
		["panePlaces", "assistantPlace"],
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
					update(movePane(options.settings(), pane, control.value as PanePlace));
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
			...assistantPlaceRow(settings),
		);
	}

	/** The assistant's panel among the others: left, right or under the document; it is closed, not hidden. */
	function assistantPlaceRow(settings: Settings): HTMLElement[] {
		const id = `settings-pane-${++fieldCount}`;
		const control = el("select", {
			attrs: { id, "data-pane": "assistant", "data-setting": "assistantPlace" },
			children: (["left", "right", "bottom"] as const).map((place) =>
				el("option", { text: placeLabel[place], attrs: { value: place } }),
			),
		});
		control.value = settings.assistantPlace;
		control.addEventListener("change", () => {
			update({ assistantPlace: control.value as AssistantPlace });
			renderValues();
		});
		return [el("label", { attrs: { for: id }, text: t.assistantPane }), control];
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
			// The page's own heading names it: the form needs none of its own.
			children: [assistantForm.element],
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
		"assistantTools",
		[t.settingsPermissions, ...settingDef("assistantPermissions").keywords].join(" "),
		el("div", {
			class: "settings-block",
			attrs: { "data-block": "permissions" },
			children: [el("h4", { text: t.settingsPermissions }), permissions, forgetSession],
		}),
		["assistantPermissions"],
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
					update({
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
		update,
		catalog: () => bridge.assistantToolCatalog(),
	});
	item(
		"assistantTools",
		[t.toolSettingsTitle, t.toolSettingsHint, ...settingDef("assistantToolPolicies").keywords].join(
			" ",
		),
		toolSettings.element,
		["assistantToolPolicies"],
	);
	refreshers.push(() => toolSettings.refresh());

	// --- Assistant: its MCP servers, which each mode chooses from ----------------

	const mcpBlock = el("div", { class: "settings-block", attrs: { "data-block": "mcp" } });
	function drawMcp(): void {
		mcpBlock.replaceChildren(
			createMcpSection({
				t,
				servers: () => options.settings().assistantMcpServers,
				change(servers, redraw) {
					update({ assistantMcpServers: servers });
					if (redraw) drawMcp();
				},
				renamed(from, to) {
					const settings = options.settings();
					update(
						renameServerRefs(settings.assistantModes, settings.assistantCustomModes, from, to),
					);
					modeEditor.refresh();
				},
				usedIn: (name) => {
					const settings = options.settings();
					return modesUsingServers(t, settings.assistantModes, settings.assistantCustomModes)
						.filter((mode) => mode.mcp.includes(name))
						.map((mode) => mode.name);
				},
				listTools: (server) => bridge.mcpListTools(server),
				findCommand: (command) => bridge.mcpFindCommand(command),
			}),
		);
	}
	drawMcp();
	item(
		"mcp",
		[t.mcpTitle, t.mcpHint, ...settingDef("assistantMcpServers").keywords].join(" "),
		mcpBlock,
		["assistantMcpServers"],
	);
	refreshers.push(() => {
		// Text being typed is not redrawn under the cursor.
		if (
			mcpBlock.contains(document.activeElement) &&
			document.activeElement?.matches("input, textarea")
		) {
			return;
		}
		if (mcpBlock.contains(document.activeElement)) return;
		drawMcp();
	});

	const extensionsSection = createExtensionsSection({
		t,
		bridge,
		errorText: options.errorText,
		registries: () => options.settings().extensionRegistries,
		setRegistries: (registries) => update({ extensionRegistries: registries }),
	});
	item(
		"extensions",
		[
			t.settingsPageExtensions,
			t.extensionsHint,
			t.extensionInstallFromFile,
			"extension",
			"plugin",
			"eklenti",
		].join(" "),
		extensionsSection.element,
	);
	refreshers.push(() => void extensionsSection.refresh());

	// --- The assistant's modes --------------------------------------------------

	const modeEditor = createModeEditor({
		t,
		settings: options.settings,
		update,
		toolCatalog: () => bridge.assistantToolCatalog(),
		exportMode: (which) => bridge.assistantModeExport(which),
		importMode: () => bridge.assistantModeImport(),
	});
	item(
		"modes",
		[t.settingsCatModes, t.modesHint, ...settingDef("assistantModes").keywords].join(" "),
		modeEditor.element,
		["assistantModes", "assistantCustomModes"],
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
	const templatesBlock = item(
		"page",
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
				el("h4", { text: t.settingsCatTemplates }),
				el("p", { class: "confluence-hint", text: t.templatesHint }),
				templateList,
				el("div", { class: "jira-actions", children: [keepOpen, importButton] }),
				keepForm,
				templateNote,
				templateError,
			],
		}),
		["defaultTemplate"],
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
					template.id === preferred || (template.id === BUILTIN_ID && (preferred === "" || !known));
				const radio = el("input", {
					attrs: {
						type: "radio",
						name: "default-template",
						"aria-label": `${t.templateDefault}: ${template.name}`,
					},
				});
				radio.checked = isDefault;
				radio.addEventListener("change", () => {
					update({ defaultTemplate: template.id === BUILTIN_ID ? "" : template.id });
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
								update({ defaultTemplate: "" });
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

	// Text & Paragraph: sliders and a preview rather than one row a setting.
	const typography = createTypographyPanel({
		t,
		settings: options.settings,
		update,
	});
	item(
		"typography",
		[
			t.settingsCatTypography,
			...SETTING_DEFS.filter((def) => def.category === "typography").map((def) =>
				searchText(t, def),
			),
		].join(" "),
		typography.element,
		SETTING_DEFS.filter((def) => def.category === "typography").map((def) => def.key),
	);

	// The schema's rows, in each category after its own parts.
	for (const def of SETTING_DEFS) if (def.category !== "typography") row(def);

	// --- Proxy -------------------------------------------------------------------

	const proxyServer = el("input", {
		attrs: {
			type: "text",
			id: "settings-proxy-server",
			placeholder: "proxy.example.com:8080",
			spellcheck: "false",
			autocomplete: "off",
			"data-setting": "proxyServer",
		},
	});
	const proxyServerError = el("p", {
		class: "confluence-error",
		text: t.settingsProxyInvalid,
		attrs: { hidden: "", role: "alert" },
	});
	const proxyBypass = el("input", {
		attrs: {
			type: "text",
			id: "settings-proxy-bypass",
			placeholder: "*.example.local, 10.0.0.0/8",
			spellcheck: "false",
			autocomplete: "off",
			"data-setting": "proxyBypass",
		},
	});
	const proxyUser = el("input", {
		attrs: { type: "text", id: "settings-proxy-user", autocomplete: "off", spellcheck: "false" },
	});
	const proxyPassword = el("input", {
		attrs: { type: "password", id: "settings-proxy-password", autocomplete: "new-password" },
	});
	const proxySave = el("button", {
		class: "jira-button",
		text: t.settingsProxySave,
		attrs: { type: "button" },
	});
	const proxyForget = el("button", {
		class: "jira-button",
		text: t.settingsProxyForget,
		attrs: { type: "button", hidden: "" },
	});
	const proxyTest = el("button", {
		class: "jira-button",
		text: t.settingsProxyTest,
		attrs: { type: "button" },
	});
	const proxyStatus = el("p", {
		class: "confluence-hint",
		attrs: { hidden: "", role: "status", "data-proxy-status": "" },
	});
	const proxyManual = el("div", {
		class: "settings-proxy-manual",
		children: [
			el("div", {
				class: "settings-grid",
				children: [
					el("label", { text: t.settingsProxyServer, attrs: { for: "settings-proxy-server" } }),
					proxyServer,
				],
			}),
			el("p", { class: "settings-note", text: t.settingsProxyServerHint }),
			proxyServerError,
			el("div", {
				class: "settings-grid",
				children: [
					el("label", { text: t.settingsProxyBypass, attrs: { for: "settings-proxy-bypass" } }),
					proxyBypass,
				],
			}),
			el("p", { class: "settings-note", text: t.settingsProxyBypassHint }),
			el("h5", { text: t.settingsProxyLogin }),
			el("div", {
				class: "settings-grid",
				children: [
					el("label", { text: t.settingsProxyUser, attrs: { for: "settings-proxy-user" } }),
					proxyUser,
					el("label", { text: t.settingsProxyPassword, attrs: { for: "settings-proxy-password" } }),
					proxyPassword,
				],
			}),
			el("div", { class: "jira-actions", children: [proxySave, proxyForget] }),
		],
	});
	item(
		"proxy",
		[t.settingsProxyServer, t.settingsProxyBypass, t.settingsProxyLogin, "proxy"].join(" "),
		el("div", {
			class: "settings-block",
			attrs: { "data-block": "proxy" },
			children: [
				el("p", { class: "confluence-hint", text: t.settingsProxyHint }),
				proxyManual,
				el("div", { class: "jira-actions", children: [proxyTest] }),
				proxyStatus,
			],
		}),
		["proxyServer", "proxyBypass"],
	);
	const proxyModeRow = contents
		.get("proxy")
		?.querySelector<HTMLElement>(':scope > [data-key="proxyMode"]');
	if (proxyModeRow) contents.get("proxy")?.prepend(proxyModeRow);

	const showProxyStatus = (text: string): void => {
		proxyStatus.textContent = text;
		proxyStatus.hidden = false;
	};
	const proxyServerValid = (value: string): boolean =>
		value.trim() === "" || normalizeProxyServer(value) !== null;
	proxyServer.addEventListener("input", () => {
		proxyServerError.hidden = proxyServerValid(proxyServer.value);
	});
	proxyServer.addEventListener("change", () => {
		if (!proxyServerValid(proxyServer.value)) return;
		update({ proxyServer: proxyServer.value.trim() });
	});
	proxyBypass.addEventListener("change", () => {
		update({ proxyBypass: bypassList(proxyBypass.value).join(", ") });
		proxyBypass.value = options.settings().proxyBypass;
	});
	async function renderProxyAccount(): Promise<void> {
		const account = await bridge.proxyAccount().catch(() => null);
		proxyUser.value = account?.username ?? "";
		proxyPassword.value = "";
		proxyPassword.placeholder = account?.hasPassword === true ? t.settingsProxyPasswordKept : "";
		proxyForget.hidden = account === null;
	}
	proxySave.addEventListener("click", async () => {
		const password = proxyPassword.value;
		try {
			await bridge.proxySetLogin({
				username: proxyUser.value.trim(),
				password: password === "" ? null : password,
			});
			await renderProxyAccount();
			showProxyStatus(t.settingsProxySaved);
		} catch (error) {
			showProxyStatus(options.errorText(error));
		}
	});
	proxyForget.addEventListener("click", async () => {
		await bridge.proxySetLogin({ username: "", password: null }).catch(() => {});
		await renderProxyAccount();
	});
	proxyTest.addEventListener("click", async () => {
		proxyTest.disabled = true;
		showProxyStatus(t.settingsProxyTesting);
		try {
			const result = await bridge.proxyTest();
			showProxyStatus(
				result.ok
					? format(t.settingsProxyTestOk, result.route)
					: format(
							t.settingsProxyTestFailed,
							result.route,
							result.error ?? `HTTP ${result.status ?? "?"}`,
						),
			);
		} catch (error) {
			showProxyStatus(options.errorText(error));
		} finally {
			proxyTest.disabled = false;
		}
	});
	refreshers.push(() => {
		const settings = options.settings();
		proxyManual.hidden = settings.proxyMode !== "manual";
		if (document.activeElement !== proxyServer) proxyServer.value = settings.proxyServer;
		if (document.activeElement !== proxyBypass) proxyBypass.value = settings.proxyBypass;
		proxyServerError.hidden = proxyServerValid(proxyServer.value);
	});
	contents.get("proxy")?.addEventListener("change", (event) => {
		if ((event.target as HTMLElement).dataset.setting === "proxyMode") {
			proxyManual.hidden = options.settings().proxyMode !== "manual";
			proxyStatus.hidden = true;
		}
	});
	// The templates after the page's own settings: the size and margins first, as the page's name says.
	contents.get("page")?.append(templatesBlock);
	// What coding agents' spec files follow goes with the templates they come from.
	const specRow = contents
		.get("page")
		?.querySelector<HTMLElement>(':scope > [data-key="specProfile"]');
	if (specRow) templatesBlock.after(specRow);

	// --- Search ------------------------------------------------------------------

	/**
	 * Shows the chosen page, or, while searching or showing only what is
	 * changed, every item that is looked for, page by page.
	 */
	function filter(): void {
		const query = search.value.trim();
		const onlyChanged = changedOnly.getAttribute("aria-pressed") === "true";
		const searching = query !== "" || onlyChanged;
		dialog.toggleAttribute("data-searching", searching);
		markChanged();
		const items = SETTING_PAGES.flatMap((page) => [
			...(contents.get(page)?.children ?? []),
		]) as HTMLElement[];
		// Words with a Turkish ending ("yakınlaştırma") only when nothing matches as typed.
		const matches = items.some((item) => matchesQuery(item.dataset.search ?? "", query))
			? matchesQuery
			: matchesStems;
		let found = 0;
		for (const page of SETTING_PAGES) {
			let shown = 0;
			for (const child of contents.get(page)?.children ?? []) {
				const item = child as HTMLElement;
				const match =
					(query === "" || matches(item.dataset.search ?? "", query)) &&
					(!onlyChanged || item.hasAttribute("data-changed"));
				item.hidden = !match;
				if (match) shown++;
			}
			found += shown;
			const section = sections.get(page) as HTMLElement;
			section.hidden = searching ? shown === 0 : page !== current;
			const button = navButtons.get(page) as HTMLButtonElement;
			button.classList.toggle("settings-nav-current", !searching && page === current);
			button.classList.toggle("settings-nav-dim", searching && shown === 0);
			if (!searching && page === current) button.setAttribute("aria-current", "true");
			else button.removeAttribute("aria-current");
		}
		empty.hidden = !searching || found > 0;
		empty.textContent = !searching
			? ""
			: onlyChanged
				? query === ""
					? t.settingsNoChanges
					: format(t.settingsNoChangedResults, query)
				: format(t.settingsNoResults, query);
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
		markChanged();
		for (const refresh of refreshers) refresh();
		typography.refresh();
		renderPalette();
		renderPanes();
		renderPermissions();
	}

	async function refresh(): Promise<void> {
		await Promise.all([renderConnections(), renderTemplates(), renderProxyAccount()]);
		renderValues();
		filter();
	}

	return {
		async show(page) {
			if (page !== undefined) {
				current = page;
				search.value = "";
				changedOnly.setAttribute("aria-pressed", "false");
			}
			await refresh();
			if (!dialog.open) {
				if (docked) dialog.show();
				else dialog.showModal();
				void assistantForm.show().then(() => {
					// The form takes the focus to its first field: the search keeps it.
					search.focus();
				});
			}
		},
		async refresh() {
			if (dialog.open) await refresh();
		},
		close() {
			if (dialog.open) dialog.close();
		},
	};
}
