import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	app,
	BrowserWindow,
	dialog,
	globalShortcut,
	nativeTheme,
	safeStorage,
	session,
} from "electron";
import type { Draft, Settings } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format, pickLanguage, stringsFor } from "../shared/i18n.js";
import { quickNoteName } from "../shared/notes.js";
import { isEditablePath, isPackagePath, isWordPath } from "../shared/paths.js";
import { confluenceClient } from "./confluence-ipc.js";
import { ConfluenceStore } from "./confluence-store.js";
import { DraftStore } from "./drafts.js";
import { VersionStore } from "./history.js";
import { registerIpc } from "./ipc.js";
import type { MenuContext } from "./menu.js";
import {
	installMenu,
	popupCaseMenu,
	popupContextMenu,
	popupFileMenu,
	popupTabMenu,
	welcomeDocument,
} from "./menu.js";
import { PackageStore } from "./package.js";
import { handleDocumentScheme, registerDocumentScheme } from "./protocol.js";
import { SettingsStore } from "./settings.js";
import { TrayIcon } from "./tray.js";
import { Updater } from "./updater.js";
import type { AppWindow } from "./windows.js";
import { errorMessage, WindowManager } from "./windows.js";

// Lets end-to-end tests run against a throwaway profile. The single-instance
// lock is tied to this folder, so tests do not collide with a running app.
const userDataDir = process.env.KALEM_USER_DATA_DIR;
if (userDataDir !== undefined && userDataDir !== "") {
	app.setPath("userData", resolve(userDataDir));
}

registerDocumentScheme();

const NEW_WINDOW_FLAG = "--new-window";

const PAGE_NUMBER_FOOTER =
	'<div style="width:100%;font:9px sans-serif;color:#555;text-align:center">' +
	'<span class="pageNumber"></span> / <span class="totalPages"></span></div>';

function documentArguments(argv: readonly string[], cwd: string): string[] {
	return argv
		.slice(1)
		.filter((arg) => !arg.startsWith("-") && (isEditablePath(arg) || isWordPath(arg)))
		.map((arg) => resolve(cwd, arg));
}

function start(): void {
	const store = new SettingsStore(join(app.getPath("userData"), "settings.json"));
	const drafts = new DraftStore(join(app.getPath("userData"), "drafts"));
	const packages = new PackageStore(join(app.getPath("userData"), "packages"));
	const confluence = new ConfluenceStore(join(app.getPath("userData"), "confluence.json"), {
		encrypt: (text) =>
			safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : null,
		decrypt: (data) => safeStorage.decryptString(data),
	});
	// End-to-end tests keep every save as its own version.
	const versionInterval = Number(process.env.KALEM_VERSION_INTERVAL);
	const versions = new VersionStore(
		join(app.getPath("userData"), "history"),
		Number.isFinite(versionInterval) && process.env.KALEM_VERSION_INTERVAL !== ""
			? versionInterval
			: undefined,
	);

	// Resolved once at startup; a language change applies after a restart.
	let language: Lang = "en";
	let t: Strings = stringsFor(language);

	/** macOS "open with" requests that arrive before the app is ready. */
	const queuedFiles: string[] = [];
	let ready = false;

	const updater = new Updater({
		store,
		strings: () => t,
		window: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
	});

	/** A dated note in the open folder, or in Documents; nothing is written until it is saved. */
	async function quickNote(): Promise<void> {
		const folder = store.state.workspace ?? join(app.getPath("documents"), t.quickNotesFolder);
		await mkdir(folder, { recursive: true });
		const name = quickNoteName(t.quickNoteName, new Date(), (candidate) =>
			existsSync(join(folder, `${candidate}.md`)),
		);
		const win = windows.open([
			{
				tabId: randomUUID(),
				payload: { kind: "new-file", path: join(folder, `${name}.md`), name },
			},
		]);
		win.window.focus();
	}

	function showWindow(): void {
		const window = BrowserWindow.getAllWindows()[0];
		if (window === undefined) {
			windows.open();
			return;
		}
		if (window.isMinimized()) window.restore();
		window.show();
		window.focus();
	}

	const tray = new TrayIcon({
		strings: () => t,
		quickNote: () => void quickNote(),
		newWindow: () => void windows.open(),
		show: showWindow,
		quit: () => app.quit(),
	});

	const windows: WindowManager = new WindowManager({
		store,
		drafts,
		packages,
		preloadPath: join(__dirname, "preload.cjs"),
		devUrl: process.env.KALEM_DEV_URL || null,
		rendererFile: join(__dirname, "..", "renderer", "index.html"),
		strings: () => t,
		language: () => language,
		onRecentFilesChanged: () => refreshMenu(),
		showContextMenu: (contents, params) => popupContextMenu(t, contents, params),
	});

	function applySpellCheck(): void {
		const defaultSession = session.defaultSession;
		defaultSession.setSpellCheckerEnabled(store.settings.spellCheck);
		// macOS uses the system spell checker and detects the language itself.
		if (process.platform === "darwin") return;
		const wanted = language === "tr" ? ["tr", "en-US"] : ["en-US"];
		const available = new Set(defaultSession.availableSpellCheckerLanguages);
		try {
			defaultSession.setSpellCheckerLanguages(wanted.filter((code) => available.has(code)));
		} catch (error) {
			console.warn("Spell checker languages could not be set:", error);
		}
	}

	function changeSettings(patch: Partial<Settings>): void {
		store.updateSettings(patch);
		tray.apply(store.settings.tray);
		nativeTheme.themeSource = store.settings.theme;
		applySpellCheck();
		windows.broadcastSettings(store.settings);
		refreshMenu();
	}

	function changeLanguage(next: Lang | null): void {
		store.updateSettings({ language: next });
		refreshMenu();
		if ((next ?? pickLanguage(app.getLocale())) === language) return;

		void dialog
			.showMessageBox({
				type: "info",
				message: t.languageRestart,
				buttons: [t.restart, t.later],
				defaultId: 0,
				cancelId: 1,
				noLink: true,
			})
			.then(({ response }) => {
				if (response !== 0) return;
				app.relaunch();
				app.quit();
			});
	}

	/** The window's background shows through the page margins; paper is white. */
	async function onPaper<T>(win: AppWindow, print: () => Promise<T>): Promise<T> {
		win.window.setBackgroundColor("#ffffff");
		try {
			return await print();
		} finally {
			win.window.setBackgroundColor(windows.backgroundColor());
		}
	}

	/** Prints the active tab: the renderer only lays out the visible document. */
	async function exportPdf(win: AppWindow): Promise<void> {
		const name = windows.activeTab(win)?.name ?? t.untitled;
		const result = await dialog.showSaveDialog(win.window, {
			defaultPath: join(windows.defaultFolder(win), `${name}.pdf`),
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
		if (result.canceled || result.filePath === "") return;
		try {
			const { pageNumbers } = store.settings;
			// Size, orientation and margins come from the page's `@page` rule (see `pageRule`).
			const pdf = await onPaper(win, () =>
				win.window.webContents.printToPDF({
					printBackground: true,
					preferCSSPageSize: true,
					displayHeaderFooter: pageNumbers,
					...(pageNumbers
						? { headerTemplate: "<span></span>", footerTemplate: PAGE_NUMBER_FOOTER }
						: {}),
				}),
			);
			await writeFile(result.filePath, pdf);
		} catch (error) {
			void dialog.showMessageBox(win.window, {
				type: "error",
				message: t.exportFailed,
				detail: errorMessage(error),
			});
		}
	}

	function setWorkspace(folder: string | null): void {
		store.update({ workspace: folder });
		for (const win of windows.all()) win.window.webContents.send(CHANNEL.workspaceChange);
		refreshMenu();
	}

	async function openFolder(win: AppWindow | undefined): Promise<void> {
		const start = store.state.workspace ?? (win === undefined ? null : windows.defaultFolder(win));
		const options: Electron.OpenDialogOptions = {
			properties: ["openDirectory"],
			...(start === null ? {} : { defaultPath: start }),
		};
		const result =
			win === undefined
				? await dialog.showOpenDialog(options)
				: await dialog.showOpenDialog(win.window, options);
		const folder = result.filePaths[0];
		if (result.canceled || folder === undefined) return;
		setWorkspace(folder);
		// The files are what the user asked to see.
		if (store.settings.sidePane !== "files" || !store.settings.navigation) {
			changeSettings({ sidePane: "files", navigation: true });
		}
	}

	function menuContext(): MenuContext {
		return {
			windows,
			t,
			settings: store.settings,
			recentFiles: store.state.recentFiles,
			workspace: store.state.workspace,
			openFolder: (win) => void openFolder(win),
			closeFolder: () => setWorkspace(null),
			changeSettings,
			changeLanguage,
			clearRecentFiles: () => {
				store.update({ recentFiles: [] });
				app.clearRecentDocuments();
				refreshMenu();
			},
			exportPdf: (win) => void exportPdf(win),
			checkForUpdates: () => void updater.check(true),
			quickNote: () => void quickNote(),
			print: (win) =>
				void onPaper(
					win,
					() =>
						new Promise<void>((resolve) =>
							win.window.webContents.print({ printBackground: true }, () => resolve()),
						),
				),
			showAbout: () => {
				void dialog.showMessageBox({
					type: "info",
					message: t.appName,
					detail: format(
						t.aboutDetail,
						app.getVersion(),
						process.versions.electron,
						process.versions.chrome,
					),
				});
			},
		};
	}

	function refreshMenu(): void {
		if (ready) installMenu(menuContext());
	}

	/** A recovered package draft needs the package unpacked so its images resolve. */
	async function withPackageBase(draft: Draft): Promise<Draft> {
		if (draft.path === null || !isPackagePath(draft.path)) return draft;
		try {
			const file = await packages.open(
				draft.path,
				language === "tr" ? "windows-1254" : "windows-1252",
			);
			return file.base === undefined ? draft : { ...draft, base: file.base };
		} catch {
			return draft;
		}
	}

	async function openDocuments(paths: readonly string[]): Promise<void> {
		for (const path of paths) await windows.openPath(path, windows.focused());
	}

	/** Taskbar jump list tasks; recent documents come from `app.addRecentDocument`. */
	function installUserTasks(): void {
		if (process.platform !== "win32" || !app.isPackaged) return;
		// The portable launcher runs a copy from a cache folder; tasks must start the launcher.
		const program = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
		app.setUserTasks([
			{
				program,
				arguments: NEW_WINDOW_FLAG,
				iconPath: program,
				iconIndex: 0,
				title: t.newWindow,
				description: t.newWindow,
			},
		]);
	}

	app.on("second-instance", (_event, argv, cwd) => {
		if (argv.includes(NEW_WINDOW_FLAG)) {
			windows.open();
			return;
		}
		const paths = documentArguments(argv, cwd);
		if (paths.length > 0) {
			void openDocuments(paths);
			return;
		}
		const window = BrowserWindow.getAllWindows()[0];
		if (window === undefined) {
			windows.open();
			return;
		}
		if (window.isMinimized()) window.restore();
		window.focus();
	});

	app.on("open-file", (event, path) => {
		event.preventDefault();
		if (ready) void openDocuments([path]);
		else queuedFiles.push(path);
	});

	app.on("before-quit", () => windows.beginQuit());

	app.on("window-all-closed", () => {
		// With the tray icon the app stays, ready for the next quick note.
		if (process.platform !== "darwin" && !tray.enabled) app.quit();
	});

	app.on("will-quit", () => globalShortcut.unregisterAll());

	app.on("activate", () => {
		if (ready && BrowserWindow.getAllWindows().length === 0) windows.open();
	});

	void app.whenReady().then(async () => {
		language = store.settings.language ?? pickLanguage(app.getLocale());
		t = stringsFor(language);
		ready = true;

		nativeTheme.themeSource = store.settings.theme;
		handleDocumentScheme(async (pageId, name) => {
			const credentials = await confluence.get();
			return credentials === null ? null : confluenceClient(credentials).attachment(pageId, name);
		});
		applySpellCheck();
		installUserTasks();
		registerIpc({
			windows,
			store,
			drafts,
			packages,
			versions,
			confluence,
			strings: () => t,
			language: () => language,
			changeSettings,
			showFileMenu: (win, x, y) => popupFileMenu(menuContext(), win, x, y),
			showTabMenu: (win, tabId, x, y) => popupTabMenu(menuContext(), win, tabId, x, y),
			showCaseMenu: (win, x, y) => popupCaseMenu(menuContext(), win, x, y),
			openFolder,
			closeFolder: () => setWorkspace(null),
		});
		refreshMenu();
		tray.apply(store.settings.tray);

		// A recovered tab keeps the draft's id: with a fresh id the document
		// would have no copy on disk until edited, and a second crash would lose it.
		// Working folders of packages from the last session; nothing is open yet.
		await packages.clear().catch(() => {});
		const recovered = await Promise.all((await drafts.list()).map(withPackageBase));
		if (recovered.length > 0) {
			windows.open(
				recovered.map((draft) => ({ tabId: draft.id, payload: { kind: "draft", draft } })),
			);
		}

		await openDocuments([...documentArguments(process.argv, process.cwd()), ...queuedFiles]);

		if (BrowserWindow.getAllWindows().length === 0) {
			windows.open(store.state.welcomed ? [] : [welcomeDocument()]);
		}
		if (!store.state.welcomed) store.update({ welcomed: true });
		// Not in the way of startup.
		setTimeout(() => updater.checkInBackground(), 10_000);
	});
}

// A second instance hands its documents to the running one and exits.
if (app.requestSingleInstanceLock()) start();
else app.quit();
