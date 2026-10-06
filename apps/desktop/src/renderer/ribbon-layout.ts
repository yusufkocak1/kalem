import type { AlignType, Root } from "@kalem-editor/core";
import type { BlockType, MarkType } from "@kalem-editor/core/commands";
import type { Caret, EditResult } from "@kalem-editor/editor";
import type { Command, KalemBridge, Settings } from "../shared/bridge.js";
import { MAX_ZOOM, MIN_ZOOM } from "../shared/bridge.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { SortDirection } from "../shared/table.js";
import {
	alignColumn,
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	sortRows,
} from "../shared/table.js";
import type { TableColor, TableStyle } from "../shared/table-style.js";
import {
	TABLE_COLORS,
	withColumnDeleted,
	withColumnInserted,
	withColumnWidth,
} from "../shared/table-style.js";
import { el } from "./dom.js";
import type { TableContext, TableEdit } from "./edits.js";
import { insertTable, tableAt } from "./edits.js";
import type { Ribbon, RibbonButton, RibbonTab, RibbonWidget } from "./ribbon.js";
import {
	createColorMenu,
	createRibbon,
	createStyleGallery,
	createSwatches,
	createTablePicker,
} from "./ribbon.js";
import type { Session } from "./session.js";

/** What the ribbon reads and runs; the window's state stays in main.ts. */
export interface RibbonContext {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly platform: string;
	readonly language: Lang;
	readonly commands: Readonly<Record<Command, () => void>>;
	session(): Session;
	settings(): Settings;
	updateSettings(patch: Partial<Settings>): void;
	canEdit(): boolean;
	inSource(): boolean;
	inCodeBlock(): boolean;
	focusMode(): boolean;
	warn(text: string): void;
	edit(change: (doc: Root, caret: Caret) => EditResult | null): void;
	editTable(change: (context: TableContext) => TableEdit): void;
}

/** Builds the window's ribbon: Home, Insert, View and the contextual Table and Code tabs. */
export function createAppRibbon(
	host: HTMLElement,
	trailing: HTMLElement,
	ctx: RibbonContext,
): Ribbon {
	const { t } = ctx;

	const MOD = ctx.platform === "darwin" ? "Cmd" : "Ctrl";

	function currentBlock(): Root["children"][number] | undefined {
		const caret = ctx.session().editor.getCaret();
		return caret === null
			? undefined
			: ctx.session().editor.getDocument().children[caret.blockIndex];
	}

	function currentTable(): TableContext | null {
		return ctx.inSource()
			? null
			: tableAt(ctx.session().editor.getDocument(), ctx.session().editor.getCaret());
	}

	function inCodeBlock(): boolean {
		return ctx.inCodeBlock();
	}

	function isList(ordered: boolean): boolean {
		const block = currentBlock();
		return block?.type === "list" && block.ordered === ordered;
	}

	function isTaskList(): boolean {
		const block = currentBlock();
		return block?.type === "list" && block.children.every((item) => item.checked !== null);
	}

	function command(
		id: Command,
		label: string,
		iconName: RibbonButton["icon"],
		extra: Partial<RibbonButton> = {},
	): RibbonButton {
		return { id, label, icon: iconName, run: ctx.commands[id], enabled: ctx.canEdit, ...extra };
	}

	function markButton(id: Command, label: string, mark: MarkType, shortcut: string): RibbonButton {
		return command(id, label, id === "inline-code" ? "code" : (id as RibbonButton["icon"]), {
			shortcut,
			pressed: () => ctx.canEdit() && ctx.session().editor.isMarkActive(mark),
		});
	}

	function styleActive(type: BlockType["type"], depth?: number): () => boolean {
		return () => {
			const current = ctx.session().editor.getBlockType();
			if (current === null || current.type !== type) return false;
			return current.type !== "heading" || current.depth === depth;
		};
	}

	const styleGallery = createStyleGallery(
		t.groupStyles,
		[
			{
				id: "normal",
				label: t.styleNormal,
				shortcut: `${MOD}+Alt+0`,
				active: styleActive("paragraph"),
				apply: ctx.commands.paragraph,
			},
			...([1, 2, 3] as const).map((depth) => ({
				id: `heading-${depth}`,
				label: format(t.heading, depth),
				shortcut: `${MOD}+Alt+${depth}`,
				active: styleActive("heading", depth),
				apply: ctx.commands[`heading-${depth}`],
			})),
			{ id: "quote", label: t.quote, active: styleActive("blockquote"), apply: ctx.commands.quote },
			{
				id: "code",
				label: t.styleCode,
				active: styleActive("code"),
				apply: ctx.commands["code-block"],
			},
		],
		ctx.canEdit,
	);

	const tablePicker = createTablePicker({
		label: t.table,
		dialogLabel: t.insertTable,
		sizeLabel: (rows, columns) => (rows === 0 ? t.insertTable : format(t.tableSize, rows, columns)),
		pick: (rows, columns) => ctx.edit((doc, caret) => insertTable(doc, caret, rows, columns)),
		enabled: ctx.canEdit,
	});

	const zoomReset = el("button", {
		class: "ribbon-button ribbon-zoom-value",
		attrs: { type: "button", "data-command": "zoom-reset", title: t.zoomReset },
	});
	zoomReset.addEventListener("mousedown", (event) => event.preventDefault());
	zoomReset.addEventListener("click", ctx.commands["zoom-reset"]);
	const zoomWidget: RibbonWidget = {
		kind: "widget",
		element: zoomReset,
		update() {
			zoomReset.textContent = `${ctx.settings().zoom}%`;
		},
	};

	function toggle(
		id: string,
		label: string,
		iconName: RibbonButton["icon"],
		isOn: () => boolean,
		run: () => void,
		showLabel = true,
	): RibbonButton {
		return { id, label, icon: iconName, showLabel, run, pressed: isOn };
	}

	function themeButton(theme: Settings["theme"], label: string, iconName: RibbonButton["icon"]) {
		return toggle(
			`theme-${theme}`,
			label,
			iconName,
			() => ctx.settings().theme === theme,
			() => ctx.updateSettings({ theme }),
			false,
		);
	}

	function tableButton(
		id: string,
		label: string,
		iconName: RibbonButton["icon"],
		change: Parameters<typeof ctx.editTable>[0],
		extra: Partial<RibbonButton> = {},
	): RibbonButton {
		return {
			id,
			label,
			icon: iconName,
			run: () => ctx.editTable(change),
			enabled: ctx.canEdit,
			...extra,
		};
	}

	function tableId(context: TableContext): string | undefined {
		return ctx.session().editor.getBlockIds()[context.blockIndex];
	}

	/** Column widths are stored by index, so they have to follow inserted and deleted columns. */
	function restyle(context: TableContext, change: (style: TableStyle) => TableStyle): void {
		const id = tableId(context);
		if (id !== undefined) ctx.session().setTableStyle(id, change(ctx.session().tableStyle(id)));
	}

	const COLUMN_WIDTH_STEP = 24;

	/** Changes the width of the caret's column by `delta` pixels; `null` makes it automatic again. */
	function resizeColumn(delta: number | null): void {
		if (!ctx.canEdit()) return;
		const context = currentTable();
		const id = context === null ? undefined : tableId(context);
		if (context === null || id === undefined) return;

		const style = ctx.session().tableStyle(id);
		if (delta === null) {
			ctx.session().setTableStyle(id, withColumnWidth(style, context.column, null));
			return;
		}
		const element = ctx.session().editor.getBlockElement(id);
		const header =
			element instanceof HTMLTableElement ? element.rows[0]?.cells[context.column] : undefined;
		const measured =
			header === undefined
				? 120
				: header.getBoundingClientRect().width / (ctx.settings().zoom / 100);
		const current = style.widths[context.column] ?? measured;
		ctx.session().setTableStyle(id, withColumnWidth(style, context.column, current + delta));
	}

	function sortButton(direction: SortDirection, label: string, iconName: RibbonButton["icon"]) {
		return tableButton(
			`table-sort-${direction}`,
			label,
			iconName,
			({ table, row, column }) => ({
				table: sortRows(table, column, direction, ctx.language),
				row,
				column,
			}),
			{ showLabel: true },
		);
	}

	const COLOR_LABELS: Record<TableColor, string> = {
		gray: t.colorGray,
		blue: t.colorBlue,
		teal: t.colorTeal,
		green: t.colorGreen,
		orange: t.colorOrange,
		red: t.colorRed,
		purple: t.colorPurple,
	};

	const tableColors = createSwatches<TableColor>({
		label: t.groupColor,
		noneLabel: t.colorNone,
		options: TABLE_COLORS.map((color) => ({ value: color, label: COLOR_LABELS[color] })),
		current: () => {
			const context = currentTable();
			const id = context === null ? undefined : tableId(context);
			return id === undefined ? null : ctx.session().tableStyle(id).color;
		},
		pick: (color) => {
			const context = currentTable();
			if (context !== null && ctx.canEdit()) restyle(context, (style) => ({ ...style, color }));
		},
		enabled: ctx.canEdit,
	});

	const textColors = createColorMenu({
		id: "text-color",
		icon: "textColor",
		label: t.textColor,
		noneLabel: t.textColorNone,
		colors: [
			{ value: "#e03131", label: t.colorRed },
			{ value: "#e8590c", label: t.colorOrange },
			{ value: "#f08c00", label: t.colorYellow },
			{ value: "#2f9e44", label: t.colorGreen },
			{ value: "#0c8599", label: t.colorTeal },
			{ value: "#1c7ed6", label: t.colorBlue },
			{ value: "#7950f2", label: t.colorPurple },
			{ value: "#d6336c", label: t.colorPink },
			{ value: "#868e96", label: t.colorGray },
		],
		current: () => ctx.session().editor.getColor(),
		customLabel: t.moreColors,
		pick: (color) => {
			if (!ctx.session().editor.setColor(color)) ctx.warn(t.selectTextFirst);
		},
		enabled: ctx.canEdit,
	});

	function alignButton(
		align: AlignType,
		label: string,
		iconName: RibbonButton["icon"],
	): RibbonButton {
		const isActive = (): boolean => {
			const context = currentTable();
			return context !== null && context.table.align[context.column] === align;
		};
		return tableButton(
			`table-align-${align}`,
			label,
			iconName,
			({ table, row, column }) => ({
				// Clicking the active alignment clears it.
				table: alignColumn(table, column, table.align[column] === align ? null : align),
				row,
				column,
			}),
			{ pressed: isActive },
		);
	}

	const ribbonTabs: RibbonTab[] = [
		{
			id: "home",
			label: t.tabHome,
			groups: [
				{
					label: t.groupClipboard,
					items: [
						{
							id: "paste",
							label: t.paste,
							icon: "paste",
							showLabel: true,
							shortcut: `${MOD}+V`,
							run: () => ctx.bridge.clipboard("paste"),
							enabled: ctx.canEdit,
						},
						{
							id: "cut",
							label: t.cut,
							icon: "cut",
							shortcut: `${MOD}+X`,
							run: () => ctx.bridge.clipboard("cut"),
							enabled: ctx.canEdit,
						},
						{
							id: "copy",
							label: t.copy,
							icon: "copy",
							shortcut: `${MOD}+C`,
							run: () => ctx.bridge.clipboard("copy"),
						},
					],
				},
				{ label: t.groupStyles, items: [styleGallery] },
				{
					label: t.groupFont,
					items: [
						markButton("bold", t.bold, "strong", `${MOD}+B`),
						markButton("italic", t.italic, "emphasis", `${MOD}+I`),
						markButton("strikethrough", t.strikethrough, "delete", `${MOD}+Shift+X`),
						markButton("inline-code", t.inlineCode, "inlineCode", `${MOD}+E`),
						textColors,
						{
							id: "change-case",
							label: t.changeCase,
							icon: "changeCase",
							run: () => {
								const button = document.querySelector('[data-command="change-case"]');
								const box = button?.getBoundingClientRect();
								if (box !== undefined) ctx.bridge.showCaseMenu(box.left, box.bottom);
							},
							enabled: ctx.canEdit,
						},
						{ kind: "separator" },
						command("link", t.link, "link", {
							shortcut: `${MOD}+K`,
							pressed: () => ctx.canEdit() && ctx.session().editor.getActiveLink() !== null,
						}),
					],
				},
				{
					label: t.groupParagraph,
					items: [
						command("bullet-list", t.bulletList, "bulletList", {
							shortcut: `${MOD}+Shift+8`,
							pressed: () => isList(false) && !isTaskList(),
						}),
						command("ordered-list", t.orderedList, "orderedList", {
							shortcut: `${MOD}+Shift+7`,
							pressed: () => isList(true),
						}),
						command("task-list", t.taskList, "taskList", { pressed: isTaskList }),
						{ kind: "separator" },
						command("outdent", t.outdent, "outdent", { shortcut: "Shift+Tab" }),
						command("indent", t.indent, "indent", { shortcut: "Tab" }),
						{ kind: "separator" },
						command("merge-blocks", t.mergeBlocks, "mergeBlocks", {
							shortcut: `${MOD}+Shift+M`,
							enabled: () => ctx.canEdit() && ctx.session().editor.canMergeBlocks(),
						}),
					],
				},
				{
					label: t.groupEditing,
					items: [
						{
							id: "find",
							label: t.find,
							icon: "find",
							shortcut: `${MOD}+F`,
							run: ctx.commands.find,
							enabled: () => !ctx.inSource(),
						},
						command("replace", t.replace, "replace", { shortcut: `${MOD}+H` }),
					],
				},
			],
		},
		{
			id: "insert",
			label: t.tabInsert,
			groups: [
				{
					label: t.groupElements,
					items: [
						command("image", t.image, "image", { showLabel: true }),
						command("attach-file", t.attachFile, "attach", { showLabel: true }),
						tablePicker,
						command("link", t.link, "link", { showLabel: true, shortcut: `${MOD}+K` }),
					],
				},
				{
					label: t.groupBlocks,
					items: [
						command("divider", t.divider, "divider", { showLabel: true }),
						command("code-block", t.codeBlock, "codeBlock", { showLabel: true }),
						command("quote", t.quote, "quote", { showLabel: true }),
						command("task-list", t.taskList, "taskList", { showLabel: true }),
					],
				},
				{
					label: t.groupImport,
					items: [
						{
							id: "import-word",
							label: t.wordDocument,
							icon: "word",
							showLabel: true,
							shortcut: `${MOD}+Shift+O`,
							run: () => void ctx.bridge.importWord(),
						},
						{
							id: "import-confluence",
							label: t.confluencePage,
							icon: "confluence",
							showLabel: true,
							run: () => void ctx.bridge.importConfluence(),
						},
					],
				},
			],
		},
		{
			id: "view",
			label: t.tabView,
			groups: [
				{
					label: t.groupViews,
					items: [
						toggle(
							"navigation",
							t.navigationPane,
							"navigation",
							() => ctx.settings().navigation,
							() => ctx.updateSettings({ navigation: !ctx.settings().navigation }),
						),
						{
							...toggle("source", t.markdownSource, "source", ctx.inSource, ctx.commands.source),
							shortcut: `${MOD}+Shift+M`,
						},
						toggle(
							"read-only",
							t.readOnly,
							"readOnly",
							() => ctx.session().editor.isReadOnly(),
							ctx.commands["read-only"],
						),
						{
							...toggle("focus", t.focusMode, "focus", () => ctx.focusMode(), ctx.commands.focus),
							shortcut: `${MOD}+Shift+F`,
						},
					],
				},
				{
					label: t.groupZoom,
					items: [
						{
							id: "zoom-out",
							label: t.zoomOut,
							icon: "zoomOut",
							shortcut: `${MOD}+-`,
							run: ctx.commands["zoom-out"],
							enabled: () => ctx.settings().zoom > MIN_ZOOM,
						},
						zoomWidget,
						{
							id: "zoom-in",
							label: t.zoomIn,
							icon: "zoomIn",
							shortcut: `${MOD}++`,
							run: ctx.commands["zoom-in"],
							enabled: () => ctx.settings().zoom < MAX_ZOOM,
						},
						{ kind: "separator" },
						toggle(
							"full-width",
							t.fullWidth,
							"fullWidth",
							() => ctx.settings().fullWidth,
							() => ctx.updateSettings({ fullWidth: !ctx.settings().fullWidth }),
							false,
						),
					],
				},
				{
					label: t.groupTheme,
					items: [
						themeButton("light", t.themeLight, "themeLight"),
						themeButton("dark", t.themeDark, "themeDark"),
						themeButton("system", t.themeSystem, "themeSystem"),
					],
				},
				{
					label: t.groupOptions,
					items: [
						toggle(
							"spell-check",
							t.spellCheck,
							"spellCheck",
							() => ctx.settings().spellCheck,
							() => ctx.updateSettings({ spellCheck: !ctx.settings().spellCheck }),
						),
						toggle(
							"auto-save",
							t.autoSave,
							"autoSave",
							() => ctx.settings().autoSave,
							() => ctx.updateSettings({ autoSave: !ctx.settings().autoSave }),
						),
					],
				},
			],
		},
		{
			id: "table",
			label: t.tabTable,
			visible: () => currentTable() !== null,
			groups: [
				{
					label: t.groupRows,
					items: [
						tableButton("table-row-above", t.rowAbove, "rowAbove", ({ table, row, column }) => ({
							table: insertRow(table, row),
							row,
							column,
						})),
						tableButton("table-row-below", t.rowBelow, "rowBelow", ({ table, row, column }) => ({
							table: insertRow(table, row + 1),
							row: row + 1,
							column,
						})),
						tableButton("table-delete-row", t.deleteRow, "deleteRow", ({ table, row, column }) => ({
							table: deleteRow(table, row),
							row: Math.max(0, row - 1),
							column,
						})),
					],
				},
				{
					label: t.groupColumns,
					items: [
						tableButton("table-column-left", t.columnLeft, "columnLeft", (context) => {
							restyle(context, (style) => withColumnInserted(style, context.column));
							return {
								table: insertColumn(context.table, context.column),
								row: context.row,
								column: context.column,
							};
						}),
						tableButton("table-column-right", t.columnRight, "columnRight", (context) => {
							restyle(context, (style) => withColumnInserted(style, context.column + 1));
							return {
								table: insertColumn(context.table, context.column + 1),
								row: context.row,
								column: context.column + 1,
							};
						}),
						tableButton("table-delete-column", t.deleteColumn, "deleteColumn", (context) => {
							restyle(context, (style) => withColumnDeleted(style, context.column));
							return {
								table: deleteColumn(context.table, context.column),
								row: context.row,
								column: Math.max(0, context.column - 1),
							};
						}),
					],
				},
				{
					label: t.groupColumnWidth,
					items: [
						{
							id: "table-column-narrow",
							label: t.narrowColumn,
							icon: "columnNarrow",
							run: () => resizeColumn(-COLUMN_WIDTH_STEP),
							enabled: ctx.canEdit,
						},
						{
							id: "table-column-widen",
							label: t.widenColumn,
							icon: "columnWiden",
							run: () => resizeColumn(COLUMN_WIDTH_STEP),
							enabled: ctx.canEdit,
						},
						{
							id: "table-column-auto",
							label: t.autoColumnWidth,
							icon: "columnAuto",
							run: () => resizeColumn(null),
							enabled: ctx.canEdit,
						},
					],
				},
				{
					label: t.groupAlignment,
					items: [
						alignButton("left", t.alignLeft, "alignLeft"),
						alignButton("center", t.alignCenter, "alignCenter"),
						alignButton("right", t.alignRight, "alignRight"),
					],
				},
				{
					label: t.groupSort,
					items: [
						sortButton("ascending", t.sortAscending, "sortAscending"),
						sortButton("descending", t.sortDescending, "sortDescending"),
					],
				},
				{ label: t.groupColor, items: [tableColors] },
				{
					label: t.table,
					items: [
						tableButton(
							"table-delete",
							t.deleteTable,
							"deleteTable",
							() => ({ table: null, row: 0, column: 0 }),
							{ showLabel: true },
						),
					],
				},
			],
		},
		{
			id: "code",
			label: t.tabCode,
			visible: inCodeBlock,
			groups: [
				{
					label: t.groupCode,
					items: [
						command("format-code", t.formatCode, "braces", {
							showLabel: true,
							shortcut: "Shift+Alt+F",
						}),
						command("format-all-code", t.formatAllCode, "bracesAll", { showLabel: true }),
					],
				},
			],
		},
	];

	return createRibbon(host, {
		label: t.ribbon,
		fileButton: { label: t.file, open: (x, y) => ctx.bridge.showFileMenu(x, y) },
		quickAccess: {
			label: t.quickAccess,
			buttons: [
				{ id: "save", label: t.save, icon: "save", shortcut: `${MOD}+S`, run: ctx.commands.save },
				{
					id: "undo",
					label: t.undo,
					icon: "undo",
					shortcut: `${MOD}+Z`,
					run: ctx.commands.undo,
					enabled: () => ctx.canEdit() && ctx.session().editor.canUndo(),
				},
				{
					id: "redo",
					label: t.redo,
					icon: "redo",
					shortcut: `${MOD}+Y`,
					run: ctx.commands.redo,
					enabled: () => ctx.canEdit() && ctx.session().editor.canRedo(),
				},
			],
		},
		tabs: ribbonTabs,
		trailing,
	});
}
