import type {
	ConfluenceAttachment,
	ConfluencePageContent,
	ConfluencePageSummary,
	ConfluenceSpace,
	ConfluenceTreePage,
	RemotePage,
} from "../shared/bridge.js";

export interface ConfluenceCredentials {
	readonly site: string;
	/** Cloud: the account e-mail. Server / Data Center: empty for a personal access token. */
	readonly username: string;
	readonly token: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class ConfluenceError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "ConfluenceError";
		this.status = status;
	}
}

/**
 * The REST base of a site as the user typed it. Cloud sites live under
 * `/wiki`; a Server / Data Center site may have any context path.
 */
export function normalizeSite(input: string): string {
	let raw = input.trim();
	if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
	const url = new URL(raw);
	let path = url.pathname.replace(/\/+$/, "");
	path = path.replace(/\/(spaces|display|pages|rest|api)(\/.*)?$/i, "");
	if (isCloudHost(url.hostname) && !/^\/wiki$/i.test(path)) path = "/wiki";
	return `${url.protocol}//${url.host}${path}`;
}

export function isCloudHost(host: string): boolean {
	return /\.(atlassian\.net|jira\.com)$/i.test(host);
}

function cqlString(value: string): string {
	return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

type Json = Record<string, unknown>;

/** A page named by the search box instead of words of its title. */
export type PageReference = (
	| { readonly kind: "id"; readonly id: string }
	| { readonly kind: "title"; readonly spaceKey: string; readonly title: string }
) & {
	/** The address's host; absent for a bare id. */
	readonly host?: string;
};

/**
 * The page id of a tiny link (`/x/AbCd`): the id's bytes, little-endian, in
 * base64 with `-` for `/`, `_` for `+` and the trailing zero bytes left out.
 */
export function tinyLinkId(code: string): string | null {
	if (!/^[A-Za-z0-9_-]{1,11}$/.test(code)) return null;
	const base64 = code.replace(/-/g, "/").replace(/_/g, "+").padEnd(11, "A");
	const bytes = Buffer.from(`${base64}=`, "base64");
	if (bytes.length !== 8) return null;
	const id = bytes.readBigUInt64LE(0);
	return id === 0n ? null : id.toString();
}

const decodePart = (part: string): string => {
	try {
		return decodeURIComponent(part.replace(/\+/g, " "));
	} catch {
		return part;
	}
};

/**
 * What the search box names, when it is not words of a title: a page id, or
 * a page's address as the browser shows it (Cloud's `/pages/<id>/…`,
 * Server's `viewpage.action?pageId=…` and `/display/<space>/<title>`, a
 * tiny link `/x/…`).
 */
export function pageReference(query: string): PageReference | null {
	const text = query.trim();
	if (/^\d{1,20}$/.test(text)) return { kind: "id", id: text };
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const pageId = url.searchParams.get("pageId");
	const host = url.hostname.toLowerCase(); // kalem-locale-ok: host names are ASCII
	if (pageId !== null && /^\d+$/.test(pageId)) return { kind: "id", id: pageId, host };
	const path = url.pathname;
	const page = /\/pages\/(?:edit-v2\/|edit\/)?(\d+)(?:\/|$)/.exec(path);
	if (page?.[1] !== undefined) return { kind: "id", id: page[1], host };
	const tiny = /\/x\/([A-Za-z0-9_-]+)\/?$/.exec(path);
	if (tiny?.[1] !== undefined) {
		const id = tinyLinkId(tiny[1]);
		return id === null ? null : { kind: "id", id, host };
	}
	const display = /\/display\/([^/]+)\/([^/]+)\/?$/.exec(path);
	if (display?.[1] !== undefined && display[2] !== undefined) {
		return {
			kind: "title",
			spaceKey: decodePart(display[1]),
			title: decodePart(display[2]),
			host,
		};
	}
	return null;
}

const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null ? (value as Json) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Confluence's REST API. Cloud uses the v2 API where one exists (pages,
 * spaces) and v1 for search and attachment upload; Server / Data Center
 * only has v1.
 */
export class ConfluenceClient {
	readonly site: string;
	readonly cloud: boolean;
	#auth: string;
	#token: string;
	readonly #fetch: Fetch;

	constructor(credentials: ConfluenceCredentials, fetchImpl: Fetch) {
		this.site = normalizeSite(credentials.site);
		this.cloud = isCloudHost(new URL(this.site).hostname);
		this.#auth =
			credentials.username === ""
				? `Bearer ${credentials.token}`
				: `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString("base64")}`;
		this.#token = credentials.token;
		this.#fetch = fetchImpl;
	}

	/** True when requests carry the token alone (a Server / Data Center personal access token). */
	get bearer(): boolean {
		return this.#auth.startsWith("Bearer ");
	}

	async #request(path: string, init: RequestInit = {}): Promise<Response> {
		const url = /^https?:/i.test(path) ? path : `${this.site}${path}`;
		if (!url.startsWith(`${this.site}/`) && new URL(url).origin !== new URL(this.site).origin) {
			throw new Error("Refusing to send credentials to another site");
		}
		const response = await this.#fetch(url, {
			...init,
			headers: {
				Accept: "application/json",
				Authorization: this.#auth,
				...(init.headers as Record<string, string> | undefined),
			},
		});
		if (!response.ok) {
			let detail = "";
			try {
				const body = asJson(await response.json());
				detail = asString(body.message) || asString(asJson(asArray(body.errors)[0]).title);
			} catch {}
			throw new ConfluenceError(
				response.status,
				detail === "" ? `HTTP ${response.status}` : `HTTP ${response.status}: ${detail}`,
			);
		}
		return response;
	}

	async #json(path: string, init?: RequestInit): Promise<Json> {
		return asJson(await (await this.#request(path, init)).json());
	}

	/** Fails when the site or the login is wrong. */
	async verify(): Promise<void> {
		const path = this.cloud ? "/api/v2/spaces?limit=1" : "/rest/api/space?limit=1";
		try {
			await this.#json(path);
		} catch (error) {
			// Server / Data Center rejects a personal access token sent with a
			// user name; retry it as a bearer token before giving up.
			if (
				this.cloud ||
				this.bearer ||
				!(error instanceof ConfluenceError) ||
				error.status !== 401
			) {
				throw error;
			}
			const basic = this.#auth;
			this.#auth = `Bearer ${this.#token}`;
			try {
				await this.#json(path);
			} catch {
				this.#auth = basic;
				throw error;
			}
		}
	}

	async spaces(): Promise<ConfluenceSpace[]> {
		const spaces: ConfluenceSpace[] = [];
		let next: string | null = this.cloud ? "/api/v2/spaces?limit=250" : "/rest/api/space?limit=500";
		// A few pages at most: the list is for picking, search covers the rest.
		for (let round = 0; next !== null && round < 8; round++) {
			const body: Json = await this.#json(next);
			for (const item of asArray(body.results)) {
				const space = asJson(item);
				if (asString(space.key) !== "") {
					spaces.push({ key: asString(space.key), name: asString(space.name) });
				}
			}
			const link = asString(asJson(body._links).next);
			next = link === "" ? null : this.#relative(link);
		}
		return spaces.sort((a, b) => a.name.localeCompare(b.name, "en"));
	}

	/** Cloud's v2 API takes a space's id, not its key. */
	async #spaceId(spaceKey: string): Promise<string> {
		const spaces = await this.#json(`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`);
		return asString(asJson(asArray(spaces.results)[0]).id);
	}

	/** A space's top-level pages, in Confluence's order. */
	async rootPages(spaceKey: string): Promise<ConfluenceTreePage[]> {
		if (this.cloud) {
			const id = await this.#spaceId(spaceKey);
			if (id === "") return [];
			return this.#treeLevel(`/api/v2/spaces/${id}/pages?depth=root&limit=250`);
		}
		return this.#treeLevel(
			`/rest/api/space/${encodeURIComponent(spaceKey)}/content/page?depth=root&limit=200&expand=children.page`,
		);
	}

	/** A page's child pages, in Confluence's order. */
	async childPages(id: string): Promise<ConfluenceTreePage[]> {
		if (!/^\d+$/.test(id)) throw new Error("Invalid page id");
		return this.#treeLevel(
			this.cloud
				? `/api/v2/pages/${id}/children?limit=250`
				: `/rest/api/content/${id}/child/page?limit=200&expand=children.page`,
		);
	}

	/**
	 * One level of the page tree, following `next` links. Server reports
	 * whether a page has children (`expand=children.page`); Cloud's v2 API
	 * does not, so there it is left open.
	 */
	async #treeLevel(first: string): Promise<ConfluenceTreePage[]> {
		const pages: ConfluenceTreePage[] = [];
		let next: string | null = first;
		// A level that long is better found by search than by scrolling.
		for (let round = 0; next !== null && round < 10; round++) {
			const body: Json = await this.#json(next);
			for (const item of asArray(body.results)) {
				const page = asJson(item);
				const id = asString(page.id);
				if (id === "") continue;
				const children = asJson(asJson(page.children).page);
				const size = typeof children.size === "number" ? children.size : null;
				pages.push({
					id,
					title: asString(page.title),
					hasChildren: this.cloud || size === null ? null : size > 0,
				});
			}
			const link = asString(asJson(body._links).next);
			next = link === "" ? null : this.#relative(link);
		}
		return pages;
	}

	/** `_links.next` is relative to the host on Cloud, to the site on Server. */
	#relative(link: string): string {
		if (/^https?:/i.test(link)) return link;
		const sitePath = new URL(this.site).pathname;
		return link.startsWith(`${sitePath}/`) ? link.slice(sitePath.length) : link;
	}

	/**
	 * Pages whose title starts with the words, newest first. A page id or a
	 * page's address finds that page, in whatever space; digits alone are
	 * also looked for in titles.
	 */
	async search(query: string, spaceKey: string | null): Promise<ConfluencePageSummary[]> {
		const reference = pageReference(query);
		// The same id on another site is another page.
		if (reference?.host !== undefined && reference.host !== new URL(this.site).hostname) return [];
		if (reference?.kind === "title") {
			return this.#cql(
				`type=page AND space=${cqlString(reference.spaceKey)} AND title=${cqlString(reference.title)}`,
			);
		}
		if (reference?.kind === "id") {
			const found = await this.#summary(reference.id);
			if (!/^\d+$/.test(query.trim())) return found === null ? [] : [found];
			const titled = await this.#titleSearch(query, spaceKey);
			return [
				...(found === null ? [] : [found]),
				...titled.filter((page) => page.id !== found?.id),
			];
		}
		return this.#titleSearch(query, spaceKey);
	}

	/** The page with this id; `null` when there is none, or it may not be read. */
	async #summary(id: string): Promise<ConfluencePageSummary | null> {
		try {
			if (this.cloud) {
				const body = await this.#json(`/api/v2/pages/${id}`);
				const spaceId = asString(body.spaceId);
				const space = spaceId === "" ? {} : await this.#json(`/api/v2/spaces/${spaceId}`);
				return {
					id,
					title: asString(body.title),
					spaceName: asString(space.name),
					modified: asString(asJson(body.version).createdAt) || null,
				};
			}
			const body = await this.#json(`/rest/api/content/${id}?expand=space,version`);
			if (asString(body.type) !== "" && asString(body.type) !== "page") return null;
			return {
				id,
				title: asString(body.title),
				spaceName: asString(asJson(body.space).name),
				modified: asString(asJson(body.version).when) || null,
			};
		} catch (error) {
			if (error instanceof ConfluenceError && [400, 403, 404].includes(error.status)) return null;
			throw error;
		}
	}

	async #titleSearch(query: string, spaceKey: string | null): Promise<ConfluencePageSummary[]> {
		const terms = ["type=page"];
		if (spaceKey !== null && spaceKey !== "") terms.push(`space=${cqlString(spaceKey)}`);
		const words = query.trim();
		if (words !== "") terms.push(`title~${cqlString(`${words}*`)}`);
		return this.#cql(terms.join(" AND "));
	}

	async #cql(where: string): Promise<ConfluencePageSummary[]> {
		const cql = `${where} ORDER BY lastmodified DESC`;
		const body = await this.#json(`/rest/api/search?limit=50&cql=${encodeURIComponent(cql)}`);
		return asArray(body.results).flatMap((item): ConfluencePageSummary[] => {
			const result = asJson(item);
			const content = asJson(result.content);
			const id = asString(content.id);
			if (id === "") return [];
			return [
				{
					id,
					title: asString(content.title) || asString(result.title),
					spaceName: asString(asJson(result.resultGlobalContainer).title),
					modified: asString(result.lastModified) || null,
				},
			];
		});
	}

	async page(id: string): Promise<ConfluencePageContent> {
		if (!/^\d+$/.test(id)) throw new Error("Invalid page id");
		if (this.cloud) {
			const body = await this.#json(`/api/v2/pages/${id}?body-format=storage`);
			const spaceId = asString(body.spaceId);
			const space = spaceId === "" ? {} : await this.#json(`/api/v2/spaces/${spaceId}`);
			return {
				page: {
					site: this.site,
					id,
					title: asString(body.title),
					spaceKey: asString(space.key),
					version: Number(asJson(body.version).number) || 1,
					webUrl: this.#webUrl(asString(asJson(body._links).webui)),
				},
				storage: asString(asJson(asJson(body.body).storage).value),
			};
		}
		const body = await this.#json(`/rest/api/content/${id}?expand=body.storage,version,space`);
		return {
			page: {
				site: this.site,
				id,
				title: asString(body.title),
				spaceKey: asString(asJson(body.space).key),
				version: Number(asJson(body.version).number) || 1,
				webUrl: this.#webUrl(asString(asJson(body._links).webui)),
			},
			storage: asString(asJson(asJson(body.body).storage).value),
		};
	}

	#webUrl(webui: string): string {
		return webui === "" ? this.site : `${this.site}${webui}`;
	}

	/**
	 * Creates an empty page at the top of the space or under `parentId`; returns its id.
	 * A title already used in the space surfaces as a 400 `ConfluenceError`.
	 */
	async create(spaceKey: string, parentId: string | null, title: string): Promise<string> {
		if (parentId !== null && !/^\d+$/.test(parentId)) throw new Error("Invalid page id");
		const storage = "<p></p>";
		const init = (body: unknown): RequestInit => ({
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		let body: Json;
		if (this.cloud) {
			const spaceId = await this.#spaceId(spaceKey);
			if (spaceId === "") throw new Error(`Unknown space: ${spaceKey}`);
			body = await this.#json(
				"/api/v2/pages",
				init({
					spaceId,
					status: "current",
					title,
					...(parentId === null ? {} : { parentId }),
					body: { representation: "storage", value: storage },
				}),
			);
		} else {
			body = await this.#json(
				"/rest/api/content",
				init({
					type: "page",
					title,
					space: { key: spaceKey },
					...(parentId === null ? {} : { ancestors: [{ id: parentId }] }),
					body: { storage: { value: storage, representation: "storage" } },
				}),
			);
		}
		const id = asString(body.id);
		if (!/^\d+$/.test(id)) throw new Error("Confluence did not return the new page");
		return id;
	}

	/** Writes a new version; a version conflict surfaces as a 409 `ConfluenceError`. */
	async update(page: RemotePage, storage: string): Promise<RemotePage> {
		const version = page.version + 1;
		const init = (body: unknown): RequestInit => ({
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const body = this.cloud
			? await this.#json(
					`/api/v2/pages/${page.id}`,
					init({
						id: page.id,
						status: "current",
						title: page.title,
						body: { representation: "storage", value: storage },
						version: { number: version, message: "Kalem" },
					}),
				)
			: await this.#json(
					`/rest/api/content/${page.id}`,
					init({
						id: page.id,
						type: "page",
						title: page.title,
						space: { key: page.spaceKey },
						body: { storage: { value: storage, representation: "storage" } },
						version: { number: version, message: "Kalem" },
					}),
				);
		return { ...page, version: Number(asJson(body.version).number) || version };
	}

	/** Creates or replaces the attachment `name` on the page. */
	async attach(pageId: string, name: string, type: string, bytes: Uint8Array): Promise<void> {
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
		form.append("minorEdit", "true");
		await this.#request(`/rest/api/content/${pageId}/child/attachment`, {
			method: "PUT",
			headers: { "X-Atlassian-Token": "no-check" },
			body: form,
		});
	}

	/** The page's attachments, newest first as Confluence lists them. */
	async attachments(pageId: string): Promise<ConfluenceAttachment[]> {
		if (!/^\d+$/.test(pageId)) throw new Error("Invalid page id");
		const files: ConfluenceAttachment[] = [];
		let next: string | null = this.cloud
			? `/api/v2/pages/${pageId}/attachments?limit=250`
			: `/rest/api/content/${pageId}/child/attachment?limit=200&expand=version`;
		for (let round = 0; next !== null && round < 10; round++) {
			const body: Json = await this.#json(next);
			for (const item of asArray(body.results)) {
				const file = asJson(item);
				const id = asString(file.id);
				if (id === "") continue;
				const version = asJson(file.version);
				const extensions = asJson(file.extensions);
				const size = this.cloud ? file.fileSize : extensions.fileSize;
				const when = Date.parse(asString(this.cloud ? version.createdAt : version.when));
				files.push({
					id,
					name: asString(file.title),
					size: typeof size === "number" ? size : null,
					mediaType: asString(this.cloud ? file.mediaType : extensions.mediaType),
					modified: Number.isNaN(when) ? null : when,
					author: this.cloud ? "" : asString(asJson(version.by).displayName),
					version: typeof version.number === "number" ? version.number : 1,
				});
			}
			const link = asString(asJson(body._links).next);
			next = link === "" ? null : this.#relative(link);
		}
		return files;
	}

	/** Moves the attachment to the space's trash, from where an admin can restore it. */
	async deleteAttachment(id: string): Promise<void> {
		if (!/^(att)?\d+$/.test(id)) throw new Error("Invalid attachment id");
		await this.#request(this.cloud ? `/api/v2/attachments/${id}` : `/rest/api/content/${id}`, {
			method: "DELETE",
			headers: { "X-Atlassian-Token": "no-check" },
		});
	}

	/** The attachment's bytes, or `null` when the page has no such file. */
	async attachment(pageId: string, name: string): Promise<Response | null> {
		const query = `filename=${encodeURIComponent(name)}`;
		let download = "";
		if (this.cloud) {
			const body = await this.#json(`/api/v2/pages/${pageId}/attachments?${query}`);
			download = asString(asJson(asArray(body.results)[0]).downloadLink);
		} else {
			const body = await this.#json(`/rest/api/content/${pageId}/child/attachment?${query}`);
			download = asString(asJson(asJson(asArray(body.results)[0])._links).download);
		}
		if (download === "") return null;
		return this.#request(this.#relative(download), { headers: { Accept: "*/*" } });
	}
}
