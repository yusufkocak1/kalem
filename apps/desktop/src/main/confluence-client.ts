import type {
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

	/** A space's top-level pages, in Confluence's order. */
	async rootPages(spaceKey: string): Promise<ConfluenceTreePage[]> {
		if (this.cloud) {
			const spaces = await this.#json(`/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`);
			const id = asString(asJson(asArray(spaces.results)[0]).id);
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

	async search(query: string, spaceKey: string | null): Promise<ConfluencePageSummary[]> {
		const terms = ["type=page"];
		if (spaceKey !== null && spaceKey !== "") terms.push(`space=${cqlString(spaceKey)}`);
		const words = query.trim();
		if (words !== "") terms.push(`title~${cqlString(`${words}*`)}`);
		const cql = `${terms.join(" AND ")} ORDER BY lastmodified DESC`;
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
