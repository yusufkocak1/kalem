/** The windows' requests about extensions: list, install from a file, turn on and off, set up. */
import { readFile } from "node:fs/promises";
import type { BrowserWindow } from "electron";
import { dialog, ipcMain } from "electron";
import type { ExtensionInfo, ExtensionPreview, MarketCatalog } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { Registry } from "../shared/extension-registry.js";
import { blockedReason, latestCompatible } from "../shared/extension-registry.js";
import { asksForMore, compareVersions, EXTENSION_FILE_EXTENSION } from "../shared/extensions.js";
import type { Strings } from "../shared/i18n.js";
import type { ExtensionHost } from "./extension-host.js";
import { RegistryClient } from "./extension-registry.js";
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
	/** Tells the windows an extension's settings or secrets changed. */
	settingsChanged(id: string): void;
	/** The catalogs the user trusts. */
	registries(): readonly Registry[];
	readonly client?: RegistryClient;
}

interface Pending {
	readonly pkg: InspectedPackage;
	readonly registry: string | null;
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

/** Each catalog's extensions for this Kalem, and what is installed of them; blocked ones are turned off. */
export async function readCatalogs(
	ctx: Pick<ExtensionIpcContext, "store" | "host" | "appVersion" | "registries" | "broadcast">,
	client: RegistryClient,
	force: boolean,
): Promise<MarketCatalog[]> {
	const installed = await ctx.store.list();
	const catalogs: MarketCatalog[] = [];
	let changed = false;
	for (const registry of ctx.registries()) {
		try {
			const index = await client.index(registry, force);
			for (const extension of installed) {
				if (extension.registry !== registry.url) continue;
				const reason = blockedReason(index, extension.manifest.id, extension.manifest.version);
				if (reason === extension.blocked) continue;
				await ctx.store.setBlocked(extension.manifest.id, reason);
				if (reason !== null) ctx.host.stop(extension.manifest.id);
				changed = true;
			}
			catalogs.push({
				registry,
				name: index.name || registry.name,
				error: null,
				entries: latestCompatible(index, ctx.appVersion).map((entry) => {
					const own = installed.find((each) => each.manifest.id === entry.id);
					const version = own?.manifest.version ?? null;
					return {
						...entry,
						registry: registry.url,
						installedVersion: version,
						update: version !== null && compareVersions(entry.version, version) > 0,
					};
				}),
			});
		} catch (error) {
			catalogs.push({
				registry,
				name: registry.name,
				error: error instanceof Error ? error.message : String(error),
				entries: [],
			});
		}
	}
	if (changed) ctx.broadcast();
	return catalogs;
}

/** Registers the requests; returns a check of the catalogs (blocked extensions turned off). */
/** The package's icon as a data: address, for the window to show before it is installed. */
function iconData(pkg: InspectedPackage): string | null {
	const path = pkg.manifest.icon;
	const data = path === null ? undefined : pkg.files.get(path);
	if (path === null || data === undefined || data.byteLength > 256 * 1024) return null;
	// kalem-locale-ok: file extensions are ASCII
	const type = path.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
	return `data:${type};base64,${Buffer.from(data).toString("base64")}`;
}

export function registerExtensionIpc(ctx: ExtensionIpcContext): () => Promise<void> {
	const { store, host } = ctx;
	const client = ctx.client ?? new RegistryClient();
	const pending = new Map<string, Pending>();

	const preview = async (
		pkg: InspectedPackage,
		registry: string | null,
	): Promise<ExtensionPreview> => {
		pending.clear();
		pending.set(pkg.token, { pkg, registry });
		const installed = await store.get(pkg.manifest.id);
		return {
			token: pkg.token,
			manifest: pkg.manifest,
			installedVersion: installed?.manifest.version ?? null,
			asksForMore: installed === null || asksForMore(installed.granted, pkg.manifest.permissions),
			registry,
			icon: iconData(pkg),
		};
	};

	ipcMain.handle(CHANNEL.extensionMarket, (_event, force: unknown) =>
		readCatalogs(ctx, client, force === true),
	);

	ipcMain.handle(CHANNEL.extensionMarketPick, async (_event, registryUrl: unknown, id: unknown) => {
		const registry = ctx.registries().find((each) => each.url === registryUrl);
		if (registry === undefined) throw new Error("That catalog is not in Settings any more.");
		const entry = latestCompatible(await client.index(registry), ctx.appVersion).find(
			(each) => each.id === id,
		);
		if (entry === undefined) throw new Error("The catalog no longer offers it for this Kalem.");
		let pkg: InspectedPackage;
		try {
			pkg = await readPackage(await client.download(entry), ctx.appVersion);
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : String(error));
		}
		if (pkg.manifest.id !== entry.id || pkg.manifest.version !== entry.version) {
			throw new Error(
				`The package is ${pkg.manifest.id} ${pkg.manifest.version}, not what the catalog says.`,
			);
		}
		return preview(pkg, registry.url);
	});

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
		return preview(pkg, null);
	});

	ipcMain.handle(CHANNEL.extensionInstall, async (_event, token: unknown) => {
		const chosen = pending.get(text(token));
		if (chosen === undefined) throw new Error("Pick the package again.");
		const { pkg } = chosen;
		pending.delete(pkg.token);
		host.stop(pkg.manifest.id);
		await store.install(pkg, chosen.registry === null ? "file" : "registry", chosen.registry);
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
			ctx.settingsChanged(text(id));
		},
	);

	ipcMain.handle(
		CHANNEL.extensionSetSecret,
		async (_event, id: unknown, key: unknown, value: unknown) => {
			await store.setSecret(text(id), text(key), typeof value === "string" ? value : null);
			ctx.settingsChanged(text(id));
			ctx.broadcast();
		},
	);

	ipcMain.handle(CHANNEL.extensionUiCall, (_event, id: unknown, name: unknown, input: unknown) =>
		host.uiCall(text(id), text(name), input),
	);

	ipcMain.handle(CHANNEL.extensionStatusItems, () => host.statusItems());
	ipcMain.on(CHANNEL.extensionRunCommand, (_event, id: unknown, command: unknown) => {
		void host.runCommand(text(id), text(command));
	});

	ipcMain.handle(CHANNEL.extensionDevTools, (_event, id: unknown) => host.openDevTools(text(id)));

	return async () => {
		if (ctx.registries().length > 0) await readCatalogs(ctx, client, true);
	};
}
