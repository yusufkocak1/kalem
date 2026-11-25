/** The windows' requests about extensions: list, install from a file, turn on and off, set up. */
import { readFile } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import { dialog, ipcMain } from "electron";
import type { ExtensionInfo, ExtensionPreview } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import { asksForMore, EXTENSION_FILE_EXTENSION } from "../shared/extensions.js";
import type { Strings } from "../shared/i18n.js";
import type { ExtensionHost } from "./extension-host.js";
import type { ExtensionStore, InspectedPackage } from "./extension-store.js";
import { ExtensionPackageError, readPackage } from "./extension-store.js";

export interface ExtensionIpcContext {
	readonly store: ExtensionStore;
	readonly host: ExtensionHost;
	readonly appVersion: string;
	strings(): Strings;
	windowOf(contentsId: number): BrowserWindow | null;
	/** Tells the windows the list changed. */
	broadcast(): void;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

export async function extensionInfos(
	store: ExtensionStore,
	host: ExtensionHost,
): Promise<ExtensionInfo[]> {
	const found: ExtensionInfo[] = [];
	for (const extension of await store.list()) {
		const { id } = extension.manifest;
		const secrets: Record<string, boolean> = {};
		for (const secret of extension.manifest.secrets)
			secrets[secret.key] = await store.hasSecret(id, secret.key);
		found.push({
			...extension,
			...host.state(id),
			settings: await store.settingsOf(id),
			secrets,
		});
	}
	return found;
}

export function registerExtensionIpc(ctx: ExtensionIpcContext): void {
	const { store, host } = ctx;
	const pending = new Map<string, InspectedPackage>();

	ipcMain.handle(CHANNEL.extensions, () => extensionInfos(store, host));

	ipcMain.handle(CHANNEL.extensionPick, async (event): Promise<ExtensionPreview | null> => {
		const parent = ctx.windowOf(event.sender.id);
		const options = {
			title: ctx.strings().extensionInstallFromFile,
			properties: ["openFile" as const],
			filters: [{ name: "Kalem", extensions: [EXTENSION_FILE_EXTENSION.slice(1), "zip"] }],
		};
		const picked = await (parent === null
			? dialog.showOpenDialog(options)
			: dialog.showOpenDialog(parent, options));
		const path = picked.filePaths[0];
		if (picked.canceled || path === undefined) return null;
		let pkg: InspectedPackage;
		try {
			pkg = await readPackage(await readFile(path), ctx.appVersion);
		} catch (error) {
			if (error instanceof ExtensionPackageError) throw new Error(error.message);
			throw error;
		}
		pending.clear();
		pending.set(pkg.token, pkg);
		const installed = await store.get(pkg.manifest.id);
		return {
			token: pkg.token,
			manifest: pkg.manifest,
			installedVersion: installed?.manifest.version ?? null,
			asksForMore: installed === null || asksForMore(installed.granted, pkg.manifest.permissions),
		};
	});

	ipcMain.handle(CHANNEL.extensionInstall, async (_event, token: unknown) => {
		const pkg = pending.get(text(token));
		if (pkg === undefined) throw new Error("Pick the package again.");
		pending.delete(pkg.token);
		host.stop(pkg.manifest.id);
		await store.install(pkg, "file");
		await host.start(pkg.manifest.id);
		ctx.broadcast();
	});

	ipcMain.handle(CHANNEL.extensionUninstall, async (_event, id: unknown) => {
		host.stop(text(id));
		host.clearLog(text(id));
		await store.uninstall(text(id));
		ctx.broadcast();
	});

	ipcMain.handle(CHANNEL.extensionSetEnabled, async (_event, id: unknown, enabled: unknown) => {
		await store.setEnabled(text(id), enabled === true);
		if (enabled === true) await host.start(text(id));
		else host.stop(text(id));
		ctx.broadcast();
	});

	ipcMain.handle(CHANNEL.extensionRestart, async (_event, id: unknown) => {
		await host.start(text(id));
		ctx.broadcast();
	});

	ipcMain.handle(
		CHANNEL.extensionSetSetting,
		async (_event, id: unknown, key: unknown, value: unknown) => {
			await store.setSetting(text(id), text(key), value);
		},
	);

	ipcMain.handle(
		CHANNEL.extensionSetSecret,
		async (_event, id: unknown, key: unknown, value: unknown) => {
			await store.setSecret(text(id), text(key), typeof value === "string" ? value : null);
			ctx.broadcast();
		},
	);

	ipcMain.handle(CHANNEL.extensionDevTools, (_event, id: unknown) => host.openDevTools(text(id)));
}
