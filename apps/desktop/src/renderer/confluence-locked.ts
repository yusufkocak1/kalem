import { ATOM_PREFIX } from "../shared/confluence-storage.js";
import { lockedLabel } from "../shared/confluence-sync.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";

/**
 * Shows the placeholders of Confluence macros Markdown cannot hold as
 * locked boxes, and marks kept inline atoms (see `atomKind`). Boxes: the comment text is hidden, the box cannot be typed into,
 * and it can still be moved or deleted as a block. Runs after every change,
 * like the previews.
 */
export function decorateLocked(root: HTMLElement, t: Strings): void {
	// Inline atoms (mentions, page links, dates, inline macros) are kept links.
	for (const link of root.querySelectorAll<HTMLElement>(`a[href^="${ATOM_PREFIX}"]`)) {
		if (link.title !== t.confluenceAtomHint) link.title = t.confluenceAtomHint;
	}
	for (const code of root.querySelectorAll<HTMLElement>("pre > code[data-kalem-code]")) {
		const pre = code.parentElement as HTMLElement;
		const label = lockedLabel(code.textContent ?? "");
		if (label === null) {
			if (pre.hasAttribute("data-confluence-locked")) {
				pre.removeAttribute("data-confluence-locked");
				pre.removeAttribute("contenteditable");
				pre.removeAttribute("title");
			}
			continue;
		}
		const text = format(t.confluenceLocked, label);
		if (pre.getAttribute("data-confluence-locked") === text) continue;
		pre.setAttribute("data-confluence-locked", text);
		pre.setAttribute("contenteditable", "false");
		pre.title = t.confluenceLockedHint;
	}
}
