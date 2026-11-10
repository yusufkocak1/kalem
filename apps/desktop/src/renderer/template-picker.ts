/**
 * File → New from Template: the templates in a list, the default one
 * first; a click starts a new document from it.
 */
import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { TemplateInfo } from "../shared/templates.js";
import { el } from "./dom.js";

export function sourceLabel(t: Strings, template: TemplateInfo): string {
	return template.source === "builtin"
		? t.templateBuiltin
		: template.source === "workspace"
			? t.templateWorkspace
			: t.templatePersonal;
}

export function createTemplatePicker(options: {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	defaultTemplate(): string;
	errorText(error: unknown): string;
}): { show(): Promise<void> } {
	const { t, bridge } = options;
	const list = el("ul", {
		class: "template-list",
		attrs: { role: "listbox", "aria-label": t.templatePickerTitle },
	});
	const error = el("p", { class: "assistant-error", attrs: { hidden: "", role: "alert" } });
	const cancel = el("button", {
		class: "jira-button",
		text: t.assistantCancel,
		attrs: { type: "button" },
	});
	const dialog = el("dialog", {
		class: "template-picker",
		attrs: { "aria-label": t.templatePickerTitle },
		children: [
			el("h2", { text: t.templatePickerTitle }),
			list,
			error,
			el("div", { class: "confluence-actions", children: [cancel] }),
		],
	});
	document.body.append(dialog);
	cancel.addEventListener("click", () => dialog.close());

	return {
		async show() {
			error.hidden = true;
			let templates: readonly TemplateInfo[];
			try {
				templates = await bridge.templates();
			} catch (failure) {
				error.textContent = options.errorText(failure);
				error.hidden = false;
				templates = [];
			}
			const preferred = options.defaultTemplate();
			const isDefault = (template: TemplateInfo): boolean =>
				template.id === preferred || (preferred === "" && template.source === "builtin");
			const sorted = [...templates].sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)));
			list.replaceChildren(
				...sorted.map((template) => {
					const item = el("button", {
						class: "template-item",
						attrs: { type: "button", role: "option", "data-template": template.id },
						children: [
							el("strong", { text: template.name }),
							el("span", {
								class: "template-meta",
								text: [
									sourceLabel(t, template),
									format(t.templateRequired, template.required.length),
									...(isDefault(template) ? [t.templateDefault] : []),
								].join(" · "),
							}),
						],
					});
					item.addEventListener("click", async () => {
						try {
							await bridge.templateNew(template.id);
							dialog.close();
						} catch (failure) {
							error.textContent = options.errorText(failure);
							error.hidden = false;
						}
					});
					return el("li", { children: [item] });
				}),
			);
			if (!dialog.open) dialog.showModal();
			(list.querySelector("button") as HTMLButtonElement | null)?.focus();
		},
	};
}
