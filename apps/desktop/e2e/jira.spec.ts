import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { CONFLUENCE_TOKEN, fakeJira, fakeJiraConfluence, JIRA_TOKEN } from "./fake-jira.js";
import { clickMenu, launch, showPane } from "./launch.js";

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

test("opens a Jira issue named on a Confluence page in Kalem, and docks the panels where the user puts them", async () => {
	const jiraServer = await fakeJira();
	cleanup.push(jiraServer.close);
	const confluence = await fakeJiraConfluence(jiraServer.site);
	cleanup.push(confluence.close);
	jiraServer.confluence.site = confluence.site;
	const { app, page, userData, errors } = await launch();
	await app.evaluate(({ shell }) => {
		const opened: string[] = [];
		(globalThis as { opened?: string[] }).opened = opened;
		shell.openExternal = async (url: string) => {
			opened.push(url);
		};
	});
	const opened = () => app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);

	// Not set up: neither Confluence nor Jira has a pane.
	await expect(page.locator('.stripe-left .stripe-button[data-pane="outline"]')).toBeVisible();
	await expect(page.locator('.stripe-button[data-pane="confluence"]')).toHaveCount(0);
	await expect(page.locator('.stripe-button[data-pane="jira"]')).toHaveCount(0);
	// The left dock names the pane it shows, as the assistant's panel does.
	await expect(page.locator(".dock-left .dock-title h2")).toHaveText("Headings");

	await clickMenu(app, "File", "Open from Confluence…");
	const dialog = page.locator(".confluence-dialog");
	await dialog.locator('input[type="url"]').fill(confluence.site);
	await dialog.locator('input[type="password"]').fill(CONFLUENCE_TOKEN);
	await dialog.getByRole("button", { name: "Connect" }).click();
	await dialog.locator(".quick-open-item", { hasText: "Sprint Planı" }).click();
	await expect(dialog).not.toBeVisible();
	// Connected: Confluence's pane is there now.
	await expect(page.locator('.stripe-left .stripe-button[data-pane="confluence"]')).toBeVisible();

	// The card: Jira's address from the Jira macro's servers, and an Open button.
	const atom = page.locator('#editor a[href^="#confluence-keep-"]', { hasText: "QR-1" });
	await atom.hover();
	const card = page.locator(".link-card");
	await expect(card.locator(".link-card-url")).toHaveText(`${jiraServer.site}/browse/QR-1`);
	await expect(card.getByRole("button", { name: "Open", exact: true })).toBeVisible();
	await expect(card.getByRole("button", { name: "Open in Browser" })).toBeVisible();

	// A click opens it in Kalem; without a Jira login it asks for one, the address filled in.
	await page.mouse.move(0, 0);
	await atom.click();
	const jira = page.locator(".jira-dialog");
	await expect(jira).toBeVisible();
	await expect(jira.locator('input[type="url"]')).toHaveValue(jiraServer.site);
	await jira.locator('input[type="password"]').fill(JIRA_TOKEN);
	await jira.getByRole("button", { name: "Connect" }).click();

	await expect(jira.locator(".jira-title")).toHaveText("Giriş zaman aşımı");
	await expect(jira.locator(".jira-issue-head .jira-status")).toHaveText("In Progress");
	await expect(jira.locator(".jira-parent-link")).toContainText(
		"FT-30468TK PNRı Olmayan Bilette PNR Alanının Dolu Gelmesi",
	);
	await expect(jira.locator(".jira-tab")).toHaveText([
		"Details",
		"Comments (4)",
		"Development",
		"Sub-tasks (1)",
	]);
	await expect(jira.locator(".jira-meta")).toContainText("Bug");
	await expect(jira.locator(".jira-journey-step:not(.merge) .jira-journey-label")).toHaveText([
		"Open",
		"In Analysis",
		"In Progress",
	]);
	await expect(jira.locator(".jira-journey-step.current")).toContainText("In Progress");
	await expect(jira.locator(".jira-journey-step.merge")).toHaveText("PR merged");
	await expect(jira.locator(".jira-fields")).toContainText("AssigneeAyşe Balcı");
	await expect(jira.locator(".jira-fields")).toContainText("12h · 8h left");
	await expect(jira.locator(".jira-fields")).toContainText("SprintKırmızı Sprint 27");
	await expect(jira.locator(".jira-fields")).toContainText("TakımKırmızı");
	await jira.locator(".jira-all-fields > summary").click();
	const all = jira.locator(".jira-all-fields-list");
	await expect(all).toContainText("Story OriginBusiness Requirement");
	await expect(all).toContainText("TeamKırmızı");
	await expect(all).toContainText("ReporterMehmet");
	await expect(all).not.toContainText("Branch");
	await expect(all).not.toContainText("Parent Link");

	// The chips save at once; a failed save puts the old value back.
	await jira.locator('.jira-field-chip[aria-label="Assignee"]').click();
	await jira
		.locator(".jira-picker:not([hidden]) .jira-picker-item", { hasText: "Yusuf Kocak" })
		.click();
	await expect(jira.locator('.jira-field-chip[aria-label="Assignee"]')).toHaveText("Yusuf Kocak");
	await expect
		.poll(() => jiraServer.edits.at(-1))
		.toEqual({
			method: "PUT",
			path: "/rest/api/2/issue/QR-1/assignee",
			body: { name: "yusuf" },
		});
	await jira.locator('.jira-field-chip[aria-label="Sprint"]').click();
	await expect(
		jira.locator(".jira-picker:not([hidden]) .jira-picker-item[aria-selected=true]"),
	).toHaveText("Kırmızı Sprint 27");
	await jira
		.locator(".jira-picker:not([hidden]) .jira-picker-item", { hasText: "Kırmızı Sprint 28" })
		.click();
	await expect.poll(() => jiraServer.edits.at(-1)?.path).toBe("/rest/agile/1.0/sprint/28/issue");
	jiraServer.editable.failNextEdit = true;
	await jira.locator('.jira-field-chip[aria-label="Takım"]').click();
	await jira.locator(".jira-picker:not([hidden]) .jira-picker-item", { hasText: "Mavi" }).click();
	await expect(jira.locator(".jira-edit-error")).toContainText("Alan düzenlenemez");
	await expect(jira.locator('.jira-field-chip[aria-label="Takım"]')).toHaveText("Kırmızı");
	await jira.locator('.jira-field-chip[aria-label="Takım"]').click();
	await jira.locator(".jira-picker:not([hidden]) .jira-picker-item", { hasText: "Mavi" }).click();
	await expect
		.poll(() => jiraServer.edits.at(-1)?.body)
		.toEqual({
			fields: { customfield_11: { id: "2" } },
		});
	await expect(jira.locator(".jira-edit-error")).toBeHidden();
	// Labels: removed with ×, added from the suggestions.
	await jira.locator('.jira-label-chip[data-label="oturum"] .jira-label-remove').click();
	await expect
		.poll(() => jiraServer.edits.at(-1)?.body)
		.toEqual({
			update: { labels: [{ remove: "oturum" }] },
		});
	await jira.locator(".jira-label-add").click();
	await page.keyboard.type("Ana");
	await jira.locator(".jira-label-picker .jira-picker-item", { hasText: "AnalizTamam" }).click();
	await expect(jira.locator(".jira-label-chip[data-label]")).toHaveText(["AnalizTamam"]);
	await expect
		.poll(() => jiraServer.edits.at(-1)?.body)
		.toEqual({
			update: { labels: [{ add: "AnalizTamam" }] },
		});
	// The description kept as HTML is drawn as a page, not shown as code: the panel is an alert.
	const description = jira.locator(".jira-markdown").first();
	await expect(description.locator("blockquote")).toContainText(
		"⚠️ HATA: Oturum 30 sn sonra düşüyor.",
	);
	await expect(description.locator("li")).toHaveText(["Chrome", "Edge"]);
	await expect(description).not.toContainText("<div");
	await expect(description).not.toContainText("\\");
	// Links are grouped by how they relate; a Confluence page that mentions it is among them.
	const mentioned = jira.locator(".jira-link-group", { hasText: "mentioned in" });
	await expect(mentioned.locator(".jira-remote")).toHaveText("Sprint Planı");
	await jira.locator('.jira-tab[data-tab="comments"]').click();
	const comments = jira.locator(".jira-comment");
	await expect(comments.nth(0).locator(".jira-comment-author")).toHaveText("Gulden Baykara");
	await expect(comments.nth(0).locator(".jira-team-badge")).toHaveText("Quickres Analist Takimi");
	await expect(comments.nth(0).locator(".jira-mention")).toHaveText("@Isil Sen");
	await expect(comments.nth(0).locator(".jira-markdown p")).toHaveCount(3);
	await expect(comments.nth(1)).toHaveClass(/jira-comment-short/);
	await expect(comments.nth(1).locator(".jira-team-badge")).toHaveText("Gelir Yonetimi Bsk.");
	await expect(comments.nth(2)).toContainText("Bende de oluyor.");
	// An attached image comes through Kalem, signed in; one that is gone shows its name.
	const image = comments.nth(3).locator(".jira-thumb img");
	await expect(image).toHaveAttribute("src", "kalem-doc://jira/501/pastedImage_1.png");
	await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
	await expect(comments.nth(3).locator(".jira-attachment-missing")).toContainText("kayip.png");
	const linkCard = comments.nth(3).locator(".jira-link-card");
	await expect(linkCard.locator(".jira-link-card-title")).toHaveText("TK PNRı Olmayan Bilette");
	await expect(linkCard.locator(".jira-link-card-subtitle")).toHaveText(
		"Doğrudan Satış · wiki.example.com",
	);
	// Filters: comments with attachments, a team.
	await jira.locator(".jira-filter-chip", { hasText: "With attachments" }).click();
	await expect(comments).toHaveCount(1);
	await jira.locator(".jira-filter-chip", { hasText: "With attachments" }).click();
	await jira.locator(".jira-filter-select").selectOption("team:Quickres Analist Takimi");
	await expect(comments).toHaveCount(1);
	await jira.locator(".jira-filter-select").selectOption("");
	await expect(comments).toHaveCount(4);
	// A quick reply, with a mention picked from Jira's users.
	const reply = jira.locator(".jira-composer-input");
	await reply.click();
	await page.keyboard.type("Merhaba @isi");
	await jira.locator(".jira-mention-picker .jira-picker-item", { hasText: "Isil Sen" }).click();
	await page.keyboard.type("bakar mısınız?");
	await expect(reply).toHaveValue("Merhaba @Isil Sen bakar mısınız?");
	await jira.locator(".jira-composer-send").click();
	await expect(comments).toHaveCount(5);
	await expect(jira.locator('.jira-tab[data-tab="comments"]')).toHaveText("Comments (5)");
	expect(jiraServer.edits.at(-1)).toMatchObject({
		path: "/rest/api/2/issue/QR-1/comment",
		body: { body: "Merhaba [~isil.sen] bakar mısınız?" },
	});
	await expect(reply).toHaveValue("");
	await jira.locator('.jira-tab[data-tab="development"]').click();
	// The Development panel: branches, commits and pull requests, each opening into its list.
	const development = jira.locator(".jira-dev-section");
	await expect(development.locator(".jira-dev-count")).toHaveText([
		"2 branches",
		"8 commits",
		"1 pull request",
	]);
	await development.locator('.jira-dev-line[data-kind="pullRequests"]').click();
	const pull = development.locator(".jira-dev-item");
	await expect(pull.locator(".jira-dev-title")).toHaveText("QR-1 Oturum süresi");
	await expect(pull.locator(".jira-dev-state")).toHaveText("MERGED");
	await expect(pull.locator(".jira-dev-detail")).toHaveText("feature/QR-1 → develop");
	// The status opens the steps the issue can take; one that asks for more is taken in Jira.
	await jira.locator(".jira-status-button").click();
	const steps = jira.locator(".jira-transition-menu .jira-transition");
	await expect(steps).toHaveCount(3);
	// Escape closes the menu only, not the issue's dialog with it.
	await page.keyboard.press("Escape");
	await expect(jira.locator(".jira-transition-menu")).toBeHidden();
	await expect(jira).toBeVisible();
	await jira.locator(".jira-status-button").click();
	await expect(steps).toHaveCount(3);
	await expect(steps.nth(2)).toHaveAttribute("title", "Asks for Reason: opens in Jira");
	await steps.filter({ hasText: "Test" }).click();
	await expect(jira.locator(".jira-status-button .jira-status")).toHaveText("Test");
	expect(jiraServer.transitions).toEqual([{ transition: { id: "21" } }]);
	// Work is logged from the issue, through Tempo: a quick button, then its fields.
	await jira.locator(".jira-log-work").click();
	const worklog = jira.locator(".jira-worklog");
	await expect(worklog.locator(".jira-worklog-summary")).toHaveText("Spent 12h · Remaining 8h");
	await expect(worklog.locator(".jira-worklog-mine li")).toContainText("6h");
	// The choices come from each attribute's own address, as in Tempo's dialog.
	const servis = worklog.locator('input[data-attribute="_Servis_"]');
	const sirket = worklog.locator('input[data-attribute="_Sirket_"]');
	const choices = worklog.locator(".combo-list:not([hidden]) .combo-option");
	await expect(servis).toHaveAttribute("placeholder", "Choose…");
	await sirket.click();
	await expect(choices).toHaveText(["TKAO - Türk Hava Yolları A.O."]);
	await page.keyboard.press("Escape");
	await expect(worklog.locator(".jira-worklog-diagnostics")).toBeHidden();
	await worklog.locator('.jira-worklog-chip[data-hours="5"]').click();
	await expect(worklog.locator(".jira-worklog-worked")).toHaveValue("5h");
	await expect(worklog.locator(".jira-worklog-remaining")).toHaveValue("3h");
	// Servis must be chosen; Tempo is not asked until it is.
	await worklog.locator(".jira-worklog-submit").click();
	await expect(worklog.locator(".jira-worklog-status")).toHaveText("Fill in: Servis");
	expect(jiraServer.worklogs).toEqual([]);
	// Each letter typed narrows the list: names starting with it first, then a word in them.
	await servis.click();
	await expect(choices).toHaveCount(3);
	await page.keyboard.type("s");
	await expect(choices).toHaveText([
		"Sigorta Servisi",
		"Satış Kanalı (QuickRes) Uygulaması",
		"Ana Sayfa Servisi",
	]);
	await page.keyboard.type("a");
	await expect(choices).toHaveText(["Satış Kanalı (QuickRes) Uygulaması", "Ana Sayfa Servisi"]);
	await page.keyboard.press("Enter");
	await expect(servis).toHaveValue("Satış Kanalı (QuickRes) Uygulaması");
	await sirket.click();
	await page.keyboard.type("türk");
	await expect(choices).toHaveText(["TKAO - Türk Hava Yolları A.O."]);
	await page.keyboard.press("Enter");
	await expect(sirket).toHaveValue("TKAO - Türk Hava Yolları A.O.");
	await worklog.locator(".jira-worklog-submit").click();
	await expect(worklog.locator(".jira-worklog-status")).toHaveText("5h logged on QR-1.");
	expect(jiraServer.worklogs[0]).toMatchObject({
		worker: "JIRAUSER1",
		// As Tempo's own dialog sends it: the issue's numeric id, and no remaining
		// estimate unless the user typed one.
		originTaskId: "10001",
		timeSpentSeconds: 5 * 3600,
		remainingEstimate: null,
		billableSeconds: null,
		comment: "Working on issue QR-1",
		attributes: {
			_Servis_: { name: "Servis", workAttributeId: 102, value: "3351" },
			_Sirket_: { name: "Faturalandırılacak Şirket", workAttributeId: 21, value: "TKAO" },
		},
	});
	await expect(worklog.locator(".jira-worklog-summary")).toHaveText("Spent 17h · Remaining 8h");
	// The choices are remembered: the form starts with them next time.
	await expect
		.poll(async () =>
			JSON.parse(await readFile(join(userData, "jira-worklog.json"), "utf8").catch(() => "{}")),
		)
		.toEqual({ [jiraServer.site]: { _Sirket_: "TKAO", _Servis_: "3351" } });
	// A sub-task opens in the same dialog, and Back returns.
	await jira.locator('.jira-tab[data-tab="subtasks"]').click();
	await jira.locator('.jira-row[data-key="QR-2"]').click();
	await expect(jira.locator(".jira-title")).toHaveText("Süreyi ayarla");
	await jira.getByRole("button", { name: "Back" }).click();
	await expect(jira.locator(".jira-title")).toHaveText("Giriş zaman aşımı");
	await jira.getByRole("button", { name: "Open in Browser" }).click();
	await expect.poll(opened).toEqual([`${jiraServer.site}/browse/QR-1`]);
	// The page opens in Kalem, and the dialog closes.
	await mentioned.locator(".jira-remote").click();
	await expect(jira).toBeHidden();
	await expect(page.locator(".doc-tab", { hasText: "Sprint Planı" })).toHaveCount(1);

	// The card now shows the issue's summary and status, from Jira.
	await atom.hover();
	await expect(card.locator(".link-card-issue")).toContainText("Giriş zaman aşımı");
	await page.mouse.move(0, 0);

	// Jira has a pane once it is connected: the user's issues.
	await showPane(page, "jira");
	await expect(page.locator(".dock-left .dock-title h2")).toHaveText("Jira");
	// Sub-tasks under their parent, as a tree, folded away until the parent is opened;
	// a parent the search missed heads its own, open, since they are what was found.
	const rows = page.locator(".jira-pane .jira-row");
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-7", "QR-8"]);
	await expect(page.locator(".jira-pane .jira-tree-child")).toHaveCount(1);
	await expect(page.locator('.jira-pane .jira-tree-context[data-key="QR-7"]')).toBeVisible();
	await expect(page.locator('.jira-pane .jira-row[data-key="QR-1"]')).toHaveAttribute(
		"aria-expanded",
		"false",
	);
	// Escape empties the pane's search, as in the other panes.
	const paneSearch = page.locator(".jira-pane-search");
	await paneSearch.fill("oturum");
	await expect.poll(() => jiraServer.searches.at(-1)).toContain("oturum");
	await paneSearch.press("Escape");
	await expect(paneSearch).toHaveValue("");
	await expect.poll(() => jiraServer.searches.at(-1)).not.toContain("oturum");
	// The parent's toggle opens its drawer of sub-tasks, and folds it away again.
	const toggle = page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-tree-toggle');
	await toggle.click();
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-2", "QR-5", "QR-7", "QR-8"]);
	await expect(page.locator(".jira-dialog")).toBeHidden();
	await page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-tree-toggle').click();
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-7", "QR-8"]);
	await page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-tree-toggle').click();
	await expect(rows).toHaveCount(5);
	expect(jiraServer.searches.at(-1)).toContain("assignee = currentUser()");
	// Issue types filter the list: a chip each, with how many there are.
	const chips = page.locator(".jira-pane .jira-type-chip");
	await expect(chips).toHaveText(["All4", "Bug3", "Sub-task1"]);
	await chips.filter({ hasText: "Sub-task" }).click();
	await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
	// The sub-task stays under its parent, which only heads it now.
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-2"]);
	await expect(page.locator('.jira-pane .jira-tree-context[data-key="QR-1"]')).toBeVisible();
	await expect(page.locator(".jira-pane .jira-pane-message")).toHaveText("1 of 4 loaded issues");
	await chips.first().click();
	await expect(rows).toHaveCount(5);
	await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
	// The keyboard walks the tree: down to the next row, left folds a parent.
	await rows.first().focus();
	await page.keyboard.press("ArrowDown");
	await expect(page.locator('.jira-pane .jira-row[data-key="QR-2"]')).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(page.locator('.jira-pane .jira-row[data-key="QR-1"]')).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(rows).toHaveCount(3);
	await page.keyboard.press("ArrowRight");
	await expect(rows).toHaveCount(5);

	// A right-click logs work today, with the choices remembered from the form.
	await page.locator('.jira-pane .jira-row[data-key="QR-1"]').click({ button: "right" });
	const rowMenu = page.locator(".jira-row-menu");
	await expect(rowMenu).toBeVisible();
	await rowMenu.locator('.jira-worklog-chip[data-hours="3"]').click();
	await expect(rowMenu).toBeHidden();
	await expect(page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-row-note')).toHaveText(
		"✓ 3h",
	);
	expect(jiraServer.worklogs.at(-1)).toMatchObject({
		originTaskId: "10001",
		timeSpentSeconds: 3 * 3600,
		comment: "Working on issue QR-1",
		attributes: { _Servis_: { value: "3351" }, _Sirket_: { value: "TKAO" } },
	});
	await expect(page.locator(".jira-dialog")).toBeHidden();

	// Stars: one from the row's menu, one from the row; the favorites list shows them.
	await page.locator('.jira-pane .jira-row[data-key="QR-5"]').click({ button: "right" });
	await rowMenu.getByRole("menuitem", { name: "★ Add to favorites" }).click();
	await expect(page.locator('.jira-pane .jira-row[data-key="QR-5"] .jira-star')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await page.locator('.jira-pane .jira-row[data-key="QR-8"]').hover();
	await page.locator('.jira-pane .jira-row[data-key="QR-8"] .jira-star').click();
	await page.locator(".jira-pane-list").selectOption("favorites");
	await expect(rows.locator(".jira-key")).toHaveText(["QR-7", "QR-8", "QR-1", "QR-5"]);
	expect(jiraServer.searches.at(-1)).toBe("key IN (QR-8, QR-5)");
	// Taking a star off takes it out of the list.
	await page.locator('.jira-pane .jira-row[data-key="QR-8"] .jira-star').click();
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-5"]);
	await expect
		.poll(async () => {
			const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
			return stored.settings.jiraFavorites.map((item: { key: string }) => item.key);
		})
		.toEqual(["QR-5"]);
	await page.locator(".jira-pane-list").selectOption("mine");

	// Settings: Jira goes to the right dock, the headings under the document.
	await clickMenu(app, "File", "Settings…");
	const settings = page.locator(".settings-dialog");
	await settings.locator('[data-category="connections"]').click();
	await expect(settings.locator('[data-connection="Jira"]')).toContainText(jiraServer.site);
	await settings.locator('[data-category="panels"]').click();
	await settings.locator('select[data-pane="jira"]').selectOption("right");
	await settings.locator('select[data-pane="outline"]').selectOption("bottom");
	await settings.getByRole("button", { name: "Done" }).click();
	await expect(page.locator(".dock-right .jira-pane")).toBeVisible();
	await expect(page.locator(".dock-bottom .navigation-content")).toBeVisible();
	await expect(page.locator('.stripe-right .stripe-button[data-pane="jira"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	// The right stripe's button closes and reopens its dock.
	await page.locator('.stripe-right .stripe-button[data-pane="jira"]').click();
	await expect(page.locator(".dock-right")).toBeHidden();
	await page.locator('.stripe-right .stripe-button[data-pane="jira"]').click();
	await expect(page.locator(".dock-right")).toBeVisible();

	// A tab's menu moves a pane too: files go to the right, next to Jira.
	await page.locator('.stripe-left .stripe-button[data-pane="files"]').click({ button: "right" });
	await page.locator(".dock-menu").getByRole("menuitem", { name: "Move to Right" }).click();
	await expect(page.locator('.stripe-right .stripe-button[data-pane="files"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(page.locator(".dock-right .dock-title h2")).toHaveText("Files");

	await expect
		.poll(async () => {
			const stored = JSON.parse(await readFile(join(userData, "settings.json"), "utf8"));
			return stored.settings.panePlaces;
		})
		.toEqual({
			outline: "bottom",
			files: "right",
			confluence: "left",
			jira: "right",
			notes: "right",
		});
	expect(errors).toEqual([]);
	await app.close();
});
