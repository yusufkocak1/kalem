import type { BrowserWindow, MessageBoxOptions } from "electron";
import { app, dialog, net, shell } from "electron";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { SettingsStore } from "./settings.js";
import type { Release } from "./updates.js";
import { checkDue, compareVersions, latestRelease, RELEASES_URL } from "./updates.js";
import { errorMessage } from "./windows.js";

export interface UpdaterOptions {
	readonly store: SettingsStore;
	strings(): Strings;
	window(): BrowserWindow | undefined;
}

/**
 * Looks for a newer `desktop-v*` release on GitHub. The installed app
 * downloads and installs it after asking; the portable exe cannot replace
 * itself, so it only points at the download page.
 */
export class Updater {
	readonly #options: UpdaterOptions;
	#busy = false;

	constructor(options: UpdaterOptions) {
		this.#options = options;
	}

	/** The NSIS install; the portable launcher sets this variable. */
	get #installed(): boolean {
		return app.isPackaged && process.platform === "win32" && !process.env.PORTABLE_EXECUTABLE_FILE;
	}

	async #ask(options: MessageBoxOptions): Promise<number> {
		const win = this.#options.window();
		const { response } =
			win === undefined
				? await dialog.showMessageBox(options)
				: await dialog.showMessageBox(win, options);
		return response;
	}

	/** At startup: at most once a day, only when enabled, silent unless there is news. */
	checkInBackground(): void {
		const { store } = this.#options;
		if (!app.isPackaged || !store.settings.checkUpdates) return;
		if (!checkDue(store.state.lastUpdateCheck, Date.now())) return;
		void this.check(false);
	}

	async check(manual: boolean): Promise<void> {
		if (this.#busy) return;
		this.#busy = true;
		const t = this.#options.strings();
		try {
			const response = await net.fetch(RELEASES_URL, {
				headers: { Accept: "application/vnd.github+json", "User-Agent": "Kalem" },
			});
			if (!response.ok) throw new Error(`GitHub: ${response.status}`);
			const release = latestRelease(await response.json());
			this.#options.store.update({ lastUpdateCheck: Date.now() });

			if (release === null || compareVersions(release.version, app.getVersion()) <= 0) {
				if (manual) {
					await this.#ask({
						type: "info",
						message: format(t.updateNone, app.getVersion()),
						buttons: ["OK"],
					});
				}
				return;
			}
			await this.#offer(release);
		} catch (error) {
			if (manual) {
				await this.#ask({
					type: "error",
					message: t.updateFailed,
					detail: errorMessage(error),
					buttons: ["OK"],
				});
			}
		} finally {
			this.#busy = false;
		}
	}

	async #offer(release: Release): Promise<void> {
		const t = this.#options.strings();
		const message = format(t.updateAvailable, release.version, app.getVersion());

		if (!this.#installed || !release.installable) {
			const choice = await this.#ask({
				type: "info",
				message,
				detail: t.updateManual,
				buttons: [t.updateOpenPage, t.later],
				defaultId: 0,
				cancelId: 1,
				noLink: true,
			});
			if (choice === 0) await shell.openExternal(release.page);
			return;
		}

		const choice = await this.#ask({
			type: "info",
			message,
			buttons: [t.updateInstall, t.updateNotes, t.later],
			defaultId: 0,
			cancelId: 2,
			noLink: true,
		});
		if (choice === 1) await shell.openExternal(release.page);
		if (choice !== 0) return;

		const { autoUpdater } = await import("electron-updater");
		autoUpdater.autoDownload = false;
		autoUpdater.autoInstallOnAppQuit = true;
		autoUpdater.setFeedURL({ provider: "generic", url: release.downloads });
		await autoUpdater.checkForUpdates();
		await autoUpdater.downloadUpdate();

		const restart = await this.#ask({
			type: "info",
			message: format(t.updateReady, release.version),
			detail: t.updateReadyDetail,
			buttons: [t.restart, t.later],
			defaultId: 0,
			cancelId: 1,
			noLink: true,
		});
		// Unsaved documents are asked about as the windows close.
		if (restart === 0) autoUpdater.quitAndInstall();
	}
}
