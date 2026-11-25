import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { installSample } from "./api-fakes.js";
import { fakeClaude } from "./fake-claude.js";
import { launch, stubOpenDialog, tempDir } from "./launch.js";

const APP_LOG = [
	"2026-11-25 10:00:01.123 INFO  [main] o.a.c.Server - Server started in 3.2 s",
	"2026-11-25 10:00:01.500 DEBUG [main] c.a.Cache - warming 42 keys",
	"2026-11-25 10:00:02.001 ERROR [http-1] c.a.OrderService - Order 7731 failed",
	"java.lang.NullPointerException: customer is null",
	"\tat com.acme.OrderService.place(OrderService.java:42)",
	"\tat com.acme.Api.post(Api.java:10)",
	"\tat org.apache.catalina.core.StandardWrapperValve.invoke(StandardWrapperValve.java:199)",
	"Caused by: java.lang.IllegalStateException: session closed",
	"\t... 12 more",
	"2026-11-25 10:00:03.010 WARN  [db] c.a.Repo - slow query 1200 ms",
	"2026-11-25 10:00:04.000 INFO  [http-2] c.a.OrderService - Order 7732 placed",
	"",
].join("\n");

test("the Log Viewer follows a log as it grows, colours and counts levels, keeps stack traces with their line and filters", async () => {
	const folder = await tempDir("logs");
	const appLog = join(folder, "app.log");
	const gcLog = join(folder, "gc.log");
	await writeFile(appLog, APP_LOG);
	await writeFile(gcLog, "2026-11-25 10:00:00 INFO gc started\n");
	const { app, page, errors } = await launch();
	await page.setViewportSize({ width: 1400, height: 900 });
	const logs = await installSample(app, page, "log-viewer", "logs", "Logs");

	await expect(logs.locator(".lv-empty")).toContainText("Open a log file");
	await logs.getByLabel("Log file path").fill(appLog);
	await logs.getByRole("button", { name: "Open", exact: true }).click();

	const entries = logs.locator(".lv-entry");
	await expect(entries).toHaveCount(5);
	await expect(entries.nth(2)).toHaveAttribute("data-level", "error");
	await expect(entries.nth(2).locator(".lv-more > div")).toHaveCount(3);
	await expect(entries.nth(2).locator(".lv-expand")).toHaveText("3 more lines");
	await entries.nth(2).locator(".lv-expand").click();
	await expect(entries.nth(2).locator(".lv-more > div")).toHaveCount(6);
	await expect(logs.locator('.lv-level-chip[data-level="info"] .lv-count')).toHaveText("2");
	await expect(logs.locator('.lv-level-chip[data-level="error"] .lv-count')).toHaveText("1");
	await expect(logs.locator(".lv-status")).toContainText("5 entries");

	await appendFile(
		appLog,
		"2026-11-25 10:00:05.000 ERROR [http-3] c.a.Pay - Payment gateway timeout\n\tat com.acme.Pay.charge(Pay.java:88)\n",
	);
	await expect(entries).toHaveCount(6);
	await expect(entries.last()).toContainText("Payment gateway timeout");
	await expect(entries.last().locator(".lv-more")).toContainText("Pay.java:88");
	await expect(logs.locator('.lv-level-chip[data-level="error"] .lv-count')).toHaveText("2");

	await logs.getByLabel("Search", { exact: true }).fill("order 77\\d\\d");
	await logs.getByRole("button", { name: "Regular expression" }).click();
	await expect(entries).toHaveCount(2);
	await expect(entries.first().locator("mark")).toHaveText("Order 7731");
	await logs.locator('.lv-level-chip[data-level="error"]').click();
	await expect(entries).toHaveCount(1);
	await expect(entries.first()).toContainText("Order 7732 placed");
	await expect(logs.locator(".lv-status")).toContainText("1 of 6 entries");
	await logs.locator('.lv-level-chip[data-level="error"]').click();
	await logs.getByLabel("Search", { exact: true }).fill("");
	await expect(entries).toHaveCount(6);

	await stubOpenDialog(app, [gcLog]);
	await logs.getByRole("button", { name: "Open a Log File…" }).click();
	await expect(logs.getByRole("tab", { name: "gc.log" })).toHaveAttribute("aria-selected", "true");
	await expect(entries).toHaveCount(1);
	await appendFile(appLog, "2026-11-25 10:00:06.000 FATAL [main] c.a.App - Out of memory\n");
	await expect(logs.getByRole("tab", { name: /app\.log/ }).locator(".lv-unseen")).toHaveText("1");
	await logs.getByRole("tab", { name: /app\.log/ }).click();
	await expect(entries.last()).toHaveAttribute("data-level", "fatal");
	await expect(logs.getByRole("tab", { name: /app\.log/ }).locator(".lv-unseen")).toHaveCount(0);

	await writeFile(
		appLog,
		"2026-11-25 11:00:00.000 INFO  [main] o.a.c.Server - Server started again\n",
	);
	await expect(logs.locator(".lv-notice")).toContainText("rotated");
	await expect(entries).toHaveCount(1);
	await expect(entries.first()).toContainText("Server started again");
	expect(errors).toEqual([]);
});

test("the assistant reads a log's last errors and searches it through the Log Viewer's tools", async () => {
	test.skip(process.platform === "win32", "The stand-in CLI is a Unix script.");
	const folder = await tempDir("logs-agent");
	const appLog = join(folder, "app.log");
	await writeFile(appLog, APP_LOG);
	const claude = await fakeClaude(folder, "Siparişte NullPointerException var.", [
		{ name: "log_files", input: {} },
		{ name: "log_tail", input: { levels: ["error", "warn"], entries: 10 } },
		{ name: "log_search", input: { query: "7732" } },
	]);
	const { app, page } = await launch({
		settings: { assistant: true },
		env: { KALEM_CLAUDE: claude.path },
	});
	const logs = await installSample(app, page, "log-viewer", "logs", "Logs");
	await logs.getByLabel("Log file path").fill(appLog);
	await logs.getByRole("button", { name: "Open", exact: true }).click();
	await expect(logs.locator(".lv-entry")).toHaveCount(5);

	const assistant = page.locator(".assistant");
	await assistant.locator(".assistant-input").fill("Loglarda hata var mı?");
	await assistant.locator(".assistant-input").press("Enter");
	await expect(
		assistant.locator(".assistant-assistant").last().locator(".assistant-markdown"),
	).toContainText("Siparişte NullPointerException var.");
	const [call] = await claude.calls();
	const [files, tail, search] = call?.tools ?? [];
	expect(files?.text).toMatch(/app\.log \(\d+ KB, changed /);
	expect(tail?.text).toBe(
		[`${appLog}: 2 entries`, "", APP_LOG.split("\n").slice(2, 10).join("\n")].join("\n"),
	);
	expect(search?.text).toBe(`1 matching entry in ${appLog}\n\n${APP_LOG.split("\n")[10]}`);
});
