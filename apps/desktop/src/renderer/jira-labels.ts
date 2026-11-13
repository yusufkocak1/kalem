import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { normalizeLabel } from "../shared/jira-fields.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { createPopupList, errorMessage } from "./jira-field-chip.js";

export interface LabelEditorOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	readonly issueKey: string;
	readonly labels: readonly string[];
	onSaved?(): void;
	onError(message: string): void;
}

export function createLabelEditor(options: LabelEditorOptions): HTMLElement {
	const { t, bridge } = options;
	let labels = [...options.labels];
	const root = el("div", { class: "jira-label-editor" });

	const save = (add: readonly string[], remove: readonly string[], before: string[]): void => {
		draw();
		bridge
			.jiraUpdateLabels(options.issueKey, add, remove)
			.then(() => options.onSaved?.())
			.catch((error: unknown) => {
				labels = before;
				draw();
				options.onError(errorMessage(error));
			});
	};

	const add = (raw: string): void => {
		const label = normalizeLabel(raw);
		if (label === "" || labels.includes(label)) return;
		const before = [...labels];
		labels = [...labels, label];
		save([label], [], before);
	};

	const remove = (label: string): void => {
		const before = [...labels];
		labels = labels.filter((item) => item !== label);
		save([], [label], before);
	};

	const input = el("input", {
		class: "jira-label-input",
		attrs: {
			type: "text",
			placeholder: t.jiraLabelPlaceholder,
			"aria-label": t.jiraLabelAdd,
			autocomplete: "off",
			spellcheck: "false",
		},
	});
	const addButton = el("button", {
		class: "jira-label-chip jira-label-add",
		attrs: { type: "button" },
		children: [icon("plus"), t.jiraLabelAdd],
	});
	const adder = el("span", { class: "jira-label-adder", children: [input] });
	adder.hidden = true;
	const popup = createPopupList({
		t,
		lang: options.lang,
		searchable: false,
		remoteSearch: true,
		anchor: input,
		className: "jira-label-picker",
		load: async (query) => {
			const typed = normalizeLabel(query);
			const found = await bridge.jiraLabelSuggestions(query).catch(() => []);
			const names = [...new Set([...(typed === "" ? [] : [typed]), ...found])].filter(
				(name) => !labels.includes(name),
			);
			return names.slice(0, 12).map((name) => ({ id: name, name }));
		},
		selected: () => null,
		choose: (option) => {
			if (option !== null) add(option.name);
			input.value = "";
			closeAdder();
		},
	});
	adder.append(popup.element);

	const closeAdder = (): void => {
		popup.close();
		adder.hidden = true;
		addButton.hidden = false;
		addButton.focus();
	};

	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastQuery = "";
	const refresh = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			if (input.value === lastQuery && popup.isOpen) return;
			lastQuery = input.value;
			popup.close();
			popup.open();
			input.focus();
		}, 200);
	};
	input.addEventListener("input", refresh);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !popup.isOpen) {
			event.preventDefault();
			add(input.value);
			input.value = "";
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			closeAdder();
		}
	});
	input.addEventListener("blur", () => {
		setTimeout(() => {
			if (!adder.contains(document.activeElement)) {
				input.value = "";
				popup.close();
				adder.hidden = true;
				addButton.hidden = false;
			}
		}, 150);
	});
	addButton.addEventListener("click", () => {
		addButton.hidden = true;
		adder.hidden = false;
		input.focus();
		lastQuery = "";
		refresh();
	});

	function draw(): void {
		const chips = labels.map((label) => {
			const removeButton = el("button", {
				class: "jira-label-remove",
				attrs: {
					type: "button",
					title: format(t.jiraLabelRemove, label),
					"aria-label": format(t.jiraLabelRemove, label),
				},
				children: [icon("close")],
			});
			removeButton.addEventListener("click", () => remove(label));
			return el("span", {
				class: "jira-label-chip",
				attrs: { "data-label": label },
				children: [el("span", { text: label }), removeButton],
			});
		});
		root.replaceChildren(...chips, addButton, adder);
	}
	draw();
	return root;
}
