import type { UserRole } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface RolePickerOptions {
	readonly t: Strings;
	/** The role picked; its presets are the caller's to apply. */
	pick(role: UserRole): void;
}

/**
 * Who the app is set up for (asked at its first start, and from the View
 * menu): three kinds of user, each a few settings changed (`rolePreset`).
 * Nothing is asked again; "Not now" leaves everything as it is.
 */
export function createRolePicker(options: RolePickerOptions): {
	show(current: UserRole | ""): void;
} {
	const { t } = options;
	const roles: readonly [UserRole, string, string, IconName][] = [
		["writer", t.roleWriter, t.roleWriterHint, "pencil"],
		["analyst", t.roleAnalyst, t.roleAnalystHint, "target"],
		["developer", t.roleDeveloper, t.roleDeveloperHint, "code"],
	];
	const list = el("div", {
		class: "role-list",
		attrs: { role: "radiogroup", "aria-label": t.roleTitle },
	});
	const skip = el("button", { class: "role-skip", text: t.roleSkip, attrs: { type: "button" } });
	const dialog = el("dialog", {
		class: "role-picker",
		attrs: { "aria-label": t.roleTitle },
		children: [
			el("h2", { text: t.roleTitle }),
			el("p", { class: "role-lede", text: t.roleLede }),
			list,
			el("div", {
				class: "role-footer",
				children: [el("span", { class: "role-hint", text: t.roleHint }), skip],
			}),
		],
	});
	document.body.append(dialog);
	skip.addEventListener("click", () => dialog.close());

	return {
		show(current) {
			list.replaceChildren(
				...roles.map(([role, label, hint, glyph]) => {
					const card = el("button", {
						class: "role-card",
						attrs: {
							type: "button",
							role: "radio",
							"aria-checked": String(role === current),
							"data-role": role,
						},
						children: [
							el("span", { class: "role-icon", children: [icon(glyph)] }),
							el("span", { class: "role-name", text: label }),
							el("span", { class: "role-what", text: hint }),
						],
					});
					card.addEventListener("click", () => {
						dialog.close();
						options.pick(role);
					});
					return card;
				}),
			);
			if (!dialog.open) dialog.showModal();
			list.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
		},
	};
}
