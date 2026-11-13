import type { Root } from "@kalem-editor/core";
import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import type { JiraAttachment } from "../shared/jira-fields.js";
import { attachmentFor } from "../shared/jira-fields.js";
import type { LinkCard } from "../shared/jira-links.js";
import { linkCardOf } from "../shared/jira-links.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";
import type { ImageViewer } from "./image-viewer.js";

export interface RichContentOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly attachments: readonly JiraAttachment[];
	readonly issueUrl: string;
	readonly viewer: ImageViewer;
	openLink(url: string): void;
	onConfluencePageOpened(): void;
}

export const PENDING_IMAGE =
	"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export function holdImages(root: Root): Root {
	const visit = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		const record = node as { type?: unknown; url?: unknown; title?: unknown; children?: unknown };
		if (
			record.type === "image" &&
			typeof record.url === "string" &&
			!record.url.startsWith("data:")
		) {
			record.title = record.url;
			record.url = PENDING_IMAGE;
		}
		if (Array.isArray(record.children)) record.children.forEach(visit);
	};
	visit(root);
	return root;
}

export const jiraAttachmentSrc = (file: JiraAttachment): string =>
	`kalem-doc://jira/${file.id}/${encodeURIComponent(file.filename)}`;

function fileNameOf(src: string): string {
	const name = src.split(/[?#]/)[0]?.split("/").pop() ?? "";
	try {
		return decodeURIComponent(name);
	} catch {
		return name;
	}
}

function missingImage(name: string, url: string, options: RichContentOptions): HTMLElement {
	const open = el("a", {
		class: "jira-attachment-open",
		text: options.t.jiraOpenInJira,
		attrs: { href: url },
	});
	open.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		options.openLink(url);
	});
	return el("span", {
		class: "jira-attachment-missing",
		children: [icon("image"), el("span", { class: "jira-attachment-name", text: name }), open],
	});
}

export function decorateImages(root: HTMLElement, options: RichContentOptions): void {
	const images = [...root.querySelectorAll<HTMLImageElement>("img")];
	const shown: HTMLImageElement[] = [];
	for (const image of images) {
		const pending = image.getAttribute("src") === PENDING_IMAGE;
		const src = (pending ? image.getAttribute("title") : image.getAttribute("src")) ?? "";
		if (pending) image.removeAttribute("title");
		const file = attachmentFor(src, options.attachments);
		const external = /^(?:https?:|data:)/i.test(src) && file === null;
		const name = file?.filename ?? (fileNameOf(src) || src);
		const openUrl = file?.url || options.issueUrl;
		if (!external && file === null) {
			image.replaceWith(missingImage(name, openUrl, options));
			continue;
		}
		image.src = file === null ? src : jiraAttachmentSrc(file);
		if (image.getAttribute("alt") === null || image.alt === "") image.alt = name;
		image.loading = "lazy";
		const thumb = el("button", {
			class: "jira-thumb",
			attrs: { type: "button", title: name, "aria-label": name },
		});
		image.replaceWith(thumb);
		thumb.append(image);
		shown.push(image);
		thumb.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			options.viewer.open(
				image,
				shown.filter((item) => item.isConnected && item.complete),
			);
		});
		image.addEventListener(
			"error",
			() => {
				thumb.replaceWith(missingImage(name, openUrl, options));
			},
			{ once: true },
		);
	}
}

const CARD_ICONS: Record<LinkCard["kind"], IconName> = {
	confluence: "confluence",
	pullRequest: "gitPull",
	commit: "branch",
	branch: "branch",
	repository: "branch",
};

function titleFallback(href: string, card: LinkCard, t: Strings): string {
	if (card.kind === "confluence") {
		return card.pageId === null ? t.jiraConfluencePage : `${t.jiraConfluencePage} ${card.pageId}`;
	}
	try {
		return new URL(href).pathname.split("/").filter(Boolean).pop() ?? href;
	} catch {
		return href;
	}
}

export function decorateLinkCards(root: HTMLElement, options: RichContentOptions): void {
	for (const link of [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]) {
		const href = link.getAttribute("href") ?? "";
		const card = linkCardOf(href, link.textContent ?? "");
		if (card === null) continue;
		let host = "";
		try {
			host = new URL(href).host;
		} catch {}
		const title = el("span", {
			class: "jira-link-card-title",
			text: card.title === "" ? titleFallback(href, card, options.t) : card.title,
		});
		const subtitle = el("span", {
			class: "jira-link-card-subtitle",
			text: [card.subtitle, host].filter(Boolean).join(" · "),
		});
		const element = el("a", {
			class: "jira-link-card",
			attrs: { href, title: href, "data-kind": card.kind },
			children: [
				icon(CARD_ICONS[card.kind]),
				el("span", { class: "jira-link-card-text", children: [title, subtitle] }),
			],
		});
		let pageId = card.pageId;
		if (card.kind === "confluence" && card.title === "") {
			void options.bridge
				.confluenceSearch(href, null)
				.then(([page]) => {
					if (page === undefined) return;
					title.textContent = page.title;
					pageId = page.id;
				})
				.catch(() => {});
		}
		element.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (card.kind !== "confluence" || pageId === null) {
				options.openLink(href);
				return;
			}
			options.bridge
				.confluenceOpenPage(pageId)
				.then(() => options.onConfluencePageOpened())
				.catch(() => options.openLink(href));
		});
		link.replaceWith(element);
	}
}
