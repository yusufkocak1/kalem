import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, nativeTheme, session } from "electron";
import type { Settings } from "../shared/bridge.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format, pickLanguage, stringsFor } from "../shared/i18n.js";
import { isEditablePath, isWordPath } from "../shared/paths.js";
import { DraftStore } from "./drafts.js";
import { registerIpc } from "./ipc.js";
import type { MenuContext } from "./menu.js";
import { installMenu, popupContextMenu, popupFileMenu, welcomeDocument } from "./menu.js";
import { handleDocumentScheme, registerDocumentScheme } from "./protocol.js";
import { SettingsStore } from "./settings.js";
import type { AppWindow } from "./windows.js";
import { errorMessage, WindowManager } from "./windows.js";

// Lets end-to-end tests run against a throwaway profile. The single-instance
// lock is tied to this folder, so tests do not collide with a running app.
const userDataDir = process.env.KALEM_USER_DATA_DIR;
if (userDataDir !== undefined && userDataDir !== "") {
	app.setPath("userData", resolve(userDataDir));
}

registerDocumentScheme();

function documentArguments(argv: readonly string[], cwd: string): string[] {
	return argv
		.slice(1)
		.filter((arg) => !arg.startsWith("-") && (isEditablePath(arg) || isWordPath(arg)))
		.map((arg) => resolve(cwd, arg));
}

function start(): void {
	const store = new SettingsStore(join(app.getPath("userData"), "settings.json"));
	const drafts = new DraftStore(join(app.getPath("userData"), "drafts"));

	// Resolved once at startup; a language change applies after a restart.
	let language: Lang = "en";
	let t: Strings = stringsFor(language);

	/** macOS "open with" requests that arrive before the app is ready. */
	const queuedFiles: string[] = [];
	let ready = false;

	const windows: WindowManager = new WindowManager({
		store,
		drafts,
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

	/** Prints the active tab: the renderer only lays out the visible document. */
	async function exportPdf(win: AppWindow): Promise<void> {
		const name = windows.activeTab(win)?.name ?? t.untitled;
		const result = await dialog.showSaveDialog(win.window, {
			defaultPath: join(windows.defaultFolder(win), `${name}.pdf`),
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
		if (result.canceled || result.filePath === "") return;
		try {
			const pdf = await win.window.webContents.printToPDF({
				printBackground: true,
				pageSize: "A4",
			});
			await writeFile(result.filePath, pdf);
		} catch (error) {
			void dialog.showMessageBox(win.window, {
				type: "error",
				message: t.exportFailed,
				detail: errorMessage(error),
			});
		}
	}

	function menuContext(): MenuContext {
		return {
			windows,
			t,
			settings: store.settings,
			recentFiles: store.state.recentFiles,
			changeSettings,
			changeLanguage,
			clearRecentFiles: () => {
				store.update({ recentFiles: [] });
				app.clearRecentDocuments();
				refreshMenu();
			},
			exportPdf: (win) => void exportPdf(win),
			print: (win) => win.window.webContents.print({ printBackground: true }),
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

	async function openDocuments(paths: readonly string[]): Promise<void> {
		for (const path of paths) await windows.openPath(path, windows.focused());
	}

	app.on("second-instance", (_event, argv, cwd) => {
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
		if (process.platform !== "darwin") app.quit();
	});

	app.on("activate", () => {
		if (ready && BrowserWindow.getAllWindows().length === 0) windows.open();
	});

	void app.whenReady().then(async () => {
		language = store.settings.language ?? pickLanguage(app.getLocale());
		t = stringsFor(language);
		ready = true;

		nativeTheme.themeSource = store.settings.theme;
		handleDocumentScheme();
		applySpellCheck();
		registerIpc({
			windows,
			store,
			drafts,
			strings: () => t,
			language: () => language,
			changeSettings,
			showFileMenu: (win, x, y) => popupFileMenu(menuContext(), win, x, y),
		});
		refreshMenu();

		// A recovered tab keeps the draft's id: with a fresh id the document
		// would have no copy on disk until edited, and a second crash would lose it.
		const recovered = await drafts.list();
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
	});
}

// A second instance hands its documents to the running one and exits.
if (app.requestSingleInstanceLock()) start();
else app.quit();
