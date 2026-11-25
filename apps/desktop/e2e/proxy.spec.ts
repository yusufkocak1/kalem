import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, closeSettings, launch } from "./launch.js";

test("a manual proxy carries the app's requests and its login reaches the programs it starts", async () => {
	const seen: { target: string; auth: string | undefined }[] = [];
	const proxy = createServer();
	proxy.on("connect", (request, socket) => {
		seen.push({ target: request.url ?? "", auth: request.headers["proxy-authorization"] });
		socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
	});
	await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	const { port } = proxy.address() as AddressInfo;

	const { app, page, userData, errors } = await launch();
	await clickMenu(app, "File", "Settings…");
	const dialog = page.locator(".settings-dialog");
	await dialog.locator('[data-category="proxy"]').click();
	const section = dialog.locator('[data-section="proxy"]');
	await expect(section.locator('input[data-setting="proxyServer"]')).toBeHidden();

	await section.locator('select[data-setting="proxyMode"]').selectOption({ label: "Manual proxy" });
	const server = section.locator('input[data-setting="proxyServer"]');
	await server.fill("not a proxy:abc");
	await expect(section.locator(".confluence-error")).toBeVisible();
	await server.fill(`127.0.0.1:${port}`);
	await expect(section.locator(".confluence-error")).toBeHidden();
	await server.press("Tab");
	await section.locator('input[data-setting="proxyBypass"]').fill("*.corp.local; intranet");
	await section.locator('input[data-setting="proxyBypass"]').press("Tab");

	await section.locator("#settings-proxy-user").fill("ali");
	await section.locator("#settings-proxy-password").fill("s3cret");
	await section.getByRole("button", { name: "Save login" }).click();
	await expect(section.locator("[data-proxy-status]")).toHaveText("Login saved.");
	await expect(section.locator("#settings-proxy-password")).toHaveAttribute(
		"placeholder",
		"Kept — type to change",
	);

	await section.getByRole("button", { name: "Test connection" }).click();
	await expect(section.locator("[data-proxy-status]")).toContainText(
		`Could not connect (PROXY 127.0.0.1:${port})`,
	);
	expect(seen.map((each) => each.target)).toContain("api.github.com:443");

	const env = await app.evaluate(() => ({
		https: process.env.HTTPS_PROXY,
		none: process.env.NO_PROXY,
	}));
	expect(env).toEqual({
		https: `http://ali:s3cret@127.0.0.1:${port}`,
		none: "localhost,127.0.0.1,::1,.corp.local,intranet",
	});

	await closeSettings(page);
	await app.close();
	proxy.close();
	const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
	expect(stored.settings).toMatchObject({
		proxyMode: "manual",
		proxyServer: `127.0.0.1:${port}`,
		proxyBypass: "*.corp.local, intranet",
	});
	expect(errors).toEqual([]);
});
