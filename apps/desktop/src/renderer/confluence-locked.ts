import { ATOM_PREFIX } from "../shared/confluence-storage.js";
import { layoutLabel, lockedLabel } from "../shared/confluence-sync.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";

/** The box's label for a locked placeholder or layout marker; `null` for other source blocks. */
function boxLabel(text: string, t: Strings): { text: string; hint: string; kind: string } | null {
	const macro = lockedLabel(text);
	if (macro !== null) {
		return { text: format(t.confluenceLocked, macro), hint: t.confluenceLockedHint, kind: "macro" };
	}
	const layout = layoutLabel(text);
	if (layout === null) return null;
	return {
		text: layout.end
			? t.confluenceLayoutEnd
			: format(t.confluenceLayoutColumn, layout.section, layout.cell, layout.cells),
		hint: t.confluenceLayoutHint,
		kind: "layout",
	};
}

/**
 * Shows the placeholders of Confluence macros Markdown cannot hold as locked
 * boxes and a layout's column markers as thin dividers, and marks kept
 * inline atoms (see `atomKind`). The comment text is hidden, a box cannot be
 * typed into, and it can still be moved or deleted as a block. Runs after
 * every change, like the previews.
 */
export function decorateLocked(root: HTMLElement, t: Strings): void {
	// Inline atoms (mentions, page links, dates, inline macros) are kept links.
	for (const link of root.querySelectorAll<HTMLElement>(`a[href^="${ATOM_PREFIX}"]`)) {
		if (link.title !== t.confluenceAtomHint) link.title = t.confluenceAtomHint;
	}
	for (const code of root.querySelectorAll<HTMLElement>("pre > code[data-kalem-code]")) {
		const pre = code.parentElement as HTMLElement;
		const label = boxLabel(code.textContent ?? "", t);
		if (label === null) {
			if (pre.hasAttribute("data-confluence-locked")) {
				pre.removeAttribute("data-confluence-locked");
				pre.removeAttribute("data-confluence-kind");
				pre.removeAttribute("contenteditable");
				pre.removeAttribute("title");
			}
			continue;
		}
		if (pre.getAttribute("data-confluence-locked") === label.text) continue;
		pre.setAttribute("data-confluence-locked", label.text);
		pre.setAttribute("data-confluence-kind", label.kind);
		pre.setAttribute("contenteditable", "false");
		pre.title = label.hint;
	}
}
