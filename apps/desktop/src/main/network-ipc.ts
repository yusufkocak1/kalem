/**
 * The windows' requests about the hidden debug mode and its network log:
 * turn it on or off, read the rows, pause, clear, save as a HAR file.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { app, dialog, ipcMain } from "electron";
import { CHANNEL } from "../shared/bridge.js";
import { harLog } from "../shared/network.js";
import type { NetworkLog } from "./network-log.js";
import type { AppWindow } from "./windows.js";

export interface NetworkIpcContext {
	readonly log: NetworkLog;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
	setDebugMode(on: boolean): void;
}

/** "2026-11-15-1842", for the saved file's name. */
function stamp(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function registerNetworkIpc(ctx: NetworkIpcContext): void {
	const { log } = ctx;

	ipcMain.handle(CHANNEL.setDebugMode, (event, on: unknown) => {
		ctx.senderOf(event);
		if (typeof on !== "boolean") throw new Error("Invalid debug mode");
		ctx.setDebugMode(on);
	});

	ipcMain.handle(CHANNEL.networkLog, (event) => {
		ctx.senderOf(event);
		return log.state();
	});

	ipcMain.handle(CHANNEL.networkEntry, (event, id: unknown) => {
		ctx.senderOf(event);
		return typeof id === "number" ? log.entry(id) : null;
	});

	ipcMain.handle(CHANNEL.networkRecord, (event, on: unknown) => {
		ctx.senderOf(event);
		if (log.enabled) log.setRecording(on === true);
	});

	ipcMain.handle(CHANNEL.networkClear, (event) => {
		ctx.senderOf(event);
		log.clear();
	});

	ipcMain.handle(CHANNEL.networkExport, async (event) => {
		const win = ctx.senderOf(event);
		const result = await dialog.showSaveDialog(win.window, {
			defaultPath: join(app.getPath("downloads"), `kalem-network-${stamp(new Date())}.har`),
			filters: [{ name: "HAR", extensions: ["har"] }],
		});
		if (result.canceled || result.filePath === "") return false;
		const har = harLog(log.entries(), { name: "Kalem", version: app.getVersion() });
		await writeFile(result.filePath, `${JSON.stringify(har, null, 2)}\n`, "utf8");
		return true;
	});
}
