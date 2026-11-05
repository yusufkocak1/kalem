/**
 * What a kept Confluence atom (a mention, a link to a page, a date, an
 * inline macro such as a Jira issue or a status) is, for the card shown
 * when it is pointed at: its kind, its title, its details and where it
 * opens in the browser. Pure: the main process fills in what needs the
 * server (a user's name, Jira's address).
 */
import type { MarkupElement } from "./confluence-markup.js";
import { childElements, parseMarkup, textOf } from "./confluence-markup.js";
import type { JiraIssueRow } from "./jira.js";

export type AtomType =
	| "mention"
	| "page"
	| "blog-post"
	| "space"
	| "attachment"
	| "date"
	| "jira"
	| "status"
	| "anchor"
	| "macro";

/** Who a mention names, as the page stores it: Server's user key or name, Cloud's account id. */
export interface AtomUser {
	readonly key?: string;
	readonly accountId?: string;
	readonly username?: string;
}

export interface AtomDetails {
	readonly type: AtomType;
	/** What it is called: the issue key, the page title, the user's name, the macro's name. */
	readonly title: string;
	/** A second line: the space, the Jira server, the user name. */
	readonly subtitle: string;
	/** Its settings, as name and value. */
	readonly fields: readonly { readonly name: string; readonly value: string }[];
	/** Where it opens in the browser; `null` when nowhere (a date) or not known yet. */
	readonly url: string | null;
	/** What "Copy" copies: the key, the title, the date. */
	readonly copy: string;
	/** A linked Confluence page, which can also be opened in a tab. */
	readonly page?: { readonly spaceKey: string; readonly title: string };
	readonly user?: AtomUser;
	/** A Jira issue or search, whose address the main process looks up. */
	readonly jira?: { readonly serverId: string; readonly key: string; readonly jql: string };
	/** The Jira issue's summary and status, when the app reaches that Jira. */
	readonly issue?: JiraIssueRow;
	/** A status lozenge's colour. */
	readonly colour?: string;
}

/** Where the atom is: the page's site and space, to build addresses. */
export interface AtomPlace {
	/** The REST base, e.g. `https://acme.atlassian.net/wiki`. */
	readonly site: string;
	readonly spaceKey: string;
	/** The page's own address, for what only shows in Confluence. */
	readonly pageUrl: string;
}

/** Macro settings that say nothing to a reader. */
const HIDDEN_PARAMETERS = new Set([
	"",
	"macro-id",
	"schema-version",
	"atlassian-macro-output-type",
]);

const parameters = (macro: MarkupElement): { name: string; value: string }[] =>
	childElements(macro, "ac:parameter")
		.map((param) => ({ name: param.attrs.get("ac:name") ?? "", value: textOf(param).trim() }))
		.filter((param) => !HIDDEN_PARAMETERS.has(param.name) && param.value !== "");

const param = (fields: readonly { name: string; value: string }[], name: string): string =>
	fields.find((field) => field.name === name)?.value ?? "";

/** A page's address by its space and title, which every Confluence redirects to the page. */
export function displayUrl(site: string, spaceKey: string, title = "", anchor = ""): string {
	const path = `${site}/display/${encodeURIComponent(spaceKey)}`;
	if (title === "") return path;
	const page = `${path}/${encodeURIComponent(title).replace(/%20/g, "+")}`;
	return anchor === "" ? page : `${page}#${encodeURIComponent(anchor)}`;
}

function linkAtom(link: MarkupElement, place: AtomPlace): AtomDetails | null {
	const body =
		childElements(link, "ac:link-body")[0] ?? childElements(link, "ac:plain-text-link-body")[0];
	const shown = body === undefined ? "" : textOf(body).trim();
	const anchor = link.attrs.get("ac:anchor") ?? "";
	const user = childElements(link, "ri:user")[0];
	if (user !== undefined) {
		const key = user.attrs.get("ri:userkey") ?? "";
		const accountId = user.attrs.get("ri:account-id") ?? "";
		const username = user.attrs.get("ri:username") ?? "";
		const ref: AtomUser = {
			...(key === "" ? {} : { key }),
			...(accountId === "" ? {} : { accountId }),
			...(username === "" ? {} : { username }),
		};
		const name = shown || ref.username || "";
		return {
			type: "mention",
			title: name,
			subtitle: ref.username ?? "",
			fields: [],
			url:
				ref.username === undefined
					? null
					: `${place.site}/display/~${encodeURIComponent(ref.username)}`,
			copy: name,
			user: ref,
		};
	}
	const page = childElements(link, "ri:page")[0];
	if (page !== undefined) {
		const title = page.attrs.get("ri:content-title") ?? "";
		const spaceKey = page.attrs.get("ri:space-key") || place.spaceKey;
		return {
			type: "page",
			title: title || shown,
			subtitle: spaceKey,
			fields: shown !== "" && shown !== title ? [{ name: "text", value: shown }] : [],
			url: title === "" ? null : displayUrl(place.site, spaceKey, title, anchor),
			copy: title || shown,
			...(title === "" ? {} : { page: { spaceKey, title } }),
		};
	}
	const post = childElements(link, "ri:blog-post")[0];
	if (post !== undefined) {
		const title = post.attrs.get("ri:content-title") ?? "";
		const spaceKey = post.attrs.get("ri:space-key") || place.spaceKey;
		const day = (post.attrs.get("ri:posting-day") ?? "").replace(/-/g, "/");
		return {
			type: "blog-post",
			title: title || shown,
			subtitle: [spaceKey, post.attrs.get("ri:posting-day") ?? ""].filter(Boolean).join(" · "),
			fields: [],
			url:
				title === "" || day === ""
					? null
					: `${displayUrl(place.site, spaceKey)}/${day}/${encodeURIComponent(title).replace(/%20/g, "+")}`,
			copy: title || shown,
		};
	}
	const space = childElements(link, "ri:space")[0];
	if (space !== undefined) {
		const key = space.attrs.get("ri:space-key") ?? "";
		return {
			type: "space",
			title: shown || key,
			subtitle: key,
			fields: [],
			url: key === "" ? null : displayUrl(place.site, key),
			copy: key,
		};
	}
	return null;
}

function macroAtom(macro: MarkupElement, place: AtomPlace): AtomDetails {
	// kalem-locale-ok: macro names are ASCII
	const name = (macro.attrs.get("ac:name") ?? "").toLowerCase();
	const fields = parameters(macro);
	if (name === "jira") {
		const key = param(fields, "key");
		const jql = param(fields, "jqlQuery");
		return {
			type: "jira",
			title: key || jql || "Jira",
			subtitle: param(fields, "server"),
			fields: fields.filter((field) => !["key", "server", "serverId"].includes(field.name)),
			// Jira's address is not on the page: the main process looks it up.
			url: null,
			copy: key || jql,
			jira: { serverId: param(fields, "serverId"), key, jql },
		};
	}
	if (name === "status") {
		const title = param(fields, "title");
		return {
			type: "status",
			title,
			subtitle: "",
			fields: fields.filter((field) => !["title", "colour", "color"].includes(field.name)),
			url: null,
			copy: title,
			colour: param(fields, "colour") || param(fields, "color"),
		};
	}
	if (name === "anchor") {
		const anchor = textOf(macro).trim() || param(fields, "");
		const id = fields[0]?.value ?? anchor;
		return {
			type: "anchor",
			title: id,
			subtitle: "",
			fields: [],
			url: place.pageUrl === "" ? null : `${place.pageUrl}#${encodeURIComponent(id)}`,
			copy: id,
		};
	}
	// Any other macro shows only in Confluence: the page opens there.
	const link = fields.find((field) => /^https?:\/\//i.test(field.value));
	return {
		type: "macro",
		title: name,
		subtitle: "",
		fields,
		url: link?.value ?? (place.pageUrl === "" ? null : place.pageUrl),
		copy: name,
	};
}

/** What the atom whose XML this is shows and links to; `null` when it is not one. */
export function describeAtom(xml: string, place: AtomPlace): AtomDetails | null {
	const node = childElements(parseMarkup(xml))[0];
	if (node === undefined) return null;
	if (node.name === "time") {
		const date = node.attrs.get("datetime") ?? textOf(node).trim();
		return { type: "date", title: date, subtitle: "", fields: [], url: null, copy: date };
	}
	if (node.name === "ac:link") {
		const attachment = childElements(node, "ri:attachment")[0];
		if (attachment !== undefined) {
			const file = attachment.attrs.get("ri:filename") ?? "";
			return { type: "attachment", title: file, subtitle: "", fields: [], url: null, copy: file };
		}
		return linkAtom(node, place);
	}
	if (node.name === "ac:structured-macro" || node.name === "ac:macro")
		return macroAtom(node, place);
	return null;
}

/** A Jira issue's or search's address under Jira's base address. */
export function jiraUrl(
	base: string,
	jira: { readonly key: string; readonly jql: string },
): string | null {
	const root = base.replace(/\/+$/, "");
	if (root === "") return null;
	if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(jira.key)) return `${root}/browse/${jira.key}`;
	if (jira.jql !== "") return `${root}/issues/?jql=${encodeURIComponent(jira.jql)}`;
	return null;
}

/**
 * Jira's address among Confluence Server's application links, or the Jira
 * servers its Jira macro knows (`/rest/jiraanywhere/1.0/servers`, which any
 * user may read; then every entry is a Jira): the one with the macro's
 * server id, or else the only Jira, or else the one marked as the default.
 * The list's shape differs between versions, so any object with an id and
 * an address is looked at.
 */
export function jiraBaseFromLinks(data: unknown, serverId: string, allJira = false): string | null {
	const links: { id: string; url: string; jira: boolean; selected: boolean }[] = [];
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (typeof value !== "object" || value === null) return;
		const record = value as Record<string, unknown>;
		const url =
			typeof record.displayUrl === "string"
				? record.displayUrl
				: typeof record.rpcUrl === "string"
					? record.rpcUrl
					: typeof record.url === "string"
						? record.url
						: "";
		if (typeof record.id === "string" && /^https?:\/\//i.test(url)) {
			const type = `${String(record.typeId ?? record.type ?? "")}`;
			links.push({
				id: record.id,
				url,
				jira: allJira || /jira/i.test(type),
				selected: record.selected === true || record.primary === true,
			});
		}
		for (const child of Object.values(record)) visit(child);
	};
	visit(data);
	const exact = links.find((link) => serverId !== "" && link.id === serverId);
	if (exact !== undefined) return exact.url;
	const jiras = links.filter((link) => link.jira);
	if (jiras.length === 1) return jiras[0]?.url ?? null;
	return jiras.find((link) => link.selected)?.url ?? null;
}
