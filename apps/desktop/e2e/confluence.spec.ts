import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG_1X1 } from "../src/main/sample-docx.test-helper.js";
import { clickMenu, launch } from "./launch.js";

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
	/** Pages made through the API, under page 41. */
	const created: { id: string; title: string; body: unknown }[] = [];

	const json = (res: ServerResponse, body: unknown, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const body = async (req: IncomingMessage): Promise<string> => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks).toString("utf8");
	};

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
		if (url.pathname === "/rest/api/content/42/child/attachment") {
			return json(res, {
				results: [{ _links: { download: "/download/attachments/42/logo.png" } }],
			});
		}
		if (url.pathname === "/download/attachments/42/logo.png") {
			res.writeHead(200, { "Content-Type": "image/png" });
			return res.end(PNG_1X1);
		}
		json(res, { message: "Not found" }, 404);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		site,
		page,
		saves,
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
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");
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
	await page.locator('[data-command="save"]').click();
	await expect(page.locator(".save-status")).toHaveText("Saved");

	// No loss dialog: the edited paragraph lost nothing. The table and the macro went back byte for byte.
	expect(confluence.saves).toHaveLength(1);
	expect(confluence.saves[0]?.storage).toBe(
		`<h1>Sprint Planı</h1>${table}${jira}<p>Hedef eklendi</p>`,
	);
	expect(errors).toEqual([]);
	await app.close();
});
