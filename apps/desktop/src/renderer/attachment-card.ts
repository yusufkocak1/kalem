import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface AttachmentCardOptions {
	readonly t: Strings;
	/** Where the document's links are. */
	readonly host: HTMLElement;
	/** The attachment the link points to, `null` when it is not one. */
	attachmentOf(link: HTMLAnchorElement): string | null;
	open(name: string): void;
	download(name: string): void;
	manage(name: string): void;
}

const SHOW_DELAY = 350;
const HIDE_DELAY = 250;

/**
 * A small card over an attachment link in the document, to open or download
 * the file without going through the attachments dialog.
 */
export function createAttachmentCard(options: AttachmentCardOptions): { hide(): void } {
	const { t, host } = options;
	const name = el("span", { class: "attachment-card-name" });
	const action = (label: string, run: (file: string) => void): HTMLButtonElement => {
		const button = el("button", {
			class: "attachment-card-button",
			text: label,
			attrs: { type: "button" },
		});
		button.addEventListener("click", () => {
			const file = current;
			hide();
			if (file !== null) run(file);
		});
		return button;
	};
	const card = el("div", {
		class: "attachment-card",
		attrs: { role: "dialog", "aria-label": t.confluenceAttachments, hidden: "" },
		children: [
			el("div", { class: "attachment-card-title", children: [icon("attach"), name] }),
			el("div", {
				class: "attachment-card-actions",
				children: [
					action(t.confluenceAttachmentOpen, options.open),
					action(t.confluenceAttachmentDownload, options.download),
					action(t.confluenceAttachmentsMore, options.manage),
				],
			}),
		],
	});
	document.body.append(card);

	let current: string | null = null;
	let link: HTMLAnchorElement | null = null;
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function hide(): void {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		card.hidden = true;
		current = null;
		link = null;
	}

	function show(target: HTMLAnchorElement, file: string): void {
		current = file;
		link = target;
		name.textContent = file;
		card.hidden = false;
		// Below the link, or above it when there is no room; kept inside the window.
		const box = target.getBoundingClientRect();
		const width = card.offsetWidth;
		const height = card.offsetHeight;
		const below = box.bottom + 6 + height <= window.innerHeight;
		card.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
		card.style.top = `${below ? box.bottom + 6 : Math.max(8, box.top - height - 6)}px`;
	}

	function linkAt(target: EventTarget | null): HTMLAnchorElement | null {
		const found = target instanceof Element ? target.closest("a") : null;
		return found !== null && host.contains(found) ? found : null;
	}

	host.addEventListener("mouseover", (event) => {
		const target = linkAt(event.target);
		if (target === null) return;
		clearTimeout(hideTimer);
		if (target === link) return;
		const file = options.attachmentOf(target);
		clearTimeout(showTimer);
		if (file === null) return;
		showTimer = setTimeout(() => show(target, file), card.hidden ? SHOW_DELAY : 0);
	});
	const leave = (event: MouseEvent): void => {
		const to = event.relatedTarget;
		if (to instanceof Node && (card.contains(to) || (link?.contains(to) ?? false))) return;
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		hideTimer = setTimeout(hide, HIDE_DELAY);
	};
	host.addEventListener("mouseout", (event) => {
		if (linkAt(event.target) !== null) leave(event);
	});
	card.addEventListener("mouseover", () => clearTimeout(hideTimer));
	card.addEventListener("mouseleave", leave);
	// Typing, clicking elsewhere or scrolling moves the link away from the card.
	host.addEventListener("keydown", hide);
	host.addEventListener("scroll", hide, true);
	document.addEventListener("mousedown", (event) => {
		if (!(event.target instanceof Node && card.contains(event.target))) hide();
	});
	card.addEventListener("keydown", (event) => {
		if (event.key === "Escape") hide();
	});

	return { hide };
}
