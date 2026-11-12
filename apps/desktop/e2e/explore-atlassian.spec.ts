/**
 * Exploration of the Jira and Confluence features: every screen they have
 * is opened against the fake servers, and each is looked at (`audit.ts`) at
 * three window sizes, in the light and the dark theme. With
 * KALEM_EXPLORE_SHOTS=<folder> a screenshot of each is kept;
 * KALEM_EXPLORE_REPORT=<file> writes the findings instead of failing.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createExplorer } from "./audit.js";
import { fakeConfluence, TOKEN } from "./fake-confluence.js";
import { CONFLUENCE_TOKEN, fakeJira, fakeJiraConfluence, JIRA_TOKEN } from "./fake-jira.js";
import {
	clickMenu,
	launch,
	recordMessageBoxes,
	showPane,
	stubOpenDialog,
	tempDir,
} from "./launch.js";

test.setTimeout(420_000);

const cleanup: (() => unknown)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

async function connectConfluence(
	app: ElectronApplication,
	page: Page,
	site: string,
	token: string,
): Promise<void> {
	await clickMenu(app, "File", "Open from Confluence…");
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(site);
	await dialog.locator('input[type="password"]').fill(token);
}

for (const theme of ["light", "dark"] as const) {
	test(`exploration: Jira, ${theme}`, async () => {
		const jiraServer = await fakeJira();
		cleanup.push(jiraServer.close);
		const confluence = await fakeJiraConfluence(jiraServer.site);
		cleanup.push(confluence.close);
		jiraServer.confluence.site = confluence.site;
		const { app, page, errors } = await launch({ settings: { theme } });
		await app.evaluate(({ shell }) => {
			shell.openExternal = async () => {};
		});
		const explorer = await createExplorer(app, page, `jira-${theme}`, errors);

		// Jira's login, asked for from the menu before anything is connected.
		await clickMenu(app, "File", "Jira…");
		const jira = page.locator(".jira-dialog");
		await expect(jira).toBeVisible();
		await explorer.scene("jira login, empty");
		await jira.locator('input[type="url"]').fill(jiraServer.site);
		await jira.locator('input[type="password"]').fill("wrong-token");
		await jira.getByRole("button", { name: "Connect" }).click();
		await page.waitForTimeout(500);
		await explorer.scene("jira login, wrong token");
		await page.keyboard.press("Escape");

		// Through a Confluence page that names an issue.
		await connectConfluence(app, page, confluence.site, CONFLUENCE_TOKEN);
		const cdialog = page.locator(".confluence-dialog");
		await explorer.scene("confluence login, filled");
		await cdialog.getByRole("button", { name: "Connect" }).click();
		await expect(cdialog.locator(".quick-open-item")).toHaveCount(1);
		await explorer.scene("confluence open, results");
		await cdialog.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
		await expect(cdialog).not.toBeVisible();
		const atom = page.locator('#editor a[href^="#confluence-keep-"]', { hasText: "QR-1" });
		await atom.hover();
		await expect(page.locator(".link-card")).toBeVisible();
		await explorer.scene("jira atom card, before login", { fixed: true });
		await page.mouse.move(0, 0);
		await atom.click();
		await expect(jira).toBeVisible();
		await jira.locator('input[type="password"]').fill(JIRA_TOKEN);
		await jira.getByRole("button", { name: "Connect" }).click();
		await expect(jira.locator(".jira-title")).toHaveText("Giriş zaman aşımı");
		await explorer.scene("issue, top");

		// Down the issue: description, links, comments, development.
		const scroller = jira.locator(".jira-body, .jira-issue, .jira-content").first();
		const scrollIssue = async (fraction: number): Promise<void> => {
			await jira.evaluate((dialog, f) => {
				const boxes = [dialog, ...dialog.querySelectorAll<HTMLElement>("*")].filter(
					(element) =>
						element.scrollHeight > element.clientHeight + 20 &&
						getComputedStyle(element).overflowY !== "visible",
				);
				const box = boxes.sort((a, b) => b.clientHeight - a.clientHeight)[0];
				if (box !== undefined) box.scrollTop = (box.scrollHeight - box.clientHeight) * f;
			}, fraction);
		};
		void scroller;
		await scrollIssue(0.5);
		await explorer.scene("issue, middle");
		await scrollIssue(1);
		await explorer.scene("issue, bottom");
		const development = jira.locator(".jira-dev-section");
		for (const kind of ["branches", "commits", "pullRequests"]) {
			const line = development.locator(`.jira-dev-line[data-kind="${kind}"]`);
			if ((await line.count()) === 0) continue;
			await line.scrollIntoViewIfNeeded();
			await line.click();
			await page.waitForTimeout(300);
			await explorer.scene(`issue, development ${kind}`);
		}
		await scrollIssue(0);

		// The status' steps.
		await jira.locator(".jira-status-button").click();
		await expect(jira.locator(".jira-transition-menu .jira-transition").first()).toBeVisible();
		await explorer.scene("issue, transitions menu", { fixed: true });
		await jira
			.locator(".jira-transition-menu .jira-transition")
			.filter({ hasText: "Test" })
			.click();
		await expect(jira.locator(".jira-status-button .jira-status")).toHaveText("Test");

		// Logging work.
		await jira.locator(".jira-log-work").click();
		const worklog = jira.locator(".jira-worklog");
		await expect(worklog.locator(".jira-worklog-summary")).toBeVisible();
		await explorer.scene("worklog form");
		await worklog.locator(".jira-worklog-submit").click();
		await explorer.scene("worklog, missing field");
		const servis = worklog.locator('input[data-attribute="_Servis_"]');
		await servis.click();
		await expect(worklog.locator(".combo-list:not([hidden]) .combo-option").first()).toBeVisible();
		await explorer.scene("worklog, combo open", { fixed: true });
		await page.keyboard.type("sa");
		await page.keyboard.press("Enter");
		const sirket = worklog.locator('input[data-attribute="_Sirket_"]');
		await sirket.click();
		await page.keyboard.type("türk");
		await page.keyboard.press("Enter");
		await worklog.locator('.jira-worklog-chip[data-hours="5"]').click();
		await worklog.locator(".jira-worklog-submit").click();
		await expect(worklog.locator(".jira-worklog-status")).toHaveText("5h logged on QR-1.");
		await explorer.scene("worklog, logged");

		// A sub-task, and back.
		await jira.locator('.jira-row[data-key="QR-2"]').scrollIntoViewIfNeeded();
		await jira.locator('.jira-row[data-key="QR-2"]').click();
		await expect(jira.locator(".jira-title")).toHaveText("Süreyi ayarla");
		await explorer.scene("sub-task");
		await jira.getByRole("button", { name: "Back" }).click();
		await page.keyboard.press("Escape");
		await expect(jira).toBeHidden();

		// The card once Jira is connected.
		await atom.hover();
		await expect(page.locator(".link-card .link-card-issue")).toBeVisible();
		await explorer.scene("jira atom card, with the issue", { fixed: true });
		await page.mouse.move(0, 0);

		// The search dialog.
		await clickMenu(app, "File", "Jira…");
		await expect(jira).toBeVisible();
		await page.waitForTimeout(400);
		await explorer.scene("jira search dialog");
		const search = jira.locator('input[type="search"], input[type="text"]').first();
		if ((await search.count()) > 0) {
			await search.fill("oturum");
			await page.waitForTimeout(600);
			await explorer.scene("jira search dialog, typed");
		}
		await page.keyboard.press("Escape");
		if (await jira.isVisible()) await page.keyboard.press("Escape");

		// The pane.
		await showPane(page, "jira");
		const rows = page.locator(".jira-pane .jira-row");
		await expect(rows.first()).toBeVisible();
		await explorer.scene("jira pane");
		await page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-tree-toggle').click();
		await explorer.scene("jira pane, tree open");
		await page.locator(".jira-pane .jira-type-chip").filter({ hasText: "Sub-task" }).click();
		await explorer.scene("jira pane, filtered by type");
		await page.locator(".jira-pane .jira-type-chip").first().click();
		await page.locator('.jira-pane .jira-row[data-key="QR-1"]').click({ button: "right" });
		await expect(page.locator(".jira-row-menu")).toBeVisible();
		await explorer.scene("jira pane, row menu", { fixed: true });
		await page.locator('.jira-row-menu .jira-worklog-chip[data-hours="3"]').click();
		await expect(
			page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-row-note'),
		).toBeVisible();
		await explorer.scene("jira pane, logged from the row");
		await page.locator('.jira-pane .jira-row[data-key="QR-8"]').hover();
		await page.locator('.jira-pane .jira-row[data-key="QR-8"] .jira-star').click();
		await page.locator(".jira-pane-list").selectOption("favorites");
		await page.waitForTimeout(400);
		await explorer.scene("jira pane, favorites");
		await page.locator(".jira-pane-list").selectOption("mine");
		const paneSearch = page.locator(".jira-pane-search");
		await paneSearch.fill("oturum");
		await page.waitForTimeout(600);
		await explorer.scene("jira pane, search");
		await paneSearch.press("Escape");
		// The narrowest pane, and a wide one.
		for (const [label, delta] of [
			["narrow", -400],
			["wide", 500],
		] as const) {
			const resizer = page
				.locator(".dock-left .navigation-resizer, .dock-left [role='separator']")
				.first();
			const box = await resizer.boundingBox();
			if (box === null) continue;
			await page.mouse.move(box.x + box.width / 2, box.y + 200);
			await page.mouse.down();
			await page.mouse.move(box.x + delta, box.y + 200, { steps: 5 });
			await page.mouse.up();
			await explorer.scene(`jira pane, ${label}`);
		}
		// In the right dock, and at the bottom.
		for (const place of ["right", "bottom"] as const) {
			await clickMenu(app, "File", "Settings…");
			const settings = page.locator(".settings-dialog");
			await settings.locator('[data-category="panels"]').click();
			if (place === "right") await explorer.scene("settings, panels");
			await settings.locator('select[data-pane="jira"]').selectOption(place);
			await settings.getByRole("button", { name: "Done" }).click();
			await expect(page.locator(`.dock-${place} .jira-pane`)).toBeVisible();
			await explorer.scene(`jira pane, ${place} dock`);
		}
		// An issue opened from the pane, with the pane beside it.
		await page.locator('.jira-pane .jira-row[data-key="QR-7"]').click();
		await page.waitForTimeout(600);
		await explorer.scene("issue from the pane");
		await page.keyboard.press("Escape");
		// Settings: the connections.
		await clickMenu(app, "File", "Settings…");
		await page.locator('.settings-dialog [data-category="connections"]').click();
		await page.waitForTimeout(300);
		await explorer.scene("settings, connections");
		await page.keyboard.press("Escape");

		if (await explorer.finish(errors)) {
			expect(explorer.findings).toEqual([]);
			expect(errors).toEqual([]);
		}
		await recordMessageBoxes(app, 1);
		await app.close();
	});

	test(`exploration: Confluence, ${theme}`, async () => {
		const confluence = await fakeConfluence();
		cleanup.push(confluence.close);
		const folder = await tempDir("explore-confluence");
		const doc = join(folder, "analiz.md");
		await writeFile(
			doc,
			"# Analiz Belgesi\n\nYerel bir belge; Confluence'ta yayımlanacak.\n\n| Alan | Açıklama |\n| --- | --- |\n| id | Kimlik |\n",
		);
		const report = join(folder, "rapor.pdf");
		await writeFile(report, "%PDF-1.4 sahte");
		const { app, page, errors } = await launch({
			args: [doc],
			settings: { theme, confluenceReviewBeforeSave: true },
		});
		await app.evaluate(({ shell }) => {
			shell.openExternal = async () => {};
			shell.openPath = async () => "";
		});
		const explorer = await createExplorer(app, page, `confluence-${theme}`, errors);
		const pane = page.locator(".confluence-pane");

		// Connecting.
		await clickMenu(app, "File", "Open from Confluence…");
		const dialog = page.locator(".confluence-dialog");
		await expect(dialog).toBeVisible();
		await explorer.scene("login, empty");
		await dialog.locator('input[type="url"]').fill(confluence.site);
		await dialog.locator('input[type="password"]').fill("wrong");
		await dialog.getByRole("button", { name: "Connect" }).click();
		await page.waitForTimeout(500);
		await explorer.scene("login, wrong token");
		await dialog.locator('input[type="password"]').fill(TOKEN);
		await dialog.getByRole("button", { name: "Connect" }).click();
		await expect(dialog.locator(".quick-open-item").first()).toBeVisible();
		await explorer.scene("open dialog, results");
		await dialog
			.locator('input[type="search"], .quick-open-input')
			.first()
			.fill("yok böyle bir sayfa");
		await page.waitForTimeout(600);
		await explorer.scene("open dialog, no results");
		await page.keyboard.press("Escape");
		if (await dialog.isVisible()) await page.keyboard.press("Escape");

		// The local document can be published now.
		await expect(page.locator(".ribbon-publish")).toBeVisible();
		await explorer.scene("local document, publish button");
		await page.locator(".ribbon-publish").click();
		const publish = page.locator(".publish-dialog");
		await expect(publish).toBeVisible();
		await page.waitForTimeout(500);
		await explorer.scene("publish dialog");
		const node = publish.locator('.publish-node-label[data-page="41"]');
		if ((await node.count()) > 0) {
			await node.click();
			await explorer.scene("publish dialog, place chosen");
		}
		await publish.getByRole("button", { name: "Publish", exact: true }).click();
		await expect(publish.locator(".publish-done")).toBeVisible();
		await explorer.scene("publish dialog, done");
		await publish.locator(".publish-done").getByRole("button", { name: "Close" }).click();
		await page.waitForTimeout(500);
		await explorer.scene("published page open");

		// The pane: spaces, tree, favorites.
		await showPane(page, "confluence");
		await expect(pane).toBeVisible();
		await explorer.scene("pane, spaces");
		await pane.locator("select").selectOption("DEV");
		const root = pane.locator('[data-page="41"]');
		await expect(root).toBeVisible();
		await root.locator(".confluence-twisty").click();
		const child = pane.locator('[data-page="42"]');
		await expect(child).toBeVisible();
		await explorer.scene("pane, tree");
		await child.locator(".confluence-row-main").click();
		await expect(page.locator("#editor h1").first()).toHaveText("Sprint Planı");
		await explorer.scene("page open from the tree");
		await child.hover();
		await child.getByRole("button", { name: "Add to favorites" }).click();
		await explorer.scene("pane, a favorite");
		await root.hover();
		await root.getByRole("button", { name: "Add child page" }).click();
		await expect(pane.getByRole("textbox", { name: "Page title" })).toBeVisible();
		await explorer.scene("pane, new child page title");
		await page.keyboard.press("Escape");

		// Searching: titles, contents, filters.
		const search = pane.locator(".confluence-pane-search");
		await search.fill("Sprint");
		await page.waitForTimeout(600);
		await explorer.scene("pane, title search");
		await pane.getByRole("button", { name: "Contents" }).click();
		await search.fill("onay");
		await expect(pane.locator(".confluence-excerpt").first()).toBeVisible();
		await explorer.scene("pane, content search");
		await pane.getByRole("button", { name: "Filters" }).click();
		await explorer.scene("pane, filters open");
		await pane.getByRole("button", { name: "Past week" }).click();
		await pane.getByLabel("Only pages I worked on").check();
		await page.waitForTimeout(500);
		await explorer.scene("pane, filters set");
		await pane.getByRole("button", { name: "Clear filters" }).click();
		await search.fill("hiçbirşeybulunmaz");
		await page.waitForTimeout(700);
		await explorer.scene("pane, nothing found");
		await search.fill("");
		await search.press("Enter");
		// Narrow and wide.
		for (const [label, delta] of [
			["narrow", -400],
			["wide", 500],
		] as const) {
			const resizer = page
				.locator(".dock-left .navigation-resizer, .dock-left [role='separator']")
				.first();
			const box = await resizer.boundingBox();
			if (box === null) continue;
			await page.mouse.move(box.x + box.width / 2, box.y + 200);
			await page.mouse.down();
			await page.mouse.move(box.x + delta, box.y + 200, { steps: 5 });
			await page.mouse.up();
			await explorer.scene(`pane, ${label}`);
		}

		// The page: what Markdown cannot hold, the cards of kept things.
		await page.locator(".doc-tab", { hasText: "Sprint Planı" }).click();
		const atoms = page.locator('#editor a[href^="#confluence-keep-"]');
		if ((await atoms.count()) > 0) {
			await atoms.first().hover();
			await page.waitForTimeout(500);
			await explorer.scene("kept atom card", { fixed: true });
			await page.mouse.move(0, 0);
		}
		// Typing: a mention, a Jira issue.
		await page.locator("#editor p", { hasText: "Hedef" }).click();
		await page.keyboard.press("End");
		await page.keyboard.type(" için @ay");
		await expect(page.locator(".atom-picker:visible")).toBeVisible();
		await explorer.scene("mention picker", { fixed: true });
		await page.keyboard.press("Enter");
		await page.keyboard.type(" ve /jira");
		await page.waitForTimeout(400);
		await explorer.scene("slash menu, jira", { fixed: true });
		await page.keyboard.press("Enter");
		await page.waitForTimeout(300);
		await page.keyboard.type("abc-7");
		await page.waitForTimeout(600);
		await explorer.scene("jira issue picker", { fixed: true });
		await page.keyboard.press("Enter");
		await page.keyboard.type(" bitti");
		await explorer.scene("page edited, unsaved");

		// Attachments.
		await clickMenu(app, "File", "Confluence Attachments…");
		const attachments = page.locator(".attachments");
		await expect(attachments.locator('[data-name="logo.png"]')).toBeVisible();
		await explorer.scene("attachments");
		await stubOpenDialog(app, [report]);
		await attachments.getByRole("button", { name: "Upload Files…" }).click();
		await expect(attachments.locator('[data-name="rapor.pdf"]')).toBeVisible();
		await explorer.scene("attachments, uploaded");
		await attachments.getByRole("button", { name: "Close" }).click();

		// What changed, before saving.
		await page.locator(".ribbon-changes").click();
		const changes = page.locator("dialog.changes");
		await expect(changes).toBeVisible();
		await explorer.scene("changes, unified");
		await changes.getByRole("button", { name: "Side by side" }).click();
		await explorer.scene("changes, side by side");
		// Someone else saved meanwhile: the conflict.
		confluence.page.version = 9;
		await changes.getByRole("button", { name: "Save to Confluence" }).click();
		await expect(page.locator(".notice", { hasText: "changed on Confluence" })).toBeVisible();
		if (await changes.isVisible())
			await changes.getByRole("button", { name: "Close", exact: true }).last().click();
		await explorer.scene("conflict notice");
		await page
			.locator(".notice", { hasText: "changed on Confluence" })
			.getByRole("button", { name: "Overwrite" })
			.click();
		await expect(page.locator(".save-status")).toHaveText("Saved");
		await explorer.scene("saved after overwrite");

		// The pane in the right dock, with the notes and the assistant about.
		await clickMenu(app, "File", "Settings…");
		const settings = page.locator(".settings-dialog");
		await settings.locator('[data-category="panels"]').click();
		await settings.locator('select[data-pane="confluence"]').selectOption("right");
		await settings.getByRole("button", { name: "Done" }).click();
		await expect(page.locator(".dock-right .confluence-pane")).toBeVisible();
		await explorer.scene("pane, right dock");
		await clickMenu(app, "File", "Settings…");
		await settings.locator('[data-category="connections"]').click();
		await page.waitForTimeout(300);
		await explorer.scene("settings, connections");
		await page.keyboard.press("Escape");

		if (await explorer.finish(errors)) {
			expect(explorer.findings).toEqual([]);
			expect(errors).toEqual([]);
		}
		await recordMessageBoxes(app, 1);
		await app.close();
	});
}
