import { lockedLabel } from "../shared/confluence-sync.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";

/**
 * Shows the placeholders of Confluence macros Markdown cannot hold as
 * locked boxes: the comment text is hidden, the box cannot be typed into,
 * and it can still be moved or deleted as a block. Runs after every change,
 * like the previews.
 */
export function decorateLocked(root: HTMLElement, t: Strings): void {
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
