import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Fetch } from "./confluence-client.js";
import { ConfluenceClient, ConfluenceError, normalizeSite } from "./confluence-client.js";
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
