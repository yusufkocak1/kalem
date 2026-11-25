/** Settings › Extensions: install from a file after the user sees what it asks for, then manage each one. */
import type { ExtensionInfo, ExtensionPreview, KalemBridge } from "../shared/bridge.js";
import type { ExtensionManifest, ExtensionPermissions } from "../shared/extensions.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface ExtensionsSectionOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	errorText(error: unknown): string;
}

export interface ExtensionsSection {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
}

interface PermissionLine {
	readonly text: string;
	readonly warning: boolean;
}

export function permissionLines(
	t: Strings,
	permissions: ExtensionPermissions,
	manifest: ExtensionManifest,
): PermissionLine[] {
	const lines: PermissionLine[] = [];
	if (permissions.process) lines.push({ text: t.extensionPermissionProcess, warning: true });
	if (permissions.http.length > 0) {
		lines.push({
			text: format(t.extensionPermissionHttp, permissions.http.join(", ")),
			warning: false,
		});
	}
	if (permissions.assistantTools) lines.push({ text: t.extensionPermissionTools, warning: false });
	if (manifest.secrets.length > 0) {
		lines.push({
			text: format(
				t.extensionPermissionSecrets,
				manifest.secrets.map((secret) => secret.title).join(", "),
			),
			warning: false,
		});
	}
	if (lines.length === 0) lines.push({ text: t.extensionPermissionNone, warning: false });
	return lines;
}

const permissionList = (lines: readonly PermissionLine[]): HTMLElement =>
	el("ul", {
		class: "ext-permissions",
		children: lines.map((line) =>
			el("li", { text: line.text, ...(line.warning ? { attrs: { "data-warning": "" } } : {}) }),
		),
	});

const button = (text: string, onClick: () => void, extra = ""): HTMLButtonElement => {
	const element = el("button", { class: `jira-button${extra}`, text, attrs: { type: "button" } });
	element.addEventListener("click", onClick);
	return element;
};

export function createExtensionsSection(options: ExtensionsSectionOptions): ExtensionsSection {
	const { t, bridge } = options;
	const status = el("p", { class: "ext-status", attrs: { role: "status", hidden: "" } });
	const preview = el("div", { class: "ext-preview", attrs: { hidden: "" } });
	const list = el("div", { class: "ext-list" });
	const empty = el("p", { class: "confluence-hint", text: t.extensionsEmpty });

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

	function showPreview(picked: ExtensionPreview): void {
		const { manifest } = picked;
		const heading =
			picked.installedVersion === null
				? format(t.extensionInstallAsk, manifest.name)
				: format(t.extensionUpdateAsk, manifest.name, picked.installedVersion, manifest.version);
		const install = button(t.extensionInstall, () => {
			preview.hidden = true;
			void run(() => bridge.extensionInstall(picked.token));
		});
		install.classList.add("primary");
		preview.replaceChildren(
			el("strong", { text: heading }),
			el("p", {
				class: "ext-meta",
				text: `${manifest.publisher} · ${manifest.id} · ${manifest.version}`,
			}),
			...(manifest.description === "" ? [] : [el("p", { text: manifest.description })]),
			el("p", {
				class: "ext-label",
				text: picked.asksForMore ? t.extensionWillAsk : t.extensionSamePermissions,
			}),
			permissionList(permissionLines(t, manifest.permissions, manifest)),
			el("p", { class: "confluence-hint", text: t.extensionTrustHint }),
			el("div", {
				class: "jira-actions",
				children: [
					install,
					button(t.cancel, () => {
						preview.hidden = true;
					}),
				],
			}),
		);
		preview.hidden = false;
	}

	const pick = button(t.extensionInstallFromFile, () => {
		say("");
		void bridge
			.extensionPick()
			.then((picked) => {
				if (picked !== null) showPreview(picked);
			})
			.catch((error: unknown) => say(options.errorText(error), true));
	});

	function settingsOf(info: ExtensionInfo): HTMLElement[] {
		const { id } = info.manifest;
		const rows: HTMLElement[] = [];
		for (const setting of info.manifest.settings) {
			const value = info.settings[setting.key];
			const input = el("input", {
				class: "publish-input",
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
					class: "ext-field",
					children: [
						el("span", { class: "ext-label", text: setting.title }),
						input,
						...(setting.description === ""
							? []
							: [el("span", { class: "confluence-hint", text: setting.description })]),
					],
				}),
			);
		}
		for (const secret of info.manifest.secrets) {
			const set = info.secrets[secret.key] === true;
			const input = el("input", {
				class: "publish-input",
				attrs: {
					type: "password",
					autocomplete: "new-password",
					placeholder: set ? t.extensionSecretSet : "",
				},
			});
			const save = button(t.save, () => {
				if (input.value === "") return;
				void run(() => bridge.extensionSetSecret(id, secret.key, input.value));
			});
			const forget = button(
				t.extensionSecretForget,
				() => void run(() => bridge.extensionSetSecret(id, secret.key, null)),
			);
			forget.hidden = !set;
			rows.push(
				el("div", {
					class: "ext-field",
					children: [
						el("span", { class: "ext-label", text: secret.title }),
						el("div", { class: "ext-secret", children: [input, save, forget] }),
						...(secret.description === ""
							? []
							: [el("span", { class: "confluence-hint", text: secret.description })]),
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
		const actions: HTMLElement[] = [];
		if (info.enabled && manifest.host !== null) {
			actions.push(
				button(t.extensionRestart, () => void run(() => bridge.extensionRestart(manifest.id))),
			);
			actions.push(button(t.extensionDevTools, () => void bridge.extensionDevTools(manifest.id)));
		}
		actions.push(
			button(t.extensionUninstall, () => {
				if (window.confirm(format(t.extensionUninstallConfirm, manifest.name))) {
					void run(() => bridge.extensionUninstall(manifest.id));
				}
			}),
		);
		const log = el("details", {
			class: "ext-log",
			children: [
				el("summary", { text: t.extensionLog }),
				el("pre", { text: info.log.length === 0 ? "—" : info.log.join("\n") }),
			],
		});
		return el("article", {
			class: "ext-card",
			attrs: { "data-extension": manifest.id, "data-state": state },
			children: [
				el("div", {
					class: "ext-head",
					children: [
						el("div", {
							class: "ext-title",
							children: [
								el("strong", { text: manifest.name }),
								el("span", {
									class: "ext-meta",
									text: `${manifest.version} · ${manifest.publisher}`,
								}),
							],
						}),
						el("span", { class: "ext-badge", text: stateLabel[state] }),
						el("label", {
							class: "mode-switch",
							children: [toggle, el("span", { class: "mode-switch-track" })],
						}),
					],
				}),
				...(manifest.description === ""
					? []
					: [el("p", { class: "ext-description", text: manifest.description })]),
				...(info.error !== null && info.enabled
					? [el("pre", { class: "ext-error", text: info.error })]
					: []),
				permissionList(permissionLines(t, info.granted, manifest)),
				...settingsOf(info),
				el("div", { class: "jira-actions", children: actions }),
				log,
			],
		});
	}

	let drawing = Promise.resolve();
	async function refresh(): Promise<void> {
		drawing = drawing.then(async () => {
			const infos = await bridge.extensions().catch(() => []);
			const open = new Set(
				[...list.querySelectorAll<HTMLElement>(".ext-card")]
					.filter((each) => each.querySelector("details")?.open === true)
					.map((each) => each.dataset.extension),
			);
			if (
				list.contains(document.activeElement) &&
				document.activeElement?.matches("input:not([type=checkbox])")
			)
				return;
			list.replaceChildren(...infos.map(card));
			for (const each of list.querySelectorAll<HTMLElement>(".ext-card")) {
				if (open.has(each.dataset.extension))
					(each.querySelector("details") as HTMLDetailsElement).open = true;
			}
			empty.hidden = infos.length > 0;
		});
		return drawing;
	}

	bridge.onExtensionsChanged(() => void refresh());
	void refresh();

	return {
		element: el("div", {
			class: "settings-block",
			attrs: { "data-block": "extensions" },
			children: [
				el("p", { class: "ext-hint", text: t.extensionsHint }),
				el("div", { class: "jira-actions", children: [pick] }),
				status,
				preview,
				empty,
				list,
			],
		}),
		refresh,
	};
}
