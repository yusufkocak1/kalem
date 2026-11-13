import type { CustomIcon, CustomMode } from "../shared/custom-modes.js";
import { CUSTOM_ICONS, customInstructions } from "../shared/custom-modes.js";
import type { Strings } from "../shared/i18n.js";
import type { McpServer, McpToolList } from "../shared/mcp-servers.js";
import type { StoredStep } from "../shared/mode-config.js";
import { DETAILS, REPLY_LANGUAGES } from "../shared/mode-config.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { createMcpSection } from "./mcp-editor.js";

export interface ToolInfo {
	readonly name: string;
	readonly description: string;
}

export interface CustomModeEditorOptions {
	readonly t: Strings;
	readonly mode: CustomMode;
	/** Kalem's tools, for choosing the mode's. */
	readonly catalog: Promise<readonly ToolInfo[]>;
	/** Starts an MCP server and asks it which tools it has. */
	mcpListTools(server: McpServer): Promise<McpToolList>;
	/** Keeps the mode; `null` removes it. */
	save(mode: CustomMode | null): void;
}

function mark(name: IconName, className: string): Element {
	const svg = icon(name);
	svg.classList.add(className);
	return svg;
}

/**
 * A mode of the user's in Settings: its name, icon and line, the
 * instructions the model is given, its steps, the Kalem tools it may use,
 * and its MCP servers. Every change is kept at once.
 */
export function createCustomModeEditor(options: CustomModeEditorOptions): HTMLElement {
	const { t } = options;
	let mode = options.mode;
	const root = el("div", { class: "custom-mode" });
	const preview = el("pre", { class: "mode-preview-text" });

	const keep = (next: Partial<CustomMode>, redraw = false): void => {
		mode = { ...mode, ...next };
		options.save(mode);
		preview.textContent = customInstructions(mode);
		if (redraw) draw();
	};

	const input = (
		label: string,
		value: string,
		onInput: (value: string) => void,
		attrs: Record<string, string> = {},
		multiline = false,
	): HTMLElement => {
		const control = multiline
			? el("textarea", {
					class: "publish-input",
					attrs: { rows: "4", "aria-label": label, ...attrs },
				})
			: el("input", {
					class: "publish-input",
					attrs: { type: "text", "aria-label": label, ...attrs },
				});
		control.value = value;
		control.addEventListener("input", () => onInput(control.value));
		return el("label", {
			class: "mode-field",
			children: [el("span", { class: "mode-label", text: label }), control],
		});
	};

	const section = (title: string, hint: string, ...children: HTMLElement[]): HTMLElement =>
		el("div", {
			class: "mode-section",
			children: [
				el("h4", { text: title }),
				...(hint === "" ? [] : [el("p", { class: "mode-section-hint", text: hint })]),
				...children,
			],
		});

	const switchOf = (on: boolean, label: string, onChange: (on: boolean) => void): HTMLElement => {
		const box = el("input", {
			class: "mode-switch-input",
			attrs: { type: "checkbox", role: "switch", "aria-label": label },
		});
		box.checked = on;
		box.addEventListener("change", () => onChange(box.checked));
		return el("span", {
			class: "mode-switch",
			children: [box, el("span", { class: "mode-switch-track", attrs: { "aria-hidden": "true" } })],
		});
	};

	const iconButton = (
		name: IconName,
		label: string,
		run: () => void,
		disabled = false,
	): HTMLElement => {
		const button = el("button", {
			class: "mode-icon-button",
			attrs: { type: "button", "aria-label": label, title: label },
			children: [mark(name, "mode-icon")],
		});
		button.disabled = disabled;
		button.addEventListener("click", run);
		return button;
	};

	function pills<T extends string>(
		label: string,
		values: readonly T[],
		current: T,
		name: (value: T) => string,
		onChange: (value: T) => void,
	): HTMLElement {
		return el("div", {
			class: "mode-field",
			children: [
				el("span", { class: "mode-label", text: label }),
				el("div", {
					class: "mode-pills",
					attrs: { role: "radiogroup", "aria-label": label },
					children: values.map((value) => {
						const pill = el("button", {
							class: "mode-pill",
							text: name(value),
							attrs: { type: "button", role: "radio", "aria-checked": String(value === current) },
						});
						pill.addEventListener("click", () => onChange(value));
						return pill;
					}),
				}),
			],
		});
	}

	// --- Steps -----------------------------------------------------------------------

	function stepsSection(): HTMLElement {
		const steps = mode.steps;
		const setSteps = (next: readonly StoredStep[], redraw = true): void =>
			keep({ steps: next }, redraw);
		const rows = steps.map((step, index) => {
			const title = el("input", {
				class: "publish-input",
				attrs: { type: "text", "aria-label": t.stepTitleLabel, maxlength: "120" },
			});
			title.value = step.title ?? "";
			title.addEventListener("input", () =>
				setSteps(
					mode.steps.map((each, i) =>
						i === index ? { ...each, title: title.value.trim() } : each,
					),
					false,
				),
			);
			const text = el("textarea", {
				class: "publish-input mode-step-text",
				attrs: { rows: "2", "aria-label": t.stepInstructionLabel, maxlength: "2000" },
			});
			text.value = step.instruction ?? "";
			text.addEventListener("input", () =>
				setSteps(
					mode.steps.map((each, i) =>
						i === index ? { ...each, instruction: text.value.trim() } : each,
					),
					false,
				),
			);
			const move = (by: number): void => {
				const next = [...mode.steps];
				const [moved] = next.splice(index, 1);
				if (moved !== undefined) next.splice(index + by, 0, moved);
				setSteps(next);
			};
			return el("li", {
				class: "mode-step",
				attrs: { "data-step": step.id, ...(step.on ? {} : { "data-off": "" }) },
				children: [
					el("div", {
						class: "mode-step-head",
						children: [
							el("span", {
								class: "mode-step-number",
								text: step.on
									? String(steps.slice(0, index + 1).filter((each) => each.on).length)
									: "–",
							}),
							switchOf(step.on, step.title ?? "", (on) =>
								setSteps(mode.steps.map((each, i) => (i === index ? { ...each, on } : each))),
							),
							title,
							el("span", {
								class: "mode-step-actions",
								children: [
									iconButton("arrowDown", t.stepUp, () => move(-1), index === 0),
									iconButton("arrowDown", t.stepDown, () => move(1), index === steps.length - 1),
									iconButton("close", t.stepRemove, () =>
										setSteps(mode.steps.filter((_, i) => i !== index)),
									),
								],
							}),
						],
					}),
					el("div", { class: "mode-step-edit", children: [text] }),
				],
			});
		});
		for (const row of rows) {
			row.querySelector(".mode-step-actions .mode-icon")?.classList.add("mode-icon-up");
		}
		const add = el("button", {
			class: "mode-add",
			attrs: { type: "button" },
			children: [mark("plus", "mode-icon"), t.stepAdd],
		});
		add.addEventListener("click", () => {
			const taken = new Set(steps.map((step) => step.id));
			let n = steps.length + 1;
			while (taken.has(`step-${n}`)) n++;
			setSteps([
				...steps,
				{ id: `step-${n}`, on: true, title: t.stepAdd, instruction: t.stepAdd, custom: true },
			]);
			const fresh = root.querySelector<HTMLTextAreaElement>(`[data-step="step-${n}"] textarea`);
			fresh?.select();
			fresh?.focus();
		});
		return section(
			t.modeStepsTitle,
			t.modeStepsHint,
			el("ol", { class: "mode-steps", children: rows }),
			add,
		);
	}

	// --- Tools -----------------------------------------------------------------------

	function toolsSection(): HTMLElement {
		const list = el("div", { class: "custom-tools" });
		const filter = el("input", {
			class: "publish-input",
			attrs: { type: "search", placeholder: t.customToolsFind, "aria-label": t.customToolsFind },
		});
		const all = mode.tools === "all";
		const choice = pills(
			t.customTools,
			["all", "some"] as const,
			all ? "all" : "some",
			(value) => (value === "all" ? t.customToolsAll : t.customToolsSome),
			(value) => keep({ tools: value === "all" ? "all" : [] }, true),
		);
		const count = el("span", { class: "mode-section-hint" });
		filter.hidden = all;
		list.hidden = all;
		void options.catalog.then((tools) => {
			const chosen = new Set(mode.tools === "all" ? [] : mode.tools);
			const drawCount = (): void => {
				count.textContent = all ? "" : `${chosen.size} / ${tools.length}`;
			};
			list.replaceChildren(
				...tools.map((tool) => {
					const box = el("input", { attrs: { type: "checkbox", "data-tool": tool.name } });
					box.checked = chosen.has(tool.name);
					box.addEventListener("change", () => {
						if (box.checked) chosen.add(tool.name);
						else chosen.delete(tool.name);
						drawCount();
						keep({ tools: tools.map((each) => each.name).filter((name) => chosen.has(name)) });
					});
					return el("label", {
						class: "custom-tool",
						attrs: { "data-search": `${tool.name} ${tool.description}`.toLocaleLowerCase("tr") },
						children: [
							box,
							el("span", {
								class: "custom-tool-text",
								children: [
									el("code", { class: "custom-tool-name", text: tool.name }),
									el("span", { text: tool.description }),
								],
							}),
						],
					});
				}),
			);
			drawCount();
		});
		filter.addEventListener("input", () => {
			const query = filter.value.trim().toLocaleLowerCase("tr");
			for (const row of list.querySelectorAll<HTMLElement>(".custom-tool")) {
				row.hidden = query !== "" && !(row.dataset.search ?? "").includes(query);
			}
		});
		return section(t.customToolsTitle, t.customToolsHint, choice, count, filter, list);
	}

	// --- The whole -------------------------------------------------------------------

	function draw(): void {
		const icons = el("div", {
			class: "custom-icons",
			attrs: { role: "radiogroup", "aria-label": t.customIcon },
			children: CUSTOM_ICONS.map((name: CustomIcon) => {
				const button = el("button", {
					class: "custom-icon",
					attrs: {
						type: "button",
						role: "radio",
						"aria-checked": String(mode.icon === name),
						"aria-label": name,
						title: name,
					},
					children: [mark(name, "mode-icon")],
				});
				button.addEventListener("click", () => keep({ icon: name }, true));
				return button;
			}),
		});
		const remove = el("button", {
			class: "jira-button custom-remove",
			text: t.customRemove,
			attrs: { type: "button" },
		});
		remove.addEventListener("click", () => options.save(null));
		const language = el("select", {
			class: "publish-input",
			attrs: { "aria-label": t.modeLanguage },
		});
		language.replaceChildren(
			...REPLY_LANGUAGES.map((value) =>
				el("option", {
					text: value === "auto" ? t.replyAuto : value === "tr" ? "Türkçe" : "English",
					attrs: { value },
				}),
			),
		);
		language.value = mode.language;
		language.addEventListener("change", () =>
			keep({ language: language.value as CustomMode["language"] }),
		);
		preview.textContent = customInstructions(mode);
		root.replaceChildren(
			el("div", {
				class: "mode-panel-head",
				children: [
					el("span", { class: "mode-panel-icon", children: [mark(mode.icon, "mode-icon")] }),
					el("div", {
						class: "mode-panel-title",
						children: [
							el("h3", { class: "mode-panel-name", text: mode.name }),
							el("p", { class: "mode-panel-hint", text: mode.description || t.modeCustomHint }),
						],
					}),
					remove,
				],
			}),
			el("label", {
				class: "mode-offered",
				children: [
					switchOf(mode.enabled, t.modeOffered, (enabled) => keep({ enabled })),
					el("span", { text: t.modeOffered }),
				],
			}),
			section(
				t.customAbout,
				"",
				input(
					t.customName,
					mode.name,
					(value) => {
						if (value.trim() === "") return;
						keep({ name: value.trim() });
						const shown = root.querySelector(".mode-panel-name");
						if (shown !== null) shown.textContent = value.trim();
					},
					{ maxlength: "80" },
				),
				input(
					t.customDescription,
					mode.description,
					(value) => keep({ description: value.trim() }),
					{
						maxlength: "200",
						placeholder: t.customDescriptionHint,
					},
				),
				el("div", {
					class: "mode-field",
					children: [el("span", { class: "mode-label", text: t.customIcon }), icons],
				}),
			),
			section(
				t.customPrompt,
				t.customPromptHint,
				input(
					t.customPrompt,
					mode.prompt,
					(value) => keep({ prompt: value.trim() }),
					{
						rows: "6",
						maxlength: "8000",
						placeholder: t.customPromptPlaceholder,
					},
					true,
				),
			),
			stepsSection(),
			toolsSection(),
			createMcpSection({
				t,
				servers: () => mode.mcp,
				change: (mcp, redraw) => keep({ mcp }, redraw),
				listTools: options.mcpListTools,
			}),
			section(
				t.modeOptions,
				"",
				el("div", {
					class: "mode-options",
					children: [
						pills(
							t.modeDetail,
							DETAILS,
							mode.detail,
							(value) =>
								value === "short"
									? t.detailShort
									: value === "detailed"
										? t.detailDetailed
										: t.detailNormal,
							(detail) => keep({ detail }, true),
						),
						el("label", {
							class: "mode-field",
							children: [el("span", { class: "mode-label", text: t.modeLanguage }), language],
						}),
					],
				}),
				input(
					t.modeKeywords,
					mode.keywords.join(", "),
					(value) =>
						keep({
							keywords: [
								...new Set(
									value
										.split(",")
										.map((word) => word.trim())
										.filter(Boolean),
								),
							],
						}),
					{ placeholder: t.modeKeywordsHint },
				),
			),
			el("details", {
				class: "mode-preview",
				children: [el("summary", { class: "mode-preview-summary", text: t.modePreview }), preview],
			}),
		);
	}

	draw();
	return root;
}
