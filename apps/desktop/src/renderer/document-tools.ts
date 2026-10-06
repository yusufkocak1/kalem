import type { Code } from "@kalem-editor/core";
import { parse, replaceAt } from "@kalem-editor/core";
import { CODE_ATTR, ID_ATTR } from "@kalem-editor/editor";
import codeCss from "@kalem-editor/themes/plugin-code.css?inline";
import tokensCss from "@kalem-editor/themes/tokens.css?inline";
import viewerCss from "@kalem-editor/themes/viewer.css?inline";
import type { KalemBridge } from "../shared/bridge.js";
import { formatAllCodeBlocks, formatCodeBlock } from "../shared/code-blocks.js";
import type { ConfluenceFormat } from "../shared/confluence.js";
import { markdownToStorage, markdownToWiki } from "../shared/confluence.js";
import { buildHtmlDocument, codeBlocks } from "../shared/html-export.js";
import type { Lang, Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { extractTableStyles } from "../shared/table-style.js";
import { codeAt } from "./edits.js";
import type { Previews } from "./previews.js";
import { previewKind } from "./previews.js";
import type { Session } from "./session.js";

export interface DocumentToolsContext {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly lang: Lang;
	readonly previews: Previews;
	session(): Session;
	/** The active tab's editor root. */
	canvas(): HTMLElement;
	inSource(): boolean;
	warn(text: string): void;
}

export interface DocumentTools {
	/** Whether the selection is in a code block (the Code tab shows then). */
	inCodeBlock(): boolean;
	formatCode(): void;
	formatAllCode(): void;
	exportHtml(): Promise<void>;
	exportDocx(): Promise<void>;
	exportConfluence(format: ConfluenceFormat): Promise<void>;
}

/** Code formatting and exports of the active document. */
export function createDocumentTools(ctx: DocumentToolsContext): DocumentTools {
	const { t } = ctx;

	const LANGUAGE_NAMES = {
		json: "JSON",
		jsonc: "JSONC",
		xml: "XML",
		html: "HTML",
		yaml: "YAML",
	} as const;

	interface CodeLocation {
		/** Path of the code node from the document root. */
		readonly path: readonly number[];
		readonly blockId: string;
		/** Value of the holder's `data-kalem-code` attribute. */
		readonly holderKey: string;
	}

	/**
	 * `editor.getCaret()` is null inside code blocks (they are edited as source,
	 * not inline content), so the block is located from the DOM selection.
	 */
	function codeLocation(): CodeLocation | null {
		const selection = document.getSelection();
		if (selection === null || selection.rangeCount === 0) return null;
		const node = selection.getRangeAt(0).startContainer;
		const holder = (node instanceof Element ? node : node.parentElement)?.closest(`[${CODE_ATTR}]`);
		const block = holder?.closest(`[${ID_ATTR}]`);
		if (holder == null || block == null || !ctx.canvas().contains(block)) return null;

		const blockId = block.getAttribute(ID_ATTR) ?? "";
		const blockIndex = ctx.session().editor.getBlockIds().indexOf(blockId);
		if (blockIndex < 0) return null;
		const holderKey = holder.getAttribute(CODE_ATTR) ?? "";
		const inner = holderKey === "" ? [] : holderKey.split(".").map(Number);
		return { path: [blockIndex, ...inner], blockId, holderKey };
	}

	/** Pretty-prints the code block at the caret. */
	function formatCode(): void {
		const editor = ctx.session().editor;
		if (ctx.inSource()) return;
		if (editor.isReadOnly()) {
			ctx.warn(t.readOnlyBlocked);
			return;
		}
		const location = codeLocation();
		const context = codeAt(editor.getDocument(), location?.path ?? null);
		if (location === null || context === null) {
			ctx.warn(t.formatNotCode);
			return;
		}

		const { result, code } = formatCodeBlock(context.code);
		if (!result.ok) {
			ctx.warn(
				result.reason === "invalid"
					? format(t.formatInvalid, LANGUAGE_NAMES[result.language], result.message)
					: t.formatUnsupported,
			);
			return;
		}
		ctx.session().notices.dismiss("edit");
		if (code === null) return;
		editor.applyEdit({ doc: replaceAt(editor.getDocument(), context.path, code), caret: null });
		restoreCodeCaret(location);
	}

	/** A formatted block is re-rendered and loses the caret; put it back so the Code tab stays. */
	function restoreCodeCaret(location: CodeLocation | null): void {
		if (location === null) return;
		const block = ctx.session().editor.getBlockElement(location.blockId);
		const holder = block?.querySelector(`[${CODE_ATTR}="${location.holderKey}"]`);
		if (block === undefined || holder == null) return;
		block.focus({ preventScroll: true });
		document.getSelection()?.setPosition(holder, 0);
	}

	function formatAllCode(): void {
		const editor = ctx.session().editor;
		if (ctx.inSource()) return;
		if (editor.isReadOnly()) {
			ctx.warn(t.readOnlyBlocked);
			return;
		}
		const location = codeLocation();
		const { doc, formatted, invalid } = formatAllCodeBlocks(editor.getDocument());
		if (formatted > 0) {
			editor.applyEdit({ doc, caret: null });
			restoreCodeCaret(location);
		}
		ctx.session().notices.show({
			id: "edit",
			kind: invalid > 0 ? "warning" : "info",
			text:
				invalid > 0
					? format(t.formatAllSkipped, formatted, invalid)
					: formatted > 0
						? format(t.formatAllDone, formatted)
						: t.formatAllNone,
		});
	}

	async function exportDocx(): Promise<void> {
		try {
			await ctx.bridge.writeDocx(
				ctx.session().id,
				ctx.session().name,
				ctx.session().styledMarkdown(),
			);
		} catch (error) {
			ctx.session().notices.show({
				id: "export",
				kind: "error",
				text: `${t.exportFailed}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	async function exportConfluence(target: ConfluenceFormat): Promise<void> {
		const markdown = ctx.session().styledMarkdown();
		const text = target === "storage" ? markdownToStorage(markdown) : markdownToWiki(markdown);
		try {
			await ctx.bridge.writeConfluence(ctx.session().name, text, target);
		} catch (error) {
			ctx.session().notices.show({
				id: "export",
				kind: "error",
				text: `${t.exportFailed}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	async function exportHtml(): Promise<void> {
		const markdown = ctx.session().styledMarkdown();
		// Diagrams and formulas go into the file rendered.
		const key = (code: Code): string => `${code.lang}\u0000${code.value}`;
		const rendered = new Map<string, string>();
		for (const code of codeBlocks(parse(extractTableStyles(markdown).markdown))) {
			const kind = previewKind(code.lang);
			if (kind === null) continue;
			const outcome = await ctx.previews.get(kind, code.value);
			if (outcome.ok) rendered.set(key(code), outcome.value.html);
		}
		const html = buildHtmlDocument({
			markdown,
			title: ctx.session().name,
			lang: ctx.lang,
			css: [tokensCss, viewerCss, codeCss].join("\n"),
			preview: (code) => rendered.get(key(code)) ?? null,
		});
		try {
			await ctx.bridge.writeHtml(ctx.session().name, html);
		} catch (error) {
			ctx.session().notices.show({
				id: "export",
				kind: "error",
				text: `${t.exportFailed}: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	return {
		inCodeBlock: () => !ctx.inSource() && codeLocation() !== null,
		formatCode,
		formatAllCode,
		exportHtml,
		exportDocx,
		exportConfluence,
	};
}
