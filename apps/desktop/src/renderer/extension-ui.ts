/** The pieces the Extensions page is made of: an extension's picture, its permissions, buttons, the install dialog. */
import type { ExtensionPreview } from "../shared/bridge.js";
import type { ExtensionManifest, ExtensionPermissions } from "../shared/extensions.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface PermissionLine {
	readonly text: string;
	readonly chip: string;
	readonly icon: IconName;
	readonly warning: boolean;
}

export function permissionLines(
	t: Strings,
	permissions: ExtensionPermissions,
	manifest: Pick<ExtensionManifest, "settings" | "secrets">,
): PermissionLine[] {
	const lines: PermissionLine[] = [];
	if (permissions.process) {
		lines.push({
			text: t.extensionPermissionProcess,
			chip: t.extensionChipProcess,
			icon: "terminal",
			warning: true,
		});
	}
	if (permissions.files) {
		lines.push({
			text: t.extensionPermissionFiles,
			chip: t.extensionChipFiles,
			icon: "folderOpen",
			warning: true,
		});
	}
	if (permissions.http.length > 0) {
		lines.push({
			text: format(t.extensionPermissionHttp, permissions.http.join(", ")),
			chip:
				permissions.http.length === 1 ? (permissions.http[0] as string) : t.extensionChipNetwork,
			icon: "link",
			warning: false,
		});
	}
	if (permissions.httpFromSettings.length > 0) {
		const titles = permissions.httpFromSettings.map(
			(key) => manifest.settings.find((setting) => setting.key === key)?.title ?? key,
		);
		lines.push({
			text: format(t.extensionPermissionHttpSetting, titles.join(", ")),
			chip: t.extensionChipNetwork,
			icon: "link",
			warning: false,
		});
	}
	if (permissions.assistantTools) {
		lines.push({
			text: t.extensionPermissionTools,
			chip: t.extensionChipTools,
			icon: "assistant",
			warning: false,
		});
	}
	if (manifest.secrets.length > 0) {
		lines.push({
			text: format(
				t.extensionPermissionSecrets,
				manifest.secrets.map((secret) => secret.title).join(", "),
			),
			chip: t.extensionChipSecrets,
			icon: "shield",
			warning: false,
		});
	}
	return lines;
}

export function permissionChips(t: Strings, lines: readonly PermissionLine[]): HTMLElement {
	return el("ul", {
		class: "ext-chips",
		attrs: { "aria-label": t.extensionPermissionsTitle },
		children:
			lines.length === 0
				? [el("li", { class: "ext-chip", text: t.extensionPermissionNone })]
				: lines.map((line) =>
						el("li", {
							class: "ext-chip",
							attrs: { title: line.text, ...(line.warning ? { "data-warning": "" } : {}) },
							children: [icon(line.icon), el("span", { text: line.chip })],
						}),
					),
	});
}

export function permissionList(t: Strings, lines: readonly PermissionLine[]): HTMLElement {
	return el("ul", {
		class: "ext-permissions",
		children:
			lines.length === 0
				? [
						el("li", {
							children: [icon("shieldCheck"), el("span", { text: t.extensionPermissionNone })],
						}),
					]
				: lines.map((line) =>
						el("li", {
							attrs: line.warning ? { "data-warning": "" } : {},
							children: [icon(line.icon), el("span", { text: line.text })],
						}),
					),
	});
}

const hueOf = (text: string): number => {
	let hash = 0;
	for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
	return hash;
};

/** The extension's picture, or its initial on a colour of its own. */
export function avatar(
	id: string,
	name: string,
	src: string | null,
	size: "small" | "large" = "small",
): HTMLElement {
	const box = el("span", {
		class: `ext-avatar ext-avatar-${size}`,
		attrs: { "aria-hidden": "true" },
	});
	box.style.setProperty("--hue", String(hueOf(id)));
	const initial = (): void => {
		box.replaceChildren(
			document.createTextNode(Array.from(name.trim())[0]?.toLocaleUpperCase("tr") ?? "?"),
		);
		box.dataset.initial = "";
	};
	if (src === null || src === "") initial();
	else {
		const image = el("img", { attrs: { src, alt: "", draggable: "false" } });
		image.addEventListener("error", initial, { once: true });
		box.append(image);
	}
	return box;
}

export const installedIcon = (manifest: ExtensionManifest): string | null =>
	manifest.icon === null ? null : `kalem-ext://${manifest.id}/${manifest.icon}`;

export function button(
	text: string,
	onClick: () => void,
	kind: "" | "primary" | "ghost" | "danger" = "",
): HTMLButtonElement {
	const element = el("button", {
		class: `ext-button${kind === "" ? "" : ` ext-button-${kind}`}`,
		text,
		attrs: { type: "button" },
	});
	element.addEventListener("click", onClick);
	return element;
}

export interface ConsentDialog {
	readonly element: HTMLDialogElement;
	open(picked: ExtensionPreview, source: string): void;
	close(): void;
}

/** What a package asks for, before anything is installed: install, or not. */
export function createConsentDialog(
	t: Strings,
	install: (picked: ExtensionPreview) => void,
): ConsentDialog {
	const dialog = el("dialog", {
		class: "ext-dialog ext-preview",
		attrs: { "aria-labelledby": "ext-dialog-title" },
	});
	const close = (): void => {
		if (dialog.open) dialog.close();
	};
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) close();
	});
	return {
		element: dialog,
		close,
		open(picked, source) {
			const { manifest } = picked;
			const update = picked.installedVersion !== null;
			const go = button(
				update ? t.extensionUpdate : t.extensionInstall,
				() => {
					close();
					install(picked);
				},
				"primary",
			);
			const lines = permissionLines(t, manifest.permissions, manifest);
			dialog.replaceChildren(
				el("header", {
					class: "ext-dialog-head",
					children: [
						avatar(manifest.id, manifest.name, picked.icon, "large"),
						el("div", {
							class: "ext-dialog-title",
							children: [
								el("h3", {
									text: update
										? format(
												t.extensionUpdateAsk,
												manifest.name,
												picked.installedVersion as string,
												manifest.version,
											)
										: format(t.extensionInstallAsk, manifest.name),
									attrs: { id: "ext-dialog-title" },
								}),
								el("p", {
									class: "ext-meta",
									text: `${manifest.publisher} · ${manifest.id} · ${manifest.version}`,
								}),
								el("p", {
									class: "ext-source",
									attrs: picked.registry === null ? { "data-file": "" } : {},
									children: [
										icon(picked.registry === null ? "file" : "shieldCheck"),
										el("span", { text: source }),
									],
								}),
							],
						}),
					],
				}),
				...(manifest.description === ""
					? []
					: [el("p", { class: "ext-dialog-text", text: manifest.description })]),
				el("p", {
					class: "ext-dialog-label",
					text: picked.asksForMore ? t.extensionWillAsk : t.extensionSamePermissions,
				}),
				permissionList(t, lines),
				el("p", {
					class: "ext-dialog-note",
					children: [icon("shieldAlert"), el("span", { text: t.extensionTrustHint })],
				}),
				el("footer", {
					class: "ext-dialog-actions",
					children: [button(t.cancel, close, "ghost"), go],
				}),
			);
			if (!dialog.open) dialog.showModal();
			go.focus();
		},
	};
}
