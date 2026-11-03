/**
 * Searching Confluence from the side pane: what the search box and its
 * filters ask for, as CQL, and the highlighted excerpts of the results.
 * Pure: the main process sends the query, the pane shows the results.
 */

/** Where the words are looked for: in titles only, or in the whole page (title, text, labels). */
export type SearchMode = "title" | "content";
export type SearchSort = "relevance" | "modified" | "title";
/** How recently the page was changed. */
export type SearchPeriod = "any" | "day" | "week" | "month" | "year";

export interface ConfluenceSearchRequest {
	readonly query: string;
	/** `null` for every space. */
	readonly spaceKey: string | null;
	readonly mode: SearchMode;
	readonly sort: SearchSort;
	readonly period: SearchPeriod;
	/** Only pages the signed-in user created or edited. */
	readonly mine: boolean;
	/** Only pages with this label; empty for any. */
	readonly label: string;
	/** Only pages below this page; `null` for anywhere. */
	readonly ancestor: string | null;
	/** The next page of results, as the previous answer gave it. */
	readonly cursor?: string | null;
}

/** A piece of a title or an excerpt; `hit` when the search matched it. */
export interface TextPart {
	readonly text: string;
	readonly hit: boolean;
}

export interface ConfluenceSearchHit {
	readonly id: string;
	readonly title: string;
	readonly titleParts: readonly TextPart[];
	readonly spaceName: string;
	readonly spaceKey: string;
	/** ISO date, when the server reports it. */
	readonly modified: string | null;
	/** The text around the words found; empty in a title search. */
	readonly excerpt: readonly TextPart[];
	/** The titles of the pages above it, top first. */
	readonly path: readonly string[];
}

export interface ConfluenceSearchResults {
	readonly hits: readonly ConfluenceSearchHit[];
	/** How many pages match in all, when the server says. */
	readonly total: number | null;
	/** Asks for the next results; `null` when there are no more. */
	readonly next: string | null;
}

export const SEARCH_MODES: readonly SearchMode[] = ["title", "content"];
export const SEARCH_SORTS: readonly SearchSort[] = ["relevance", "modified", "title"];
export const SEARCH_PERIODS: readonly SearchPeriod[] = ["any", "day", "week", "month", "year"];
export const SEARCH_PAGE_SIZE = 25;

export const DEFAULT_SEARCH: Omit<ConfluenceSearchRequest, "query" | "spaceKey"> = {
	mode: "title",
	sort: "relevance",
	period: "any",
	mine: false,
	label: "",
	ancestor: null,
};

/** A CQL string literal. */
export function cqlString(value: string): string {
	return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/** What a content search looks for: words, "exact phrases" and -excluded words. */
export interface QueryTerms {
	readonly words: readonly string[];
	readonly phrases: readonly string[];
	readonly excluded: readonly string[];
}

/** Characters that mean something to Confluence's (Lucene) search; they are dropped from words. */
const SPECIAL = /[+\-&|!(){}[\]^"~*?:\\/]/g;

export function queryTerms(query: string): QueryTerms {
	const words: string[] = [];
	const phrases: string[] = [];
	const excluded: string[] = [];
	const pattern = /(-?)"([^"]*)"?|(\S+)/g;
	for (const match of query.matchAll(pattern)) {
		if (match[2] !== undefined) {
			const phrase = match[2].replace(SPECIAL, " ").replace(/\s+/g, " ").trim();
			if (phrase === "") continue;
			if (match[1] === "-") excluded.push(phrase);
			else phrases.push(phrase);
			continue;
		}
		const token = match[3] ?? "";
		const negative = token.length > 1 && token.startsWith("-");
		const word = (negative ? token.slice(1) : token).replace(SPECIAL, "");
		if (word === "") continue;
		if (negative) excluded.push(word);
		else words.push(word);
	}
	return { words, phrases, excluded };
}

const PERIOD: Readonly<Record<Exclude<SearchPeriod, "any">, string>> = {
	day: "-1d",
	week: "-1w",
	month: "-4w",
	year: "-52w",
};

/**
 * The CQL for a search. A title search finds titles starting with the
 * words; a content search finds pages holding every word and phrase (the
 * last word also as the start of a longer one, so results come while
 * typing) and none of the excluded ones.
 */
export function searchCql(request: ConfluenceSearchRequest): string {
	const where = ["type=page"];
	if (request.spaceKey !== null && request.spaceKey !== "") {
		where.push(`space=${cqlString(request.spaceKey)}`);
	}
	if (request.ancestor !== null && /^\d+$/.test(request.ancestor)) {
		where.push(`ancestor=${request.ancestor}`);
	}
	const text = request.query.trim();
	if (request.mode === "title") {
		if (text !== "") where.push(`title~${cqlString(`${text}*`)}`);
	} else {
		const { words, phrases, excluded } = queryTerms(text);
		const typing = !/\s$/.test(request.query) && !text.endsWith('"');
		words.forEach((word, index) => {
			const last = index === words.length - 1;
			where.push(
				typing && last && word.length >= 3
					? `(text~${cqlString(word)} OR text~${cqlString(`${word}*`)})`
					: `text~${cqlString(word)}`,
			);
		});
		for (const phrase of phrases) where.push(`text~${cqlString(`"${phrase}"`)}`);
		for (const word of excluded) {
			where.push(`NOT text~${cqlString(word.includes(" ") ? `"${word}"` : word)}`);
		}
	}
	if (request.period !== "any")
		where.push(`lastmodified>=now(${cqlString(PERIOD[request.period])})`);
	if (request.mine) where.push("contributor=currentUser()");
	const label = request.label.trim();
	if (label !== "") where.push(`label=${cqlString(label)}`);
	// Relevance is Confluence's own order; a title search has none worth keeping.
	const sort =
		request.sort === "modified" || (request.sort === "relevance" && request.mode === "title")
			? " ORDER BY lastmodified DESC"
			: request.sort === "title"
				? " ORDER BY title ASC"
				: "";
	return where.join(" AND ") + sort;
}

/** Whether a request has something to look for: words, or a filter narrowing the pages. */
export function hasCriteria(request: ConfluenceSearchRequest): boolean {
	if (request.mode === "content") {
		const { words, phrases } = queryTerms(request.query);
		if (words.length + phrases.length > 0) return true;
	} else if (request.query.trim() !== "") return true;
	return request.period !== "any" || request.mine || request.label.trim() !== "";
}

const ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
};

/** Text with its HTML entities written out. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (name.startsWith("#")) {
			const code =
				name[1] === "x" || name[1] === "X"
					? Number.parseInt(name.slice(2), 16)
					: Number.parseInt(name.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000
				? String.fromCodePoint(code)
				: entity;
		}
		return ENTITIES[name.toLowerCase()] ?? entity; // kalem-locale-ok: entity names are ASCII
	});
}

/**
 * Confluence's highlighted text (`@@@hl@@@word@@@endhl@@@`) as parts, its
 * entities written out and its spaces collapsed.
 */
export function highlightParts(text: string): TextPart[] {
	const parts: TextPart[] = [];
	const push = (raw: string, hit: boolean): void => {
		const value = decodeEntities(raw).replace(/\s+/g, " ");
		if (value === "") return;
		const last = parts.at(-1);
		if (last !== undefined && last.hit === hit) {
			parts[parts.length - 1] = { text: last.text + value, hit };
		} else parts.push({ text: value, hit });
	};
	const pattern = /@@@hl@@@([\s\S]*?)@@@endhl@@@/g;
	let at = 0;
	for (const match of text.matchAll(pattern)) {
		push(text.slice(at, match.index), false);
		push(match[1] ?? "", true);
		at = match.index + match[0].length;
	}
	push(text.slice(at), false);
	// Leading and trailing spaces say nothing.
	const first = parts[0];
	if (first !== undefined) parts[0] = { ...first, text: first.text.trimStart() };
	const end = parts.at(-1);
	if (end !== undefined) parts[parts.length - 1] = { ...end, text: end.text.trimEnd() };
	return parts.filter((part) => part.text !== "");
}

/** The parts' text without the highlighting. */
export const plainText = (parts: readonly TextPart[]): string =>
	parts.map((part) => part.text).join("");

/**
 * A title with the searched words marked, for a title search, where
 * Confluence marks nothing: each word is matched at the start of a word of
 * the title, ignoring case in the interface's language.
 */
export function markWords(title: string, query: string, lang: string): TextPart[] {
	const fold = (text: string): string => text.toLocaleLowerCase(lang);
	const words = query
		.split(/\s+/)
		.map((word) => word.replace(SPECIAL, ""))
		.filter((word) => word !== "")
		.map(fold);
	if (words.length === 0) return [{ text: title, hit: false }];
	const folded = fold(title);
	// Folding can change a string's length (İ → i̇); then nothing is marked.
	if (folded.length !== title.length) return [{ text: title, hit: false }];
	const marked = new Array<boolean>(title.length).fill(false);
	for (const word of words) {
		for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
			const before = at === 0 ? "" : (folded[at - 1] ?? "");
			if (before !== "" && /[\p{L}\p{N}]/u.test(before)) continue;
			marked.fill(true, at, at + word.length);
		}
	}
	const parts: TextPart[] = [];
	for (let i = 0; i < title.length; i++) {
		const hit = marked[i] === true;
		const last = parts.at(-1);
		if (last !== undefined && last.hit === hit) {
			parts[parts.length - 1] = { text: last.text + title[i], hit };
		} else parts.push({ text: title[i] ?? "", hit });
	}
	return parts;
}

/** A search request sent by a window, made safe; `null` when it is not one. */
export function parseSearchRequest(raw: unknown): ConfluenceSearchRequest | null {
	if (typeof raw !== "object" || raw === null) return null;
	const value = raw as Record<string, unknown>;
	const pick = <T extends string>(options: readonly T[], item: unknown, fallback: T): T =>
		options.includes(item as T) ? (item as T) : fallback;
	const cursor = typeof value.cursor === "string" ? value.cursor.slice(0, 4000) : null;
	return {
		query: typeof value.query === "string" ? value.query.slice(0, 500) : "",
		spaceKey:
			typeof value.spaceKey === "string" && /^[\w~.-]{1,255}$/.test(value.spaceKey)
				? value.spaceKey
				: null,
		mode: pick(SEARCH_MODES, value.mode, "title"),
		sort: pick(SEARCH_SORTS, value.sort, "relevance"),
		period: pick(SEARCH_PERIODS, value.period, "any"),
		mine: value.mine === true,
		label: typeof value.label === "string" ? value.label.trim().slice(0, 100) : "",
		ancestor:
			typeof value.ancestor === "string" && /^\d{1,20}$/.test(value.ancestor)
				? value.ancestor
				: null,
		cursor,
	};
}
