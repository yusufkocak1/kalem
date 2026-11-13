import type { Strings } from "../shared/i18n.js";
import type { ColumnLayout, IssueLayout } from "../shared/jira-layout.js";
import { COLUMN_LAYOUTS, movedField, withField, withoutField } from "../shared/jira-layout.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface LayoutField {
	readonly key: string;
	readonly label: string;
}

export interface LayoutMenuOptions {
	readonly t: Strings;
	layout(): IssueLayout;
	fields(): readonly LayoutField[];
	onChange(layout: IssueLayout): void;
}

export function createLayoutMenu(options: LayoutMenuOptions): HTMLElement {
	const { t } = options;
	const toggle = el("button", {
		class: "jira-icon-action jira-layout-toggle",
		attrs: {
			type: "button",
			title: t.jiraLayoutTitle,
			"aria-label": t.jiraLayoutTitle,
			"aria-haspopup": "dialog",
			"aria-expanded": "false",
		},
		children: [icon("settings")],
	});
	const panel = el("div", {
		class: "jira-layout-menu",
		attrs: { role: "dialog", "aria-label": t.jiraLayoutTitle, tabindex: "-1" },
	});
	panel.hidden = true;
	const root = el("div", { class: "jira-layout", children: [toggle, panel] });

	const change = (layout: IssueLayout): void => {
		const active = document.activeElement;
		const field = active?.closest("[data-field]")?.getAttribute("data-field") ?? null;
		const label = active?.getAttribute("aria-label") ?? null;
		options.onChange(layout);
		draw();
		const again =
			field === null
				? null
				: panel.querySelector<HTMLButtonElement>(
						`[data-field="${CSS.escape(field)}"] button[aria-label="${CSS.escape(label ?? "")}"]`,
					);
		if (again !== null && !again.disabled) again.focus();
		else panel.focus();
	};

	const small = (
		name: Parameters<typeof icon>[0],
		label: string,
		run: () => void,
		off = false,
		extra = "",
	): HTMLButtonElement => {
		const button = el("button", {
			class: `jira-layout-small ${extra}`.trim(),
			attrs: { type: "button", title: label, "aria-label": label },
			children: [icon(name)],
		});
		button.disabled = off;
		button.addEventListener("click", run);
		return button;
	};

	function draw(): void {
		const layout = options.layout();
		const all = options.fields();
		const labelOf = new Map(all.map((field) => [field.key, field.label]));
		const columns = el("div", {
			class: "jira-layout-columns",
			attrs: { role: "group", "aria-label": t.jiraLayoutColumns },
			children: COLUMN_LAYOUTS.map((value: ColumnLayout) => {
				const button = el("button", {
					class: "jira-layout-column",
					attrs: {
						type: "button",
						"aria-pressed": String(layout.columns === value),
						"data-columns": value,
						title: t[`jiraLayoutColumns${value.replace(":", "")}` as keyof Strings],
					},
					text: value,
				});
				button.addEventListener("click", () => change({ ...layout, columns: value }));
				return button;
			}),
		});
		const shown = layout.fields.filter((key) => labelOf.has(key));
		const rows = shown.map((key, index) =>
			el("li", {
				class: "jira-layout-row",
				attrs: { "data-field": key },
				children: [
					el("span", { class: "jira-layout-name", text: labelOf.get(key) ?? key }),
					small(
						"arrowDown",
						t.jiraLayoutUp,
						() => change(movedField(layout, key, -1)),
						index === 0,
						"up",
					),
					small(
						"arrowDown",
						t.jiraLayoutDown,
						() => change(movedField(layout, key, 1)),
						index === shown.length - 1,
					),
					small("close", t.jiraLayoutHide, () => change(withoutField(layout, key))),
				],
			}),
		);
		const hidden = all.filter((field) => !layout.fields.includes(field.key));
		const adder = el("select", {
			class: "jira-filter-select jira-layout-add",
			attrs: { "aria-label": t.jiraLayoutAdd },
			children: [
				el("option", { text: t.jiraLayoutAdd, attrs: { value: "" } }),
				...hidden.map((field) => el("option", { text: field.label, attrs: { value: field.key } })),
			],
		});
		adder.disabled = hidden.length === 0;
		adder.addEventListener("change", () => {
			if (adder.value !== "") change(withField(layout, adder.value));
		});
		panel.replaceChildren(
			el("h4", { text: t.jiraLayoutColumns }),
			columns,
			el("h4", { text: t.jiraLayoutFields }),
			el("ol", { class: "jira-layout-list", children: rows }),
			adder,
		);
	}

	const close = (): void => {
		panel.hidden = true;
		toggle.setAttribute("aria-expanded", "false");
		document.removeEventListener("mousedown", outside, true);
	};
	const outside = (event: MouseEvent): void => {
		if (!root.isConnected) {
			document.removeEventListener("mousedown", outside, true);
			return;
		}
		if (!(event.target instanceof Node && root.contains(event.target))) close();
	};
	toggle.addEventListener("click", () => {
		if (!panel.hidden) {
			close();
			return;
		}
		draw();
		panel.hidden = false;
		toggle.setAttribute("aria-expanded", "true");
		document.addEventListener("mousedown", outside, true);
	});
	panel.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		close();
		toggle.focus();
	});
	return root;
}
