import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Command, KalemBridge, Settings, TabDocument } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";

function listen<Args extends unknown[]>(
	channel: string,
	handler: (...args: Args) => void,
): () => void {
	const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
		handler(...(args as Args));
	ipcRenderer.on(channel, wrapped);
	return () => {
		ipcRenderer.removeListener(channel, wrapped);
	};
}

// `ipcRenderer` itself is never exposed: the page can only call these functions.
const bridge: KalemBridge = {
	getStartup: () => ipcRenderer.invoke(CHANNEL.getStartup),

	newWindow: () => ipcRenderer.send(CHANNEL.newWindow),
	newTab: () => ipcRenderer.send(CHANNEL.newTab),
	showOpenDialog: () => ipcRenderer.invoke(CHANNEL.showOpenDialog),
	openPath: (path) => ipcRenderer.invoke(CHANNEL.openPath, path),
	importWord: () => ipcRenderer.invoke(CHANNEL.importWord),
	importConfluence: () => ipcRenderer.invoke(CHANNEL.importConfluence),
	confluenceAccount: () => ipcRenderer.invoke(CHANNEL.confluenceAccount),
	confluenceConnect: (login) => ipcRenderer.invoke(CHANNEL.confluenceConnect, login),
	confluenceDisconnect: () => ipcRenderer.invoke(CHANNEL.confluenceDisconnect),
	confluenceSpaces: () => ipcRenderer.invoke(CHANNEL.confluenceSpaces),
	confluenceSearch: (query, spaceKey) =>
		ipcRenderer.invoke(CHANNEL.confluenceSearch, query, spaceKey),
	confluenceOpenPage: (pageId) => ipcRenderer.invoke(CHANNEL.confluenceOpenPage, pageId),
	confluenceReloadPage: (tabId) => ipcRenderer.invoke(CHANNEL.confluenceReloadPage, tabId),
	confluenceSavePage: (tabId, request) =>
		ipcRenderer.invoke(CHANNEL.confluenceSavePage, tabId, request),
	confluenceAttachImage: (tabId, image) =>
		ipcRenderer.invoke(CHANNEL.confluenceAttachImage, tabId, image),
	chooseSavePath: (tabId, suggestedName, kind) =>
		ipcRenderer.invoke(CHANNEL.chooseSavePath, tabId, suggestedName, kind),
	writeDocument: (tabId, path, text, format) =>
		ipcRenderer.invoke(CHANNEL.writeDocument, tabId, path, text, format),
	reloadDocument: (tabId) => ipcRenderer.invoke(CHANNEL.reloadDocument, tabId),
	reportState: (tabId, state) => ipcRenderer.send(CHANNEL.reportState, tabId, state),
	tabActivated: (tabId) => ipcRenderer.send(CHANNEL.tabActivated, tabId),
	confirmCloseTab: (tabId) => ipcRenderer.invoke(CHANNEL.confirmCloseTab, tabId),
	tabClosed: (tabId) => ipcRenderer.send(CHANNEL.tabClosed, tabId),
	answerSave: (tabId, saved) => ipcRenderer.send(CHANNEL.answerSave, tabId, saved),

	writeImage: (documentPath, image) => ipcRenderer.invoke(CHANNEL.writeImage, documentPath, image),
	pickImages: () => ipcRenderer.invoke(CHANNEL.pickImages),
	pickAttachments: (documentPath) => ipcRenderer.invoke(CHANNEL.pickAttachments, documentPath),
	attachPaths: (documentPath, paths) =>
		ipcRenderer.invoke(CHANNEL.attachPaths, documentPath, paths),

	writeDraft: (tabId, request) => ipcRenderer.invoke(CHANNEL.writeDraft, tabId, request),
	deleteDraft: (tabId) => ipcRenderer.invoke(CHANNEL.deleteDraft, tabId),

	writeHtml: (suggestedName, html) => ipcRenderer.invoke(CHANNEL.writeHtml, suggestedName, html),
	writeDocx: (tabId, suggestedName, markdown) =>
		ipcRenderer.invoke(CHANNEL.writeDocx, tabId, suggestedName, markdown),
	writeConfluence: (suggestedName, text, format) =>
		ipcRenderer.invoke(CHANNEL.writeConfluence, suggestedName, text, format),

	updateSettings: (patch) => ipcRenderer.send(CHANNEL.updateSettings, patch),
	clipboard: (action) => ipcRenderer.send(CHANNEL.clipboard, action),
	openLink: (href) => ipcRenderer.send(CHANNEL.openLink, href),
	showFileMenu: (x, y) => ipcRenderer.send(CHANNEL.showFileMenu, x, y),
	showTabMenu: (tabId, x, y) => ipcRenderer.send(CHANNEL.showTabMenu, tabId, x, y),
	showCaseMenu: (x, y) => ipcRenderer.send(CHANNEL.showCaseMenu, x, y),
	moveTabToWindow: (tabId, tab, at) => ipcRenderer.send(CHANNEL.moveTabToWindow, tabId, tab, at),
	onTabMoved: (handler) => listen<[string]>(CHANNEL.tabMoved, handler),
	onTabMenu: (handler) => listen<[string, "move" | "close"]>(CHANNEL.tabMenu, handler),
	pathForFile: (file) => webUtils.getPathForFile(file),

	onCommand: (handler) => listen<[Command]>(CHANNEL.command, handler),
	onDocument: (handler) => listen<[TabDocument]>(CHANNEL.document, handler),
	onActivateTab: (handler) => listen<[string]>(CHANNEL.activateTab, handler),
	onSaveRequest: (handler) => listen<[string]>(CHANNEL.saveRequest, handler),
	onSettings: (handler) => listen<[Settings]>(CHANNEL.settings, handler),
	onExternalChange: (handler) => listen<[string, number]>(CHANNEL.externalChange, handler),
	getWorkspace: () => ipcRenderer.invoke(CHANNEL.getWorkspace),
	openFolder: () => ipcRenderer.invoke(CHANNEL.openFolder),
	closeFolder: () => ipcRenderer.send(CHANNEL.closeFolder),
	searchWorkspace: (query) => ipcRenderer.invoke(CHANNEL.searchWorkspace, query),
	onWorkspaceChange: (handler) => listen<[]>(CHANNEL.workspaceChange, handler),
	listVersions: (tabId) => ipcRenderer.invoke(CHANNEL.listVersions, tabId),
	readVersion: (tabId, id) => ipcRenderer.invoke(CHANNEL.readVersion, tabId, id),
};

contextBridge.exposeInMainWorld("kalem", bridge);
