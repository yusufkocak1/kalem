import type { Strings } from "../shared/i18n.js";

/**
 * Settings' long notes are a line until opened: the setting is what is
 * looked for, the note is there when it is wanted. A note is opened (and
 * shortened again) by clicking it, or with Enter or Space. A search shows
 * notes whole (the style sheet does that from `data-searching`).
 */

/** The notes under a heading or a setting. */
const NOTES = "p.confluence-hint, p.mode-section-hint, p.mode-panel-hint, p.typography-hint";

/** A note longer than this is shortened to a line. */
export const LONG_NOTE = 110;

/** Whether a note is long enough to shorten: notes that say what is going on (a status) are left whole. */
export const isLongNote = (note: Element): boolean =>
	!note.hasAttribute("role") && (note.textContent ?? "").trim().length > LONG_NOTE;

export function installHints(root: HTMLElement, t: Strings): void {
	const dress = (): void => {
		for (const note of root.querySelectorAll<HTMLElement>(NOTES)) {
			if (note.classList.contains("settings-hint")) continue;
			if (!isLongNote(note)) continue;
			note.classList.add("settings-hint");
			note.setAttribute("role", "button");
			note.tabIndex = 0;
			note.setAttribute("aria-expanded", "false");
			note.title = t.settingsHintMore;
		}
	};

	const toggle = (note: HTMLElement): void => {
		const open = note.getAttribute("aria-expanded") !== "true";
		note.setAttribute("aria-expanded", String(open));
		note.title = open ? t.settingsHintLess : t.settingsHintMore;
	};

	const noteOf = (target: EventTarget | null): HTMLElement | null =>
		target instanceof Element ? target.closest<HTMLElement>(".settings-hint") : null;

	root.addEventListener("click", (event) => {
		const note = noteOf(event.target);
		// A link in an opened note is followed, not folded.
		if (note === null || (event.target instanceof Element && event.target.closest("a, button"))) {
			return;
		}
		// Text being selected in an opened note stays selected.
		if (
			note.getAttribute("aria-expanded") === "true" &&
			String(window.getSelection() ?? "") !== ""
		) {
			return;
		}
		toggle(note);
	});
	root.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		if (!(event.target instanceof HTMLElement) || !event.target.matches(".settings-hint")) return;
		event.preventDefault();
		toggle(event.target);
	});
	new MutationObserver(dress).observe(root, { childList: true, subtree: true });
	dress();
}
