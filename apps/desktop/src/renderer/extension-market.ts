/** Settings › Extensions › Market and Catalogs: what the catalogs offer, and the catalogs the user trusts. */
import type {
	ExtensionPreview,
	KalemBridge,
	MarketCatalog,
	MarketEntry,
} from "../shared/bridge.js";
import type { Registry } from "../shared/extension-registry.js";
import { KALEM_REGISTRY, parseRegistries } from "../shared/extension-registry.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { avatar, button, permissionChips, permissionLines } from "./extension-ui.js";
import { icon } from "./icons.js";

export interface MarketOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	errorText(error: unknown): string;
	registries(): readonly Registry[];
	setRegistries(registries: readonly Registry[]): void;
	/** Whether Kalem's own catalog is on. */
	kalemCatalog(): boolean;
	setKalemCatalog(on: boolean): void;
	/** Shows what a picked package asks for, to install it. */
	showPreview(picked: ExtensionPreview): void;
	say(text: string, error?: boolean): void;
	/** What the catalogs offer changed (updates for the installed cards). */
	changed(): void;
}

export interface Market {
	/** The market's view. */
	readonly element: HTMLElement;
	/** The catalogs' view. */
	readonly catalogs: HTMLElement;
	refresh(force: boolean): Promise<void>;
	/** The newer version a catalog offers of an installed extension. */
	updateFor(id: string): MarketEntry | undefined;
	/** A catalog was added. */
	onAdded(listener: () => void): void;
}

export function createExtensionMarket(options: MarketOptions): Market {
	const { t, bridge } = options;
	let catalogs: readonly MarketCatalog[] = [];
	let loading = false;
	const added: (() => void)[] = [];

	// --- The market ----------------------------------------------------------------------
	const search = el("input", {
		class: "ext-search-input",
		attrs: {
			type: "search",
			placeholder: t.extensionMarketSearch,
			"aria-label": t.extensionMarketSearch,
		},
	});
	const reload = el("button", {
		class: "ext-icon-button",
		attrs: {
			type: "button",
			title: t.extensionMarketRefresh,
			"aria-label": t.extensionMarketRefresh,
		},
		children: [icon("refresh")],
	});
	reload.addEventListener("click", () => void refresh(true));
	const results = el("div", { class: "ext-market-results" });

	const install = async (entry: MarketEntry, target: HTMLButtonElement): Promise<void> => {
		options.say("");
		target.disabled = true;
		target.dataset.busy = "";
		try {
			options.showPreview(await bridge.extensionMarketPick(entry.registry, entry.id));
		} catch (error) {
			options.say(options.errorText(error), true);
		} finally {
			target.disabled = false;
			delete target.dataset.busy;
		}
	};

	function entryCard(entry: MarketEntry): HTMLElement {
		let action: HTMLButtonElement;
		if (entry.installedVersion === null) {
			action = button(t.extensionInstall, () => void install(entry, action), "primary");
		} else if (entry.update) {
			action = button(
				format(t.extensionUpdateTo, entry.version),
				() => void install(entry, action),
				"primary",
			);
		} else {
			action = button(t.extensionInstalledLabel, () => {});
			action.disabled = true;
			action.prepend(icon("check"));
		}
		return el("article", {
			class: "ext-tile",
			attrs: { "data-market": entry.id },
			children: [
				el("div", {
					class: "ext-tile-head",
					children: [
						avatar(entry.id, entry.name, entry.icon || null, "large"),
						el("div", {
							class: "ext-title",
							children: [
								el("strong", { class: "ext-name", text: entry.name }),
								el("span", { class: "ext-meta", text: `${entry.version} · ${entry.publisher}` }),
							],
						}),
					],
				}),
				el("p", { class: "ext-tile-text", text: entry.description }),
				permissionChips(t, permissionLines(t, entry.permissions, { settings: [], secrets: [] })),
				el("div", { class: "ext-tile-foot", children: [action] }),
			],
		});
	}

	function draw(): void {
		const wanted = search.value.trim().toLocaleLowerCase("tr");
		const matches = (entry: MarketEntry): boolean =>
			wanted === "" ||
			[entry.name, entry.description, entry.publisher, entry.id].some((value) =>
				value.toLocaleLowerCase("tr").includes(wanted),
			);
		if (catalogs.length === 0) {
			const add = button(t.extensionRegistryAdd, () => showCatalogs(), "primary");
			results.replaceChildren(
				el("div", {
					class: "ext-empty",
					children: [
						el("span", { class: "ext-empty-icon", children: [icon("shield")] }),
						el("strong", { text: t.extensionMarketNoCatalogs }),
						el("p", { text: t.extensionMarketEmpty }),
						el("div", { class: "ext-empty-actions", children: [add] }),
					],
				}),
			);
			return;
		}
		const sections: HTMLElement[] = [];
		for (const catalog of catalogs) {
			const entries = catalog.entries.filter(matches);
			sections.push(
				el("section", {
					class: "ext-catalog",
					children: [
						el("header", {
							class: "ext-catalog-head",
							children: [
								el("h3", { class: "ext-heading", text: catalog.name }),
								...(catalog.error === null
									? [
											el("span", {
												class: "ext-verified",
												attrs: { title: t.extensionRegistryHint },
												children: [icon("shieldCheck"), el("span", { text: t.extensionSigned })],
											}),
											el("span", { class: "ext-count", text: String(catalog.entries.length) }),
										]
									: []),
							],
						}),
						...(catalog.error !== null
							? [el("pre", { class: "ext-error", text: catalog.error })]
							: entries.length === 0
								? [el("p", { class: "ext-muted", text: t.extensionMarketNothing })]
								: [el("div", { class: "ext-grid", children: entries.map(entryCard) })]),
					],
				}),
			);
		}
		results.replaceChildren(...sections);
	}
	search.addEventListener("input", draw);

	const element = el("div", {
		class: "ext-view ext-market",
		children: [
			el("div", {
				class: "ext-search",
				children: [
					el("span", { class: "ext-search-icon", children: [icon("find")] }),
					search,
					reload,
				],
			}),
			results,
		],
	});

	// --- The catalogs ----------------------------------------------------------------------
	const registryList = el("div", { class: "ext-registries" });
	const field = (label: string, input: HTMLInputElement, hint = ""): HTMLElement =>
		el("label", {
			class: "ext-field",
			children: [
				el("span", { class: "ext-field-label", text: label }),
				input,
				...(hint === "" ? [] : [el("span", { class: "ext-field-hint", text: hint })]),
			],
		});
	const nameInput = el("input", { class: "ext-input", attrs: { placeholder: "Acme" } });
	const urlInput = el("input", {
		class: "ext-input",
		attrs: {
			placeholder: "https://acme.github.io/kalem-extensions/index.json",
			spellcheck: "false",
		},
	});
	const keyInput = el("input", {
		class: "ext-input ext-mono",
		attrs: { placeholder: "MCowBQYDK2VwAyEA…", spellcheck: "false" },
	});
	const add = button(
		t.extensionRegistryAdd,
		() => {
			const next = parseRegistries([
				...options.registries(),
				{ name: nameInput.value, url: urlInput.value, publicKey: keyInput.value },
			]);
			if (next.length === options.registries().length) {
				options.say(t.extensionRegistryInvalid, true);
				return;
			}
			options.say("");
			options.setRegistries(next);
			nameInput.value = urlInput.value = keyInput.value = "";
			drawRegistries();
			for (const listener of added) listener();
			void refresh(true);
		},
		"primary",
	);
	add.prepend(icon("plus"));

	function kalemRow(): HTMLElement {
		const on = options.kalemCatalog();
		const toggle = el("input", {
			attrs: { type: "checkbox", role: "switch", "aria-label": t.extensionKalemCatalogOn },
		});
		toggle.checked = on;
		toggle.addEventListener("change", () => {
			options.setKalemCatalog(toggle.checked);
			drawRegistries();
			void refresh(toggle.checked);
		});
		return el("div", {
			class: "ext-registry ext-registry-kalem",
			attrs: on ? {} : { "data-off": "" },
			children: [
				el("span", { class: "ext-registry-icon", children: [icon("shieldCheck")] }),
				el("div", {
					class: "ext-title",
					children: [
						el("strong", { text: KALEM_REGISTRY.name }),
						el("span", { class: "ext-meta", text: t.extensionKalemCatalogHint }),
						el("span", { class: "ext-meta", text: KALEM_REGISTRY.url }),
					],
				}),
				el("label", {
					class: "ext-switch",
					children: [
						toggle,
						el("span", { text: on ? t.extensionKalemCatalogOn : t.extensionKalemCatalogOff }),
					],
				}),
			],
		});
	}

	function drawRegistries(): void {
		const registries = options.registries().filter((each) => each.url !== KALEM_REGISTRY.url);
		registryList.replaceChildren(
			kalemRow(),
			...(registries.length === 0
				? []
				: registries.map((registry) =>
						el("div", {
							class: "ext-registry",
							children: [
								el("span", { class: "ext-registry-icon", children: [icon("shieldCheck")] }),
								el("div", {
									class: "ext-title",
									children: [
										el("strong", { text: registry.name }),
										el("span", { class: "ext-meta", text: registry.url }),
										el("span", {
											class: "ext-meta ext-mono",
											text: `${t.extensionRegistryKey}: ${registry.publicKey.slice(-16)}`,
										}),
									],
								}),
								button(
									t.extensionRegistryRemove,
									() => {
										options.setRegistries(
											options.registries().filter((each) => each.url !== registry.url),
										);
										drawRegistries();
										void refresh(false);
									},
									"danger",
								),
							],
						}),
					)),
		);
	}
	drawRegistries();

	const catalogsView = el("div", {
		class: "ext-view ext-catalogs",
		children: [
			el("p", { class: "ext-hint", text: t.extensionRegistryHint }),
			registryList,
			el("div", {
				class: "ext-form-card",
				children: [
					el("h3", { class: "ext-heading", text: t.extensionCatalogAddTitle }),
					el("div", {
						class: "ext-form-grid",
						children: [
							field(t.extensionRegistryName, nameInput),
							field(t.extensionRegistryUrl, urlInput),
							field(t.extensionRegistryKey, keyInput, t.extensionRegistryKeyHint),
						],
					}),
					el("div", { class: "ext-form-actions", children: [add] }),
				],
			}),
		],
	});

	function showCatalogs(): void {
		const tab = element
			.closest(".ext-page")
			?.querySelector<HTMLButtonElement>('[data-tab="catalogs"]');
		tab?.click();
		nameInput.focus();
	}

	async function refresh(force: boolean): Promise<void> {
		if (loading && !force) return;
		loading = true;
		reload.disabled = true;
		element.toggleAttribute("data-loading", true);
		try {
			catalogs = await bridge.extensionMarket(force);
		} catch (error) {
			options.say(options.errorText(error), true);
		} finally {
			loading = false;
			reload.disabled = false;
			element.toggleAttribute("data-loading", false);
		}
		draw();
		options.changed();
	}
	draw();

	return {
		element,
		catalogs: catalogsView,
		refresh,
		updateFor: (id) => {
			for (const catalog of catalogs) {
				const entry = catalog.entries.find((each) => each.id === id && each.update);
				if (entry !== undefined) return entry;
			}
			return undefined;
		},
		onAdded: (listener) => {
			added.push(listener);
		},
	};
}
