import { randomUUID } from "node:crypto";
import type { MenuItemConstructorOptions, WebContents } from "electron";
import { app, BrowserWindow, Menu, session, shell } from "electron";
import type { Command, Settings, TabDocument } from "../shared/bridge.js";
import { CHANNEL, PAGE_SIZES } from "../shared/bridge.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { AppWindow, WindowManager } from "./windows.js";

export interface MenuContext {
	readonly windows: WindowManager;
	readonly t: Strings;
	readonly settings: Settings;
	readonly recentFiles: readonly string[];
	/** The folder opened with Open Folder. */
	readonly workspace: string | null;
	openFolder(win: AppWindow | undefined): void;
	closeFolder(): void;
	changeSettings(patch: Partial<Settings>): void;
	changeLanguage(language: Lang | null): void;
	clearRecentFiles(): void;
	exportPdf(doc: AppWindow): void;
	print(doc: AppWindow): void;
	showAbout(): void;
}

type Click = NonNullable<MenuItemConstructorOptions["click"]>;

export function welcomeDocument(): TabDocument {
	return { tabId: randomUUID(), payload: { kind: "welcome" } };
}

const isMac = process.platform === "darwin";

function targetOf(ctx: MenuContext, window: Parameters<Click>[1]): AppWindow | undefined {
	const target = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow();
	return target === null ? undefined : ctx.windows.get(target.webContents);
}

function send(ctx: MenuContext, command: Command): Click {
	return (_item, window) => {
		targetOf(ctx, window)?.window.webContents.send(CHANNEL.command, command);
	};
}

function withWindow(ctx: MenuContext, action: (doc: AppWindow) => void): Click {
	return (_item, window) => {
		const doc = targetOf(ctx, window);
		if (doc !== undefined) action(doc);
	};
}

/**
 * Shortcut the editor handles itself. It is shown in the menu but not
 * registered, otherwise one key press would run the command twice.
 */
function editorShortcut(
	accelerator: string,
): Pick<MenuItemConstructorOptions, "accelerator" | "registerAccelerator"> {
	return { accelerator, registerAccelerator: false };
}

/** Shared by the menu bar and the ribbon's "File" button. */
export function fileMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
	const { t, windows } = ctx;

	const recent: MenuItemConstructorOptions[] =
		ctx.recentFiles.length === 0
			? [{ label: t.noRecent, enabled: false }]
			: [
					...ctx.recentFiles.map(
						(path): MenuItemConstructorOptions => ({
							// `&` marks a mnemonic on Windows.
							label: path.replace(/&/g, "&&"),
							click: (_item, window) => void windows.openPath(path, targetOf(ctx, window)),
						}),
					),
					{ type: "separator" },
					{ label: t.clearRecent, click: () => ctx.clearRecentFiles() },
				];

	return [
		{
			label: t.new,
			accelerator: "CmdOrCtrl+N",
			click: (_item, window) => {
				const win = targetOf(ctx, window);
				if (win === undefined) windows.open();
				else windows.addTab(win, { kind: "empty" }, false);
			},
		},
		{ label: t.newWindow, accelerator: "CmdOrCtrl+Shift+N", click: () => void windows.open() },
		{
			label: t.open,
			accelerator: "CmdOrCtrl+O",
			click: (_item, window) => void windows.showOpenDialog(targetOf(ctx, window)),
		},
		{ label: t.openRecent, submenu: recent },
		{
			label: t.quickOpen,
			accelerator: "CmdOrCtrl+Shift+P",
			click: send(ctx, "quick-open"),
		},
		{ type: "separator" },
		{
			label: t.openFolder,
			click: (_item, window) => ctx.openFolder(targetOf(ctx, window)),
		},
		{ label: t.closeFolder, enabled: ctx.workspace !== null, click: () => ctx.closeFolder() },
		{ type: "separator" },
		{ label: t.save, accelerator: "CmdOrCtrl+S", click: send(ctx, "save") },
		{ label: t.saveAs, accelerator: "CmdOrCtrl+Shift+S", click: send(ctx, "save-as") },
		{ label: t.saveAsPackage, click: send(ctx, "save-as-package") },
		{ label: t.versionHistory, click: send(ctx, "version-history") },
		{ type: "separator" },
		{
			label: t.importWord,
			accelerator: "CmdOrCtrl+Shift+O",
			click: (_item, window) => void windows.showWordDialog(targetOf(ctx, window)),
		},
		{
			label: t.export,
			submenu: [
				{ label: t.exportHtml, click: send(ctx, "export-html") },
				{ label: t.exportDocx, click: send(ctx, "export-docx") },
				{ label: t.exportPdf, click: withWindow(ctx, (win) => ctx.exportPdf(win)) },
			],
		},
		{ label: t.pageSetup, submenu: pageSetupTemplate(ctx) },
		{
			label: t.print,
			accelerator: "CmdOrCtrl+P",
			click: withWindow(ctx, (win) => ctx.print(win)),
		},
		{ type: "separator" },
		{
			label: t.showInFolder,
			click: withWindow(ctx, (win) => {
				const path = windows.activeTab(win)?.path ?? null;
				if (path !== null) shell.showItemInFolder(path);
			}),
		},
		{ type: "separator" },
		{ label: t.closeTab, accelerator: "CmdOrCtrl+W", click: send(ctx, "close-tab") },
		{ label: t.closeWindow, accelerator: "CmdOrCtrl+Shift+W", role: "close" },
		...(isMac ? [] : [{ label: t.quit, role: "quit" } satisfies MenuItemConstructorOptions]),
	];
}

function pageSetupTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
	const { t, settings } = ctx;
	const radio = <K extends keyof Settings>(
		key: K,
		value: Settings[K],
		label: string,
	): MenuItemConstructorOptions => ({
		label,
		type: "radio",
		checked: settings[key] === value,
		click: () => ctx.changeSettings({ [key]: value }),
	});

	return [
		{ label: t.pageSize, submenu: PAGE_SIZES.map((size) => radio("pageSize", size, size)) },
		{
			label: t.orientation,
			submenu: [radio("landscape", false, t.portrait), radio("landscape", true, t.landscape)],
		},
		{
			label: t.margins,
			submenu: [
				radio("margins", "normal", t.marginsNormal),
				radio("margins", "narrow", t.marginsNarrow),
				radio("margins", "wide", t.marginsWide),
			],
		},
		{ type: "separator" },
		{
			label: t.pageNumbers,
			type: "checkbox",
			checked: settings.pageNumbers,
			click: () => ctx.changeSettings({ pageNumbers: !settings.pageNumbers }),
		},
	];
}

function menuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
	const { t, settings } = ctx;

	const headings = ([1, 2, 3, 4, 5, 6] as const).map(
		(level): MenuItemConstructorOptions => ({
			label: format(t.heading, level),
			...editorShortcut(`CmdOrCtrl+Alt+${level}`),
			click: send(ctx, `heading-${level}`),
		}),
	);

	const themes = (
		[
			["light", t.themeLight],
			["dark", t.themeDark],
			["system", t.themeSystem],
		] as const
	).map(
		([theme, label]): MenuItemConstructorOptions => ({
			label,
			type: "radio",
			checked: settings.theme === theme,
			click: () => ctx.changeSettings({ theme }),
		}),
	);

	const languages = (
		[
			[null, t.languageSystem],
			["tr", "Türkçe"],
			["en", "English"],
		] as const
	).map(
		([language, label]): MenuItemConstructorOptions => ({
			label,
			type: "radio",
			checked: settings.language === language,
			click: () => ctx.changeLanguage(language),
		}),
	);

	return [
		...(isMac ? [{ role: "appMenu" } satisfies MenuItemConstructorOptions] : []),
		{ label: t.file, submenu: fileMenuTemplate(ctx) },
		{
			label: t.edit,
			submenu: [
				{ label: t.undo, ...editorShortcut("CmdOrCtrl+Z"), click: send(ctx, "undo") },
				{
					label: t.redo,
					...editorShortcut(isMac ? "Shift+Cmd+Z" : "Ctrl+Y"),
					click: send(ctx, "redo"),
				},
				{ type: "separator" },
				{ label: t.cut, role: "cut" },
				{ label: t.copy, role: "copy" },
				{ label: t.paste, role: "paste" },
				{
					label: t.pastePlain,
					...editorShortcut("CmdOrCtrl+Shift+V"),
					click: send(ctx, "paste-plain"),
				},
				{ label: t.selectAll, role: "selectAll" },
				{ type: "separator" },
				{ label: `${t.find}…`, accelerator: "CmdOrCtrl+F", click: send(ctx, "find") },
				{ label: `${t.replace}…`, accelerator: "CmdOrCtrl+H", click: send(ctx, "replace") },
				{
					label: t.searchFolder,
					accelerator: "CmdOrCtrl+Shift+E",
					click: send(ctx, "search-folder"),
				},
			],
		},
		{
			label: t.insert,
			submenu: [
				{ label: `${t.image}…`, click: send(ctx, "image") },
				{ label: `${t.attachFile}…`, click: send(ctx, "attach-file") },
				{ label: t.table, click: send(ctx, "table") },
				{ label: `${t.link}…`, ...editorShortcut("CmdOrCtrl+K"), click: send(ctx, "link") },
				{ type: "separator" },
				{ label: t.divider, click: send(ctx, "divider") },
				{ label: t.codeBlock, click: send(ctx, "code-block") },
				{ label: t.quote, click: send(ctx, "quote") },
				{ label: t.taskList, click: send(ctx, "task-list") },
			],
		},
		{
			label: t.format,
			submenu: [
				{ label: t.bold, ...editorShortcut("CmdOrCtrl+B"), click: send(ctx, "bold") },
				{ label: t.italic, ...editorShortcut("CmdOrCtrl+I"), click: send(ctx, "italic") },
				{
					label: t.strikethrough,
					...editorShortcut("CmdOrCtrl+Shift+X"),
					click: send(ctx, "strikethrough"),
				},
				{ label: t.inlineCode, ...editorShortcut("CmdOrCtrl+E"), click: send(ctx, "inline-code") },
				{ type: "separator" },
				{
					label: t.normalText,
					...editorShortcut("CmdOrCtrl+Alt+0"),
					click: send(ctx, "paragraph"),
				},
				...headings,
				{ type: "separator" },
				{
					label: t.bulletList,
					...editorShortcut("CmdOrCtrl+Shift+8"),
					click: send(ctx, "bullet-list"),
				},
				{
					label: t.orderedList,
					...editorShortcut("CmdOrCtrl+Shift+7"),
					click: send(ctx, "ordered-list"),
				},
				{ label: t.indent, ...editorShortcut("Tab"), click: send(ctx, "indent") },
				{ label: t.outdent, ...editorShortcut("Shift+Tab"), click: send(ctx, "outdent") },
				{
					label: t.mergeBlocks,
					accelerator: "CmdOrCtrl+Shift+M",
					click: send(ctx, "merge-blocks"),
				},
				{ type: "separator" },
				{ label: t.formatCode, accelerator: "Shift+Alt+F", click: send(ctx, "format-code") },
				{ label: t.formatAllCode, click: send(ctx, "format-all-code") },
			],
		},
		{
			label: t.view,
			submenu: [
				{
					label: t.navigationPane,
					type: "checkbox",
					checked: settings.navigation,
					click: () => ctx.changeSettings({ navigation: !settings.navigation }),
				},
				{
					label: t.markdownSource,
					...editorShortcut("CmdOrCtrl+Shift+M"),
					click: send(ctx, "source"),
				},
				{ label: t.readOnly, click: send(ctx, "read-only") },
				{ label: t.focusMode, accelerator: "CmdOrCtrl+Shift+F", click: send(ctx, "focus") },
				{ type: "separator" },
				{ label: t.zoomIn, accelerator: "CmdOrCtrl+=", click: send(ctx, "zoom-in") },
				{ label: t.zoomOut, accelerator: "CmdOrCtrl+-", click: send(ctx, "zoom-out") },
				{ label: t.zoomReset, accelerator: "CmdOrCtrl+0", click: send(ctx, "zoom-reset") },
				{
					label: t.fullWidth,
					type: "checkbox",
					checked: settings.fullWidth,
					click: () => ctx.changeSettings({ fullWidth: !settings.fullWidth }),
				},
				{ type: "separator" },
				{ label: t.theme, submenu: themes },
				{ label: t.language, submenu: languages },
				{ type: "separator" },
				{
					label: t.spellCheck,
					type: "checkbox",
					checked: settings.spellCheck,
					click: () => ctx.changeSettings({ spellCheck: !settings.spellCheck }),
				},
				{
					label: t.autoSave,
					type: "checkbox",
					checked: settings.autoSave,
					click: () => ctx.changeSettings({ autoSave: !settings.autoSave }),
				},
				{ type: "separator" },
				{ label: t.nextTab, accelerator: "Ctrl+Tab", click: send(ctx, "next-tab") },
				{ label: t.previousTab, accelerator: "Ctrl+Shift+Tab", click: send(ctx, "previous-tab") },
				{ type: "separator" },
				{ label: t.fullScreen, role: "togglefullscreen" },
				...(app.isPackaged
					? []
					: [{ label: t.devTools, role: "toggleDevTools" } satisfies MenuItemConstructorOptions]),
			],
		},
		{
			label: t.help,
			role: "help",
			submenu: [
				{
					label: t.welcomeDocument,
					click: (_item, window) => {
						const win = targetOf(ctx, window);
						if (win === undefined) ctx.windows.open([welcomeDocument()]);
						else ctx.windows.addTab(win, { kind: "welcome" });
					},
				},
				...(isMac ? [] : [{ label: t.about, click: () => ctx.showAbout() }]),
			],
		},
	];
}

export function installMenu(ctx: MenuContext): void {
	Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(ctx)));
}

export function popupFileMenu(ctx: MenuContext, win: AppWindow, x: number, y: number): void {
	Menu.buildFromTemplate(fileMenuTemplate(ctx)).popup({
		window: win.window,
		x: Math.round(x),
		y: Math.round(y),
	});
}

/** Electron shows no context menu by default, so spelling suggestions need one. */
export function popupContextMenu(
	t: Strings,
	contents: WebContents,
	params: Electron.ContextMenuParams,
): void {
	const items: MenuItemConstructorOptions[] = [];

	if (params.misspelledWord !== "") {
		if (params.dictionarySuggestions.length === 0) {
			items.push({ label: t.noSuggestions, enabled: false });
		}
		for (const suggestion of params.dictionarySuggestions) {
			items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
		}
		items.push({
			label: t.addToDictionary,
			click: () => session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord),
		});
		items.push({ type: "separator" });
	}

	if (params.isEditable) {
		items.push(
			{ label: t.cut, role: "cut", enabled: params.editFlags.canCut },
			{ label: t.copy, role: "copy", enabled: params.editFlags.canCopy },
			{ label: t.paste, role: "paste", enabled: params.editFlags.canPaste },
			{
				label: t.pastePlain,
				enabled: params.editFlags.canPaste,
				click: () => contents.send(CHANNEL.command, "paste-plain" satisfies Command),
			},
			{ type: "separator" },
			{ label: t.selectAll, role: "selectAll" },
		);
	} else if (params.selectionText.trim() !== "") {
		items.push({ label: t.copy, role: "copy" });
	}

	if (items.length === 0) return;
	const window = BrowserWindow.fromWebContents(contents);
	Menu.buildFromTemplate(items).popup(window === null ? {} : { window });
}
