import type { JiraComment } from "../shared/jira.js";
import type { JiraMention } from "../shared/jira-comments.js";
import {
	compactCommentHtml,
	compactCommentText,
	isShortComment,
	mentionIdFromHref,
	parsePersonName,
	shortDateTime,
} from "../shared/jira-comments.js";
import { el } from "./dom.js";

export interface CommentViewOptions {
	readonly lang: string;
	richText(markdown: string, html: string | null): HTMLElement;
}

export function personMark(name: string): HTMLElement {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const initials = [words[0], words.length > 1 ? words.at(-1) : undefined]
		.map((word) => (word === undefined ? "" : (Array.from(word)[0] ?? "")))
		.join("");
	let hash = 0;
	for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
	return el("span", {
		class: "jira-avatar jira-avatar-mark",
		attrs: { "aria-hidden": "true", "data-initials": initials, "data-tone": String(hash % 8) },
	});
}

export function mentionChip(displayName: string): HTMLElement {
	const person = parsePersonName(displayName);
	return el("span", {
		class: "jira-mention",
		text: `@${person.name}`,
		attrs: { title: person.full },
	});
}

function decorateMentions(root: HTMLElement, mentions: readonly JiraMention[]): void {
	const names = new Map(mentions.map((mention) => [mention.id, mention.name]));
	for (const link of [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]) {
		const id = mentionIdFromHref(link.getAttribute("href") ?? "");
		if (id === null) continue;
		const text = (link.textContent ?? "").trim().replace(/^@/, "");
		link.replaceWith(mentionChip(names.get(id) ?? (text === "" ? id : text)));
	}
	if (names.size === 0) return;
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		if (node instanceof Text && node.data.includes("@")) nodes.push(node);
	}
	for (const node of nodes) {
		const parts = node.data.split(/(@[\w.@-]*\w)/);
		if (parts.length === 1) continue;
		const replaced = parts.map((part) => {
			const name = part.startsWith("@") ? names.get(part.slice(1)) : undefined;
			return name === undefined ? document.createTextNode(part) : mentionChip(name);
		});
		if (replaced.some((part) => part instanceof HTMLElement)) node.replaceWith(...replaced);
	}
}

function dropEmptyBlocks(root: HTMLElement): void {
	for (const block of [...root.querySelectorAll("p, div")]) {
		const hasContent = block.querySelector("img, table, pre, ul, ol, .jira-mention") !== null;
		if (!hasContent && (block.textContent ?? "").trim() === "") block.remove();
	}
	for (const br of [...root.querySelectorAll("br")]) {
		const next = br.nextSibling;
		const blankNext = next instanceof Text && next.data.trim() === "" ? next.nextSibling : next;
		if (blankNext instanceof HTMLBRElement || br.parentElement?.lastChild === br) br.remove();
	}
}

export function commentView(comment: JiraComment, options: CommentViewOptions): HTMLElement {
	const person = parsePersonName(comment.author);
	const date = shortDateTime(comment.created, options.lang);
	const body = options.richText(
		compactCommentText(comment.body),
		comment.html === null ? null : compactCommentHtml(comment.html),
	);
	decorateMentions(body, comment.mentions);
	dropEmptyBlocks(body);
	const short = isShortComment(comment.body, comment.html);
	const name = el("strong", {
		class: "jira-comment-author",
		text: person.name,
		attrs: { title: person.full },
	});
	const head: HTMLElement[] = [personMark(person.name), name];
	if (person.team !== "") {
		head.push(
			el("span", { class: "jira-team-badge", text: person.team, attrs: { title: person.full } }),
		);
	}
	const time = el("time", {
		class: "jira-comment-time",
		text: date.short,
		attrs: { title: date.full, ...(comment.created === null ? {} : { datetime: comment.created }) },
	});
	if (short) {
		body.classList.add("jira-comment-inline");
		return el("article", {
			class: "jira-comment jira-comment-short",
			attrs: { "data-author": comment.authorId },
			children: [...head, body, time],
		});
	}
	return el("article", {
		class: "jira-comment",
		attrs: { "data-author": comment.authorId },
		children: [el("div", { class: "jira-comment-head", children: [...head, time] }), body],
	});
}
