import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG_1X1 } from "../src/main/sample-docx.test-helper.js";
import {
	clickMenu,
	launch,
	recordMessageBoxes,
	stubOpenDialog,
	stubSaveDialog,
	tempDir,
} from "./launch.js";

const TOKEN = "pat-secret-123";

/** Just enough of Confluence Server's REST API for one page. */
async function fakeConfluence() {
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
	/** Pages made through the API, under page 41. */
	const created: { id: string; title: string; body: unknown }[] = [];

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
		if (url.pathname === "/rest/api/space")
			return json(res, { results: [{ key: "DEV", name: "Geliştirme" }] });
		if (url.pathname === "/rest/api/space/DEV/content/page") {
			return json(res, {
				results: [{ id: "41", title: "Ana Sayfa", children: { page: { size: 1 } } }],
			});
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
		const made = created.find((item) => url.pathname === `/rest/api/content/${item.id}`);
		if (made !== undefined && req.method === "GET") {
			return json(res, {
				title: made.title,
				version: { number: 1 },
				body: { storage: { value: "<p></p>" } },
				space: { key: "DEV" },
				_links: { webui: `/pages/${made.id}` },
			});
		}
		if (url.pathname === "/rest/api/search") {
			searches.push(url.searchParams.get("cql") ?? "");
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
		created,
		close: () => {
			server.closeAllConnections();
			server.close();
		},
	};
}

let cleanup: (() => void)[] = [];
test.afterEach(() => {
	for (const close of cleanup) close();
	cleanup = [];
});

test("edits a Confluence page and saves it back as a new version", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const { app, page, userData, errors } = await launch();

	await clickMenu(app, "File", "Open from Confluence…");
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();

	const item = dialog.locator(".quick-open-item", { hasText: "Sprint Planı" });
	await expect(item).toContainText("Geliştirme");
	await expect(dialog.locator("select option")).toHaveCount(2);
	await item.click();
	await expect(dialog).not.toBeVisible();

	await expect(page.locator("#editor h1").first()).toHaveText("Sprint Planı");
	// The attachment is fetched from Confluence through kalem-doc://confluence/.
	const image = page.locator("#editor img");
	await expect(image).toHaveAttribute("src", "logo.png");
	await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	await expect(page.locator(".save-status")).toHaveText("Saved");

	await page.locator("#editor p", { hasText: "Hedef" }).click();
	await page.keyboard.press("End");
	await page.keyboard.type(" eklendi");
	await expect(page.locator(".save-status")).toHaveText("Unsaved");

	// Every save asks first: saying no writes nothing.
	let asked = await recordMessageBoxes(app, 1);
	await page.locator('[data-command="save"]').click();
	await expect.poll(asked).toEqual(["Update the page on Confluence?"]);
	await expect(page.locator(".save-status")).toHaveText("Unsaved");
	expect(confluence.saves).toHaveLength(0);

	asked = await recordMessageBoxes(app, 0);
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	expect(await asked()).toEqual(["Update the page on Confluence?"]);
	expect(confluence.saves).toHaveLength(1);
	expect(confluence.saves[0]?.version).toBe(2);
	expect(confluence.saves[0]?.storage).toContain("<p>Hedef eklendi</p>");
	expect(confluence.saves[0]?.storage).toContain('<ri:attachment ri:filename="logo.png" />');

	// Someone else saves in the meantime.
	confluence.page.version = 5;
	await page.keyboard.type(" tekrar");
	await page.locator('[data-command="save"]').click();
	const notice = page.locator(".notice", { hasText: "changed on Confluence" });
	await expect(notice).toBeVisible();
	expect(confluence.saves).toHaveLength(1);
	await notice.getByRole("button", { name: "Overwrite" }).click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	// Overwriting was already a choice: no second question for it.
	expect(await asked()).toHaveLength(2);
	expect(confluence.saves[1]?.version).toBe(6);
	expect(confluence.saves[1]?.storage).toContain("Hedef eklendi tekrar");

	expect(confluence.auth.every((header) => header === `Bearer ${TOKEN}`)).toBe(true);
	expect(await readFile(join(userData, "confluence.json"), "utf8")).not.toContain(TOKEN);
	expect(errors).toEqual([]);
	await app.close();
});

test("browses a space's page tree in the side pane and stars a page", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const { app, page, userData, errors } = await launch();

	await page.getByRole("tab", { name: "Confluence" }).click();
	const pane = page.locator(".confluence-pane");
	await expect(pane).toContainText("Not connected to Confluence.");
	await pane.getByRole("button", { name: "Connect" }).click();

	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();
	await expect(dialog.locator(".quick-open-item")).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();

	// All spaces: each space is a branch.
	const spaceRow = pane.locator('[data-space="Geliştirme"]');
	await spaceRow.locator(".confluence-row-main").click();
	const root = pane.locator('[data-page="41"]');
	await expect(root).toHaveAttribute("aria-expanded", "false");
	await root.locator(".confluence-twisty").click();
	const child = pane.locator('[data-page="42"]');
	await expect(child).toContainText("Sprint Planı");
	// The server said it has no children: a leaf.
	await expect(child).not.toHaveAttribute("aria-expanded");

	// One space: its top-level pages are the roots; the choice is the default from now on.
	await pane.locator("select").selectOption("DEV");
	await expect(pane.locator(".confluence-page-item").first()).toHaveAttribute("data-page", "41");

	await child.locator(".confluence-row-main").click();
	await expect(page.locator("#editor h1").first()).toHaveText("Sprint Planı");
	await expect(child).toHaveAttribute("aria-current", "page");

	// Another page opens in a tab of its own; an open page is switched to, not opened twice.
	const tabs = page.locator(".doc-tab");
	await root.locator(".confluence-row-main").click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
	await expect(page.locator("#editor p").first()).toHaveText("Hoş geldiniz");
	await child.locator(".confluence-row-main").click();
	await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
	await expect(tabs).toHaveCount(2);
	await expect(page.locator("#editor h1").first()).toHaveText("Sprint Planı");

	// Starring puts the page on top, in its own section.
	await child.getByRole("button", { name: "Add to favorites" }).click();
	await expect(pane.locator(".confluence-section").first()).toHaveText("Favorites");
	const favorite = pane.locator(".confluence-page-item").first();
	await expect(favorite).toHaveAttribute("data-page", "42");
	await expect(favorite.locator(".confluence-star")).toHaveAttribute("aria-pressed", "true");

	// Search replaces the tree with results.
	await pane.locator(".confluence-pane-search").fill("Sprint");
	await expect.poll(() => confluence.searches.at(-1)).toContain('title~"Sprint*"');
	await expect(pane.locator('[data-page="41"]')).toHaveCount(0);

	await expect
		.poll(async () => JSON.parse(await readFile(join(userData, "settings.json"), "utf8")))
		.toMatchObject({
			settings: {
				sidePane: "confluence",
				confluenceSpace: "DEV",
				confluenceFavorites: [{ site: confluence.site, id: "42", title: "Sprint Planı" }],
			},
		});

	// Unstarring from the favorites section takes it off.
	await favorite.locator(".confluence-star").click();
	await expect(pane.locator(".confluence-section")).toHaveCount(0);
	expect(errors).toEqual([]);
	await app.close();
});

test("adds a child page from the tree and opens it", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const { app, page, errors } = await launch();

	await page.getByRole("tab", { name: "Confluence" }).click();
	const pane = page.locator(".confluence-pane");
	await pane.getByRole("button", { name: "Connect" }).click();
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();
	await expect(dialog.locator(".quick-open-item")).toHaveCount(1);
	await page.keyboard.press("Escape");

	await pane.locator("select").selectOption("DEV");
	const root = pane.locator('[data-page="41"]');
	await root.hover();
	await root.getByRole("button", { name: "Add child page" }).click();
	const title = pane.getByRole("textbox", { name: "Page title" });
	await expect(title).toBeFocused();
	// Escape gives up without a request.
	await title.press("Escape");
	await expect(title).toHaveCount(0);

	await root.hover();
	await root.getByRole("button", { name: "Add child page" }).click();
	await title.fill("Toplantı Notları");
	await title.press("Enter");

	await expect(page.locator(".doc-tab", { hasText: "Toplantı Notları" })).toBeVisible();
	const added = pane.locator('[data-page="43"]');
	await expect(added).toContainText("Toplantı Notları");
	await expect(added).toHaveAttribute("aria-current", "page");
	expect(confluence.created[0]?.body).toMatchObject({
		type: "page",
		title: "Toplantı Notları",
		space: { key: "DEV" },
		ancestors: [{ id: "41" }],
	});
	expect(errors).toEqual([]);
	await app.close();
});

test("saves an edit without rewriting the parts that were not edited", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const table =
		'<table><tbody><tr><th>Ad</th><th>Not</th></tr><tr><td colspan="2" style="background-color: #fffae6;"><p>birleşik</p></td></tr></tbody></table>';
	const jira =
		'<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro>';
	confluence.page.storage = `<h1>Sprint Planı</h1>${table}${jira}<p>Hedef</p>`;
	const { app, page, errors } = await launch();

	await clickMenu(app, "File", "Open from Confluence…");
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();
	await dialog.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
	await expect(dialog).not.toBeVisible();

	// The macro is a locked box, not text to edit.
	const box = page.locator("#editor pre[data-confluence-locked]");
	await expect(box).toHaveAttribute("data-confluence-locked", "🔒 jira — edit it in Confluence");
	await expect(box).toHaveAttribute("contenteditable", "false");
	// The merged cells are in a part nobody has edited yet: a notice, no loss yet.
	await expect(page.locator(".notice", { hasText: "Parts you do not edit" })).toBeVisible();

	await page.locator("#editor p", { hasText: "Hedef" }).click();
	await page.keyboard.press("End");
	await page.keyboard.type(" eklendi");
	const asked = await recordMessageBoxes(app, 0);
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");

	// Only the save question, no loss dialog: the edited paragraph lost nothing.
	// The table and the macro went back byte for byte.
	expect(await asked()).toEqual(["Update the page on Confluence?"]);
	expect(confluence.saves).toHaveLength(1);
	expect(confluence.saves[0]?.storage).toBe(
		`<h1>Sprint Planı</h1>${table}${jira}<p>Hedef eklendi</p>`,
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("keeps mentions and inline macros in a paragraph that is edited", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const mention = '<ac:link><ri:user ri:userkey="u1" /></ac:link>';
	const status =
		'<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">TAMAM</ac:parameter></ac:structured-macro>';
	confluence.page.storage = `<h1>Sprint Planı</h1><p>Sorumlu ${mention}, durum ${status}</p>`;
	const { app, page, errors } = await launch();

	await clickMenu(app, "File", "Open from Confluence…");
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();
	await dialog.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
	await expect(dialog).not.toBeVisible();

	const atoms = page.locator('#editor a[href^="#confluence-keep-"]');
	await expect(atoms).toHaveText(["@u1", "TAMAM"]);
	await expect(atoms.first()).toHaveAttribute("title", /saved back as it was/);
	// Nothing in this page is lost by editing it.
	await expect(page.locator(".notice")).toHaveCount(0);

	await page.locator("#editor p").first().click();
	await page.keyboard.press("Home");
	await page.keyboard.type("Yeni ");
	const asked = await recordMessageBoxes(app, 0);
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");

	expect(await asked()).toEqual(["Update the page on Confluence?"]);
	expect(confluence.saves[0]?.storage).toBe(
		`<h1>Sprint Planı</h1><p>Yeni Sorumlu ${mention}, durum ${status}</p>`,
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("edits a column of a page layout and keeps the layout", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const layout =
		'<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><p>Sol sütun</p></ac:layout-cell><ac:layout-cell><p>Hedef</p></ac:layout-cell></ac:layout-section></ac:layout>';
	confluence.page.storage = `<h1>Sprint Planı</h1>${layout}`;
	const { app, page, errors } = await launch();

	await clickMenu(app, "File", "Open from Confluence…");
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();
	await dialog.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
	await expect(dialog).not.toBeVisible();

	const markers = page.locator('#editor pre[data-confluence-kind="layout"]');
	await expect(markers).toHaveCount(3);
	await expect(markers.nth(1)).toHaveAttribute(
		"data-confluence-locked",
		"▥ Section 1 · column 2 of 2",
	);
	await expect(markers.nth(2)).toHaveAttribute("data-confluence-locked", "▥ End of columns");
	// A layout is no longer something saving would lose.
	await expect(page.locator(".notice")).toHaveCount(0);

	await page.locator("#editor p", { hasText: "Hedef" }).click();
	await page.keyboard.press("End");
	await page.keyboard.type(" eklendi");
	const asked = await recordMessageBoxes(app, 0);
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");

	expect(await asked()).toEqual(["Update the page on Confluence?"]);
	expect(confluence.saves[0]?.storage).toBe(
		`<h1>Sprint Planı</h1>${layout.replace("<p>Hedef</p>", "<p>Hedef eklendi</p>")}`,
	);
	expect(errors).toEqual([]);
	await app.close();
});

test("manages the attachments of a page", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	const { app, page, errors } = await launch();
	const folder = await tempDir("kalem-attachments-");
	const report = join(folder, "rapor.pdf");
	await writeFile(report, "%PDF-1.4 rapor");

	await clickMenu(app, "File", "Open from Confluence…");
	const connect = page.locator(".confluence-dialog");
	await connect.locator('input[type="url"]').fill(confluence.site);
	await connect.locator('input[type="password"]').fill(TOKEN);
	await connect.getByRole("button", { name: "Connect" }).click();
	await connect.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
	await expect(page.locator("#editor h1").first()).toHaveText("Sprint Planı");

	await clickMenu(app, "File", "Confluence Attachments…");
	const dialog = page.locator(".attachments");
	await expect(dialog.locator(".attachments-title")).toHaveText("Attachments of “Sprint Planı”");
	const logo = dialog.locator('[data-name="logo.png"]');
	// The page shows the image: it is marked, with a preview and who uploaded it.
	await expect(logo.locator(".attachments-used")).toHaveText("On the page");
	await expect(logo.locator(".attachments-meta")).toContainText("Ayşe Yılmaz");
	await expect
		.poll(() => logo.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBe(1);

	// Upload a file; the same name again is kept under a free name.
	await stubOpenDialog(app, [report]);
	await dialog.getByRole("button", { name: "Upload Files…" }).click();
	const pdf = dialog.locator('[data-name="rapor.pdf"]');
	await expect(pdf).toContainText("version 1");
	await expect(pdf.locator(".attachments-used")).toHaveCount(0);
	expect(confluence.attachments.at(-1)).toMatchObject({ type: "application/pdf" });
	let asked = await recordMessageBoxes(app, 1);
	await dialog.getByRole("button", { name: "Upload Files…" }).click();
	await expect(dialog.locator('[data-name="rapor-2.pdf"]')).toBeVisible();
	expect(await asked()).toEqual(["“rapor.pdf” is already attached to this page."]);

	// Download a copy, and open one with the system's app.
	const saved = join(folder, "kopya.pdf");
	await stubSaveDialog(app, saved);
	await pdf.getByRole("button", { name: "Download…" }).click();
	await expect(dialog.locator(".attachments-message")).toHaveText(`Saved to ${saved}`);
	expect(await readFile(saved, "utf8")).toBe("%PDF-1.4 rapor");
	await app.evaluate(({ shell }) => {
		shell.openPath = async (path: string) => {
			(globalThis as { opened?: string }).opened = path;
			return "";
		};
	});
	await pdf.getByRole("button", { name: "Open" }).click();
	const opened = () => app.evaluate(() => (globalThis as { opened?: string }).opened ?? "");
	await expect.poll(opened).toMatch(/rapor\.pdf$/);
	expect(await readFile(await opened(), "utf8")).toBe("%PDF-1.4 rapor");

	// Delete asks first.
	asked = await recordMessageBoxes(app, 0);
	await dialog.locator('[data-name="rapor-2.pdf"]').getByRole("button", { name: "Delete" }).click();
	await expect(dialog.locator('[data-name="rapor-2.pdf"]')).toHaveCount(0);
	expect(await asked()).toEqual(["Delete “rapor-2.pdf” from the page?"]);
	expect(confluence.attachments.map((item) => item.name)).toEqual(["logo.png", "rapor.pdf"]);

	// Insert links it in the page, which saves it as an attachment link.
	await dialog.getByRole("button", { name: "Close" }).click();
	await page.locator("#editor p", { hasText: "Hedef" }).click();
	await page.keyboard.press("End");
	await clickMenu(app, "File", "Confluence Attachments…");
	await pdf.getByRole("button", { name: "Insert" }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.locator("#editor a", { hasText: "rapor.pdf" })).toBeVisible();
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
	expect(confluence.saves[0]?.storage).toContain(
		'<ac:link><ri:attachment ri:filename="rapor.pdf" /><ac:link-body>rapor.pdf</ac:link-body></ac:link>',
	);

	await clickMenu(app, "File", "Confluence Attachments…");
	await expect(pdf.locator(".attachments-used")).toHaveText("On the page");
	await dialog.getByRole("button", { name: "Close" }).click();

	// Attach File on a Confluence page uploads to the page too.
	const notes = join(folder, "notlar.txt");
	await writeFile(notes, "not");
	await stubOpenDialog(app, [notes]);
	await clickMenu(app, "Insert", "Attach File…");
	await expect(page.locator("#editor a", { hasText: "notlar.txt" })).toBeVisible();
	expect(confluence.attachments.map((item) => item.name)).toContain("notlar.txt");
	expect(errors).toEqual([]);
	await app.close();
});

test("opens an attachment from its link in the page", async () => {
	const confluence = await fakeConfluence();
	cleanup.push(confluence.close);
	confluence.page.storage =
		'<p>Loglar:</p><p><ac:link><ri:attachment ri:filename="Troya Logları.txt" /><ac:link-body>Troya Logları.txt</ac:link-body></ac:link></p>';
	confluence.attachments.push({
		id: "att2",
		name: "Troya Logları.txt",
		type: "text/plain",
		version: 1,
		bytes: Buffer.from("log satırı"),
	});
	const { app, page, errors } = await launch();
	const folder = await tempDir("kalem-attachment-link-");

	await clickMenu(app, "File", "Open from Confluence…");
	const connect = page.locator(".confluence-dialog");
	await connect.locator('input[type="url"]').fill(confluence.site);
	await connect.locator('input[type="password"]').fill(TOKEN);
	await connect.getByRole("button", { name: "Connect" }).click();
	await connect.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
	const link = page.locator("#editor a", { hasText: "Troya Logları.txt" });
	await expect(link).toBeVisible();

	// Hovering the link offers the attachment.
	const card = page.locator(".attachment-card");
	await link.hover();
	await expect(card).toBeVisible();
	await expect(card.locator(".attachment-card-name")).toHaveText("Troya Logları.txt");
	const saved = join(folder, "log.txt");
	await stubSaveDialog(app, saved);
	await card.getByRole("button", { name: "Download…" }).click();
	await expect(card).toBeHidden();
	await expect(page.locator(".notice", { hasText: `Saved to ${saved}` })).toBeVisible();
	expect(await readFile(saved, "utf8")).toBe("log satırı");

	// Attachments… opens the dialog on that file.
	await page.locator("#editor p", { hasText: "Loglar:" }).hover();
	await expect(card).toBeHidden();
	await link.hover();
	await card.getByRole("button", { name: "Attachments…" }).click();
	const dialog = page.locator(".attachments");
	await expect(dialog.locator(".attachments-filter")).toHaveValue("Troya Logları.txt");
	await expect(dialog.locator(".attachments-item")).toHaveCount(1);
	await dialog.getByRole("button", { name: "Close" }).click();

	// Ctrl+click opens it in the system's app.
	await app.evaluate(({ shell }) => {
		shell.openPath = async (path: string) => {
			(globalThis as { opened?: string }).opened = path;
			return "";
		};
	});
	await link.click({ modifiers: ["Control"] });
	const opened = () => app.evaluate(() => (globalThis as { opened?: string }).opened ?? "");
	await expect.poll(opened).toMatch(/Troya Logları\.txt$/);
	expect(await readFile(await opened(), "utf8")).toBe("log satırı");
	expect(errors).toEqual([]);
	await app.close();
});
