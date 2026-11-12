/** The fake Confluence Server the end-to-end tests talk to. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PNG_1X1 } from "../src/main/sample-docx.test-helper.js";

export const TOKEN = "pat-secret-123";

/** Just enough of Confluence Server's REST API for one page. */
export async function fakeConfluence() {
	const page = {
		title: "Sprint Planı",
		version: 1,
		storage:
			'<h1>Sprint Planı</h1><p>Hedef</p><p><ac:image><ri:attachment ri:filename="logo.png" /></ac:image></p>',
	};
	const saves: { version: number; storage: string }[] = [];
	const auth: string[] = [];
	const searches: string[] = [];
	/** Page 42's attachments. */
	const attachments = [
		{ id: "att1", name: "logo.png", type: "image/png", version: 1, bytes: Buffer.from(PNG_1X1) },
	];
	/** How page 41's children fail: the heavy request only, or every way of asking. */
	const failing = { children: "none" as "none" | "expand" | "all" };
	/** Pages made through the API, under page 41. */
	const created: {
		id: string;
		title: string;
		body: unknown;
		storage?: string;
		files?: { name: string; bytes: Buffer }[];
	}[] = [];

	const json = (res: ServerResponse, body: unknown, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const raw = async (req: IncomingMessage): Promise<Buffer> => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks);
	};
	const body = async (req: IncomingMessage): Promise<string> => (await raw(req)).toString("utf8");

	const server = createServer(async (req, res) => {
		auth.push(req.headers.authorization ?? "");
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.headers.authorization !== `Bearer ${TOKEN}`)
			return json(res, { message: "Unauthorized" }, 401);
		if (url.pathname === "/rest/api/user" && url.searchParams.get("key") === "u1") {
			return json(res, { username: "ayse", displayName: "Ayşe Balcı Polat" });
		}
		if (url.pathname === "/rest/api/search/user") {
			const cql = url.searchParams.get("cql") ?? "";
			return json(res, {
				results: cql.includes('"ay')
					? [{ user: { userKey: "u1", username: "ayse", displayName: "Ayşe Balcı Polat" } }]
					: [],
			});
		}
		if (url.pathname === "/rest/jiraanywhere/1.0/servers") {
			return json(res, [
				{ id: "j1", name: "Şirket Jira", url: "https://jira.example.com", selected: true },
			]);
		}
		if (url.pathname === "/rest/applinks/1.0/listApplicationlinks") {
			return json(res, {
				list: [
					{ application: { id: "j1", typeId: "jira", displayUrl: "https://jira.example.com" } },
				],
			});
		}
		if (url.pathname === "/rest/api/space")
			return json(res, { results: [{ key: "DEV", name: "Geliştirme" }] });
		if (url.pathname === "/rest/api/space/DEV/content/page") {
			return json(res, {
				results: [{ id: "41", title: "Ana Sayfa", children: { page: { size: 1 } } }],
			});
		}
		if (
			url.pathname === "/rest/api/content/41/child/page" &&
			(failing.children === "all" ||
				(failing.children === "expand" && url.searchParams.has("expand")))
		) {
			return json(res, { message: "Internal error" }, 500);
		}
		if (
			url.pathname === "/rest/api/search" &&
			failing.children === "all" &&
			(url.searchParams.get("cql") ?? "").includes("parent=41")
		) {
			return json(res, { message: "Internal error" }, 500);
		}
		if (url.pathname === "/rest/api/content/41/child/page") {
			return json(res, {
				results: [
					{ id: "42", title: page.title, children: { page: { size: 0 } } },
					...created.map(({ id, title }) => ({ id, title, children: { page: { size: 0 } } })),
				],
			});
		}
		if (url.pathname === "/rest/api/content" && req.method === "POST") {
			const request = JSON.parse(await body(req));
			const id = String(43 + created.length);
			created.push({ id, title: request.title, body: request });
			return json(res, { id });
		}
		if (url.pathname === "/rest/api/content/41" && req.method === "GET") {
			return json(res, {
				title: "Ana Sayfa",
				version: { number: 3 },
				body: { storage: { value: "<p>Hoş geldiniz</p>" } },
				space: { key: "DEV" },
				_links: { webui: "/display/DEV/Ana" },
			});
		}
		// A page made through the API takes attachments and new versions too.
		const attachedTo = created.find(
			(item) => url.pathname === `/rest/api/content/${item.id}/child/attachment`,
		);
		if (attachedTo !== undefined && req.method === "PUT") {
			const form = await new Response(new Uint8Array(await raw(req)), {
				headers: { "Content-Type": req.headers["content-type"] ?? "" },
			}).formData();
			const file = form.get("file") as File;
			attachedTo.files = [
				...(attachedTo.files ?? []),
				{ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
			];
			return json(res, { results: [] });
		}
		const made = created.find((item) => url.pathname === `/rest/api/content/${item.id}`);
		if (made !== undefined && req.method === "PUT") {
			const request = JSON.parse(await body(req));
			made.storage = request.body.storage.value;
			return json(res, { version: { number: request.version.number } });
		}
		if (made !== undefined && req.method === "GET") {
			return json(res, {
				title: made.title,
				version: { number: made.storage === undefined ? 1 : 2 },
				body: { storage: { value: made.storage ?? "<p></p>" } },
				space: { key: "DEV" },
				_links: { webui: `/pages/${made.id}` },
			});
		}
		if (url.pathname === "/rest/api/search") {
			const cql = url.searchParams.get("cql") ?? "";
			searches.push(cql);
			if (cql.includes('title="Ana Sayfa"')) {
				return json(res, { results: [{ content: { id: "41", title: "Ana Sayfa" } }] });
			}
			if (cql.includes("text~")) {
				// Inside pages: two results, one at a time, with excerpts.
				const second = url.searchParams.get("start") === "1";
				return json(res, {
					results: [
						second
							? {
									content: { id: "41", title: "Ana Sayfa", ancestors: [] },
									title: "Ana Sayfa",
									excerpt: "Ekibin @@@hl@@@onay@@@endhl@@@ kuralları",
									resultGlobalContainer: { title: "Geliştirme" },
									lastModified: "2026-09-01T10:00:00.000Z",
								}
							: {
									content: {
										id: "42",
										title: page.title,
										ancestors: [{ id: "41", title: "Ana Sayfa" }],
									},
									title: page.title,
									excerpt: "Sprint sonunda @@@hl@@@onay@@@endhl@@@ toplantısı &amp; demo",
									resultGlobalContainer: { title: "Geliştirme" },
									lastModified: "2026-10-01T10:00:00.000Z",
								},
					],
					start: second ? 1 : 0,
					totalSize: 2,
				});
			}
			return json(res, {
				results: [
					{
						content: { id: "42", title: page.title },
						resultGlobalContainer: { title: "Geliştirme" },
						lastModified: "2026-10-01T10:00:00.000Z",
					},
				],
			});
		}
		if (url.pathname === "/rest/api/content/42" && req.method === "GET") {
			return json(res, {
				title: page.title,
				version: { number: page.version },
				body: { storage: { value: page.storage } },
				space: { key: "DEV" },
				_links: { webui: "/display/DEV/Sprint" },
				ancestors: [{ id: "41", title: "Ana Sayfa" }],
			});
		}
		if (url.pathname === "/rest/api/content/42" && req.method === "PUT") {
			const update = JSON.parse(await body(req));
			if (update.version.number !== page.version + 1)
				return json(res, { message: "Version conflict" }, 409);
			page.version = update.version.number;
			page.storage = update.body.storage.value;
			saves.push({ version: page.version, storage: page.storage });
			return json(res, { version: { number: page.version } });
		}
		if (url.pathname === "/rest/api/content/42/child/attachment" && req.method === "PUT") {
			const form = await new Response(new Uint8Array(await raw(req)), {
				headers: { "Content-Type": req.headers["content-type"] ?? "" },
			}).formData();
			const file = form.get("file") as File;
			const bytes = Buffer.from(await file.arrayBuffer());
			const known = attachments.find((item) => item.name === file.name);
			if (known === undefined) {
				const id = `att${attachments.length + 1}`;
				attachments.push({ id, name: file.name, type: file.type, version: 1, bytes });
			} else {
				Object.assign(known, { bytes, version: known.version + 1 });
			}
			return json(res, { results: [] });
		}
		if (url.pathname === "/rest/api/content/42/child/attachment") {
			const name = url.searchParams.get("filename");
			return json(res, {
				results: attachments
					.filter((item) => name === null || item.name === name)
					.map((item) => ({
						id: item.id,
						title: item.name,
						extensions: { mediaType: item.type, fileSize: item.bytes.length },
						version: {
							number: item.version,
							when: "2026-10-01T10:00:00.000Z",
							by: { displayName: "Ayşe Yılmaz" },
						},
						_links: { download: `/download/attachments/42/${encodeURIComponent(item.name)}` },
					})),
			});
		}
		const attachment = attachments.find(
			(item) => url.pathname === `/download/attachments/42/${encodeURIComponent(item.name)}`,
		);
		if (attachment !== undefined) {
			res.writeHead(200, { "Content-Type": attachment.type });
			return res.end(attachment.bytes);
		}
		const deleted = attachments.findIndex(
			(item) => url.pathname === `/rest/api/content/${item.id}`,
		);
		if (deleted !== -1 && req.method === "DELETE") {
			attachments.splice(deleted, 1);
			res.writeHead(204);
			return res.end();
		}
		json(res, { message: "Not found" }, 404);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		site,
		page,
		saves,
		attachments,
		auth,
		searches,
		failing,
		created,
		close: () => {
			server.closeAllConnections();
			server.close();
		},
	};
}
