/** Settings › Extensions › Market: the catalogs' extensions, and the catalogs the user trusts. */
import type {
	ExtensionPreview,
	KalemBridge,
	MarketCatalog,
	MarketEntry,
} from "../shared/bridge.js";
import type { Registry } from "../shared/extension-registry.js";
import { parseRegistries } from "../shared/extension-registry.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface MarketOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	errorText(error: unknown): string;
	registries(): readonly Registry[];
	setRegistries(registries: readonly Registry[]): void;
	/** Shows what a picked package asks for, to install it. */
	showPreview(picked: ExtensionPreview): void;
	/** Says something under the tabs; an error when `error`. */
	say(text: string, error?: boolean): void;
	/** What the catalogs offer changed (updates for the installed cards). */
	changed(): void;
	/** Lists the permissions an entry asks for. */
	permissions(entry: MarketEntry): HTMLElement;
}

export interface Market {
	readonly element: HTMLElement;
	refresh(force: boolean): Promise<void>;
	/** The newer version a catalog offers of an installed extension. */
	updateFor(id: string): MarketEntry | undefined;
}

const button = (text: string, onClick: () => void, extra = ""): HTMLButtonElement => {
	const element = el("button", { class: `jira-button${extra}`, text, attrs: { type: "button" } });
	element.addEventListener("click", onClick);
	return element;
};

export function createExtensionMarket(options: MarketOptions): Market {
	const { t, bridge } = options;
	let catalogs: readonly MarketCatalog[] = [];

	const search = el("input", {
		class: "publish-input ext-search",
		attrs: {
			type: "search",
			placeholder: t.extensionMarketSearch,
			"aria-label": t.extensionMarketSearch,
		},
	});
	const reload = button(t.extensionMarketRefresh, () => void refresh(true));
	const list = el("div", { class: "ext-list ext-market-list" });

	const install = async (entry: MarketEntry, target: HTMLButtonElement): Promise<void> => {
		options.say("");
		target.disabled = true;
		try {
			options.showPreview(await bridge.extensionMarketPick(entry.registry, entry.id));
		} catch (error) {
			options.say(options.errorText(error), true);
		} finally {
			target.disabled = false;
		}
	};

	function entryCard(entry: MarketEntry): HTMLElement {
		const action =
			entry.installedVersion === null
				? button(t.extensionInstall, () => void install(entry, action), " primary")
				: entry.update
					? button(
							format(t.extensionUpdateTo, entry.version),
							() => void install(entry, action),
							" primary",
						)
					: button(t.extensionInstalledLabel, () => {});
		if (entry.installedVersion !== null && !entry.update) action.disabled = true;
		return el("article", {
			class: "ext-card",
			attrs: { "data-market": entry.id },
			children: [
				el("div", {
					class: "ext-head",
					children: [
						el("div", {
							class: "ext-title",
							children: [
								el("strong", { text: entry.name }),
								el("span", { class: "ext-meta", text: `${entry.version} · ${entry.publisher}` }),
							],
						}),
						action,
					],
				}),
				...(entry.description === ""
					? []
					: [el("p", { class: "ext-description", text: entry.description })]),
				options.permissions(entry),
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
		const parts: HTMLElement[] = [];
		if (catalogs.length === 0)
			parts.push(el("p", { class: "confluence-hint", text: t.extensionMarketEmpty }));
		for (const catalog of catalogs) {
			parts.push(el("h4", { class: "ext-catalog", text: catalog.name }));
			if (catalog.error !== null) {
				parts.push(el("pre", { class: "ext-error", text: catalog.error }));
				continue;
			}
			const entries = catalog.entries.filter(matches);
			if (entries.length === 0)
				parts.push(el("p", { class: "confluence-hint", text: t.extensionMarketNothing }));
			parts.push(...entries.map(entryCard));
		}
		list.replaceChildren(...parts);
	}
	search.addEventListener("input", draw);

	// --- The catalogs the user trusts ---------------------------------------------------
	const registryList = el("ul", { class: "ext-registries" });
	const editor = el("details", { class: "ext-registry-editor" });
	const nameInput = el("input", {
		class: "publish-input",
		attrs: { placeholder: t.extensionRegistryName, "aria-label": t.extensionRegistryName },
	});
	const urlInput = el("input", {
		class: "publish-input",
		attrs: {
			placeholder: "https://…/index.json",
			"aria-label": t.extensionRegistryUrl,
			spellcheck: "false",
		},
	});
	const keyInput = el("input", {
		class: "publish-input",
		attrs: {
			placeholder: "MCowBQYDK2VwAyEA…",
			"aria-label": t.extensionRegistryKey,
			spellcheck: "false",
		},
	});
	const add = button(t.extensionRegistryAdd, () => {
		const added = parseRegistries([
			...options.registries(),
			{ name: nameInput.value, url: urlInput.value, publicKey: keyInput.value },
		]);
		if (added.length === options.registries().length) {
			options.say(t.extensionRegistryInvalid, true);
			return;
		}
		options.setRegistries(added);
		nameInput.value = urlInput.value = keyInput.value = "";
		drawRegistries();
		void refresh(true);
	});

	function drawRegistries(): void {
		if (options.registries().length === 0) editor.open = true;
		registryList.replaceChildren(
			...options.registries().map((registry) =>
				el("li", {
					children: [
						el("span", {
							class: "ext-title",
							children: [
								el("strong", { text: registry.name }),
								el("span", { class: "ext-meta", text: registry.url }),
							],
						}),
						button(t.extensionRegistryRemove, () => {
							options.setRegistries(
								options.registries().filter((each) => each.url !== registry.url),
							);
							drawRegistries();
							void refresh(false);
						}),
					],
				}),
			),
		);
	}
	editor.append(
		el("summary", { text: t.extensionRegistries }),
		el("p", { class: "ext-hint", text: t.extensionRegistryHint }),
		registryList,
		el("div", { class: "ext-registry-form", children: [nameInput, urlInput, keyInput, add] }),
	);
	drawRegistries();

	async function refresh(force: boolean): Promise<void> {
		reload.disabled = true;
		try {
			catalogs = await bridge.extensionMarket(force);
		} catch (error) {
			options.say(options.errorText(error), true);
		} finally {
			reload.disabled = false;
		}
		draw();
		options.changed();
	}

	return {
		element: el("div", {
			class: "ext-market",
			children: [el("div", { class: "jira-actions", children: [search, reload] }), list, editor],
		}),
		refresh,
		updateFor: (id) => {
			for (const catalog of catalogs) {
				const entry = catalog.entries.find((each) => each.id === id && each.update);
				if (entry !== undefined) return entry;
			}
			return undefined;
		},
	};
}
