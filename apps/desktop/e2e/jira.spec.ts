import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, showPane } from "./launch.js";

const CONFLUENCE_TOKEN = "confluence-pat";
const JIRA_TOKEN = "jira-pat";

const json = (res: ServerResponse, body: unknown, status = 200) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const issue = (key: string, summary: string, status: string, category: string) => ({
	key,
	fields: {
		summary,
		status: { name: status, statusCategory: { key: category } },
		issuetype: { name: key === "QR-2" ? "Sub-task" : "Bug" },
		assignee: { displayName: "Ayşe Balcı" },
		updated: "2026-11-01T10:00:00.000+0300",
	},
});

const subtask = (key: string, summary: string, parent: string) => {
	const base = issue(key, summary, "Open", "new");
	return {
		...base,
		fields: {
			...base.fields,
			parent: { key: parent, fields: { summary: `Üst ${parent}`, status: { name: "Open" } } },
		},
	};
};

/** Jira Server: who is signed in, two issues and a search. */
async function fakeJira() {
	const searches: string[] = [];
	/** The work logs Tempo was sent. */
	const worklogs: Record<string, unknown>[] = [];
	/** Where the issue's "mentioned in" page is: set once the fake Confluence is up. */
	const confluence = { site: "" };
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.headers.authorization !== `Bearer ${JIRA_TOKEN}`) {
			return json(res, { errorMessages: ["Unauthorized"] }, 401);
		}
		if (url.pathname === "/rest/api/2/myself") {
			return json(res, { displayName: "Ayşe Balcı", key: "JIRAUSER1", name: "ayse" });
		}
		// Tempo Timesheets: its work attributes, its accounts, and a work log sent to it.
		if (url.pathname === "/rest/tempo-core/1/work-attribute") {
			return json(res, [
				{
					id: 1,
					key: "_Sirket_",
					name: "Faturalandırılacak Şirket",
					type: { value: "STATIC_LIST" },
					required: false,
					staticListValues: [{ id: 1, name: "TKAO - Türk Hava Yolları A.O.", value: "TKAO" }],
				},
				{ id: 2, key: "_Servis_", name: "Servis", type: { value: "ACCOUNT" }, required: true },
			]);
		}
		if (url.pathname === "/rest/tempo-accounts/1/account") {
			return json(res, [
				{ key: "QUICKRES", name: "Satış Kanalı (QuickRes) Uygulaması", status: "OPEN" },
			]);
		}
		if (url.pathname === "/rest/tempo-timesheets/4/worklogs" && req.method === "POST") {
			let body = "";
			for await (const chunk of req) body += chunk;
			worklogs.push(JSON.parse(body));
			return json(res, [{ tempoWorklogId: worklogs.length }]);
		}
		if (url.pathname === "/rest/api/2/issue/QR-1/worklog") {
			return json(res, {
				worklogs: [
					{
						author: { key: "JIRAUSER1", displayName: "Ayşe Balcı" },
						started: "2026-10-16T09:00:00.000+0300",
						timeSpentSeconds: 21600,
						comment: "Working on issue QR-1",
					},
				],
			});
		}
		if (url.pathname === "/rest/api/2/issue/QR-1") {
			const base = issue("QR-1", "Giriş zaman aşımı", "In Progress", "indeterminate");
			return json(res, {
				...base,
				fields: {
					...base.fields,
					priority: { name: "High" },
					timetracking: {
						timeSpentSeconds:
							12 * 3600 + worklogs.reduce((all, log) => all + Number(log.timeSpentSeconds), 0),
						remainingEstimateSeconds: 8 * 3600,
					},
					reporter: { displayName: "Mehmet" },
					// An HTML editor plug-in keeps the description as HTML, lines joined by backslashes.
					description:
						'<div class="jePanel_warning" style="border:1px solid #d4a19e">\\\n<p dir="auto"><b>HATA</b>: Oturum <u>30 sn</u> sonra düşüyor.</p>\\\n</div><ul>\\\n<li>Chrome</li><li>Edge</li></ul>',
					labels: ["oturum"],
					subtasks: [issue("QR-2", "Süreyi ayarla", "Done", "done")],
					comment: {
						total: 1,
						comments: [{ author: { displayName: "Can" }, body: "Bende de oluyor." }],
					},
				},
			});
		}
		if (url.pathname === "/rest/api/2/issue/QR-1/remotelink") {
			return json(res, [
				{
					relationship: "mentioned in",
					application: { type: "com.atlassian.confluence", name: "Confluence" },
					object: {
						url: `${confluence.site}/pages/viewpage.action?pageId=42`,
						title: "Sprint Planı",
					},
				},
			]);
		}
		if (url.pathname === "/rest/api/2/issue/QR-2") {
			return json(res, issue("QR-2", "Süreyi ayarla", "Done", "done"));
		}
		if (url.pathname === "/rest/api/2/search") {
			searches.push(url.searchParams.get("jql") ?? "");
			return json(res, {
				// Sub-tasks come before and after their parent; one's parent is not in the results.
				issues: [
					subtask("QR-2", "Süreyi ayarla", "QR-1"),
					issue("QR-1", "Giriş zaman aşımı", "In Progress", "indeterminate"),
					subtask("QR-5", "Ön yüz", "QR-1"),
					subtask("QR-8", "Bebek ekleme FE", "QR-7"),
				],
				total: 4,
				startAt: 0,
			});
		}
		return json(res, { errorMessages: ["Not found"] }, 404);
	});
	const site = await listen(server);
	return {
		site,
		searches,
		worklogs,
		confluence,
		close: () => new Promise<void>((done) => server.close(() => done())),
	};
}

/**
 * Confluence Server with one page naming a Jira issue. Its application
 * links need an administrator; the Jira macro's servers do not.
 */
async function fakeConfluence(jiraSite: string) {
	const jira =
		'<ac:structured-macro ac:name="jira"><ac:parameter ac:name="server">Şirket Jira</ac:parameter><ac:parameter ac:name="serverId">j1</ac:parameter><ac:parameter ac:name="key">QR-1</ac:parameter></ac:structured-macro>';
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.headers.authorization !== `Bearer ${CONFLUENCE_TOKEN}`) {
			return json(res, { message: "Unauthorized" }, 401);
		}
		if (url.pathname.startsWith("/rest/applinks/")) {
			return json(res, { message: "Administrators only" }, 403);
		}
		if (url.pathname === "/rest/jiraanywhere/1.0/servers") {
			return json(res, [{ id: "j1", name: "Şirket Jira", url: jiraSite, selected: true }]);
		}
		if (url.pathname === "/rest/api/space")
			return json(res, { results: [{ key: "DEV", name: "Geliştirme" }] });
		if (url.pathname === "/rest/api/search") {
			return json(res, { results: [{ content: { id: "42", title: "Sprint Planı" } }] });
		}
		if (url.pathname === "/rest/api/content/42") {
			return json(res, {
				title: "Sprint Planı",
				version: { number: 1 },
				body: { storage: { value: `<h1>Sprint Planı</h1><p>Kayıt ${jira} açık.</p>` } },
				space: { key: "DEV" },
				_links: { webui: "/display/DEV/Sprint" },
			});
		}
		if (url.pathname.endsWith("/child/attachment")) return json(res, { results: [] });
		return json(res, { message: "Not found" }, 404);
	});
	const site = await listen(server);
	return { site, close: () => new Promise<void>((done) => server.close(() => done())) };
}

const cleanup: (() => Promise<void>)[] = [];
test.afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

test("opens a Jira issue named on a Confluence page in Kalem, and docks the panels where the user puts them", async () => {
	const jiraServer = await fakeJira();
	cleanup.push(jiraServer.close);
	const confluence = await fakeConfluence(jiraServer.site);
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
	await expect(jira.locator(".jira-fields")).toContainText("AssigneeAyşe Balcı");
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
	await expect(jira.locator(".jira-comment")).toContainText("Bende de oluyor.");
	// Work is logged from the issue, through Tempo: a quick button, then its fields.
	await jira.locator(".jira-log-work").click();
	const worklog = jira.locator(".jira-worklog");
	await expect(worklog.locator(".jira-worklog-summary")).toHaveText("Spent 12h · Remaining 8h");
	await expect(worklog.locator(".jira-worklog-mine li")).toContainText("6h");
	await worklog.locator('.jira-worklog-chip[data-hours="5"]').click();
	await expect(worklog.locator(".jira-worklog-worked")).toHaveValue("5h");
	await expect(worklog.locator(".jira-worklog-remaining")).toHaveValue("3h");
	// Servis must be chosen; Tempo is not asked until it is.
	await worklog.locator(".jira-worklog-submit").click();
	await expect(worklog.locator(".jira-worklog-status")).toHaveText("Fill in: Servis");
	expect(jiraServer.worklogs).toEqual([]);
	await worklog.locator('select[data-attribute="_Servis_"]').selectOption("QUICKRES");
	await worklog.locator('select[data-attribute="_Sirket_"]').selectOption("TKAO");
	await worklog.locator(".jira-worklog-submit").click();
	await expect(worklog.locator(".jira-worklog-status")).toHaveText("5h logged on QR-1.");
	expect(jiraServer.worklogs[0]).toMatchObject({
		worker: "JIRAUSER1",
		originTaskId: "QR-1",
		timeSpentSeconds: 5 * 3600,
		remainingEstimate: 3 * 3600,
		comment: "Working on issue QR-1",
		attributes: {
			_Servis_: { workAttributeId: 2, value: "QUICKRES" },
			_Sirket_: { workAttributeId: 1, value: "TKAO" },
		},
	});
	await expect(worklog.locator(".jira-worklog-summary")).toHaveText("Spent 17h · Remaining 8h");
	// The choices are remembered: the form starts with them next time.
	await expect
		.poll(async () =>
			JSON.parse(await readFile(join(userData, "jira-worklog.json"), "utf8").catch(() => "{}")),
		)
		.toEqual({ [jiraServer.site]: { _Sirket_: "TKAO", _Servis_: "QUICKRES" } });
	// A sub-task opens in the same dialog, and Back returns.
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
	// Sub-tasks under their parent, as a tree; a parent the search missed heads its own.
	const rows = page.locator(".jira-pane .jira-row");
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-2", "QR-5", "QR-7", "QR-8"]);
	await expect(page.locator(".jira-pane .jira-tree-child")).toHaveCount(3);
	await expect(page.locator('.jira-pane .jira-tree-context[data-key="QR-7"]')).toBeVisible();
	// The parent's toggle folds its sub-tasks away and back.
	const toggle = page.locator('.jira-pane .jira-row[data-key="QR-1"] .jira-tree-toggle');
	await toggle.click();
	await expect(rows.locator(".jira-key")).toHaveText(["QR-1", "QR-7", "QR-8"]);
	await expect(page.locator(".jira-dialog")).toBeHidden();
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

	// Settings: Jira goes to the right dock, the headings under the document.
	await clickMenu(app, "View", "Settings…");
	const settings = page.locator(".settings-dialog");
	await expect(settings.locator('[data-connection="Jira"]')).toContainText(jiraServer.site);
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
		.toEqual({ outline: "bottom", files: "right", confluence: "left", jira: "right" });
	expect(errors).toEqual([]);
	await app.close();
});
