import type { Settings } from "../shared/bridge.js";
import { newCustomMode } from "../shared/custom-modes.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { Mode, ResolvedMode, ResolvedStep } from "../shared/mode-config.js";
import {
	DETAILS,
	MODES,
	modeInstructions,
	newStepId,
	REPLY_LANGUAGES,
	resolveMode,
	SEVERITY_FLOORS,
	storeMode,
} from "../shared/mode-config.js";
import { MODE_HINTS, MODE_LABELS } from "../shared/modes.js";
import type { ToolInfo } from "./custom-mode-editor.js";
import { createCustomModeEditor } from "./custom-mode-editor.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

/** Each mode's mark, in the picker and in Settings. */
export const MODE_ICONS: Readonly<Record<Mode | "auto", IconName>> = {
	auto: "assistant",
	ask: "chats",
	write: "pencil",
	review: "check",
	prompt: "send",
	code: "code",
	app: "settings",
};

export interface ModeEditorOptions {
	readonly t: Strings;
	settings(): Settings;
	update(patch: Partial<Settings>): void;
	/** Kalem's tools, for choosing a mode's of the user's. */
	toolCatalog(): Promise<readonly ToolInfo[]>;
}

/** An icon with a class of its own. */
function mark(name: IconName, className: string): Element {
	const svg = icon(name);
	svg.classList.add(className);
	return svg;
}

/**
 * The assistant's modes in Settings: a tab for each, its steps (turned on
 * and off, moved, rewritten, added, removed), how it answers, the words
 * that choose it automatically, and what the model is told, drawn as it
 * changes. Every change is saved at once.
 */
export function createModeEditor(options: ModeEditorOptions): {
	readonly element: HTMLElement;
	refresh(): void;
} {
	const { t } = options;
	let selected: Mode = "review";
	/** The user's mode shown instead of one of Kalem's; `null` for Kalem's. */
	let customId: string | null = null;
	let catalog: Promise<readonly ToolInfo[]> | null = null;
	let mode: ResolvedMode = resolveMode(selected, options.settings().assistantModes);
	/** The step whose text is open for editing. */
	let editing: string | null = null;

	const tabs = el("div", {
		class: "mode-tabs",
		attrs: { role: "tablist", "aria-label": t.settingsCatModes },
	});
	const panel = el("section", { class: "mode-panel", attrs: { role: "tabpanel" } });
	const element = el("div", {
		class: "settings-block mode-editor",
		attrs: { "data-block": "modes" },
		children: [el("p", { class: "confluence-hint", text: t.modesHint }), tabs, panel],
	});

	const stepTitle = (step: ResolvedStep): string =>
		step.title ?? (step.titleKey === null ? step.id : t[step.titleKey]);

	function save(): void {
		const all = { ...options.settings().assistantModes };
		const stored = storeMode(mode);
		if (Object.keys(stored).length === 0) delete all[selected];
		else all[selected] = stored;
		options.update({ assistantModes: all });
		drawPreview();
		drawTabs();
	}

	/** Changes the mode (a copy) and saves it; `redraw` when the steps' list changes shape. */
	function change(next: Partial<ResolvedMode>, redraw = true): void {
		mode = { ...mode, ...next };
		save();
		if (redraw) draw();
	}

	function changeStep(id: string, next: Partial<ResolvedStep>, redraw = true): void {
		change(
			{ steps: mode.steps.map((step) => (step.id === id ? { ...step, ...next } : step)) },
			redraw,
		);
	}

	function drawTabs(): void {
		const custom = options.settings().assistantCustomModes;
		const customTabs = custom.map((own) => {
			const tab = el("button", {
				class: "mode-tab mode-tab-custom",
				attrs: {
					type: "button",
					role: "tab",
					"aria-selected": String(own.id === customId),
					"data-mode": own.id,
					...(own.enabled ? {} : { "data-off": "" }),
				},
				children: [
					mark(own.icon, "mode-tab-icon"),
					el("span", { class: "mode-tab-label", text: own.name }),
					el("span", {
						class: "mode-tab-count",
						text: format(t.modeSteps, own.steps.filter((step) => step.on).length),
					}),
				],
			});
			tab.addEventListener("click", () => {
				customId = own.id;
				editing = null;
				draw();
			});
			return tab;
		});
		const add = el("button", {
			class: "mode-tab mode-tab-new",
			attrs: { type: "button" },
			children: [
				mark("plus", "mode-tab-icon"),
				el("span", { class: "mode-tab-label", text: t.customNew }),
			],
		});
		add.addEventListener("click", () => {
			const all = options.settings().assistantCustomModes;
			const made = newCustomMode(t.customNewName, all);
			options.update({ assistantCustomModes: [...all, made] });
			customId = made.id;
			draw();
			panel.querySelector<HTMLInputElement>(".mode-field input")?.select();
		});
		tabs.replaceChildren(
			...MODES.map((each) => {
				const resolved =
					each === selected ? mode : resolveMode(each, options.settings().assistantModes);
				const on = resolved.steps.filter((step) => step.on).length;
				const tab = el("button", {
					class: "mode-tab",
					attrs: {
						type: "button",
						role: "tab",
						"aria-selected": String(each === selected && customId === null),
						"data-mode": each,
						...(resolved.enabled ? {} : { "data-off": "" }),
					},
					children: [
						mark(MODE_ICONS[each], "mode-tab-icon"),
						el("span", { class: "mode-tab-label", text: t[MODE_LABELS[each]] }),
						el("span", { class: "mode-tab-count", text: format(t.modeSteps, on) }),
					],
				});
				tab.addEventListener("click", () => {
					if (each === selected && customId === null) return;
					customId = null;
					selected = each;
					editing = null;
					mode = resolveMode(each, options.settings().assistantModes);
					draw();
				});
				return tab;
			}),
			...customTabs,
			add,
		);
	}

	/** A mode of the user's in the panel: kept as it changes, and gone when deleted. */
	function drawCustom(id: string): boolean {
		const own = options.settings().assistantCustomModes.find((each) => each.id === id);
		if (own === undefined) return false;
		catalog ??= options.toolCatalog().catch(() => []);
		panel.replaceChildren(
			createCustomModeEditor({
				t,
				mode: own,
				catalog,
				save(next) {
					const all = options.settings().assistantCustomModes;
					if (next === null) {
						customId = null;
						options.update({ assistantCustomModes: all.filter((each) => each.id !== id) });
						draw();
						return;
					}
					options.update({
						assistantCustomModes: all.map((each) => (each.id === id ? next : each)),
					});
					drawTabs();
				},
			}),
		);
		return true;
	}

	const preview = el("pre", { class: "mode-preview-text" });
	function drawPreview(): void {
		const text = modeInstructions(selected, { [selected]: storeMode(mode) });
		preview.textContent = text === "" ? t.modeNoInstructions : text;
	}

	/** A switch: a checkbox drawn as one. */
	function toggle(on: boolean, label: string, onChange: (on: boolean) => void): HTMLElement {
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
	}

	function iconButton(
		name: IconName,
		label: string,
		run: () => void,
		disabled = false,
	): HTMLElement {
		const button = el("button", {
			class: "mode-icon-button",
			attrs: { type: "button", "aria-label": label, title: label },
			children: [mark(name, "mode-icon")],
		});
		button.disabled = disabled;
		button.addEventListener("click", run);
		return button;
	}

	function stepRow(step: ResolvedStep, index: number): HTMLElement {
		const open = editing === step.id;
		const move = (by: number): void => {
			const steps = [...mode.steps];
			const [moved] = steps.splice(index, 1);
			if (moved === undefined) return;
			steps.splice(index + by, 0, moved);
			change({ steps });
		};
		const head = el("div", {
			class: "mode-step-head",
			children: [
				el("span", {
					class: "mode-step-number",
					text: step.on
						? String(mode.steps.slice(0, index + 1).filter((each) => each.on).length)
						: "–",
				}),
				toggle(step.on, stepTitle(step), (on) => changeStep(step.id, { on })),
				el("button", {
					class: "mode-step-title",
					attrs: { type: "button", "aria-expanded": String(open) },
					children: [
						el("span", { text: stepTitle(step) }),
						...(step.custom ? [el("span", { class: "mode-badge", text: t.stepYours })] : []),
						...(step.tool === undefined
							? []
							: [
									el("span", {
										class: "mode-badge mode-badge-tool",
										text: step.tool,
										attrs: { title: format(t.stepUsesTool, step.tool) },
									}),
								]),
					],
				}),
				el("span", {
					class: "mode-step-actions",
					children: [
						iconButton("arrowDown", t.stepUp, () => move(-1), index === 0),
						iconButton("arrowDown", t.stepDown, () => move(1), index === mode.steps.length - 1),
						iconButton("pencil", t.stepInstructionLabel, () => {
							editing = open ? null : step.id;
							draw();
						}),
						...(step.custom
							? [
									iconButton("close", t.stepRemove, () => {
										editing = null;
										change({ steps: mode.steps.filter((each) => each.id !== step.id) });
									}),
								]
							: []),
					],
				}),
			],
		});
		head.querySelector(".mode-step-title")?.addEventListener("click", () => {
			editing = open ? null : step.id;
			draw();
		});
		// The first arrow points up.
		head
			.querySelector(".mode-step-actions .mode-icon-button .mode-icon")
			?.classList.add("mode-icon-up");
		const children: HTMLElement[] = [head];
		if (open) {
			const title = el("input", {
				class: "publish-input",
				attrs: { type: "text", maxlength: "120", "aria-label": t.stepTitleLabel },
			});
			title.value = stepTitle(step);
			title.addEventListener("input", () => {
				const value = title.value.trim();
				// Kalem's own name is kept while it is not changed: it follows the language.
				const named = !step.custom && step.titleKey !== null && value === t[step.titleKey];
				changeStep(step.id, { title: value === "" || named ? null : value }, false);
				const shown = row.querySelector(".mode-step-title > span");
				if (shown !== null)
					shown.textContent = value === "" ? stepTitle({ ...step, title: null }) : value;
			});
			const text = el("textarea", {
				class: "publish-input mode-step-text",
				attrs: { rows: "3", maxlength: "2000", "aria-label": t.stepInstructionLabel },
			});
			text.value = step.instruction;
			text.addEventListener("input", () => {
				const value = text.value.trim();
				changeStep(step.id, { instruction: value === "" ? step.defaultInstruction : value }, false);
			});
			const reset = el("button", {
				class: "assistant-link",
				text: t.stepResetText,
				attrs: { type: "button" },
			});
			reset.hidden = step.custom || step.instruction === step.defaultInstruction;
			reset.addEventListener("click", () =>
				changeStep(step.id, { instruction: step.defaultInstruction, title: null }),
			);
			children.push(
				el("div", {
					class: "mode-step-edit",
					children: [
						el("label", {
							class: "mode-field",
							children: [el("span", { class: "mode-label", text: t.stepTitleLabel }), title],
						}),
						el("label", {
							class: "mode-field",
							children: [el("span", { class: "mode-label", text: t.stepInstructionLabel }), text],
						}),
						reset,
					],
				}),
			);
		}
		const row = el("li", {
			class: "mode-step",
			attrs: { "data-step": step.id, ...(step.on ? {} : { "data-off": "" }) },
			children,
		});
		return row;
	}

	/** Choices as pills: one of them pressed. */
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

	function draw(): void {
		drawTabs();
		if (customId !== null) {
			if (drawCustom(customId)) return;
			customId = null;
			drawTabs();
		}
		const steps = el("ol", {
			class: "mode-steps",
			children: mode.steps.map((step, index) => stepRow(step, index)),
		});
		const add = el("button", {
			class: "mode-add",
			attrs: { type: "button" },
			children: [mark("plus", "mode-icon"), t.stepAdd],
		});
		add.addEventListener("click", () => {
			const id = newStepId(mode);
			editing = id;
			change({
				steps: [
					...mode.steps,
					{
						id,
						on: true,
						custom: true,
						title: t.stepAdd,
						titleKey: null,
						instruction: t.stepAdd,
						defaultInstruction: "",
					},
				],
			});
			const fresh = panel.querySelector<HTMLTextAreaElement>(`[data-step="${id}"] textarea`);
			fresh?.select();
			fresh?.focus();
		});
		const reset = el("button", {
			class: "jira-button",
			text: t.modeReset,
			attrs: { type: "button" },
		});
		reset.addEventListener("click", () => {
			editing = null;
			mode = resolveMode(selected);
			save();
			draw();
		});

		const keywords = el("input", {
			class: "publish-input",
			attrs: { type: "text", placeholder: t.modeKeywordsHint, "aria-label": t.modeKeywords },
		});
		keywords.value = mode.keywords.join(", ");
		keywords.addEventListener("input", () =>
			change(
				{
					keywords: [
						...new Set(
							keywords.value
								.split(",")
								.map((word) => word.trim())
								.filter(Boolean),
						),
					],
				},
				false,
			),
		);
		const extra = el("textarea", {
			class: "publish-input",
			attrs: { rows: "3", placeholder: t.modeExtraHint, "aria-label": t.modeExtra },
		});
		extra.value = mode.extra;
		extra.addEventListener("input", () => change({ extra: extra.value.trim() }, false));
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
			change({ language: language.value as ResolvedMode["language"] }, false),
		);

		const reviewOnly: HTMLElement[] = [];
		if (selected === "review") {
			const severity: Readonly<Record<string, string>> = {
				low: t.reviewLow,
				medium: t.reviewMedium,
				high: t.reviewHigh,
			};
			const most = el("input", {
				class: "publish-input mode-number",
				attrs: { type: "number", min: "0", max: "200", step: "1", "aria-label": t.modeMaxFindings },
			});
			most.value = String(mode.maxFindings);
			most.addEventListener("input", () => {
				const value = Math.max(0, Math.min(200, Math.round(Number(most.value) || 0)));
				change({ maxFindings: value }, false);
			});
			const parallel = el("input", { attrs: { type: "checkbox" } });
			parallel.checked = mode.parallel;
			parallel.addEventListener("change", () => change({ parallel: parallel.checked }, false));
			reviewOnly.push(
				pills(
					t.modeMinSeverity,
					SEVERITY_FLOORS,
					mode.minSeverity,
					(value) => severity[value] ?? value,
					(value) => change({ minSeverity: value }),
				),
				el("label", {
					class: "mode-field",
					children: [el("span", { class: "mode-label", text: t.modeMaxFindings }), most],
				}),
				el("label", { class: "settings-check", children: [parallel, t.modeParallel] }),
			);
		}

		panel.replaceChildren(
			el("div", {
				class: "mode-panel-head",
				children: [
					el("span", {
						class: "mode-panel-icon",
						children: [mark(MODE_ICONS[selected], "mode-icon")],
					}),
					el("div", {
						class: "mode-panel-title",
						children: [
							el("h3", { class: "mode-panel-name", text: t[MODE_LABELS[selected]] }),
							el("p", { class: "mode-panel-hint", text: t[MODE_HINTS[selected]] }),
						],
					}),
					reset,
				],
			}),
			el("label", {
				class: "mode-offered",
				children: [
					toggle(mode.enabled, t.modeOffered, (enabled) => change({ enabled })),
					el("span", { text: t.modeOffered }),
				],
			}),
			el("div", {
				class: "mode-section",
				children: [
					el("h4", { text: t.modeStepsTitle }),
					el("p", { class: "mode-section-hint", text: t.modeStepsHint }),
					steps,
					add,
				],
			}),
			el("div", {
				class: "mode-section",
				children: [
					el("h4", { text: t.modeOptions }),
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
								(value) => change({ detail: value }),
							),
							el("label", {
								class: "mode-field",
								children: [el("span", { class: "mode-label", text: t.modeLanguage }), language],
							}),
							...reviewOnly,
						],
					}),
					el("label", {
						class: "mode-field",
						children: [el("span", { class: "mode-label", text: t.modeKeywords }), keywords],
					}),
					el("label", {
						class: "mode-field",
						children: [el("span", { class: "mode-label", text: t.modeExtra }), extra],
					}),
				],
			}),
			el("details", {
				class: "mode-preview",
				children: [el("summary", { class: "mode-preview-summary", text: t.modePreview }), preview],
			}),
		);
		drawPreview();
	}

	return {
		element,
		refresh() {
			// Text being typed is not redrawn under the cursor.
			if (
				element.contains(document.activeElement) &&
				document.activeElement?.matches("input, textarea")
			) {
				return;
			}
			// Clicks in the user's mode (a switch, a tool) keep their own drawing.
			if (customId !== null && element.contains(document.activeElement)) return;
			mode = resolveMode(selected, options.settings().assistantModes);
			draw();
		},
	};
}
