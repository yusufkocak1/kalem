import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
	AssistantToolCall,
	Command,
	KalemBridge,
	Settings,
	TabDocument,
} from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { ClaudeEvent } from "../shared/claude.js";
import type { ApprovalRequest } from "../shared/tool-protocol.js";

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
	confluenceTree: (parent) => ipcRenderer.invoke(CHANNEL.confluenceTree, parent),
	confluenceCreatePage: (request) => ipcRenderer.invoke(CHANNEL.confluenceCreatePage, request),
	confluencePublish: (tabId, request) =>
		ipcRenderer.invoke(CHANNEL.confluencePublish, tabId, request),
	confluenceFind: (request) => ipcRenderer.invoke(CHANNEL.confluenceFind, request),
	confluenceAtom: (tabId, xml) => ipcRenderer.invoke(CHANNEL.confluenceAtom, tabId, xml),
	confluenceUsers: (query) => ipcRenderer.invoke(CHANNEL.confluenceUsers, query),
	confluenceJiraServer: () => ipcRenderer.invoke(CHANNEL.confluenceJiraServer),
	jiraAccount: () => ipcRenderer.invoke(CHANNEL.jiraAccount),
	jiraConnect: (login) => ipcRenderer.invoke(CHANNEL.jiraConnect, login),
	jiraDisconnect: () => ipcRenderer.invoke(CHANNEL.jiraDisconnect),
	jiraSuggestedSite: () => ipcRenderer.invoke(CHANNEL.jiraSuggestedSite),
	jiraIssue: (key) => ipcRenderer.invoke(CHANNEL.jiraIssue, key),
	jiraSearch: (query, next) => ipcRenderer.invoke(CHANNEL.jiraSearch, query, next),
	jiraWorklogContext: (key) => ipcRenderer.invoke(CHANNEL.jiraWorklogContext, key),
	jiraTransitions: (key) => ipcRenderer.invoke(CHANNEL.jiraTransitions, key),
	jiraTransition: (key, id) => ipcRenderer.invoke(CHANNEL.jiraTransition, key, id),
	jiraDevelopment: (issueId) => ipcRenderer.invoke(CHANNEL.jiraDevelopment, issueId),
	jiraDevelopmentDetail: (issueId, kind) =>
		ipcRenderer.invoke(CHANNEL.jiraDevelopmentDetail, issueId, kind),
	jiraLogWork: (key, entry) => ipcRenderer.invoke(CHANNEL.jiraLogWork, key, entry),
	confluenceAncestors: (pageId) => ipcRenderer.invoke(CHANNEL.confluenceAncestors, pageId),
	confluenceSearch: (query, spaceKey) =>
		ipcRenderer.invoke(CHANNEL.confluenceSearch, query, spaceKey),
	confluenceOpenPage: (pageId) => ipcRenderer.invoke(CHANNEL.confluenceOpenPage, pageId),
	confluenceReloadPage: (tabId) => ipcRenderer.invoke(CHANNEL.confluenceReloadPage, tabId),
	confluenceSavePage: (tabId, request) =>
		ipcRenderer.invoke(CHANNEL.confluenceSavePage, tabId, request),
	confluenceAttachImage: (tabId, image) =>
		ipcRenderer.invoke(CHANNEL.confluenceAttachImage, tabId, image),
	confluenceAttachments: (tabId) => ipcRenderer.invoke(CHANNEL.confluenceAttachments, tabId),
	confluenceWriteDiagram: (tabId, diagram) =>
		ipcRenderer.invoke(CHANNEL.confluenceWriteDiagram, tabId, diagram),
	writeDiagram: (documentPath, diagram) =>
		ipcRenderer.invoke(CHANNEL.writeDiagram, documentPath, diagram),
	confluenceUploadFiles: (tabId, paths) =>
		ipcRenderer.invoke(CHANNEL.confluenceUploadFiles, tabId, paths),
	confluenceOpenAttachment: (tabId, name) =>
		ipcRenderer.invoke(CHANNEL.confluenceOpenAttachment, tabId, name),
	confluenceDownloadAttachment: (tabId, name) =>
		ipcRenderer.invoke(CHANNEL.confluenceDownloadAttachment, tabId, name),
	confluenceDeleteAttachment: (tabId, attachment) =>
		ipcRenderer.invoke(CHANNEL.confluenceDeleteAttachment, tabId, attachment),
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
	onDocumentMoved: (handler) => listen<[string, string]>(CHANNEL.documentMoved, handler),
	onActivateTab: (handler) => listen<[string]>(CHANNEL.activateTab, handler),
	onSaveRequest: (handler) => listen<[string]>(CHANNEL.saveRequest, handler),
	onSettings: (handler) => listen<[Settings]>(CHANNEL.settings, handler),
	onExternalChange: (handler) => listen<[string, number]>(CHANNEL.externalChange, handler),
	getWorkspace: () => ipcRenderer.invoke(CHANNEL.getWorkspace),
	openFolder: () => ipcRenderer.invoke(CHANNEL.openFolder),
	closeFolder: (path) => ipcRenderer.send(CHANNEL.closeFolder, path),
	searchWorkspace: (query) => ipcRenderer.invoke(CHANNEL.searchWorkspace, query),
	createInWorkspace: (parent, name, kind) =>
		ipcRenderer.invoke(CHANNEL.createInWorkspace, parent, name, kind),
	renameInWorkspace: (path, name) => ipcRenderer.invoke(CHANNEL.renameInWorkspace, path, name),
	trashInWorkspace: (path) => ipcRenderer.invoke(CHANNEL.trashInWorkspace, path),
	revealInFolder: (path) => ipcRenderer.send(CHANNEL.revealInFolder, path),
	openWithSystem: (path) => ipcRenderer.invoke(CHANNEL.openWithSystem, path),
	gitBranches: (folder) => ipcRenderer.invoke(CHANNEL.gitBranches, folder),
	gitRun: (folder, action) => ipcRenderer.invoke(CHANNEL.gitRun, folder, action),
	gitClone: (url) => ipcRenderer.invoke(CHANNEL.gitClone, url),
	gitDiff: (folder, path) => ipcRenderer.invoke(CHANNEL.gitDiff, folder, path),
	gitSuggestMessage: (folder, paths) =>
		ipcRenderer.invoke(CHANNEL.gitSuggestMessage, folder, paths),
	onWorkspaceChange: (handler) => listen<[]>(CHANNEL.workspaceChange, handler),
	listVersions: (tabId) => ipcRenderer.invoke(CHANNEL.listVersions, tabId),
	readVersion: (tabId, id) => ipcRenderer.invoke(CHANNEL.readVersion, tabId, id),
	assistantStatus: (refresh) => ipcRenderer.invoke(CHANNEL.assistantStatus, refresh === true),
	assistantConfig: () => ipcRenderer.invoke(CHANNEL.assistantConfig),
	assistantConfigure: (update) => ipcRenderer.invoke(CHANNEL.assistantConfigure, update),
	assistantSetModel: (model) => ipcRenderer.invoke(CHANNEL.assistantSetModel, model),
	assistantToolCatalog: () => ipcRenderer.invoke(CHANNEL.assistantToolCatalog),
	assistantModels: (request) => ipcRenderer.invoke(CHANNEL.assistantModels, request),
	assistantLocate: () => ipcRenderer.invoke(CHANNEL.assistantLocate),
	assistantChats: () => ipcRenderer.invoke(CHANNEL.assistantChats),
	assistantChat: (id) => ipcRenderer.invoke(CHANNEL.assistantChat, id),
	assistantSaveChat: (chat) => ipcRenderer.invoke(CHANNEL.assistantSaveChat, chat),
	assistantDeleteChat: (id) => ipcRenderer.invoke(CHANNEL.assistantDeleteChat, id),
	assistantAsk: (request) => ipcRenderer.invoke(CHANNEL.assistantAsk, request),
	assistantStop: (chatId) => ipcRenderer.invoke(CHANNEL.assistantStop, chatId),
	assistantPickSources: (kind) => ipcRenderer.invoke(CHANNEL.assistantPickSources, kind),
	assistantApplyEdit: (id) => ipcRenderer.invoke(CHANNEL.assistantApplyEdit, id),
	onAssistantEvent: (handler) => listen<[string, ClaudeEvent]>(CHANNEL.assistantEvent, handler),
	assistantApprove: (id, answer) => ipcRenderer.invoke(CHANNEL.assistantApprove, id, answer),
	assistantToolResult: (id, answer) => ipcRenderer.invoke(CHANNEL.assistantToolResult, id, answer),
	assistantForgetPermissions: () => ipcRenderer.invoke(CHANNEL.assistantForgetPermissions),
	assistantCompact: (sessionId) => ipcRenderer.invoke(CHANNEL.assistantCompact, sessionId),
	templates: () => ipcRenderer.invoke(CHANNEL.templates),
	templateNew: (id) => ipcRenderer.invoke(CHANNEL.templateNew, id),
	templateOpen: (id) => ipcRenderer.invoke(CHANNEL.templateOpen, id),
	templateCopy: (id) => ipcRenderer.invoke(CHANNEL.templateCopy, id),
	templateDelete: (id) => ipcRenderer.invoke(CHANNEL.templateDelete, id),
	templateSave: (request) => ipcRenderer.invoke(CHANNEL.templateSave, request),
	templateImport: () => ipcRenderer.invoke(CHANNEL.templateImport),
	onAssistantApproval: (handler) => listen<[ApprovalRequest]>(CHANNEL.assistantApproval, handler),
	onAssistantToolCall: (handler) => listen<[AssistantToolCall]>(CHANNEL.assistantToolCall, handler),
};

contextBridge.exposeInMainWorld("kalem", bridge);
