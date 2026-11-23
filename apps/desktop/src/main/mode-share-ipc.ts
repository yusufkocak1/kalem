/**
 * Exporting an assistant mode to a file and importing one: the file is
 * chosen here, and before a mode comes in the user sees what it is, what
 * it replaces, and the MCP servers it brings (a server runs a program on
 * this computer or reaches an address), then chooses to take it with its
 * servers, without them, or not at all.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { app, dialog, ipcMain } from "electron";
import type { ModeExportResult, ModeImportResult, Settings } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { McpServer } from "../shared/mcp-servers.js";
import { isMode } from "../shared/mode-config.js";
import type { ModeFile, ModeFileError } from "../shared/mode-share.js";
import {
	exportCustomMode,
	exportKalemMode,
	importMode,
	modeFileName,
	parseModeFile,
	sameNamed,
	serversOf,
	toFillIn,
} from "../shared/mode-share.js";
import { MODE_LABELS } from "../shared/modes.js";
import type { SettingsStore } from "./settings.js";
import type { AppWindow } from "./windows.js";

export interface ModeShareIpcContext {
	readonly store: SettingsStore;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
	changeSettings(patch: Partial<Settings>): void;
}

const ERRORS: Readonly<Record<ModeFileError, keyof Strings>> = {
	json: "modeImportNotJson",
	kind: "modeImportNotMode",
	empty: "modeImportNotMode",
	newer: "modeImportNewer",
};

/** How a server shows in the question: what it runs, or where it connects. */
function serverLine(server: McpServer): string {
	const how = server.transport === "http" ? server.url : [server.command, ...server.args].join(" ");
	return `• ${server.name} — ${how.length > 160 ? `${how.slice(0, 159)}…` : how}`;
}

/** The mode's name, as the question says it. */
const nameOf = (t: Strings, file: ModeFile): string =>
	file.custom?.name ?? (file.kalem === undefined ? "" : t[MODE_LABELS[file.kalem.mode]]);

export function registerModeShareIpc(ctx: ModeShareIpcContext): void {
	ipcMain.handle(
		CHANNEL.assistantModeExport,
		async (event, raw: unknown): Promise<ModeExportResult | null> => {
			const win = ctx.senderOf(event);
			const t = ctx.strings();
			const settings = ctx.store.settings;
			const which = (typeof raw === "object" && raw !== null ? raw : {}) as {
				custom?: unknown;
				kalem?: unknown;
			};
			let file: ModeFile;
			let name: string;
			if (typeof which.custom === "string") {
				const mode = settings.assistantCustomModes.find((each) => each.id === which.custom);
				if (mode === undefined) return null;
				file = exportCustomMode(mode, settings.assistantMcpServers);
				name = mode.name;
			} else if (isMode(which.kalem)) {
				file = exportKalemMode(which.kalem, settings);
				name = t[MODE_LABELS[which.kalem]];
			} else return null;
			const result = await dialog.showSaveDialog(win.window, {
				title: t.modeExportTitle,
				defaultPath: join(app.getPath("documents"), modeFileName(name)),
				filters: [{ name: t.modeFiles, extensions: ["json"] }],
			});
			if (result.canceled || result.filePath === undefined || result.filePath === "") return null;
			await writeFile(result.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
			return { path: result.filePath, fillIn: toFillIn(file.servers) };
		},
	);

	ipcMain.handle(CHANNEL.assistantModeImport, async (event): Promise<ModeImportResult | null> => {
		const win = ctx.senderOf(event);
		const t = ctx.strings();
		const opened = await dialog.showOpenDialog(win.window, {
			title: t.modeImportTitle,
			properties: ["openFile", "dontAddToRecent"],
			filters: [{ name: t.modeFiles, extensions: ["json"] }],
		});
		const path = opened.filePaths[0];
		if (opened.canceled || path === undefined) return null;
		const read = parseModeFile(await readFile(path, "utf8").catch(() => ""));
		if (!read.ok) {
			await dialog.showMessageBox(win.window, {
				type: "warning",
				message: format(t.modeImportFailed, basename(path)),
				detail: t[ERRORS[read.error]],
			});
			return null;
		}
		const file = read.file;
		const settings = ctx.store.settings;
		const { added, kept } = serversOf(file, settings.assistantMcpServers);
		const same = sameNamed(file, settings.assistantCustomModes);
		const fillIn = toFillIn(added);
		const detail = [
			file.kalem === undefined
				? t.modeImportOwn
				: format(t.modeImportKalem, t[MODE_LABELS[file.kalem.mode]]),
			...(file.servers.length === 0
				? []
				: [
						"",
						t.modeImportServers,
						...added.map(serverLine),
						...kept.map((server) => `• ${server.name} — ${t.modeImportServerHave}`),
					]),
			...(added.length === 0 ? [] : ["", t.modeImportServerWarning]),
			...(fillIn.length === 0 ? [] : ["", format(t.modeImportFillInAsk, fillIn.join(", "))]),
		].join("\n");
		const buttons =
			added.length > 0
				? [t.modeImportWithServers, t.modeImportOnly, t.cancel]
				: [t.modeImportGo, t.cancel];
		const answer = await dialog.showMessageBox(win.window, {
			type: "question",
			message: format(t.modeImportAsk, nameOf(t, file)),
			detail,
			buttons,
			defaultId: 0,
			cancelId: buttons.length - 1,
			noLink: true,
			...(same === undefined ? {} : { checkboxLabel: format(t.modeImportReplace, same.name) }),
		});
		if (answer.response === buttons.length - 1) return null;
		const done = importMode(file, settings, {
			servers: added.length > 0 && answer.response === 0,
			replace: answer.checkboxChecked === true,
		});
		if (done === null) {
			await dialog.showMessageBox(win.window, {
				type: "warning",
				message: format(t.modeImportFailed, basename(path)),
				detail: t.modeImportFull,
			});
			return null;
		}
		ctx.changeSettings(done.patch);
		return {
			name: nameOf(t, file),
			...(done.custom === undefined ? {} : { custom: done.custom }),
			...(done.kalem === undefined ? {} : { kalem: done.kalem }),
			added: done.added,
			fillIn: toFillIn(added.filter((server) => done.added.includes(server.name))),
		};
	});
}
