import type {
	Block,
	Definition,
	Frontmatter,
	Inline,
	List,
	Root,
	Table as TableNode,
} from "@kalem-editor/core";
import { parse } from "@kalem-editor/core";
import type { IParagraphOptions, ParagraphChild } from "docx";
import {
	AlignmentType,
	BorderStyle,
	Document,
	ExternalHyperlink,
	Footer,
	FootnoteReferenceRun,
	HeadingLevel,
	ImageRun,
	LevelFormat,
	Packer,
	PageNumber,
	PageOrientation,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from "docx";
import type { Settings } from "../shared/bridge.js";
import { MARGIN_CM, PAGE_SIZE_MM } from "../shared/bridge.js";
import type { Footnotes } from "../shared/footnotes.js";
import {
	collectFootnotes,
	footnoteDefinitionLabel,
	referenceLabel,
	splitReferences,
} from "../shared/footnotes.js";
import type { ImageInfo } from "../shared/image-size.js";
import type { TableStyle } from "../shared/table-style.js";
import { extractTableStyles, mix, TABLE_COLOR_VALUES } from "../shared/table-style.js";

export interface DocxImage {
	readonly data: Uint8Array;
	readonly info: ImageInfo;
}

export interface DocxOptions {
	readonly title: string;
	readonly page: Pick<Settings, "pageSize" | "landscape" | "margins" | "pageNumbers">;
	/** Resolves an image URL as written in the Markdown; `null` leaves the alt text instead. */
	loadImage(url: string): Promise<DocxImage | null>;
}

const TWIPS_PER_MM = 56.7;
const MONOSPACE = "Consolas";
const CODE_FILL = "F3F3F3";
const QUOTE_BORDER = "C8C8C8";
/** Word indents each list level by this much (twips). */
const LEVEL_INDENT = 360;

interface Marks {
	readonly bold?: boolean;
	readonly italics?: boolean;
	readonly strike?: boolean;
	readonly code?: boolean;
	readonly color?: string;
	readonly link?: boolean;
}

interface Context {
	/** Blockquote depth. */
	readonly quote: number;
	/** Left indent of list item content, in twips. */
	readonly indent: number;
}

function upperHex(hex: string): string {
	return hex.toUpperCase(); // kalem-locale-ok: hex digits are ASCII
}

/** Word wants `RRGGBB`; only `#rgb` and `#rrggbb` are passed through. */
function wordColor(color: string): string | undefined {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
	if (hex === undefined) return undefined;
	return upperHex(hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex);
}

function stripTags(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

class Converter {
	readonly #options: DocxOptions;
	readonly #definitions = new Map<string, Definition>();
	readonly #tableStyles: readonly TableStyle[];
	#tableIndex = 0;
	/** Numbering definitions for ordered lists, by start number. */
	readonly #orderedStarts = new Set<number>();
	#listInstance = 0;
	/** Content width in pixels at 96 dpi; images are scaled down to fit. */
	readonly #contentWidth: number;
	readonly #footnotes: Footnotes;

	constructor(options: DocxOptions, tableStyles: readonly TableStyle[], footnotes: Footnotes) {
		this.#options = options;
		this.#tableStyles = tableStyles;
		this.#footnotes = footnotes;
		const [width, height] = PAGE_SIZE_MM[options.page.pageSize];
		const across = options.page.landscape ? height : width;
		const margin = (MARGIN_CM[options.page.margins][1] as number) * 10;
		this.#contentWidth = ((across - 2 * margin) / 25.4) * 96;
	}

	get orderedStarts(): readonly number[] {
		return [...this.#orderedStarts];
	}

	/** Word footnotes, numbered from 1 in the order of `Footnotes.order`. */
	async footnotes(): Promise<Record<number, { children: Paragraph[] }>> {
		const out: Record<number, { children: Paragraph[] }> = {};
		for (const [i, label] of this.#footnotes.order.entries()) {
			const note = this.#footnotes.notes.get(label) ?? [];
			out[i + 1] = { children: [new Paragraph({ children: await this.inline(note) })] };
		}
		return out;
	}

	#footnoteReference(label: string): FootnoteReferenceRun {
		return new FootnoteReferenceRun(this.#footnotes.order.indexOf(label) + 1);
	}

	collectDefinitions(nodes: readonly (Block | Frontmatter)[]): void {
		for (const node of nodes) {
			if (node.type === "definition") {
				this.#definitions.set(node.identifier.toLowerCase(), node); // kalem-locale-ok: identifiers are normalized ASCII-insensitively by the parser
			} else if ("children" in node && node.type !== "table" && node.type !== "list") {
				this.collectDefinitions(node.children as Block[]);
			} else if (node.type === "list") {
				for (const item of node.children) this.collectDefinitions(item.children);
			}
		}
	}

	// --- Inline ---------------------------------------------------------------

	async inline(nodes: readonly Inline[], marks: Marks = {}): Promise<ParagraphChild[]> {
		const out: ParagraphChild[] = [];
		for (const node of nodes) out.push(...(await this.#inlineNode(node, marks)));
		return out;
	}

	#text(text: string, marks: Marks): TextRun {
		return new TextRun({
			text,
			...(marks.bold ? { bold: true } : {}),
			...(marks.italics ? { italics: true } : {}),
			...(marks.strike ? { strike: true } : {}),
			...(marks.link ? { style: "Hyperlink" } : {}),
			...(marks.color !== undefined && !marks.link ? { color: marks.color } : {}),
			...(marks.code
				? {
						font: MONOSPACE,
						shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL },
					}
				: {}),
		});
	}

	async #inlineNode(node: Inline, marks: Marks): Promise<ParagraphChild[]> {
		switch (node.type) {
			case "text":
				// A soft line break inside a paragraph reads as a space, as in HTML.
				return splitReferences(node.value.replace(/\n/g, " "), this.#footnotes.notes).map((part) =>
					typeof part === "string" ? this.#text(part, marks) : this.#footnoteReference(part.label),
				);
			case "strong":
				return this.inline(node.children, { ...marks, bold: true });
			case "emphasis":
				return this.inline(node.children, { ...marks, italics: true });
			case "delete":
				return this.inline(node.children, { ...marks, strike: true });
			case "inlineCode":
				return [this.#text(node.value, { ...marks, code: true })];
			case "color": {
				const color = wordColor(node.color);
				return this.inline(node.children, color === undefined ? marks : { ...marks, color });
			}
			case "break":
				return [new TextRun({ text: "", break: 1 })];
			case "link":
				return [this.#link(node.url, await this.inline(node.children, { ...marks, link: true }))];
			case "linkReference": {
				const footnote = referenceLabel(node, this.#footnotes.notes);
				if (footnote !== null) return [this.#footnoteReference(footnote)];
				const children = await this.inline(node.children, { ...marks, link: true });
				const definition = this.#definitions.get(node.identifier.toLowerCase()); // kalem-locale-ok: see collectDefinitions
				return definition === undefined ? children : [this.#link(definition.url, children)];
			}
			case "image":
				return [await this.#image(node.url, node.alt ?? "", marks)];
			case "imageReference": {
				const definition = this.#definitions.get(node.identifier.toLowerCase()); // kalem-locale-ok: see collectDefinitions
				if (definition === undefined) return [this.#text(node.alt ?? "", marks)];
				return [await this.#image(definition.url, node.alt ?? "", marks)];
			}
			case "html":
				if (/^<br\s*\/?>$/i.test(node.value.trim())) return [new TextRun({ text: "", break: 1 })];
				return node.value.trim().startsWith("<") ? [] : [this.#text(stripTags(node.value), marks)];
		}
	}

	#link(url: string, children: ParagraphChild[]): ParagraphChild {
		return new ExternalHyperlink({ link: url, children });
	}

	async #image(url: string, alt: string, marks: Marks): Promise<ParagraphChild> {
		const image = await this.#options.loadImage(url).catch(() => null);
		if (image === null) return this.#text(alt === "" ? url : alt, marks);
		const { info, data } = image;
		const scale = Math.min(1, this.#contentWidth / Math.max(1, info.width));
		return new ImageRun({
			type: info.type,
			data,
			transformation: {
				width: Math.round(info.width * scale),
				height: Math.round(info.height * scale),
			},
			altText: { name: alt, title: alt, description: alt },
		});
	}

	// --- Blocks ---------------------------------------------------------------

	#paragraphOptions(ctx: Context): Partial<IParagraphOptions> {
		const quoteIndent = ctx.quote * 360;
		const left = ctx.indent + quoteIndent;
		return {
			...(left > 0 ? { indent: { left } } : {}),
			...(ctx.quote > 0
				? {
						border: {
							left: { style: BorderStyle.SINGLE, size: 18, color: QUOTE_BORDER, space: 8 },
						},
					}
				: {}),
		};
	}

	async blocks(
		nodes: readonly (Block | Frontmatter)[],
		ctx: Context,
	): Promise<(Paragraph | Table)[]> {
		const out: (Paragraph | Table)[] = [];
		for (const node of nodes) out.push(...(await this.#block(node, ctx)));
		return out;
	}

	async #block(node: Block | Frontmatter, ctx: Context): Promise<(Paragraph | Table)[]> {
		// Footnote definitions become Word footnotes.
		if (ctx.quote === 0 && ctx.indent === 0 && footnoteDefinitionLabel(node) !== null) return [];
		switch (node.type) {
			case "paragraph":
				return [
					new Paragraph({
						...this.#paragraphOptions(ctx),
						children: await this.inline(node.children),
					}),
				];
			case "heading": {
				const levels = [
					HeadingLevel.HEADING_1,
					HeadingLevel.HEADING_2,
					HeadingLevel.HEADING_3,
					HeadingLevel.HEADING_4,
					HeadingLevel.HEADING_5,
					HeadingLevel.HEADING_6,
				] as const;
				return [
					new Paragraph({
						...this.#paragraphOptions(ctx),
						heading: levels[node.depth - 1] ?? HeadingLevel.HEADING_6,
						children: await this.inline(node.children),
					}),
				];
			}
			case "blockquote":
				return this.blocks(node.children, { ...ctx, quote: ctx.quote + 1 });
			case "list":
				return this.#list(node, ctx, 0);
			case "code": {
				const lines = node.value.replace(/\n$/, "").split("\n");
				return lines.map(
					(line, i) =>
						new Paragraph({
							...this.#paragraphOptions(ctx),
							shading: { type: ShadingType.CLEAR, color: "auto", fill: CODE_FILL },
							spacing: { before: 0, after: i === lines.length - 1 ? 160 : 0 },
							children: [new TextRun({ text: line, font: MONOSPACE, size: 19 })],
						}),
				);
			}
			case "thematicBreak":
				return [
					new Paragraph({
						border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
						children: [],
					}),
				];
			case "table":
				return [await this.#table(node, ctx)];
			case "html": {
				const text = stripTags(node.value).trim();
				if (text === "" || node.value.trim().startsWith("<!--")) return [];
				return [new Paragraph({ ...this.#paragraphOptions(ctx), children: [new TextRun(text)] })];
			}
			case "definition":
			case "yaml":
			case "toml":
				return [];
		}
	}

	async #list(list: List, ctx: Context, level: number): Promise<(Paragraph | Table)[]> {
		const start = list.start ?? 1;
		if (list.ordered) this.#orderedStarts.add(start);
		const reference = list.ordered ? `ordered-${start}` : "bullet";
		// Each ordered list restarts its numbering.
		const instance = list.ordered ? ++this.#listInstance : 0;
		const itemIndent = (level + 1) * LEVEL_INDENT * 2;

		const out: (Paragraph | Table)[] = [];
		for (const item of list.children) {
			const [first, ...rest] = item.children;
			const task = item.checked === null ? [] : [new TextRun({ text: item.checked ? "☑ " : "☐ " })];
			const inner: Context = { ...ctx, indent: ctx.indent + itemIndent };

			if (first?.type === "paragraph" || first?.type === "heading") {
				out.push(
					new Paragraph({
						...this.#paragraphOptions(ctx),
						numbering: { reference, level, instance },
						children: [...task, ...(await this.inline(first.children))],
					}),
				);
			} else {
				out.push(
					new Paragraph({
						...this.#paragraphOptions(ctx),
						numbering: { reference, level, instance },
						children: task,
					}),
				);
				if (first !== undefined) rest.unshift(first);
			}
			for (const child of rest) {
				if (child.type === "list") out.push(...(await this.#list(child, ctx, level + 1)));
				else out.push(...(await this.#block(child, inner)));
			}
		}
		return out;
	}

	async #table(node: TableNode, ctx: Context): Promise<Table> {
		const style =
			ctx.quote === 0 && ctx.indent === 0 ? this.#tableStyles[this.#tableIndex++] : undefined;
		const color = style?.color == null ? null : TABLE_COLOR_VALUES[style.color];
		const alignment = (column: number) => {
			const align = node.align[column];
			if (align === "center") return AlignmentType.CENTER;
			if (align === "right") return AlignmentType.RIGHT;
			return AlignmentType.LEFT;
		};
		// Styled widths are CSS pixels; 1 px = 15 twips.
		const widths = style?.widths ?? [];
		const hasWidths = widths.some((width) => width !== null);

		const rows = await Promise.all(
			node.children.map(async (row, r) => {
				const head = r === 0;
				const fill =
					color === null
						? head
							? CODE_FILL
							: undefined
						: head
							? upperHex(color.slice(1))
							: r % 2 === 0
								? upperHex(mix(color, "#ffffff", 0.11).slice(1))
								: undefined;
				const cells = await Promise.all(
					row.children.map(async (cell, c) => {
						const width = widths[c] ?? null;
						const marks: Marks = head
							? { bold: true, ...(color !== null ? { color: "FFFFFF" } : {}) }
							: {};
						return new TableCell({
							...(fill !== undefined
								? { shading: { type: ShadingType.CLEAR, color: "auto", fill } }
								: {}),
							...(width !== null ? { width: { size: width * 15, type: WidthType.DXA } } : {}),
							children: [
								new Paragraph({
									alignment: alignment(c),
									children: await this.inline(cell.children, marks),
								}),
							],
						});
					}),
				);
				return new TableRow({ tableHeader: head, children: cells });
			}),
		);
		return new Table({
			rows,
			...(hasWidths ? {} : { width: { size: 100, type: WidthType.PERCENTAGE } }),
			...(ctx.indent + ctx.quote * 360 > 0
				? { indent: { size: ctx.indent + ctx.quote * 360, type: WidthType.DXA } }
				: {}),
		});
	}
}

function numberingLevels(format: (typeof LevelFormat)[keyof typeof LevelFormat], start: number) {
	const bullets = ["•", "◦", "▪"];
	return Array.from({ length: 9 }, (_, level) => ({
		level,
		format,
		text: format === LevelFormat.BULLET ? (bullets[level % 3] as string) : `%${level + 1}.`,
		start: level === 0 ? start : 1,
		alignment: AlignmentType.LEFT,
		style: {
			paragraph: { indent: { left: (level + 1) * LEVEL_INDENT * 2, hanging: LEVEL_INDENT } },
		},
	}));
}

/** Builds a Word document from Kalem's Markdown, table style comments included. */
export async function markdownToDocx(markdown: string, options: DocxOptions): Promise<Uint8Array> {
	const extracted = extractTableStyles(markdown);
	const root: Root = parse(extracted.markdown);
	const converter = new Converter(options, extracted.styles, collectFootnotes(root));
	converter.collectDefinitions(root.children);
	const children = await converter.blocks(root.children, { quote: 0, indent: 0 });
	const footnotes = await converter.footnotes();

	const { page } = options;
	const [width, height] = PAGE_SIZE_MM[page.pageSize];
	const [vertical, horizontal] = MARGIN_CM[page.margins];
	const document = new Document({
		title: options.title,
		creator: "Kalem",
		footnotes,
		numbering: {
			config: [
				{ reference: "bullet", levels: numberingLevels(LevelFormat.BULLET, 1) },
				...converter.orderedStarts.map((start) => ({
					reference: `ordered-${start}`,
					levels: numberingLevels(LevelFormat.DECIMAL, start),
				})),
			],
		},
		sections: [
			{
				properties: {
					page: {
						size: {
							width: Math.round(width * TWIPS_PER_MM),
							height: Math.round(height * TWIPS_PER_MM),
							orientation: page.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
						},
						margin: {
							top: Math.round(vertical * 10 * TWIPS_PER_MM),
							bottom: Math.round(vertical * 10 * TWIPS_PER_MM),
							left: Math.round(horizontal * 10 * TWIPS_PER_MM),
							right: Math.round(horizontal * 10 * TWIPS_PER_MM),
						},
					},
				},
				...(page.pageNumbers
					? {
							footers: {
								default: new Footer({
									children: [
										new Paragraph({
											alignment: AlignmentType.CENTER,
											children: [
												new TextRun({
													children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
												}),
											],
										}),
									],
								}),
							},
						}
					: {}),
				children,
			},
		],
	});
	return new Uint8Array(await Packer.toBuffer(document));
}
