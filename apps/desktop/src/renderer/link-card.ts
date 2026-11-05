import type { AtomDetails, AtomPlace, AtomType } from "../shared/confluence-atoms.js";
import { describeAtom } from "../shared/confluence-atoms.js";
import { ATOM_PREFIX } from "../shared/confluence-storage.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { issueKeyFromUrl } from "../shared/jira.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import { statusLozenge } from "./jira-dialog.js";

/** A Jira issue or search to show in Kalem, and where it opens in the browser when known. */
export interface JiraTarget {
	readonly key: string;
	readonly jql: string;
	readonly url: string | null;
}

export interface LinkCardOptions {
	readonly t: Strings;
	readonly lang: string;
	/** Where the document's links are. */
	readonly host: HTMLElement;
	/** The active tab's Confluence page, when it is one. */
	place(): (AtomPlace & { readonly tabId: string }) | null;
	/** The XML of a kept atom of the active page by its link. */
	atomSource(href: string): string | null;
	/** The atom described with what the server knows (a user's name, Jira's address). */
	resolve(tabId: string, xml: string): Promise<AtomDetails | null>;
	/** Whether the link is to an attachment, which has a card of its own. */
	isAttachment(link: HTMLAnchorElement): boolean;
	openLink(url: string): void;
	/** Opens a Confluence page in a tab of this window. */
	openPage(spaceKey: string, title: string): Promise<void>;
	/** Shows a Jira issue or search in Kalem. */
	openJira(target: JiraTarget): void;
	/** Shows that something failed. */
	notice(text: string): void;
}

const SHOW_DELAY = 450;
const HIDE_DELAY = 250;

/** What the card holds: a kept Confluence atom, or a link with its address. */
type Target =
	| { readonly kind: "atom"; readonly xml: string; details: AtomDetails; resolved: boolean }
	| { readonly kind: "link"; readonly url: string; readonly text: string };

const ATOM_ICONS: Readonly<Record<AtomType, IconName>> = {
	mention: "chats",
	page: "file",
	"blog-post": "file",
	space: "open",
	attachment: "attach",
	date: "table",
	jira: "link",
	status: "star",
	anchor: "link",
	macro: "braces",
};

/** Whether a link is a kept Confluence atom (a mention, a page link, a Jira issue…). */
export const isAtomLink = (link: Element): boolean =>
	(link.getAttribute("href") ?? "").startsWith(ATOM_PREFIX);

/**
 * A card over a link or a kept Confluence atom in the document, shown when
 * the pointer rests on it: what it is (a Jira issue with its server, a
 * mentioned user with their name, a linked page with its space, a macro
 * with its settings), where it leads, and buttons to open it in the
 * browser, open a linked page or a Jira issue in Kalem or copy it. A click
 * on a Jira issue opens it in Kalem; on another atom it opens it in the
 * browser at once; one that leads nowhere shows the card.
 */
export function createLinkCard(options: LinkCardOptions): { hide(): void } {
	const { t, host } = options;
	const card = el("div", {
		class: "link-card",
		// Its capitals follow the interface's language (i → İ in Turkish).
		attrs: { role: "dialog", hidden: "", "aria-live": "polite", lang: options.lang },
	});
	document.body.append(card);

	let target: Target | null = null;
	let link: HTMLAnchorElement | null = null;
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** Asked for once per atom while the page is open; a user's name does not change meanwhile. */
	const resolved = new Map<string, Promise<AtomDetails | null>>();

	const typeLabel = (details: AtomDetails): string => {
		switch (details.type) {
			case "mention":
				return t.atomMention;
			case "page":
				return t.atomPage;
			case "blog-post":
				return t.atomBlogPost;
			case "space":
				return t.atomSpace;
			case "attachment":
				return t.atomAttachment;
			case "date":
				return t.atomDate;
			case "jira":
				return details.jira?.key === "" ? t.atomJiraSearch : t.atomJira;
			case "status":
				return t.atomStatus;
			case "anchor":
				return t.atomAnchor;
			case "macro":
				return format(t.atomMacro, details.title);
		}
	};

	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "full" });
	function dateText(value: string): string {
		const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : null;
		return date === null || Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
	}

	function action(
		label: string,
		name: IconName,
		run: () => void | Promise<void>,
		primary = false,
	): HTMLButtonElement {
		const button = el("button", {
			class: `link-card-button${primary ? " primary" : ""}`,
			attrs: { type: "button" },
			children: [icon(name), label],
		});
		button.addEventListener("click", async () => {
			try {
				await run();
			} catch (error) {
				options.notice(error instanceof Error ? error.message : String(error));
			}
		});
		return button;
	}

	function copyAction(label: string, text: string): HTMLButtonElement {
		const button = action(label, "copy", async () => {
			await navigator.clipboard.writeText(text);
			const last = button.lastChild;
			if (last !== null) last.textContent = t.linkCopied;
			setTimeout(() => {
				if (button.lastChild !== null) button.lastChild.textContent = label;
			}, 1200);
		});
		return button;
	}

	function openAction(url: string, primary = true): HTMLButtonElement {
		return action(
			t.linkOpenBrowser,
			"open",
			() => {
				hide();
				options.openLink(url);
			},
			primary,
		);
	}

	/** Opens the Jira issue or search in Kalem: always there, whether or not Jira's address is known. */
	function jiraAction(jira: JiraTarget): HTMLButtonElement {
		return action(
			t.jiraOpen,
			"open",
			() => {
				hide();
				options.openJira(jira);
			},
			true,
		);
	}

	function render(): void {
		if (target === null) return;
		const children: HTMLElement[] = [];
		const buttons: HTMLElement[] = [];
		if (target.kind === "link") {
			const key = issueKeyFromUrl(target.url);
			children.push(
				el("div", {
					class: "link-card-kind",
					children: [icon("link"), key === null ? t.linkCardLink : `${t.atomJira} · ${key}`],
				}),
				...(target.text !== "" && target.text !== target.url
					? [el("div", { class: "link-card-title", text: target.text })]
					: []),
				el("div", { class: "link-card-url", text: target.url, attrs: { title: target.url } }),
			);
			if (key !== null) buttons.push(jiraAction({ key, jql: "", url: target.url }));
			buttons.push(openAction(target.url, key === null), copyAction(t.linkCopyUrl, target.url));
			children.push(el("div", { class: "link-card-actions", children: buttons }));
			children.push(el("p", { class: "link-card-hint", text: t.linkCardEditHint }));
		} else {
			const details = target.details;
			children.push(
				el("div", {
					class: "link-card-kind",
					children: [icon(ATOM_ICONS[details.type]), typeLabel(details)],
				}),
			);
			const title =
				details.type === "date"
					? dateText(details.title)
					: details.type === "macro"
						? ""
						: details.title;
			if (title !== "") {
				const heading = el("div", { class: "link-card-title", text: title });
				if (details.type === "status") {
					heading.classList.add("link-card-status");
					heading.dataset.colour = (details.colour ?? "grey").toLowerCase(); // kalem-locale-ok: colour names are ASCII
				}
				children.push(heading);
			}
			if (details.subtitle !== "") {
				children.push(el("div", { class: "link-card-subtitle", text: details.subtitle }));
			}
			const issue = details.issue;
			if (issue !== undefined) {
				children.push(
					el("div", {
						class: "link-card-issue",
						children: [
							el("span", { class: "jira-summary", text: issue.summary }),
							...(issue.status === "" ? [] : [statusLozenge(issue.status, issue.statusCategory)]),
						],
					}),
				);
				const facts = [issue.type, issue.assignee].filter((part) => part !== "").join(" · ");
				if (facts !== "") children.push(el("div", { class: "link-card-subtitle", text: facts }));
			}
			if (details.fields.length > 0) {
				children.push(
					el("dl", {
						class: "link-card-fields",
						children: details.fields
							.slice(0, 10)
							.flatMap((field) => [
								el("dt", { text: field.name }),
								el("dd", { text: field.value, attrs: { title: field.value } }),
							]),
					}),
				);
			}
			if (details.url !== null) {
				children.push(
					el("div", { class: "link-card-url", text: details.url, attrs: { title: details.url } }),
				);
			} else if (!target.resolved && (details.type === "jira" || details.type === "mention")) {
				children.push(el("div", { class: "link-card-url loading", text: t.confluenceLoading }));
			} else if (details.type === "jira") {
				children.push(el("p", { class: "link-card-hint", text: t.atomJiraUnknown }));
			}
			const jira = details.jira;
			if (jira !== undefined && (jira.key !== "" || jira.jql !== "")) {
				buttons.push(jiraAction({ key: jira.key, jql: jira.jql, url: details.url }));
			}
			if (details.url !== null) buttons.push(openAction(details.url, jira === undefined));
			const page = details.page;
			if (page !== undefined) {
				buttons.push(
					action(t.linkOpenInKalem, "file", async () => {
						hide();
						await options.openPage(page.spaceKey, page.title);
					}),
				);
			}
			if (details.copy !== "") buttons.push(copyAction(t.linkCopy, details.copy));
			if (details.url !== null) buttons.push(copyAction(t.linkCopyUrl, details.url));
			if (buttons.length > 0) {
				children.push(el("div", { class: "link-card-actions", children: buttons }));
			}
			children.push(
				el("p", {
					class: "link-card-hint",
					text:
						details.type === "macro"
							? t.atomOnlyInConfluence
							: details.type === "jira"
								? t.atomJiraOpenHint
								: t.confluenceAtomHint,
				}),
			);
		}
		card.replaceChildren(...children);
		card.setAttribute(
			"aria-label",
			target.kind === "link" ? t.linkCardLink : typeLabel(target.details),
		);
		place();
	}

	/** Below the link, or above it when there is no room; kept inside the window. */
	function place(): void {
		if (link === null || card.hidden) return;
		const box = link.getBoundingClientRect();
		const width = card.offsetWidth;
		const height = card.offsetHeight;
		const below = box.bottom + 6 + height <= window.innerHeight;
		card.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
		card.style.top = `${below ? box.bottom + 6 : Math.max(8, box.top - height - 6)}px`;
	}

	/** What a link is: a kept atom of the page, a web link, or nothing the card is for. */
	function targetOf(anchor: HTMLAnchorElement): Target | null {
		const href = anchor.getAttribute("href") ?? "";
		if (href === "" || options.isAttachment(anchor)) return null;
		if (href.startsWith(ATOM_PREFIX)) {
			const where = options.place();
			const xml = options.atomSource(href);
			if (where === null || xml === null) return null;
			const details = describeAtom(xml, where);
			return details === null ? null : { kind: "atom", xml, details, resolved: false };
		}
		if (href.startsWith("#")) return null;
		return { kind: "link", url: href, text: (anchor.textContent ?? "").trim() };
	}

	/** The atom with what the server knows; the card updates when it arrives. */
	function resolve(atom: Extract<Target, { kind: "atom" }>): Promise<AtomDetails | null> {
		const where = options.place();
		if (where === null) return Promise.resolve(null);
		let request = resolved.get(atom.xml);
		if (request === undefined) {
			request = options.resolve(where.tabId, atom.xml).catch(() => null);
			resolved.set(atom.xml, request);
		}
		return request.then((details) => {
			// A Jira issue without its summary is asked again: Jira may be connected meanwhile.
			if (details?.type === "jira" && details.issue === undefined) resolved.delete(atom.xml);
			atom.resolved = true;
			if (details !== null) atom.details = details;
			if (target === atom) render();
			return details;
		});
	}

	function show(anchor: HTMLAnchorElement, found: Target): void {
		target = found;
		link = anchor;
		card.hidden = false;
		render();
		if (found.kind === "atom" && !found.resolved) void resolve(found);
	}

	function hide(): void {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		card.hidden = true;
		target = null;
		link = null;
	}

	function linkAt(eventTarget: EventTarget | null): HTMLAnchorElement | null {
		const found = eventTarget instanceof Element ? eventTarget.closest("a") : null;
		return found !== null && host.contains(found) ? found : null;
	}

	host.addEventListener("mouseover", (event) => {
		const anchor = linkAt(event.target);
		if (anchor === null) return;
		clearTimeout(hideTimer);
		if (anchor === link) return;
		clearTimeout(showTimer);
		const found = targetOf(anchor);
		if (found === null) return;
		showTimer = setTimeout(() => show(anchor, found), card.hidden ? SHOW_DELAY : 0);
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

	// A click on an atom opens it in the browser; one that leads nowhere shows the card.
	host.addEventListener(
		"click",
		(event) => {
			const anchor = linkAt(event.target);
			if (anchor === null || !isAtomLink(anchor) || event.button !== 0) return;
			const found = targetOf(anchor);
			if (found === null || found.kind !== "atom") return;
			event.preventDefault();
			event.stopPropagation();
			clearTimeout(showTimer);
			const jira = found.details.jira;
			// A Jira issue opens in Kalem, with its address for the browser once it is known.
			if (jira !== undefined && (jira.key !== "" || jira.jql !== "")) {
				hide();
				void resolve(found).then((details) =>
					options.openJira({ key: jira.key, jql: jira.jql, url: details?.url ?? null }),
				);
				return;
			}
			const open = (details: AtomDetails): boolean => {
				if (details.url === null) return false;
				hide();
				options.openLink(details.url);
				return true;
			};
			if (open(found.details)) return;
			// A user's profile comes from the server.
			if (found.details.type === "jira" || found.details.type === "mention") {
				void resolve(found).then((details) => {
					if (details === null || !open(details)) show(anchor, found);
				});
				return;
			}
			show(anchor, found);
		},
		true,
	);

	// Typing, clicking elsewhere or scrolling moves the link away from the card.
	host.addEventListener("keydown", hide);
	host.addEventListener("scroll", hide, true);
	document.addEventListener("mousedown", (event) => {
		if (!(event.target instanceof Node && card.contains(event.target))) hide();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !card.hidden) hide();
	});

	return {
		hide() {
			hide();
			resolved.clear();
		},
	};
}
