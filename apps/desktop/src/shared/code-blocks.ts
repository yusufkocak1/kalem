import type { Code, Root } from "@kalem-editor/core";
import type { BeautifyResult } from "./beautify.js";
import { beautify } from "./beautify.js";

export interface FormattedCode {
	readonly result: BeautifyResult;
	/** The reformatted block, or `null` when there is nothing to change. */
	readonly code: Code | null;
}

export function formatCodeBlock(code: Code): FormattedCode {
	const result = beautify(code.value, code.lang);
	if (!result.ok) return { result, code: null };

	// The parser keeps the newline before the closing fence in `value`.
	const value = result.text + (code.value.endsWith("\n") ? "\n" : "");
	const hasLanguage = code.lang !== null && code.lang.trim() !== "";
	if (hasLanguage) return { result, code: value === code.value ? null : { ...code, value } };

	// Label the block with the detected language so it gets highlighted.
	// An indented block cannot carry a language, so its syntax is dropped
	// and the serializer writes a fence instead.
	const { syntax, ...rest } = code;
	return {
		result,
		code: {
			...rest,
			value,
			lang: result.language,
			...(syntax?.style === "fenced" ? { syntax } : {}),
		},
	};
}

export interface FormatAllResult {
	readonly doc: Root;
	readonly formatted: number;
	/** Blocks with a declared JSON/XML language whose content does not parse. */
	readonly invalid: number;
}

/** Formats every code block, including those nested in lists and quotes. */
export function formatAllCodeBlocks(doc: Root): FormatAllResult {
	let formatted = 0;
	let invalid = 0;

	// Unchanged nodes keep their identity, so the editor re-renders only what changed.
	const visit = <T>(node: T): T => {
		const value = node as { type?: string; children?: readonly unknown[] };
		if (value.type === "code") {
			const { result, code } = formatCodeBlock(node as unknown as Code);
			if (!result.ok && result.reason === "invalid") invalid++;
			if (code === null) return node;
			formatted++;
			return code as unknown as T;
		}
		if (!Array.isArray(value.children)) return node;

		let changed = false;
		const children = value.children.map((child) => {
			const next = visit(child);
			if (next !== child) changed = true;
			return next;
		});
		return changed ? ({ ...node, children } as T) : node;
	};

	return { doc: visit(doc), formatted, invalid };
}
