import type { KalemBridge, Settings, Theme } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { PanePlace, ToolPane } from "../shared/panes.js";
import { movePane, PANE_PLACES, TOOL_PANES } from "../shared/panes.js";
import { el } from "./dom.js";

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
}

export interface SettingsDialog {
	/** Opens it; `section` scrolls to that part. */
	show(section?: "panes" | "connections" | "general"): Promise<void>;
	/** Re-reads the connections while it is open. */
	refresh(): Promise<void>;
}

let fieldCount = 0;

/**
 * The app's settings in one place: where each panel docks (left, right,
 * bottom or hidden), the Confluence and Jira connections, and the general
 * options the menus also have.
 */
export function createSettingsDialog(options: SettingsDialogOptions): SettingsDialog {
	const { t, bridge } = options;
	const panes = el("div", { class: "settings-grid" });
	const connections = el("div", { class: "settings-connections" });
	const general = el("div", { class: "settings-general" });
	const done = el("button", {
		class: "confluence-primary",
		text: t.settingsDone,
		attrs: { type: "button" },
	});
	const section = (id: string, title: string, children: readonly HTMLElement[]): HTMLElement =>
		el("section", {
			class: "settings-section",
			attrs: { "data-section": id },
			children: [el("h3", { text: title }), ...children],
		});
	const dialog = el("dialog", {
		class: "settings-dialog",
		attrs: { "aria-label": t.settingsTitle },
		children: [
			el("h2", { text: t.settingsTitle }),
			el("div", {
				class: "settings-body",
				children: [
					section("panes", t.settingsPanes, [
						el("p", { class: "confluence-hint", text: t.settingsPanesHint }),
						panes,
					]),
					section("connections", t.settingsConnections, [connections]),
					section("general", t.settingsGeneral, [general]),
				],
			}),
			el("div", { class: "confluence-actions", children: [done] }),
		],
	});
	document.body.append(dialog);
	done.addEventListener("click", () => dialog.close());
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});

	const placeLabel: Readonly<Record<PanePlace, string>> = {
		left: t.placeLeft,
		right: t.placeRight,
		bottom: t.placeBottom,
		hidden: t.placeHidden,
	};
	let connected = { confluence: false, jira: false };

	function renderPanes(): void {
		const settings = options.settings();
		panes.replaceChildren(
			...TOOL_PANES.flatMap((pane) => {
				const id = `settings-pane-${++fieldCount}`;
				const select = el("select", {
					attrs: { id, "data-pane": pane },
					children: PANE_PLACES.map((place) =>
						el("option", { text: placeLabel[place], attrs: { value: place } }),
					),
				});
				select.value = settings.panePlaces[pane];
				select.addEventListener("change", () =>
					options.update(movePane(options.settings(), pane, select.value as PanePlace)),
				);
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
					select,
				];
			}),
		);
	}

	async function renderConnections(): Promise<void> {
		const [confluence, jira] = await Promise.all([
			bridge.confluenceAccount().catch(() => null),
			bridge.jiraAccount().catch(() => null),
		]);
		connected = { confluence: confluence !== null, jira: jira !== null };
		const row = (
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
			row(
				"Confluence",
				t.confluenceConnectTitle,
				confluence?.site ?? null,
				options.connectConfluence,
				() => bridge.confluenceDisconnect(),
			),
			row(
				"Jira",
				t.jiraConnectTitle,
				jira === null ? null : jira.shared ? `${jira.site} (${t.jiraSharedLogin})` : jira.site,
				options.connectJira,
				// Confluence Cloud's own login is disconnected with Confluence.
				jira?.shared === true ? null : () => bridge.jiraDisconnect(),
			),
		);
	}

	function renderGeneral(): void {
		const settings = options.settings();
		const themeId = `settings-theme-${++fieldCount}`;
		const theme = el("select", {
			attrs: { id: themeId },
			children: (
				[
					["system", t.themeSystem],
					["light", t.themeLight],
					["dark", t.themeDark],
				] as const
			).map(([value, label]) => el("option", { text: label, attrs: { value } })),
		});
		theme.value = settings.theme;
		theme.addEventListener("change", () => options.update({ theme: theme.value as Theme }));
		const check = (
			label: string,
			key: "autoSave" | "spellCheck" | "checkUpdates" | "tray" | "gitAutoFetch",
		): HTMLElement => {
			const box = el("input", { attrs: { type: "checkbox", "data-setting": key } });
			box.checked = settings[key];
			box.addEventListener("change", () => options.update({ [key]: box.checked }));
			return el("label", { class: "settings-check", children: [box, label] });
		};
		general.replaceChildren(
			el("div", {
				class: "settings-grid",
				children: [el("label", { text: t.theme, attrs: { for: themeId } }), theme],
			}),
			check(t.autoSave, "autoSave"),
			check(t.spellCheck, "spellCheck"),
			check(t.settingsUpdates, "checkUpdates"),
			check(t.settingsTray, "tray"),
			check(t.settingsGitFetch, "gitAutoFetch"),
		);
	}

	async function refresh(): Promise<void> {
		await renderConnections();
		renderPanes();
		renderGeneral();
	}

	return {
		async show(part) {
			await refresh();
			if (!dialog.open) dialog.showModal();
			if (part !== undefined) {
				dialog.querySelector(`[data-section="${part}"]`)?.scrollIntoView({ block: "start" });
			}
		},
		async refresh() {
			if (dialog.open) await refresh();
		},
	};
}
