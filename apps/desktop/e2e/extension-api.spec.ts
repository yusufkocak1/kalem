import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { installFolder } from "./extension-install.js";
import { launch, tempDir } from "./launch.js";

const TOUR = join(import.meta.dirname, "fixtures", "api-tour");

test("an extension's pane reaches each part of window.kalem through its host", async () => {
	const server = createServer((_request, response) => {
		response.writeHead(200, { "Content-Type": "text/plain" });
		response.end("pong");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ping`;
	const folder = await tempDir("tour");
	const log = join(folder, "app.log");
	await writeFile(log, "first line\nsecond line\nthe last line\n");

	try {
		const { app, page, errors } = await launch();
		await page.setViewportSize({ width: 1300, height: 900 });
		const tour = await installFolder(app, page, TOUR, "tour", "Tour");
		const call = async (name: string, input = "") => {
			await tour.getByLabel("Input").fill(input);
			await tour.getByRole("button", { name, exact: true }).click();
			return tour.locator(`#out-${name}`);
		};

		await expect(await call("settings")).toHaveText("hello");
		await expect(await call("storage")).toHaveText("1");
		await expect(await call("storage")).toHaveText("2");
		await expect(await call("fetch", url)).toHaveText("200 pong");
		await expect(await call("readRange", log)).toHaveText(
			"first line\nsecond line\nthe last line\n",
		);
		await expect(await call("spawn")).toHaveText("tour-ok (0)");

		await expect(await call("status")).toHaveText("set");
		const status = page.locator('.ext-status-item[data-extension="kalem.api-tour"]');
		await expect(status).toHaveText("Tour ✓");

		await expect(await call("post")).toHaveText("posted");
		await expect(tour.locator("#pushed")).toHaveText("from the host");

		const dock = page.locator(".tool-dock.dock-bottom");
		await dock.getByRole("button", { name: "Close" }).click();
		await expect(dock).toBeHidden();
		await status.click();
		await expect(dock.locator(".dock-title")).toHaveText("Tour");
		expect(errors).toEqual([]);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
