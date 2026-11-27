/**
 * The extensions' panes: each an iframe of the extension's own `ui` page,
 * docked as Kalem's panes are. The page talks only to its host code, by
 * messages that pass through here; it is sent the app's colours.
 */
import type { ExtensionEditorTab, ExtensionInfo, KalemBridge } from "../shared/bridge.js";
import type { ExtensionPaneId, PanePlace, PanePlaces } from "../shared/panes.js";
import { extensionPaneId, placeOf } from "../shared/panes.js";
import type { DockPane } from "./docks.js";
import { el } from "./dom.js";

export interface ExtensionPanesOptions {
	readonly bridge: KalemBridge;
	readonly language: string;
	panePlaces(): PanePlaces;
	/** Puts panes that were never placed where their extension asks. */
	place(places: Readonly<Record<ExtensionPaneId, PanePlace>>): void;
	changed(panes: readonly DockPane[]): void;
	/** Editor tabs whose extension stopped or went: their tabs close. */
	editorsGone(ids: readonly string[]): void;
}

/** An extension's editor open in a tab: its page in the documents' place. */
export interface OpenEditor {
	/** The tab's id. */
	readonly id: string;
	readonly element: HTMLElement;
	/** It was not open before. */
	readonly created: boolean;
}

export interface ExtensionPanes {
	has(pane: ExtensionPaneId): boolean;
	label(pane: ExtensionPaneId): string | undefined;
	refresh(): Promise<void>;
	/** Makes the editor's page, or gives its new data to the one already open with that key. */
	openEditor(tab: ExtensionEditorTab): OpenEditor | null;
	closeEditor(id: string): void;
	/** The id of the tab an extension opened with `key`, when it is open. */
	editorId(extension: string, key: string): string;
}

interface Messaged {
	readonly extension: string;
	readonly iframe: HTMLIFrameElement;
}

interface EditorFrame extends Messaged {
	data: unknown;
	ready: boolean;
}

interface Frame {
	readonly extension: string;
	readonly key: string;
	readonly pane: DockPane;
	readonly iframe: HTMLIFrameElement;
}

const THEME_VARS = [
	"--app-text",
	"--app-muted",
	"--app-accent",
	"--app-accent-text",
	"--app-border",
	"--app-surface",
	"--app-raised",
	"--app-hover",
	"--app-error",
	"--app-ok",
	"--app-warning",
	"--app-mono",
	"--app-page",
	"--app-desk",
	"--app-pressed",
	"--app-info-bg",
	"--app-error-bg",
	"--app-warning-bg",
	"--app-shadow",
	"--app-shadow-soft",
	"--app-ease",
];

function themeMessage(): { kalem: "theme"; vars: Record<string, string>; dark: boolean } {
	const style = getComputedStyle(document.documentElement);
	const vars: Record<string, string> = {};
	for (const name of THEME_VARS) {
		const value = style.getPropertyValue(name).trim();
		if (value !== "") vars[name] = value;
	}
	const dark =
		document.documentElement.dataset.theme === "dark" ||
		(document.documentElement.dataset.theme !== "light" &&
			matchMedia("(prefers-color-scheme: dark)").matches);
	return { kalem: "theme", vars, dark };
}

export function createExtensionPanes(options: ExtensionPanesOptions): ExtensionPanes {
	const { bridge } = options;
	const frames = new Map<ExtensionPaneId, Frame>();
	const editors = new Map<string, EditorFrame>();
	let infos: readonly ExtensionInfo[] = [];
	const everyFrame = (): Messaged[] => [...frames.values(), ...editors.values()];
	const editorId = (extension: string, key: string): string => `ext-editor:${extension}:${key}`;
	const originOf = (extension: string): string => `kalem-ext://${extension}`;

	const post = (frame: Messaged, message: unknown): void => {
		frame.iframe.contentWindow?.postMessage(message, originOf(frame.extension));
	};

	function frameFor(info: ExtensionInfo, paneId: string, title: string): Frame {
		const { manifest } = info;
		const id = extensionPaneId(manifest.id, paneId);
		const key = `${manifest.version}:${info.installedAt}`;
		const known = frames.get(id);
		if (known !== undefined && known.key === key) return known;
		const iframe = el("iframe", {
			class: "ext-pane-frame",
			attrs: {
				src: `${originOf(manifest.id)}/${manifest.ui}?pane=${encodeURIComponent(paneId)}&lang=${options.language}`,
				sandbox: "allow-scripts allow-same-origin allow-forms",
				title,
				referrerpolicy: "no-referrer",
			},
		});
		const element = el("div", {
			class: "ext-pane",
			attrs: { "data-extension-pane": id },
			children: [iframe],
		});
		const frame: Frame = {
			extension: manifest.id,
			key,
			iframe,
			pane: { id, label: title, icon: "extension", element },
		};
		iframe.addEventListener("load", () => post(frame, themeMessage()));
		return frame;
	}

	window.addEventListener("message", (event) => {
		const frame = everyFrame().find((each) => each.iframe.contentWindow === event.source);
		if (frame === undefined || event.origin !== originOf(frame.extension)) return;
		const data = event.data as {
			kalem?: unknown;
			id?: unknown;
			name?: unknown;
			input?: unknown;
		} | null;
		if (data === null || typeof data !== "object") return;
		if (data.kalem === "ready") {
			post(frame, themeMessage());
			if ("data" in frame) {
				const editor = frame as EditorFrame;
				editor.ready = true;
				post(editor, { kalem: "editor-data", data: editor.data });
			}
			return;
		}
		if (data.kalem !== "call" || typeof data.name !== "string") return;
		const id = data.id;
		bridge
			.extensionUiCall(frame.extension, data.name, data.input ?? null)
			.then((value) => post(frame, { kalem: "reply", id, ok: true, value }))
			.catch((error: unknown) =>
				post(frame, {
					kalem: "reply",
					id,
					ok: false,
					error: (error instanceof Error ? error.message : String(error)).replace(
						/^Error invoking remote method '[^']+': (?:Error: )?/,
						"",
					),
				}),
			);
	});

	bridge.onExtensionUiMessage((extension, message) => {
		for (const frame of everyFrame()) {
			if (frame.extension === extension) post(frame, { kalem: "message", data: message });
		}
	});

	let pending = 0;
	const sendTheme = (): void => {
		cancelAnimationFrame(pending);
		pending = requestAnimationFrame(() => {
			const message = themeMessage();
			for (const frame of everyFrame()) post(frame, message);
		});
	};
	new MutationObserver(sendTheme).observe(document.documentElement, { attributes: true });
	new MutationObserver(sendTheme).observe(document.head, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", sendTheme);

	async function refresh(): Promise<void> {
		infos = await bridge.extensions().catch(() => [] as ExtensionInfo[]);
		const next = new Map<ExtensionPaneId, Frame>();
		const unplaced: Record<ExtensionPaneId, PanePlace> = {};
		const places = options.panePlaces();
		for (const info of infos) {
			if (!info.enabled || info.manifest.ui === null) continue;
			for (const pane of info.manifest.panes) {
				const frame = frameFor(info, pane.id, pane.title);
				next.set(frame.pane.id as ExtensionPaneId, frame);
				const id = frame.pane.id as ExtensionPaneId;
				if (!Object.hasOwn(places, id) && placeOf(places, id) === "hidden")
					unplaced[id] = pane.dock;
			}
		}
		frames.clear();
		for (const [id, frame] of next) frames.set(id, frame);
		options.changed([...frames.values()].map((frame) => frame.pane));
		const live = new Set(
			infos
				.filter((info) => info.enabled && info.manifest.ui !== null)
				.map((info) => info.manifest.id),
		);
		const gone = [...editors].filter(([, editor]) => !live.has(editor.extension)).map(([id]) => id);
		if (gone.length > 0) options.editorsGone(gone);
		if (Object.keys(unplaced).length > 0) options.place(unplaced);
	}

	bridge.onExtensionsChanged(() => void refresh());
	bridge.onExtensionSettingsChanged((extension) => {
		for (const frame of everyFrame()) {
			if (frame.extension === extension) post(frame, { kalem: "settings" });
		}
	});

	function openEditor(tab: ExtensionEditorTab): OpenEditor | null {
		const id = editorId(tab.extension, tab.key);
		const known = editors.get(id);
		const element = known?.iframe.parentElement;
		if (known !== undefined && element != null) {
			known.data = tab.data;
			if (known.ready) post(known, { kalem: "editor-data", data: tab.data });
			return { id, element, created: false };
		}
		const info = infos.find((each) => each.manifest.id === tab.extension);
		if (info === undefined || !info.enabled || info.manifest.ui === null) return null;
		const query = new URLSearchParams({
			pane: tab.editor,
			editor: tab.editor,
			key: tab.key,
			lang: options.language,
		});
		const iframe = el("iframe", {
			class: "ext-pane-frame",
			attrs: {
				src: `${originOf(tab.extension)}/${info.manifest.ui}?${query.toString()}`,
				sandbox: "allow-scripts allow-same-origin allow-forms",
				title: tab.title,
				referrerpolicy: "no-referrer",
			},
		});
		const frame: EditorFrame = { extension: tab.extension, iframe, data: tab.data, ready: false };
		editors.set(id, frame);
		iframe.addEventListener("load", () => {
			post(frame, themeMessage());
			// Its "ready" can be missed while the frame is still being placed: the page's scripts have run by now.
			if (!frame.ready) {
				frame.ready = true;
				post(frame, { kalem: "editor-data", data: frame.data });
			}
		});
		return {
			id,
			element: el("div", {
				class: "ext-editor",
				attrs: { "data-extension-editor": id },
				children: [iframe],
			}),
			created: true,
		};
	}

	return {
		openEditor,
		closeEditor: (id) => {
			editors.get(id)?.iframe.parentElement?.remove();
			editors.delete(id);
		},
		editorId,
		has: (pane) => frames.has(pane),
		label: (pane) => frames.get(pane)?.pane.label,
		refresh,
	};
}
