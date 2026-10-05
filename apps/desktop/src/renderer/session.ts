import type { Root } from "@kalem-editor/core";
import { parse, serialize } from "@kalem-editor/core";
import type { ClipboardPayload, PasteInput } from "@kalem-editor/editor";
import { Editor } from "@kalem-editor/editor";
import { autosavePlugin } from "@kalem-editor/plugin-autosave";
import { codeHighlightPlugin } from "@kalem-editor/plugin-code-highlight";
import type { FindReplacePlugin } from "@kalem-editor/plugin-find-replace";
import { findReplacePlugin } from "@kalem-editor/plugin-find-replace";
import type { ImageUploadPlugin } from "@kalem-editor/plugin-image-upload";
import {
	altFromFilename,
	imageAltAt,
	imageUploadPlugin,
	imageUrls,
	insertImage,
	replaceImageUrl,
} from "@kalem-editor/plugin-image-upload";
import { outlinePlugin } from "@kalem-editor/plugin-outline";
import type { SourceModePlugin } from "@kalem-editor/plugin-source-mode";
import { sourceModePlugin } from "@kalem-editor/plugin-source-mode";
import { wordCountPlugin } from "@kalem-editor/plugin-word-count";
import type { Ui } from "@kalem-editor/ui";
import { labelsFor, mountUi } from "@kalem-editor/ui";
import type { DocumentPayload, KalemBridge, Settings } from "../shared/bridge.js";
import type { TextFormat } from "../shared/encoding.js";
import { DEFAULT_FORMAT, formatLabel, willConvertToUtf8 } from "../shared/encoding.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { IMAGE_EXTENSIONS, isEmbeddedImage, parseDataUrl, toDataUrl } from "../shared/images.js";
import {
	documentBaseUrl,
	extension,
	fileName,
	isPackagePath,
	stripExtension,
	TEXT_EXTENSIONS,
} from "../shared/paths.js";
import type { TableStyle } from "../shared/table-style.js";
import {
	extractTableStyles,
	hasTableDirective,
	injectTableStyles,
	isPlain,
	renderStyledHtml,
} from "../shared/table-style.js";
import { insertLink, insertTable } from "./edits.js";
import type { Notices } from "./notices.js";
import { TableStyles } from "./table-styles.js";
import { welcomeDocument } from "./welcome.js";
import { wordHtmlToMarkdown } from "./word.js";

export type SaveStatus = "new" | "saved" | "unsaved" | "saving" | "error";

export interface SessionOptions {
	/** The tab this document lives in; the main process knows it by the same id. */
	readonly id: string;
	readonly bridge: KalemBridge;
	readonly t: Strings;
	readonly language: Lang;
	readonly documentScheme: string;
	readonly canvas: HTMLElement;
	readonly outline: HTMLElement;
	readonly wordCount: HTMLElement;
	readonly notices: Notices;
	settings(): Settings;
	/** Name, path, format or save status changed. */
	onStateChange(): void;
	/** Selection or content changed. */
	onEditorChange(): void;
}

const MAX_UPLOAD_SIZE = 32 * 1024 * 1024;
const AUTOSAVE_DELAY = 1500;

function ipcErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** One open document: the Kalem editor, its plugins and the save state. */
export class Session {
	readonly #o: SessionOptions;
	#editor: Editor | null = null;
	#ui: Ui | null = null;
	#find: FindReplacePlugin | null = null;
	#source: SourceModePlugin | null = null;
	#images: ImageUploadPlugin | null = null;

	#path: string | null = null;
	/** What relative links resolve against: the path, or a package's unpacked text. */
	#base: string | null = null;
	#name = "";
	#format: TextFormat = DEFAULT_FORMAT;
	/** Text as last saved; `null` when the document has never matched a file. */
	#savedText: string | null = null;
	/** New documents end with a newline; a file that had none keeps its ending. */
	#finalNewline = true;
	#dirty = false;
	#saving = false;
	#saveFailed = false;
	#reported: { name: string; dirty: boolean } | null = null;
	#saveQueue: Promise<unknown> = Promise.resolve();
	readonly #tables = new TableStyles();
	/** Whether this is the visible tab; only that one owns `<base>` and `#editor`. */
	#active = false;

	constructor(options: SessionOptions) {
		this.#o = options;
		this.#name = options.t.untitled;
	}

	get editor(): Editor {
		if (this.#editor === null) throw new Error("No document is loaded");
		return this.#editor;
	}

	get id(): string {
		return this.#o.id;
	}

	get notices(): Notices {
		return this.#o.notices;
	}

	get ui(): Ui | null {
		return this.#ui;
	}

	get find(): FindReplacePlugin | null {
		return this.#find;
	}

	get source(): SourceModePlugin | null {
		return this.#source;
	}

	get path(): string | null {
		return this.#path;
	}

	get name(): string {
		return this.#name;
	}

	get formatLabel(): string {
		return formatLabel(this.#format);
	}

	get dirty(): boolean {
		return this.#dirty;
	}

	get status(): SaveStatus {
		if (this.#saving) return "saving";
		if (this.#dirty) return this.#saveFailed ? "error" : "unsaved";
		return this.#path === null ? "new" : "saved";
	}

	/** The document with its table style comments; in source mode, the source text. */
	styledMarkdown(): string {
		return this.#source?.isSource() === true ? this.#source.text() : this.#text();
	}

	/** The document as written to disk: the editor's Markdown plus table style comments. */
	#text(): string {
		const editor = this.editor;
		if (this.#tables.isEmpty) return editor.getValue();
		return serialize(injectTableStyles(editor.getDocument(), this.#tables.styleOf));
	}

	tableStyle(id: string): TableStyle {
		return this.#tables.get(id);
	}

	/** `commit: false` only repaints, for the steps of a drag that has not ended yet. */
	setTableStyle(id: string, style: TableStyle, commit = true): void {
		this.#tables.set(id, style);
		this.#tables.decorate(this.editor);
		if (!commit) return;

		// A copy of the document is a new history state; `reconcile` ties the new styles to it.
		const doc = this.editor.getDocument();
		if (!this.editor.applyEdit({ doc: { ...doc }, caret: null })) {
			this.#refreshDirty(this.#text());
			this.#o.onEditorChange();
		}
	}

	/** Puts `text` in place of the document as one edit, so undo brings the old text back. */
	replaceText(text: string): boolean {
		const editor = this.editor;
		if (editor.isReadOnly() || this.#source?.isSource() === true) return false;
		const extracted = extractTableStyles(text);
		// Every table of the new document is new; their styles go in by position.
		this.#tables.expectPaste(extracted.styles);
		const replaced = editor.applyEdit({ doc: parse(extracted.markdown), caret: null });
		this.#tables.expectPaste(null);
		return replaced;
	}

	// --- Loading ------------------------------------------------------------

	load(payload: DocumentPayload): void {
		const { t, notices, language } = this.#o;
		notices.clear();
		this.#saveFailed = false;
		this.#path = null;
		this.#base = null;
		this.#name = t.untitled;
		this.#format = DEFAULT_FORMAT;
		this.#finalNewline = true;

		let text = "";
		let clean = true;

		switch (payload.kind) {
			case "file": {
				const { file } = payload;
				text = file.text;
				this.#path = file.path;
				this.#base = file.base ?? file.path;
				this.#name = stripExtension(file.name);
				this.#format = file.format;
				this.#finalNewline = file.text === "" || file.text.endsWith("\n");
				if (willConvertToUtf8(file.format)) {
					notices.show({
						id: "encoding",
						kind: "warning",
						text: format(t.encodingWarning, formatLabel(file.format).split(" · ")[0] ?? ""),
					});
				}
				break;
			}
			case "word": {
				const { word } = payload;
				text = wordHtmlToMarkdown(word.html);
				this.#name = word.name;
				clean = false;
				const issues = [
					...(word.skippedImages > 0 ? [format(t.wordImagesSkipped, word.skippedImages)] : []),
					...word.warnings.slice(0, 3),
				];
				notices.show(
					issues.length === 0
						? { id: "word", text: format(t.wordImported, word.name) }
						: {
								id: "word",
								kind: "warning",
								text: format(t.wordPartial, word.name, issues.join("; ")),
							},
				);
				break;
			}
			case "draft": {
				const { draft } = payload;
				text = draft.text;
				this.#path = draft.path;
				this.#base = draft.base ?? draft.path;
				this.#name = draft.name === "" ? t.untitled : draft.name;
				this.#format = draft.format;
				clean = false;
				notices.show({ id: "recovered", kind: "warning", text: t.recovered });
				break;
			}
			case "welcome":
				text = welcomeDocument(language);
				this.#name = t.welcomeDocument;
				break;
			default:
				break;
		}

		this.#updateBase();
		// The editor gets plain tables; their styles are kept beside it.
		const extracted = extractTableStyles(text);
		this.#mount(extracted.markdown);
		this.#tables.reset(this.editor.getDocument(), extracted.styles);
		this.#tables.decorate(this.editor);
		// The baseline is what the editor serializes, not the file text: a file
		// that does not round-trip byte for byte must not open as "modified".
		this.#savedText = clean ? this.#text() : null;
		this.#dirty = !clean;
		this.#reported = null;
		this.#report();
		this.#o.onStateChange();
		this.#o.onEditorChange();
		this.editor.focus();

		// An imported document exists nowhere on disk until it is edited or saved.
		if (payload.kind === "word") void this.#writeDraft(text);
	}

	/**
	 * Relative image URLs must stay relative in the editor DOM (Kalem reads
	 * inline content back from the DOM), so they are resolved through `<base>`.
	 */
	#updateBase(): void {
		// Plain text files show their line breaks as written (see style.css).
		const plainText = this.#path !== null && TEXT_EXTENSIONS.includes(extension(this.#path));
		this.#o.canvas.toggleAttribute("data-plain-text", plainText);
		if (!this.#active) return;

		// An untitled document has no folder; it gets a base that resolves to nothing.
		// The element is never removed or left without an href: Chromium reports
		// both as a violation of the `base-uri` policy.
		const href =
			this.#base === null
				? `${this.#o.documentScheme}://local/`
				: documentBaseUrl(this.#o.documentScheme, this.#base);
		const existing = document.querySelector("base");
		if (existing !== null) {
			existing.href = href;
			return;
		}
		const base = document.createElement("base");
		base.href = href;
		document.head.prepend(base);
	}

	/** Called when this tab becomes the visible one. */
	activate(): void {
		this.#active = true;
		this.#o.canvas.id = "editor";
		this.#updateBase();
	}

	deactivate(): void {
		this.#active = false;
		this.#o.canvas.removeAttribute("id");
		// The find panel floats over the window; it must not outlive its tab.
		this.#find?.close();
	}

	dispose(): void {
		this.#unmount();
	}

	// A fresh editor per document: `setValue` would make the autosave plugin
	// treat the newly opened text as an edit and write it straight back.
	#mount(text: string): void {
		this.#unmount();
		const { canvas, outline, wordCount, t, language, notices } = this.#o;

		const editor = new Editor(canvas, {
			value: text,
			lang: language,
			label: t.document,
			onChange: (value) => this.#handleChange(value),
			onSelectionChange: () => this.#o.onEditorChange(),
			transformCopy: (payload, fragment) => this.#copyTables(payload, fragment),
			transformPaste: (fragment, input, plain) => this.#pasteTables(fragment, input, plain),
		});

		const find = findReplacePlugin();
		const source = sourceModePlugin({ onModeChange: () => this.#o.onEditorChange() });
		const images = imageUploadPlugin({
			accept: Object.keys(IMAGE_EXTENSIONS),
			maxSize: MAX_UPLOAD_SIZE,
			upload: ({ file }) => this.#upload(file),
			onError: (error) => {
				notices.show({
					id: "image",
					kind: "error",
					text: format(t.imageError, ipcErrorMessage(error)),
				});
			},
		});

		const plugins = [
			codeHighlightPlugin(),
			find,
			outlinePlugin({ container: outline }),
			wordCountPlugin({ container: wordCount }),
			source,
			images,
			autosavePlugin({ delay: AUTOSAVE_DELAY, save: () => this.#autoSave() }),
		];
		for (const plugin of plugins) editor.addPlugin(plugin);

		this.#ui = mountUi(editor, {
			toolbar: "bubble",
			slashItems: [
				{
					id: "table",
					label: t.table,
					group: labelsFor(language).blockType,
					glyph: "▦",
					apply: (doc, caret) => insertTable(doc, caret, 3, 3),
				},
			],
		});
		editor.on("readonlychange", () => {
			this.#o.onEditorChange();
			this.#o.onStateChange();
		});

		this.#editor = editor;
		this.#find = find;
		this.#source = source;
		this.#images = images;
	}

	#unmount(): void {
		// UI first: it removes its own shortcut plugin from the editor.
		this.#ui?.destroy();
		this.#editor?.destroy();
		this.#o.canvas.replaceChildren();
		this.#ui = null;
		this.#editor = null;
		this.#find = null;
		this.#source = null;
		this.#images = null;
	}

	/** Copied tables take their styles along, as comments in the Markdown and inline in the HTML. */
	#copyTables(payload: ClipboardPayload, fragment: Root): ClipboardPayload {
		const styleOf = this.#tables.styleOf;
		const styled = fragment.children.some((block) => {
			const style = block.type === "table" ? styleOf(block) : undefined;
			return style !== undefined && !isPlain(style);
		});
		if (!styled) return payload;
		return {
			text: serialize(injectTableStyles(fragment, styleOf)).replace(/\n$/, ""),
			html: renderStyledHtml(fragment, styleOf),
		};
	}

	/**
	 * Markdown with table style comments (copied from Kalem, or from a styled
	 * file) is pasted from its text, which is lossless; the styles go to the
	 * tables the paste inserts.
	 */
	#pasteTables(fragment: Root, input: PasteInput, plain: boolean): Root {
		if (plain || !hasTableDirective(input.text)) return fragment;
		const extracted = extractTableStyles(input.text);
		this.#tables.expectPaste(extracted.styles);
		// The paste's change arrives synchronously; a paste that changes nothing must not leave them behind.
		queueMicrotask(() => this.#tables.expectPaste(null));
		return parse(extracted.markdown);
	}

	#handleChange(value: string): void {
		const editor = this.#editor;
		if (editor === null) return;
		this.#tables.reconcile(editor.getDocument());
		this.#tables.decorate(editor);
		this.#refreshDirty(this.#tables.isEmpty ? value : this.#text());
		this.#o.onEditorChange();
	}

	#refreshDirty(text: string): void {
		const dirty = this.#savedText === null || text !== this.#savedText;
		if (dirty !== this.#dirty) {
			this.#dirty = dirty;
			// Back to the saved text (e.g. by undo): nothing left to recover.
			if (!dirty) void this.#o.bridge.deleteDraft(this.id).catch(() => {});
			this.#report();
			this.#o.onStateChange();
		}
	}

	#report(): void {
		const state = { name: this.#name, dirty: this.#dirty };
		if (this.#reported?.name === state.name && this.#reported.dirty === state.dirty) return;
		this.#reported = state;
		this.#o.bridge.reportState(this.id, state);
	}

	// --- Saving -------------------------------------------------------------

	/** Saves are serialized: autosave and Ctrl+S must not write concurrently. */
	save(saveAs = false, kind?: "package"): Promise<boolean> {
		const result = this.#saveQueue.then(() => this.#save(saveAs, kind));
		this.#saveQueue = result.catch(() => false);
		return result;
	}

	async #save(saveAs: boolean, kind?: "package"): Promise<boolean> {
		const { bridge, t, notices } = this.#o;
		const editor = this.editor;

		if (this.#source?.isSource() === true) this.#source.exit();
		if ((this.#images?.pendingUploads().length ?? 0) > 0) {
			notices.show({ id: "save", kind: "warning", text: t.uploadPending });
			return false;
		}

		let path = this.#path;
		if (path === null || saveAs) {
			path = await bridge.chooseSavePath(this.id, this.#name, kind);
			if (path === null) return false;
		} else if (!this.#dirty) {
			return true;
		}
		// Another document was loaded into this window while the dialog was open.
		if (this.#editor !== editor) return false;

		this.#saving = true;
		this.#o.onStateChange();
		try {
			if (path !== this.#path) {
				this.#path = path;
				this.#name = stripExtension(fileName(path));
				// A package's links resolve inside it; the save result brings that base.
				if (!isPackagePath(path)) {
					this.#base = path;
					this.#updateBase();
				}
			}
			await this.#extractEmbeddedImages(editor, path);

			const text = this.#text();
			const target: TextFormat = willConvertToUtf8(this.#format)
				? { ...this.#format, encoding: "utf-8" }
				: this.#format;
			const needsNewline = this.#finalNewline && text !== "" && !text.endsWith("\n");
			const output = needsNewline ? `${text}\n` : text;
			const result = await bridge.writeDocument(this.id, path, output, target);
			if (result.file !== undefined) {
				// Links were moved with their files: show the document as it was written.
				this.load({ kind: "file", file: result.file });
				return true;
			}

			this.#format = target;
			this.#savedText = text;
			this.#saveFailed = false;
			this.#dirty = this.#text() !== text;
			for (const id of ["save", "encoding", "recovered", "word", "external"]) notices.dismiss(id);
			return true;
		} catch (error) {
			this.#saveFailed = true;
			notices.show({
				id: "save",
				kind: "error",
				text: format(t.saveError, ipcErrorMessage(error)),
			});
			return false;
		} finally {
			this.#saving = false;
			this.#report();
			this.#o.onStateChange();
		}
	}

	/**
	 * Images added before the first save live in the document as `data:` URLs.
	 * Once a path is known they are written next to it and relinked.
	 */
	async #extractEmbeddedImages(editor: Editor, documentPath: string): Promise<void> {
		if (editor.isReadOnly()) return;
		const snapshot = editor.getDocument();
		const seen = new Set<string>();

		for (const [index, url] of imageUrls(snapshot).entries()) {
			if (!isEmbeddedImage(url) || seen.has(url)) continue;
			seen.add(url);
			const data = parseDataUrl(url);
			const ext = data === null ? undefined : IMAGE_EXTENSIONS[data.type];
			if (data === null || ext === undefined) continue;

			const alt = (imageAltAt(snapshot, index) ?? "").trim();
			const relative = await this.#o.bridge.writeImage(documentPath, {
				name: `${alt === "" ? "image" : alt}.${ext}`,
				type: data.type,
				bytes: data.bytes,
			});
			const next = replaceImageUrl(editor.getDocument(), url, { url: relative });
			if (next !== null) editor.applyEdit({ doc: next, caret: null });
		}
	}

	async #autoSave(): Promise<void> {
		if (!this.#dirty) {
			await this.#o.bridge.deleteDraft(this.id);
			return;
		}
		const canWriteFile =
			this.#o.settings().autoSave && this.#path !== null && this.#editor?.isReadOnly() === false;
		if (canWriteFile) {
			if (!(await this.save())) throw new Error("Autosave failed");
			return;
		}
		await this.#writeDraft(this.#text());
	}

	#writeDraft(text: string): Promise<void> {
		return this.#o.bridge.writeDraft(this.id, { name: this.#name, text, format: this.#format });
	}

	// --- Images -------------------------------------------------------------

	async #upload(file: File): Promise<string> {
		const bytes = new Uint8Array(await file.arrayBuffer());
		// kalem-locale-ok: MIME types are ASCII
		const type = file.type.toLowerCase();
		if (this.#path === null) return toDataUrl(type, bytes);
		return this.#o.bridge.writeImage(this.#path, { name: file.name, type, bytes });
	}

	async insertImages(): Promise<void> {
		const { bridge, t, notices } = this.#o;
		const editor = this.editor;
		if (editor.isReadOnly()) {
			notices.show({ id: "edit", kind: "warning", text: t.readOnlyBlocked });
			return;
		}

		const caretBefore = editor.getCaret();
		const files = await bridge.pickImages();
		if (this.#editor !== editor) return;

		for (const file of files) {
			try {
				const url =
					this.#path === null
						? toDataUrl(file.type, file.bytes)
						: await bridge.writeImage(this.#path, file);
				editor.applyEdit(
					insertImage(editor.getDocument(), editor.getCaret() ?? caretBefore, {
						type: "image",
						url,
						alt: altFromFilename(file.name),
						title: null,
					}),
				);
			} catch (error) {
				notices.show({
					id: "image",
					kind: "error",
					text: format(t.imageError, ipcErrorMessage(error)),
				});
			}
		}
	}

	// --- Attachments --------------------------------------------------------

	/**
	 * Copies files next to the document and links them. Without `paths` the
	 * user picks the files. An unsaved document has no folder to copy into,
	 * so it is saved first.
	 */
	async attachFiles(paths?: readonly string[]): Promise<void> {
		const { bridge, t, notices } = this.#o;
		const editor = this.editor;
		if (editor.isReadOnly()) {
			notices.show({ id: "edit", kind: "warning", text: t.readOnlyBlocked });
			return;
		}

		const caretBefore = editor.getCaret();
		if (this.#path === null) await this.save();
		const documentPath = this.#path;
		if (documentPath === null || this.#editor !== editor) {
			notices.show({ id: "edit", kind: "warning", text: t.attachNeedsSave });
			return;
		}
		notices.dismiss("edit");

		try {
			const attachments =
				paths === undefined
					? await bridge.pickAttachments(documentPath)
					: await bridge.attachPaths(documentPath, paths);
			if (this.#editor !== editor) return;
			for (const { name, url } of attachments) {
				const caret = editor.getCaret() ?? caretBefore;
				editor.applyEdit(insertLink(editor.getDocument(), caret, name, url));
			}
		} catch (error) {
			notices.show({
				id: "attach",
				kind: "error",
				text: `${t.attachFailed}: ${ipcErrorMessage(error)}`,
			});
		}
	}

	// --- External changes ---------------------------------------------------

	async handleExternalChange(): Promise<void> {
		const { t, notices } = this.#o;
		if (this.#path === null) return;
		if (!this.#dirty) {
			await this.reloadFromDisk();
			return;
		}
		notices.show({
			id: "external",
			kind: "warning",
			text: t.externalChange,
			actions: [
				{ label: t.reload, run: () => void this.reloadFromDisk() },
				{ label: t.keepMine, run: () => {} },
			],
		});
	}

	async reloadFromDisk(): Promise<void> {
		const { bridge, t, notices } = this.#o;
		try {
			const file = await bridge.reloadDocument(this.id);
			if (file !== null) this.load({ kind: "file", file });
		} catch (error) {
			notices.show({
				id: "external",
				kind: "error",
				text: `${t.openFailed}: ${ipcErrorMessage(error)}`,
			});
		}
	}
}
