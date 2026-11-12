import { randomUUID } from "node:crypto";
import type { MenuItemConstructorOptions, WebContents } from "electron";
import { app, BrowserWindow, Menu, session, shell } from "electron";
import type { Command, PaletteCommand, Settings, TabDocument } from "../shared/bridge.js";
import { CHANNEL, PAGE_SIZES } from "../shared/bridge.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { QUICK_NOTE_SHORTCUT } from "./tray.js";
import type { AppWindow, WindowManager } from "./windows.js";

export interface MenuContext {
	readonly windows: WindowManager;
	readonly t: Strings;
	readonly settings: Settings;
	readonly recentFiles: readonly string[];
	/** The folder opened with Open Folder. */
	readonly workspaces: readonly string[];
	openFolder(win: AppWindow | undefined): void;
	closeFolder(): void;
	changeSettings(patch: Partial<Settings>): void;
	changeLanguage(language: Lang | null): void;
	clearRecentFiles(): void;
	exportPdf(doc: AppWindow): void;
	print(doc: AppWindow): void;
	showAbout(): void;
	checkForUpdates(): void;
	quickNote(): void;
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
		{ label: t.newFromTemplate, click: send(ctx, "new-from-template") },
		{ label: t.newWindow, accelerator: "CmdOrCtrl+Shift+N", click: () => void windows.open() },
		{
			label: t.quickNote,
			accelerator: QUICK_NOTE_SHORTCUT,
			// With the tray on, the shortcut is registered system-wide instead.
			registerAccelerator: !ctx.settings.tray,
			click: () => ctx.quickNote(),
		},
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
		{
			label: ctx.workspaces.length > 1 ? t.closeAllFolders : t.closeFolder,
			enabled: ctx.workspaces.length > 0,
			click: () => ctx.closeFolder(),
		},
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
		{ label: t.confluenceOpen, click: send(ctx, "confluence-open") },
		{ label: t.publishMenu, click: send(ctx, "publish-confluence") },
		{ label: t.changesCommand, click: send(ctx, "confluence-changes") },
		{ label: t.confluenceAttachmentsMenu, click: send(ctx, "confluence-attachments") },
		{ label: t.jiraMenu, click: send(ctx, "jira-open") },
		{
			label: t.importConfluence,
			click: (_item, window) => void windows.showConfluenceDialog(targetOf(ctx, window)),
		},
		{
			label: t.export,
			submenu: [
				{ label: t.exportHtml, click: send(ctx, "export-html") },
				{ label: t.exportDocx, click: send(ctx, "export-docx") },
				{ label: t.exportConfluence, click: send(ctx, "export-confluence") },
				{ label: t.exportConfluenceWiki, click: send(ctx, "export-confluence-wiki") },
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
		// On macOS the shortcut is on the app menu's entry, where Mac apps keep it.
		{
			label: t.settingsMenu,
			...(isMac ? {} : { accelerator: "CmdOrCtrl+," }),
			click: send(ctx, "settings"),
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

/** macOS's app menu, as Electron's `appMenu` role makes it, with the settings where Mac apps have them. */
function appMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions {
	return {
		label: app.name,
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ label: ctx.t.settingsMenu, accelerator: "Cmd+,", click: send(ctx, "settings") },
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		],
	};
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
		...(isMac ? [appMenuTemplate(ctx)] : []),
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
				{ label: t.diagramInsert, click: send(ctx, "diagram") },
				{ label: t.table, click: send(ctx, "table") },
				{ label: `${t.link}…`, ...editorShortcut("CmdOrCtrl+K"), click: send(ctx, "link") },
				{ type: "separator" },
				{ label: t.divider, click: send(ctx, "divider") },
				{ label: t.codeBlock, click: send(ctx, "code-block") },
				{ label: t.quote, click: send(ctx, "quote") },
				{ label: t.taskList, click: send(ctx, "task-list") },
				{ type: "separator" },
				{ label: t.noteNewMenu, accelerator: "CmdOrCtrl+Alt+M", click: send(ctx, "note-new") },
				{ label: t.notePrevious, click: send(ctx, "note-previous") },
				{ label: t.noteNext, click: send(ctx, "note-next") },
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
				{ label: t.changeCase, submenu: caseMenuTemplate(ctx) },
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
				{ label: t.commandPalette, accelerator: "F1", click: send(ctx, "command-palette") },
				{ type: "separator" },
				{
					label: t.navigationPane,
					type: "checkbox",
					checked: settings.navigation,
					click: () => ctx.changeSettings({ navigation: !settings.navigation }),
				},
				{
					label: t.assistantPane,
					type: "checkbox",
					checked: settings.assistant,
					accelerator: "CmdOrCtrl+Shift+L",
					click: send(ctx, "assistant"),
				},
				{
					label: t.markdownSource,
					...editorShortcut("CmdOrCtrl+Shift+M"),
					click: send(ctx, "source"),
				},
				{ label: t.readOnly, click: send(ctx, "read-only") },
				{
					label: t.localNotes,
					type: "checkbox",
					checked: settings.localNotes,
					click: () => ctx.changeSettings({ localNotes: !settings.localNotes }),
				},
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
				{ label: t.moveTabToWindow, click: send(ctx, "move-tab") },
				{ label: t.previousTab, accelerator: "Ctrl+Shift+Tab", click: send(ctx, "previous-tab") },
				{ type: "separator" },
				{ label: t.fullScreen, role: "togglefullscreen" },
				...(isMac
					? []
					: [
							{
								label: t.runInTray,
								type: "checkbox",
								checked: settings.tray,
								click: () => ctx.changeSettings({ tray: !settings.tray }),
							} satisfies MenuItemConstructorOptions,
						]),
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
				{ type: "separator" },
				{ label: t.checkForUpdates, click: () => ctx.checkForUpdates() },
				{
					label: t.checkUpdatesAutomatically,
					type: "checkbox",
					checked: settings.checkUpdates,
					click: () => ctx.changeSettings({ checkUpdates: !settings.checkUpdates }),
				},
				...(isMac ? [] : [{ label: t.about, click: () => ctx.showAbout() }]),
			],
		},
	];
}

export function installMenu(ctx: MenuContext): void {
	Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(ctx)));
}

function caseMenuTemplate(ctx: MenuContext): MenuItemConstructorOptions[] {
	const { t } = ctx;
	return [
		{ label: t.caseSentence, click: send(ctx, "case-sentence") },
		{ label: t.caseLower, click: send(ctx, "case-lower") },
		{ label: t.caseUpper, click: send(ctx, "case-upper") },
		{ label: t.caseTitle, click: send(ctx, "case-title") },
		{ label: t.caseToggle, click: send(ctx, "case-toggle") },
		{ type: "separator" },
		{ label: t.caseCycle, ...editorShortcut("Shift+F3"), click: send(ctx, "case-cycle") },
		{ type: "separator" },
		{ label: t.collapseSpaces, click: send(ctx, "collapse-spaces") },
	];
}

export function popupCaseMenu(ctx: MenuContext, win: AppWindow, x: number, y: number): void {
	Menu.buildFromTemplate(caseMenuTemplate(ctx)).popup({
		window: win.window,
		x: Math.round(x),
		y: Math.round(y),
	});
}

export function popupTabMenu(
	ctx: MenuContext,
	win: AppWindow,
	tabId: string,
	x: number,
	y: number,
): void {
	const { t } = ctx;
	const action = (name: "move" | "close") => () =>
		win.window.webContents.send(CHANNEL.tabMenu, tabId, name);
	Menu.buildFromTemplate([
		{ label: t.moveTabToWindow, enabled: win.tabs.size > 1, click: action("move") },
		{ type: "separator" },
		{ label: t.closeTab, click: action("close") },
	]).popup({ window: win.window, x: Math.round(x), y: Math.round(y) });
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
			// Chromium sees no selection when the editor has blocks selected (it keeps
			// that selection itself), so its canCut/canCopy would disable them. With
			// nothing selected they do nothing.
			{ label: t.cut, role: "cut" },
			{ label: t.copy, role: "copy" },
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
	// A note of the user's own on the words: read-only documents take them too.
	if (params.isEditable || params.selectionText.trim() !== "") {
		items.push(
			{ type: "separator" },
			{
				label: t.noteNewMenu,
				accelerator: "CmdOrCtrl+Alt+M",
				click: () => contents.send(CHANNEL.command, "note-new" satisfies Command),
			},
		);
	}

	if (items.length === 0) return;
	const window = BrowserWindow.fromWebContents(contents);
	Menu.buildFromTemplate(items).popup(window === null ? {} : { window });
}

/** An accelerator as the menu shows it on this system: "Ctrl+Shift+S", "Cmd+Shift+S". */
function shownAccelerator(accelerator: string | null | undefined): string {
	if (accelerator === undefined || accelerator === null) return "";
	return accelerator
		.replace(/CommandOrControl|CmdOrCtrl/g, isMac ? "Cmd" : "Ctrl")
		.replace(/\bCommand\b/g, "Cmd")
		.replace(/\bControl\b/g, "Ctrl")
		.replace(/\bPlus\b/g, "+");
}

/**
 * Every command of the application menu, for the command palette: the
 * items that do something (not submenus, separators, hidden or disabled
 * ones), each with the menus it is under and its shortcut. The id is its
 * place in the menu, which `runPaletteCommand` finds it by.
 */
export function paletteCommands(): PaletteCommand[] {
	const menu = Menu.getApplicationMenu();
	if (menu === null) return [];
	const found: PaletteCommand[] = [];
	const walk = (items: readonly Electron.MenuItem[], path: string[], ids: number[]): void => {
		items.forEach((item, index) => {
			if (!item.visible || item.type === "separator") return;
			const label = item.label.replace(/&/g, "");
			if (item.submenu !== undefined && item.submenu !== null) {
				walk(item.submenu.items, [...path, label], [...ids, index]);
				return;
			}
			if (!item.enabled || label === "") return;
			found.push({
				id: [...ids, index].join("."),
				label,
				group: path.join(" › "),
				accelerator: shownAccelerator(item.accelerator),
				checked: item.type === "checkbox" || item.type === "radio" ? item.checked : null,
			});
		});
	};
	walk(menu.items, [], []);
	return found;
}

/** Runs the menu item a palette command names, as a click on it in `window` would. */
export function runPaletteCommand(id: string, window: BrowserWindow): void {
	let items = Menu.getApplicationMenu()?.items ?? [];
	let item: Electron.MenuItem | undefined;
	for (const part of id.split(".")) {
		item = items[Number(part)];
		if (item === undefined) return;
		items = item.submenu?.items ?? [];
	}
	if (item === undefined || !item.enabled || item.submenu) return;
	item.click(undefined, window, window.webContents);
}
