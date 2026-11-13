export type LinkKind = "confluence" | "pullRequest" | "commit" | "branch" | "repository";

export interface LinkCard {
	readonly kind: LinkKind;
	readonly title: string;
	readonly subtitle: string;
	readonly pageId: string | null;
}

const decodePart = (part: string): string => {
	try {
		return decodeURIComponent(part.replace(/\+/g, " "));
	} catch {
		return part.replace(/\+/g, " ");
	}
};

const looksLikeUrl = (text: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim());

function confluenceFromUrl(url: URL): LinkCard | null {
	const path = url.pathname;
	const display = /\/display\/([^/]+)\/([^/]+)\/?$/.exec(path);
	if (display !== null) {
		return {
			kind: "confluence",
			title: decodePart(display[2] as string),
			subtitle: decodePart(display[1] as string),
			pageId: null,
		};
	}
	const spaces = /\/spaces\/([^/]+)\/pages\/(\d+)(?:\/([^/]+))?/.exec(path);
	if (spaces !== null) {
		return {
			kind: "confluence",
			title: spaces[3] === undefined ? "" : decodePart(spaces[3]),
			subtitle: decodePart(spaces[1] as string),
			pageId: spaces[2] as string,
		};
	}
	if (/\/pages\/viewpage\.action$/i.test(path)) {
		const pageId = url.searchParams.get("pageId");
		const title = url.searchParams.get("title");
		const space = url.searchParams.get("spaceKey");
		if (pageId === null && title === null) return null;
		return {
			kind: "confluence",
			title: title ?? "",
			subtitle: space ?? "",
			pageId: pageId !== null && /^\d+$/.test(pageId) ? pageId : null,
		};
	}
	return null;
}

function gitFromUrl(url: URL): LinkCard | null {
	const path = url.pathname.replace(/\/+$/, "");
	const repo =
		/\/projects\/([^/]+)\/repos\/([^/]+)/.exec(path) ??
		/^\/([^/]+)\/([^/]+?)(?:\.git)?(?=\/|$)/.exec(path);
	if (repo === null) return null;
	const name = `${decodePart(repo[1] as string)}/${decodePart(repo[2] as string)}`;
	const pull = /\/(?:pull-requests|pull|merge_requests)\/(\d+)/.exec(path);
	if (pull !== null)
		return { kind: "pullRequest", title: `#${pull[1]}`, subtitle: name, pageId: null };
	const commit = /\/commits?\/([0-9a-f]{7,40})/i.exec(path);
	if (commit !== null) {
		return {
			kind: "commit",
			title: (commit[1] as string).slice(0, 10),
			subtitle: name,
			pageId: null,
		};
	}
	const branch = /\/(?:tree|branch|browse)\/?(.*)$/.exec(path);
	const at = url.searchParams.get("at");
	if (at !== null && /^refs\/heads\//.test(at)) {
		return {
			kind: "branch",
			title: at.replace(/^refs\/heads\//, ""),
			subtitle: name,
			pageId: null,
		};
	}
	if (branch !== null && /\/tree\//.test(path)) {
		return { kind: "branch", title: decodePart(branch[1] as string), subtitle: name, pageId: null };
	}
	return null;
}

const GIT_HOSTS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$|bitbucket|gitlab|^git\./i;
const CONFLUENCE_HOSTS = /confluence|wiki|\.atlassian\.net$/i;

export function linkCardOf(href: string, text: string): LinkCard | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	let card: LinkCard | null = null;
	if (CONFLUENCE_HOSTS.test(url.hostname) || /\/(display|spaces|pages)\//.test(url.pathname)) {
		card = confluenceFromUrl(url);
	}
	if (card === null && GIT_HOSTS.test(url.hostname)) card = gitFromUrl(url);
	if (card === null) return null;
	const label = text.trim();
	if (label === "" || looksLikeUrl(label)) return card;
	if (card.kind !== "confluence") return { ...card, title: label };
	const parts = label.split(/\s+-\s+/);
	if (parts.length > 1 && /^confluence$/i.test(parts.at(-1) ?? "")) parts.pop();
	return {
		...card,
		title: parts[0] ?? label,
		subtitle: parts.length > 1 ? parts.slice(1).join(" - ") : card.subtitle,
	};
}
