export interface PersonName {
	readonly name: string;
	readonly team: string;
	readonly full: string;
}

export interface JiraMention {
	readonly id: string;
	readonly name: string;
}

const TURKISH_UPPER = /[ÇĞİÖŞÜ]/;

function titleCase(text: string): string {
	if (/\p{Ll}/u.test(text)) return text;
	const locale = TURKISH_UPPER.test(text) ? "tr" : "en";
	return text
		.toLocaleLowerCase(locale)
		.split(/(\s+)/)
		.map((word) => {
			const [first = "", ...rest] = Array.from(word);
			return first.toLocaleUpperCase(locale) + rest.join("");
		})
		.join("");
}

function firstParenGroup(text: string, open: number): string {
	let depth = 0;
	for (let index = open; index < text.length; index++) {
		const char = text[index];
		if (char === "(") depth++;
		else if (char === ")" && --depth === 0) return text.slice(open + 1, index);
	}
	return text.slice(open + 1);
}

export function parsePersonName(displayName: string): PersonName {
	const full = displayName.trim().replace(/\s+/g, " ");
	const paren = full.indexOf("(");
	const dash = full.indexOf(" - ");
	let name = full;
	let team = "";
	if (paren > 0 && (dash < 0 || paren < dash)) {
		name = full.slice(0, paren);
		team = firstParenGroup(full, paren).split(/\s*\(|\s+-\s+/)[0] ?? "";
	} else if (dash > 0) {
		name = full.slice(0, dash);
		team = full.slice(dash + 3);
	}
	name = name.trim();
	return { name: name === "" ? full : titleCase(name), team: team.trim(), full };
}

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

function plainText(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
			if (name.startsWith("#")) {
				const hex = name[1] === "x" || name[1] === "X";
				const code = hex ? parseInt(name.slice(2), 16) : Number(name.slice(1));
				return Number.isFinite(code) && code > 0 && code < 0x110000
					? String.fromCodePoint(code)
					: whole;
			}
			return ENTITIES[name.toLowerCase()] ?? whole; // kalem-locale-ok: entity names are ASCII
		})
		.replace(/\s+/g, " ")
		.trim();
}

export function mentionIdFromHref(href: string): string | null {
	const decode = (value: string): string => {
		try {
			return decodeURIComponent(value.replace(/\+/g, " "));
		} catch {
			return value;
		}
	};
	const profile = /ViewProfile\.jspa\?(?:[^#]*&)?name=([^&#]+)/i.exec(href);
	if (profile?.[1] !== undefined) return decode(profile[1]);
	const account = /[?&]accountId=([^&#]+)/i.exec(href);
	if (account?.[1] !== undefined) return decode(account[1]);
	const people = /\/(?:jira\/)?people\/([^/?#]+)\/?(?:[?#]|$)/i.exec(href);
	if (people?.[1] !== undefined) return decode(people[1]);
	return null;
}

const attribute = (attrs: string, name: string): string | null => {
	const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
	return match === null ? null : (match[1] ?? match[2] ?? "");
};

export function mentionsOf(renderedHtml: string | null, rawBody: string): JiraMention[] {
	const found = new Map<string, string>();
	for (const match of (renderedHtml ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
		const attrs = match[1] ?? "";
		const href = attribute(attrs, "href") ?? "";
		const hover = /\buser-hover\b/i.test(attribute(attrs, "class") ?? "");
		const id =
			attribute(attrs, "data-username") ??
			attribute(attrs, "data-account-id") ??
			(hover ? attribute(attrs, "rel") : null) ??
			mentionIdFromHref(href);
		if (id === null || id === "") continue;
		if (!hover && mentionIdFromHref(href) === null && attribute(attrs, "data-username") === null) {
			continue;
		}
		const name = plainText(match[2] ?? "").replace(/^@/, "");
		if (!found.has(id) || found.get(id) === id) found.set(id, name === "" ? id : name);
	}
	for (const match of rawBody.matchAll(/\[~(?:accountid:)?([^\]|]+)\]/gi)) {
		const id = (match[1] ?? "").trim();
		if (id !== "" && !found.has(id)) found.set(id, id);
	}
	return [...found].map(([id, name]) => ({ id, name }));
}

const EMPTY_PARAGRAPH = /<(p|div)\b[^>]*>(?:\s|&nbsp;|&#160;| |<br\s*\/?>)*<\/\1>/gi;

export function compactCommentHtml(html: string): string {
	let result = html;
	let previous = "";
	while (previous !== result) {
		previous = result;
		result = result.replace(EMPTY_PARAGRAPH, "");
	}
	return result
		.replace(/(?:<br\s*\/?>\s*(?:&nbsp;|&#160;| )?\s*){2,}/gi, "<br>")
		.replace(/(<(?:p|div)\b[^>]*>)\s*(?:<br\s*\/?>\s*)+/gi, "$1")
		.replace(/(?:\s*<br\s*\/?>)+\s*(<\/(?:p|div)>)/gi, "$1")
		.replace(/^(?:\s|<br\s*\/?>)+|(?:\s|<br\s*\/?>)+$/gi, "");
}

export function compactCommentText(text: string): string {
	return text
		.replace(/ /g, " ")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export const SHORT_COMMENT_LENGTH = 120;

export function isShortComment(text: string, html: string | null): boolean {
	const body = compactCommentText(text);
	if (body === "" || body.includes("\n") || body.length > SHORT_COMMENT_LENGTH) return false;
	return html === null || !/<(?:img|table|ul|ol|pre|blockquote|h[1-6])\b/i.test(html);
}

export interface DateLabel {
	readonly short: string;
	readonly full: string;
}

export function shortDateTime(value: string | null, lang: string, now = new Date()): DateLabel {
	if (value === null) return { short: "", full: "" };
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return { short: value, full: value };
	const sameYear = date.getFullYear() === now.getFullYear();
	const short = new Intl.DateTimeFormat(lang, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(date);
	const full = new Intl.DateTimeFormat(lang, { dateStyle: "full", timeStyle: "short" }).format(
		date,
	);
	return { short, full };
}

export function formatDurationShort(seconds: number, hourUnit: string, minuteUnit: string): string {
	const minutes = Math.max(0, Math.round(seconds / 60));
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0 && rest === 0) return `0${minuteUnit}`;
	return [hours > 0 ? `${hours}${hourUnit}` : "", rest > 0 ? `${rest}${minuteUnit}` : ""]
		.filter(Boolean)
		.join(" ");
}

export interface TimeBar {
	readonly value: number;
	readonly max: number;
}

export function timeBar(spent: number, remaining: number | null, estimate: number | null): TimeBar {
	const left = remaining ?? 0;
	if (left > 0) return { value: spent, max: spent + left };
	if (estimate !== null && estimate > spent) return { value: spent, max: estimate };
	return { value: 1, max: 1 };
}

const BOT_NAME = /bot\b|\bbot|jira|admin|automation|system/i;

export function isBotAuthor(name: string, id: string): boolean {
	return BOT_NAME.test(parsePersonName(name).name) || BOT_NAME.test(id);
}

export function hasAttachment(body: string, html: string | null): boolean {
	if (html !== null && /<img\b|\/secure\/attachment\//i.test(html)) return true;
	return /![^!\s][^!\n]*!|\[\^[^\]]+\]|!\[[^\]]*\]\(/.test(body);
}

export interface CommentFilter {
	readonly attachmentsOnly: boolean;
	readonly humansOnly: boolean;
	readonly person: string | null;
	readonly team: string | null;
}

export const NO_COMMENT_FILTER: CommentFilter = {
	attachmentsOnly: false,
	humansOnly: false,
	person: null,
	team: null,
};

interface FilterableComment {
	readonly author: string;
	readonly authorId: string;
	readonly body: string;
	readonly html: string | null;
}

export function filterComments<T extends FilterableComment>(
	comments: readonly T[],
	filter: CommentFilter,
): T[] {
	return comments.filter((comment) => {
		if (filter.humansOnly && isBotAuthor(comment.author, comment.authorId)) return false;
		if (filter.attachmentsOnly && !hasAttachment(comment.body, comment.html)) return false;
		const person = parsePersonName(comment.author);
		if (filter.person !== null && person.name !== filter.person) return false;
		if (filter.team !== null && person.team !== filter.team) return false;
		return true;
	});
}

export function commentPeople(comments: readonly FilterableComment[]): {
	readonly people: string[];
	readonly teams: string[];
} {
	const people = new Set<string>();
	const teams = new Set<string>();
	for (const comment of comments) {
		const person = parsePersonName(comment.author);
		people.add(person.name);
		if (person.team !== "") teams.add(person.team);
	}
	const sort = (values: Set<string>): string[] =>
		[...values].sort((a, b) => a.localeCompare(b, "tr"));
	return { people: sort(people), teams: sort(teams) };
}

export function applyMentions(text: string, mentions: ReadonlyMap<string, string>): string {
	let result = text;
	const names = [...mentions.keys()].sort((a, b) => b.length - a.length);
	for (const name of names) result = result.split(`@${name}`).join(mentions.get(name) ?? "");
	return result;
}
