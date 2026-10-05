import { join } from "node:path";
import type { Tray as ElectronTray } from "electron";
import { globalShortcut, Menu, nativeImage, Tray } from "electron";
import type { Strings } from "../shared/i18n.js";

/** Three keys: Ctrl+Alt alone is AltGr on many keyboards and would swallow typed characters. */
export const QUICK_NOTE_SHORTCUT = "CommandOrControl+Shift+Alt+N";

export interface TrayOptions {
	strings(): Strings;
	quickNote(): void;
	newWindow(): void;
	/** Brings an existing window forward, or opens one. */
	show(): void;
	quit(): void;
}

/** The notification-area icon and the system-wide quick note shortcut. */
export class TrayIcon {
	readonly #options: TrayOptions;
	#tray: ElectronTray | null = null;

	constructor(options: TrayOptions) {
		this.#options = options;
	}

	get enabled(): boolean {
		return this.#tray !== null;
	}

	apply(enabled: boolean): void {
		if (enabled === this.enabled) {
			if (enabled) this.#updateMenu();
			return;
		}
		if (!enabled) {
			globalShortcut.unregister(QUICK_NOTE_SHORTCUT);
			this.#tray?.destroy();
			this.#tray = null;
			return;
		}

		const image = nativeImage
			.createFromPath(join(__dirname, "icon.png"))
			.resize({ width: 16, height: 16 });
		this.#tray = new Tray(image);
		this.#tray.setToolTip(this.#options.strings().appName);
		this.#tray.on("click", () => this.#options.show());
		this.#updateMenu();
		// Another app may own the shortcut; the tray menu still offers the note.
		if (!globalShortcut.isRegistered(QUICK_NOTE_SHORTCUT)) {
			globalShortcut.register(QUICK_NOTE_SHORTCUT, () => this.#options.quickNote());
		}
	}

	#updateMenu(): void {
		const t = this.#options.strings();
		this.#tray?.setContextMenu(
			Menu.buildFromTemplate([
				{
					label: t.quickNote,
					accelerator: QUICK_NOTE_SHORTCUT,
					registerAccelerator: false,
					click: () => this.#options.quickNote(),
				},
				{ label: t.newWindow, click: () => this.#options.newWindow() },
				{ type: "separator" },
				{ label: t.quit, click: () => this.#options.quit() },
			]),
		);
	}
}
