/**
 * The Text & Paragraph part of the Settings window, as Word's Paragraph
 * dialog: line spacing (with Word's 1.0 / 1.15 / 1.5 / 2.0), the room after
 * paragraphs, above headings and between list items, the typeface, the
 * text size and the page's width, beside a preview. Each change is a
 * setting (`shared/typography.ts`) and shows at once, here and on the
 * open documents; the section's Reset puts the defaults back.
 */
import type { Settings } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { parseSetting } from "../shared/settings-schema.js";
import type { DocumentFont, Typography } from "../shared/typography.js";
import {
	DEFAULT_TYPOGRAPHY,
	DOCUMENT_FONTS,
	LINE_SPACING_PRESETS,
	pickTypography,
	TYPOGRAPHY_RANGES,
	typographyVars,
} from "../shared/typography.js";
import { el } from "./dom.js";

export interface TypographyPanelOptions {
	readonly t: Strings;
	settings(): Settings;
	update(patch: Partial<Settings>): void;
}

export interface TypographyPanel {
	readonly element: HTMLElement;
	/** The settings changed: the controls and the preview follow. */
	refresh(): void;
}

type NumberKey = keyof typeof TYPOGRAPHY_RANGES;

const FONT_LABELS: Readonly<Record<DocumentFont, keyof Strings>> = {
	default: "typoFontDefault",
	sans: "typoFontSans",
	serif: "typoFontSerif",
	word: "typoFontWord",
	mono: "typoFontMono",
};

export function createTypographyPanel(options: TypographyPanelOptions): TypographyPanel {
	const { t } = options;
	const refreshers: (() => void)[] = [];
	let pending: Partial<Settings> = {};
	let frame = 0;

	/** Applies a change; a slider's many steps reach the app once a frame. */
	function change(patch: Partial<Settings>): void {
		pending = { ...pending, ...patch };
		drawPreview({ ...pickTypography(options.settings()), ...pending } as Typography);
		if (frame !== 0) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			const next = pending;
			pending = {};
			options.update(next);
			refresh();
		});
	}

	// --- A number: slider, box and unit -------------------------------------------

	let fieldCount = 0;
	function numberRow(
		key: NumberKey,
		label: string,
		unit: string,
		extra?: HTMLElement,
	): HTMLElement {
		const range = TYPOGRAPHY_RANGES[key];
		const id = `typography-${key}-${++fieldCount}`;
		const attrs = { min: String(range.min), max: String(range.max), step: String(range.step) };
		const slider = el("input", {
			class: "typography-slider",
			attrs: { type: "range", ...attrs, "aria-label": label, "data-typography": key },
		});
		const box = el("input", {
			class: "typography-number",
			attrs: { id, type: "number", ...attrs, "data-typography-box": key },
		});
		const set = (raw: number): void => {
			const value = parseSetting(key, raw) as number;
			change({ [key]: value } as Partial<Settings>);
			slider.value = String(value);
		};
		slider.addEventListener("input", () => {
			box.value = slider.value;
			set(Number(slider.value));
		});
		box.addEventListener("change", () => {
			const value = Number(box.value);
			if (box.value.trim() === "" || !Number.isFinite(value)) {
				box.value = String(options.settings()[key]);
				return;
			}
			set(value);
			box.value = String(parseSetting(key, value));
		});
		refreshers.push(() => {
			const value = String(options.settings()[key]);
			slider.value = value;
			if (document.activeElement !== box) box.value = value;
		});
		return el("div", {
			class: "typography-row",
			children: [
				el("label", { class: "typography-label", text: label, attrs: { for: id } }),
				el("div", {
					class: "typography-control",
					children: [slider, box, el("span", { class: "typography-unit", text: unit })],
				}),
				...(extra === undefined ? [] : [extra]),
			],
		});
	}

	// --- Line spacing presets, as Word's 1.0 / 1.15 / 1.5 / 2.0 ------------------

	const presets = el("div", {
		class: "typography-presets",
		attrs: { role: "group", "aria-label": t.typoLineSpacing },
	});
	for (const value of LINE_SPACING_PRESETS) {
		const button = el("button", {
			class: "typography-preset",
			// 1 reads as Word's "1.0"; Kalem's own spacing is marked as the default.
			text: Number.isInteger(value) ? value.toFixed(1) : String(value),
			attrs: {
				type: "button",
				"data-preset": String(value),
				title: value === DEFAULT_TYPOGRAPHY.lineSpacing ? t.typoFontDefault : String(value),
			},
		});
		button.addEventListener("click", () => change({ lineSpacing: value }));
		presets.append(button);
		refreshers.push(() => {
			button.setAttribute("aria-pressed", String(options.settings().lineSpacing === value));
		});
	}

	// --- Typeface -------------------------------------------------------------------

	const fontId = `typography-font-${++fieldCount}`;
	const font = el("select", {
		class: "typography-select",
		attrs: { id: fontId, "data-typography": "documentFont" },
		children: DOCUMENT_FONTS.map((value) =>
			el("option", { text: t[FONT_LABELS[value]], attrs: { value } }),
		),
	});
	font.addEventListener("change", () => change({ documentFont: font.value as DocumentFont }));
	refreshers.push(() => {
		font.value = options.settings().documentFont;
	});

	// --- Preview ------------------------------------------------------------------

	const preview = el("div", {
		class: "typography-preview kalem-theme kalem-doc",
		attrs: { "aria-label": t.typoPreview },
		children: [
			el("h2", { text: t.typoPreviewHeading }),
			el("p", { text: t.typoPreviewText }),
			el("p", { text: t.typoPreviewText2 }),
			el("ul", {
				children: [el("li", { text: t.typoPreviewItem1 }), el("li", { text: t.typoPreviewItem2 })],
			}),
		],
	});

	function drawPreview(typography: Typography): void {
		for (const [name, value] of Object.entries(typographyVars(typography))) {
			if (value === null) preview.style.removeProperty(name);
			else preview.style.setProperty(name, value);
		}
		preview.toggleAttribute("data-doc-font", typography.documentFont !== "default");
	}

	// --- The panel ------------------------------------------------------------------

	const group = (title: string, ...rows: HTMLElement[]): HTMLElement =>
		el("fieldset", {
			class: "typography-group",
			children: [el("legend", { text: title }), ...rows],
		});

	const body = el("div", {
		class: "typography-body",
		children: [
			el("div", {
				class: "typography-controls",
				children: [
					el("p", { class: "typography-hint", text: t.typographyHint }),
					group(
						t.typoSpacingGroup,
						numberRow("lineSpacing", t.typoLineSpacing, t.typoUnitLines, presets),
						numberRow("paragraphSpacing", t.typoParagraphSpacing, t.typoUnitEm),
						numberRow("headingSpacing", t.typoHeadingSpacing, t.typoUnitEm),
						numberRow("listSpacing", t.typoListSpacing, t.typoUnitEm),
					),
					group(
						t.typoTextGroup,
						el("div", {
							class: "typography-row",
							children: [
								el("label", {
									class: "typography-label",
									text: t.typoFont,
									attrs: { for: fontId },
								}),
								el("div", { class: "typography-control", children: [font] }),
							],
						}),
						numberRow("documentFontSize", t.typoFontSize, t.typoUnitPx),
					),
					group(
						t.typoPageGroup,
						numberRow(
							"pageWidth",
							t.typoPageWidth,
							t.typoUnitEm,
							el("p", { class: "typography-hint", text: t.typoPageWidthHint }),
						),
					),
				],
			}),
			el("div", {
				class: "typography-preview-frame",
				children: [el("h3", { text: t.typoPreview }), preview],
			}),
		],
	});

	const element = el("div", { class: "typography-panel", children: [body] });

	function refresh(): void {
		for (const refresher of refreshers) refresher();
		drawPreview(pickTypography(options.settings()));
	}
	refresh();

	return { element, refresh };
}
