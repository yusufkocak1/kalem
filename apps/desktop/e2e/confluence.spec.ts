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
		if (url.pathname === "/rest/api/search") {
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
