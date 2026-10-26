import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Fetch } from "./confluence-client.js";
import {
	ConfluenceClient,
	ConfluenceError,
	normalizeSite,
	pageReference,
	tinyLinkId,
} from "./confluence-client.js";
import { ConfluenceStore } from "./confluence-store.js";

interface Call {
	readonly url: string;
	readonly init: RequestInit | undefined;
}

/** Answers requests by URL substring, in order of the routes. */
function fakeFetch(routes: [string, unknown, number?][]): { fetch: Fetch; calls: Call[] } {
	const calls: Call[] = [];
	const fetch: Fetch = async (url, init) => {
		calls.push({ url, init });
		const route = routes.find(([part]) => url.includes(part));
		if (route === undefined) return new Response("{}", { status: 404 });
		const [, body, status = 200] = route;
		return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
	};
	return { fetch, calls };
}

const header = (call: Call | undefined, name: string): string | undefined =>
	(call?.init?.headers as Record<string, string> | undefined)?.[name];

describe("normalizeSite", () => {
	it("puts Cloud sites under /wiki and drops page paths", () => {
		expect(normalizeSite("acme.atlassian.net")).toBe("https://acme.atlassian.net/wiki");
		expect(normalizeSite("https://acme.atlassian.net/wiki/spaces/DEV/pages/1/x")).toBe(
			"https://acme.atlassian.net/wiki",
		);
		expect(normalizeSite("https://wiki.example.com/confluence/display/DEV/Home")).toBe(
			"https://wiki.example.com/confluence",
		);
		expect(normalizeSite("http://localhost:8090/")).toBe("http://localhost:8090");
	});
});

describe("pageReference", () => {
	it("reads a page id and the addresses a browser shows", () => {
		expect(pageReference(" 123456 ")).toEqual({ kind: "id", id: "123456" });
		expect(
			pageReference("https://acme.atlassian.net/wiki/spaces/DEV/pages/98765/Sprint+Plan%C4%B1"),
		).toEqual({ kind: "id", id: "98765", host: "acme.atlassian.net" });
		expect(pageReference("https://acme.atlassian.net/wiki/spaces/DEV/pages/edit-v2/98765")).toEqual(
			{
				kind: "id",
				id: "98765",
				host: "acme.atlassian.net",
			},
		);
		expect(
			pageReference("https://wiki.example.com/pages/viewpage.action?pageId=4242&focused=1"),
		).toEqual({ kind: "id", id: "4242", host: "wiki.example.com" });
		expect(pageReference("https://wiki.example.com/display/DEV/Sprint+Plan%C4%B1")).toEqual({
			kind: "title",
			spaceKey: "DEV",
			title: "Sprint Planı",
			host: "wiki.example.com",
		});
		expect(pageReference("https://wiki.example.com/x/AgAB")).toEqual({
			kind: "id",
			id: "65538",
			host: "wiki.example.com",
		});
	});

	it("leaves words of a title alone", () => {
		expect(pageReference("Sprint planı")).toBeNull();
		expect(pageReference("https://wiki.example.com/spaces/DEV/overview")).toBeNull();
		expect(pageReference("ftp://wiki.example.com/x/AgAB")).toBeNull();
	});

	it("decodes tiny links", () => {
		expect(tinyLinkId("AgAB")).toBe("65538");
		expect(tinyLinkId("0gKWSQ")).toBe("1234567890");
		expect(tinyLinkId("AAAA")).toBeNull();
		expect(tinyLinkId("bad!")).toBeNull();
	});
});

describe("ConfluenceClient", () => {
	it("authenticates Cloud with e-mail and token, Server with a bearer token", async () => {
		const cloud = fakeFetch([["/api/v2/spaces", { results: [] }]]);
		await new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a@b.c", token: "tok" },
			cloud.fetch,
		).verify();
		expect(cloud.calls[0]?.url).toBe("https://acme.atlassian.net/wiki/api/v2/spaces?limit=1");
		expect(header(cloud.calls[0], "Authorization")).toBe(
			`Basic ${Buffer.from("a@b.c:tok").toString("base64")}`,
		);

		const server = fakeFetch([["/rest/api/space", { results: [] }]]);
		await new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "pat" },
			server.fetch,
		).verify();
		expect(server.calls[0]?.url).toBe("https://wiki.example.com/rest/api/space?limit=1");
		expect(header(server.calls[0], "Authorization")).toBe("Bearer pat");
	});

	it("reports errors with the server's message", async () => {
		const { fetch } = fakeFetch([["/api/v2/spaces", { message: "Unauthorized" }, 401]]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a", token: "b" },
			fetch,
		);
		const error = await client.verify().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ConfluenceError);
		expect((error as ConfluenceError).status).toBe(401);
		expect((error as Error).message).toBe("HTTP 401: Unauthorized");
	});

	it("retries a Server login that was given a user name as a bearer token", async () => {
		const calls: Call[] = [];
		const fetch: Fetch = async (url, init) => {
			calls.push({ url, init });
			const auth = header({ url, init }, "Authorization");
			return auth === "Bearer pat"
				? new Response(JSON.stringify({ results: [] }))
				: new Response("{}", { status: 401 });
		};
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "jdoe", token: "pat" },
			fetch,
		);
		expect(client.bearer).toBe(false);
		await client.verify();
		expect(client.bearer).toBe(true);
		expect(calls.map((call) => header(call, "Authorization"))).toEqual([
			`Basic ${Buffer.from("jdoe:pat").toString("base64")}`,
			"Bearer pat",
		]);
	});

	it("keeps the first 401 when the bearer retry fails too", async () => {
		const { fetch, calls } = fakeFetch([["/rest/api/space", { message: "Bad login" }, 401]]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "jdoe", token: "wrong" },
			fetch,
		);
		const error = await client.verify().catch((e: unknown) => e);
		expect((error as Error).message).toBe("HTTP 401: Bad login");
		expect(calls).toHaveLength(2);
		expect(client.bearer).toBe(false);
	});

	it("lists a Server space's page tree a level at a time", async () => {
		const { fetch, calls } = fakeFetch([
			[
				"/rest/api/space/DEV/content/page",
				{
					results: [
						{ id: "1", title: "Ana", children: { page: { size: 2 } } },
						{ id: "2", title: "Yaprak", children: { page: { size: 0 } } },
					],
				},
			],
			["/rest/api/content/1/child/page", { results: [{ id: "3", title: "Alt" }] }],
		]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "pat" },
			fetch,
		);
		expect(await client.rootPages("DEV")).toEqual([
			{ id: "1", title: "Ana", hasChildren: true },
			{ id: "2", title: "Yaprak", hasChildren: false },
		]);
		expect(calls[0]?.url).toBe(
			"https://wiki.example.com/rest/api/space/DEV/content/page?depth=root&limit=200&expand=children.page",
		);
		// Without the expansion the server says nothing: unknown, not a leaf.
		expect(await client.childPages("1")).toEqual([{ id: "3", title: "Alt", hasChildren: null }]);
		await expect(client.childPages("1/../2")).rejects.toThrow("Invalid page id");
	});

	it("lists a Cloud space's page tree through the v2 API", async () => {
		const { fetch, calls } = fakeFetch([
			["/api/v2/spaces?keys=DEV", { results: [{ id: "77", key: "DEV" }] }],
			["/api/v2/spaces/77/pages", { results: [{ id: "1", title: "Ana" }] }],
			["/api/v2/pages/1/children", { results: [{ id: "3", title: "Alt" }] }],
		]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a@b.c", token: "tok" },
			fetch,
		);
		expect(await client.rootPages("DEV")).toEqual([{ id: "1", title: "Ana", hasChildren: null }]);
		expect(calls[1]?.url).toBe(
			"https://acme.atlassian.net/wiki/api/v2/spaces/77/pages?depth=root&limit=250",
		);
		expect(await client.childPages("1")).toEqual([{ id: "3", title: "Alt", hasChildren: null }]);
	});

	it("creates a page under a parent on Server and at the top of a Cloud space", async () => {
		const server = fakeFetch([["/rest/api/content", { id: "43" }]]);
		const id = await new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "pat" },
			server.fetch,
		).create("DEV", "41", "Yeni");
		expect(id).toBe("43");
		expect(server.calls[0]?.init?.method).toBe("POST");
		expect(JSON.parse(String(server.calls[0]?.init?.body))).toEqual({
			type: "page",
			title: "Yeni",
			space: { key: "DEV" },
			ancestors: [{ id: "41" }],
			body: { storage: { value: "<p></p>", representation: "storage" } },
		});

		const cloud = fakeFetch([
			["/api/v2/spaces?keys=DEV", { results: [{ id: "77" }] }],
			["/api/v2/pages", { id: "99" }],
		]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a@b.c", token: "tok" },
			cloud.fetch,
		);
		expect(await client.create("DEV", null, "Kök")).toBe("99");
		expect(JSON.parse(String(cloud.calls[1]?.init?.body))).toEqual({
			spaceId: "77",
			status: "current",
			title: "Kök",
			body: { representation: "storage", value: "<p></p>" },
		});
		await expect(client.create("DEV", "../1", "x")).rejects.toThrow("Invalid page id");
	});

	it("searches pages with CQL", async () => {
		const { fetch, calls } = fakeFetch([
			[
				"/rest/api/search",
				{
					results: [
						{
							content: { id: "42", title: "Sprint Planı" },
							resultGlobalContainer: { title: "Geliştirme" },
							lastModified: "2026-10-01T10:00:00.000Z",
						},
					],
				},
			],
		]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fetch,
		);
		const pages = await client.search('plan "x"', "DEV");
		expect(pages).toEqual([
			{
				id: "42",
				title: "Sprint Planı",
				spaceName: "Geliştirme",
				modified: "2026-10-01T10:00:00.000Z",
			},
		]);
		const cql = decodeURIComponent(new URL(calls[0]?.url ?? "").searchParams.get("cql") ?? "");
		expect(cql).toBe(
			'type=page AND space="DEV" AND title~"plan \\"x\\"*" ORDER BY lastmodified DESC',
		);
	});

	it("finds a page by its id or address, in any space", async () => {
		const { fetch, calls } = fakeFetch([
			[
				"/rest/api/content/4242",
				{
					type: "page",
					title: "Mimari",
					space: { name: "Geliştirme" },
					version: { when: "2026-10-02T10:00:00.000Z" },
				},
			],
			["/rest/api/search", { results: [{ content: { id: "7", title: "4242 numaralı karar" } }] }],
		]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fetch,
		);
		const mimari = {
			id: "4242",
			title: "Mimari",
			spaceName: "Geliştirme",
			modified: "2026-10-02T10:00:00.000Z",
		};
		expect(
			await client.search("https://wiki.example.com/pages/viewpage.action?pageId=4242", "OPS"),
		).toEqual([mimari]);
		expect(calls).toHaveLength(1);
		// Digits alone may also be words of a title.
		expect((await client.search("4242", null)).map((page) => page.id)).toEqual(["4242", "7"]);
		// Another site's address names another site's page.
		expect(
			await client.search("https://other.example.com/pages/viewpage.action?pageId=4242", null),
		).toEqual([]);
	});

	it("looks for a /display/ address by its space and exact title", async () => {
		const { fetch, calls } = fakeFetch([["/rest/api/search", { results: [] }]]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fetch,
		);
		await client.search("https://wiki.example.com/display/DEV/Sprint+Plan%C4%B1", null);
		const cql = new URL(calls[0]?.url ?? "").searchParams.get("cql");
		expect(cql).toBe(
			'type=page AND space="DEV" AND title="Sprint Planı" ORDER BY lastmodified DESC',
		);
	});

	it("finds a Cloud page by its id through the v2 API, and none for a missing one", async () => {
		const { fetch } = fakeFetch([
			["/api/v2/spaces/7", { key: "DEV", name: "Geliştirme" }],
			["/api/v2/pages/42", { title: "Plan", spaceId: "7", version: { createdAt: "2026-10-03" } }],
		]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a", token: "b" },
			fetch,
		);
		expect(
			await client.search("https://acme.atlassian.net/wiki/spaces/DEV/pages/42/Plan", null),
		).toEqual([{ id: "42", title: "Plan", spaceName: "Geliştirme", modified: "2026-10-03" }]);
		expect(
			await client.search("https://acme.atlassian.net/wiki/spaces/DEV/pages/43", null),
		).toEqual([]);
	});

	it("reads and updates a Cloud page through the v2 API", async () => {
		const { fetch, calls } = fakeFetch([
			["/api/v2/spaces/7", { key: "DEV" }],
			[
				"/api/v2/pages/42",
				{
					id: "42",
					title: "Plan",
					spaceId: "7",
					version: { number: 3 },
					body: { storage: { value: "<p>x</p>" } },
					_links: { webui: "/spaces/DEV/pages/42/Plan" },
				},
			],
		]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a", token: "b" },
			fetch,
		);
		const content = await client.page("42");
		expect(content).toEqual({
			page: {
				site: "https://acme.atlassian.net/wiki",
				id: "42",
				title: "Plan",
				spaceKey: "DEV",
				version: 3,
				webUrl: "https://acme.atlassian.net/wiki/spaces/DEV/pages/42/Plan",
			},
			storage: "<p>x</p>",
		});

		await client.update(content.page, "<p>y</p>");
		const put = calls[calls.length - 1];
		expect(put?.init?.method).toBe("PUT");
		expect(JSON.parse(String(put?.init?.body))).toMatchObject({
			id: "42",
			status: "current",
			title: "Plan",
			body: { representation: "storage", value: "<p>y</p>" },
			version: { number: 4 },
		});
	});

	it("updates a Server page through the v1 API with its space", async () => {
		const { fetch, calls } = fakeFetch([["/rest/api/content/42", { version: { number: 6 } }]]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fetch,
		);
		const saved = await client.update(
			{ site: client.site, id: "42", title: "Plan", spaceKey: "DEV", version: 5, webUrl: "" },
			"<p>y</p>",
		);
		expect(saved.version).toBe(6);
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
			type: "page",
			space: { key: "DEV" },
			body: { storage: { value: "<p>y</p>", representation: "storage" } },
			version: { number: 6 },
		});
	});

	it("surfaces a version conflict as a 409", async () => {
		const { fetch } = fakeFetch([["/rest/api/content/42", { message: "Version conflict" }, 409]]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fetch,
		);
		const error = await client
			.update(
				{ site: client.site, id: "42", title: "P", spaceKey: "D", version: 1, webUrl: "" },
				"",
			)
			.catch((e: unknown) => e);
		expect((error as ConfluenceError).status).toBe(409);
	});

	it("downloads attachments from the same site only", async () => {
		const { fetch, calls } = fakeFetch([
			[
				"/child/attachment",
				{ results: [{ _links: { download: "/download/attachments/42/a.png" } }] },
			],
			["/download/attachments/42/a.png", "PNG"],
		]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fetch,
		);
		const response = await client.attachment("42", "a.png");
		expect(await response?.text()).toBe("PNG");
		expect(calls[1]?.url).toBe("https://wiki.example.com/download/attachments/42/a.png");

		const hostile = fakeFetch([
			["/child/attachment", { results: [{ _links: { download: "https://evil.example/x.png" } }] }],
		]);
		const other = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			hostile.fetch,
		);
		await expect(other.attachment("42", "x.png")).rejects.toThrow(/another site/);
		expect(hostile.calls).toHaveLength(1);
	});

	it("rejects page ids that are not numbers", async () => {
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "t" },
			fakeFetch([]).fetch,
		);
		await expect(client.page("../admin")).rejects.toThrow(/Invalid page id/);
	});
	it("lists a page's attachments from Server and follows next links", async () => {
		const { fetch, calls } = fakeFetch([
			[
				"start=1",
				{
					results: [
						{
							id: "att2",
							title: "notlar.txt",
							extensions: { mediaType: "text/plain" },
							version: { number: 1 },
						},
					],
				},
			],
			[
				"/child/attachment",
				{
					results: [
						{
							id: "att1",
							title: "rapor.pdf",
							extensions: { mediaType: "application/pdf", fileSize: 2048 },
							version: {
								number: 3,
								when: "2026-10-01T10:00:00.000Z",
								by: { displayName: "Yusuf Koçak" },
							},
						},
					],
					_links: { next: "/rest/api/content/42/child/attachment?limit=200&start=1" },
				},
			],
		]);
		const client = new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "pat" },
			fetch,
		);
		expect(await client.attachments("42")).toEqual([
			{
				id: "att1",
				name: "rapor.pdf",
				size: 2048,
				mediaType: "application/pdf",
				modified: Date.parse("2026-10-01T10:00:00.000Z"),
				author: "Yusuf Koçak",
				version: 3,
			},
			{
				id: "att2",
				name: "notlar.txt",
				size: null,
				mediaType: "text/plain",
				modified: null,
				author: "",
				version: 1,
			},
		]);
		expect(calls[0]?.url).toBe(
			"https://wiki.example.com/rest/api/content/42/child/attachment?limit=200&expand=version",
		);
		await expect(client.attachments("42/../1")).rejects.toThrow("Invalid page id");
	});

	it("lists attachments from Cloud's v2 API", async () => {
		const { fetch, calls } = fakeFetch([
			[
				"/attachments",
				{
					results: [
						{
							id: "att7",
							title: "logo.png",
							mediaType: "image/png",
							fileSize: 10,
							version: { number: 2, createdAt: "2026-10-02T08:00:00.000Z", authorId: "abc" },
						},
					],
				},
			],
		]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a@b.c", token: "tok" },
			fetch,
		);
		const [file] = await client.attachments("42");
		expect(calls[0]?.url).toBe(
			"https://acme.atlassian.net/wiki/api/v2/pages/42/attachments?limit=250",
		);
		expect(file).toMatchObject({
			id: "att7",
			size: 10,
			mediaType: "image/png",
			author: "",
			version: 2,
		});
	});

	it("deletes an attachment", async () => {
		const server = fakeFetch([["/rest/api/content/att5", ""]]);
		await new ConfluenceClient(
			{ site: "https://wiki.example.com", username: "", token: "pat" },
			server.fetch,
		).deleteAttachment("att5");
		expect(server.calls[0]?.url).toBe("https://wiki.example.com/rest/api/content/att5");
		expect(server.calls[0]?.init?.method).toBe("DELETE");

		const cloud = fakeFetch([["/api/v2/attachments/att5", ""]]);
		const client = new ConfluenceClient(
			{ site: "acme.atlassian.net", username: "a@b.c", token: "tok" },
			cloud.fetch,
		);
		await client.deleteAttachment("att5");
		expect(cloud.calls[0]?.url).toBe("https://acme.atlassian.net/wiki/api/v2/attachments/att5");
		await expect(client.deleteAttachment("../spaces")).rejects.toThrow("Invalid attachment id");
	});
});

describe("ConfluenceStore", () => {
	const box = {
		encrypt: (text: string) => Buffer.from(`sealed:${text}`),
		decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, ""),
	};

	it("stores the token only encrypted", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-confluence-")), "confluence.json");
		await new ConfluenceStore(file, box).set({ site: "https://s", username: "u", token: "secret" });
		const raw = await readFile(file, "utf8");
		expect(raw).not.toContain("secret");
		expect(await new ConfluenceStore(file, box).get()).toEqual({
			site: "https://s",
			username: "u",
			token: "secret",
		});
	});

	it("keeps the login in memory when the OS has no encryption", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-confluence-")), "confluence.json");
		const store = new ConfluenceStore(file, { ...box, encrypt: () => null });
		await store.set({ site: "https://s", username: "", token: "secret" });
		expect((await store.get())?.token).toBe("secret");
		await expect(readFile(file, "utf8")).rejects.toThrow();
		expect(await new ConfluenceStore(file, box).get()).toBeNull();
	});
});
