/**
 * The windows' requests about analysis templates: list them, start a new
 * document from one, open one to edit, copy, remove, keep the active
 * document as one, and bring one in from a file.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { dialog, ipcMain } from "electron";
import { CHANNEL } from "../shared/bridge.js";
import { DEFAULT_FORMAT } from "../shared/encoding.js";
import type { Strings } from "../shared/i18n.js";
import type { TemplateInfo } from "../shared/templates.js";
import { asTemplate, BUILTIN_ID, documentFromTemplate } from "../shared/templates.js";
import type { TemplateStore } from "./templates.js";
import type { AppWindow, WindowManager } from "./windows.js";

export interface TemplateIpcContext {
	readonly templates: TemplateStore;
	readonly windows: WindowManager;
	strings(): Strings;
	senderOf(event: IpcMainInvokeEvent): AppWindow;
}

const record = (raw: unknown): Record<string, unknown> =>
	typeof raw === "object" && raw !== null && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: {};

/** A template's text under another name: its front matter says the new one. */
export function renamed(text: string, name: string): string {
	const front = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (front === null) return asTemplate(text, name);
	const lines = front[1] as string;
	const line = `kalem-template: ${JSON.stringify(name)}`;
	const next = /^kalem-template:.*$/m.test(lines)
		? lines.replace(/^kalem-template:.*$/m, () => line)
		: `${line}\n${lines}`;
	const start = front[0].indexOf(lines);
	return `${text.slice(0, start)}${next}${text.slice(start + lines.length)}`;
}

export function registerTemplateIpc(ctx: TemplateIpcContext): void {
	const { templates, windows } = ctx;

	ipcMain.handle(CHANNEL.templates, () => templates.list());

	ipcMain.handle(CHANNEL.templateNew, async (event, id: unknown) => {
		const win = ctx.senderOf(event);
		const { text } = await templates.read(typeof id === "string" ? id : BUILTIN_ID);
		const name = ctx.strings().untitled;
		windows.addTab(win, {
			kind: "draft",
			draft: {
				id: randomUUID(),
				path: null,
				name: "",
				text: documentFromTemplate(text, name),
				format: DEFAULT_FORMAT,
				time: 0,
			},
		});
	});

	ipcMain.handle(CHANNEL.templateOpen, async (event, id: unknown) => {
		const win = ctx.senderOf(event);
		if (typeof id !== "string" || !templates.isFile(id))
			throw new Error("This template cannot be edited.");
		await windows.openPath(id, win);
	});

	ipcMain.handle(CHANNEL.templateCopy, async (event, id: unknown): Promise<TemplateInfo> => {
		const win = ctx.senderOf(event);
		const { info, text } = await templates.read(typeof id === "string" ? id : BUILTIN_ID);
		const name = `${info.name.replace(/\s*\((?:best practice)\)\s*$/i, "")} (${ctx.strings().templateCopySuffix})`;
		const saved = await templates.save("personal", name, renamed(text, name));
		if (saved.path !== null) await windows.openPath(saved.path, win);
		return saved;
	});

	ipcMain.handle(CHANNEL.templateDelete, async (_event, id: unknown) => {
		if (typeof id !== "string") throw new Error("Invalid template");
		await templates.remove(id);
	});

	ipcMain.handle(CHANNEL.templateSave, async (_event, raw: unknown): Promise<TemplateInfo> => {
		const { name, text, where } = record(raw);
		if (typeof name !== "string" || name.trim() === "" || typeof text !== "string") {
			throw new Error("Invalid template");
		}
		return templates.save(
			where === "workspace" ? "workspace" : "personal",
			name.trim(),
			asTemplate(text, name.trim()),
		);
	});

	ipcMain.handle(CHANNEL.templateImport, async (event): Promise<TemplateInfo | "word" | null> => {
		const win = ctx.senderOf(event);
		const t = ctx.strings();
		const result = await dialog.showOpenDialog(win.window, {
			title: t.templateImportTitle,
			properties: ["openFile", "dontAddToRecent"],
			filters: [{ name: t.templateImportFiles, extensions: ["md", "markdown", "txt", "docx"] }],
		});
		const path = result.filePaths[0];
		if (result.canceled || path === undefined) return null;
		// A Word file opens as a document first: the user keeps it as a template from there.
		// kalem-locale-ok: a file extension
		if (extname(path).toLowerCase() === ".docx") {
			// kalem-locale-ok: a file extension
			await windows.importWord(path, win);
			return "word";
		}
		const name = basename(path, extname(path));
		return templates.save("personal", name, asTemplate(await readFile(path, "utf8"), name));
	});
}
