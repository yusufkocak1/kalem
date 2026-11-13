/** The fake Jira Server (and a Confluence naming one of its issues) the end-to-end tests talk to. */
import type { ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export const CONFLUENCE_TOKEN = "confluence-pat";
export const JIRA_TOKEN = "jira-pat";

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
export async function fakeJira() {
	const searches: string[] = [];
	/** The work logs Tempo was sent. */
	const worklogs: Record<string, unknown>[] = [];
	/** How often ScriptRunner's list was asked for. */
	let serviceListAsked = 0;
	/** The fake's own address, known once it listens. */
	const base = { site: "" };
	const jiraSite = (): string => base.site;
	/** The status changes Jira was sent, and QR-1's status after them. */
	const transitions: Record<string, unknown>[] = [];
	let status = { name: "In Progress", category: "indeterminate" };
	/** Where the issue's "mentioned in" page is: set once the fake Confluence is up. */
	const confluence = { site: "" };
	const edits: { method: string; path: string; body: unknown }[] = [];
	const editable = {
		assignee: { name: "ayse", displayName: "Ayşe Balcı" } as {
			name: string;
			displayName: string;
		} | null,
		labels: ["oturum"],
		team: { id: "1", value: "Kırmızı" } as { id: string; value: string } | null,
		sprint:
			"com.atlassian.greenhopper.service.sprint.Sprint@a1[id=27,rapidViewId=5,state=ACTIVE,name=Kırmızı Sprint 27,goal=]",
		failNextEdit: false,
	};
	const addedComments: Record<string, unknown>[] = [];
	const readJson = async (req: AsyncIterable<unknown>): Promise<unknown> => {
		let body = "";
		for await (const chunk of req) body += String(chunk);
		return body === "" ? null : JSON.parse(body);
	};
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (req.headers.authorization !== `Bearer ${JIRA_TOKEN}`) {
			return json(res, { errorMessages: ["Unauthorized"] }, 401);
		}
		const noContent = () => {
			res.writeHead(204);
			res.end();
		};
		const record = async () => {
			const body = await readJson(req);
			edits.push({ method: req.method ?? "", path: url.pathname, body });
			return body as Record<string, unknown> | null;
		};
		const failing = () => {
			if (!editable.failNextEdit) return false;
			editable.failNextEdit = false;
			json(res, { errorMessages: ["Alan düzenlenemez"] }, 400);
			return true;
		};
		if (url.pathname === "/secure/attachment/501/pastedImage_1.png") {
			res.writeHead(200, { "Content-Type": "image/png" });
			return res.end(Buffer.from(PNG, "base64"));
		}
		if (url.pathname === "/rest/api/2/issue/FT-30468") {
			return json(
				res,
				issue("FT-30468", "TK PNRı Olmayan Bilette PNR Alanının Dolu Gelmesi", "Open", "new"),
			);
		}
		if (url.pathname === "/rest/api/2/user/assignable/search") {
			return json(res, [
				{ name: "ayse", displayName: "Ayşe Balcı" },
				{ name: "yusuf", displayName: "YUSUF KOCAK - Quickres Gelistirme Takimi" },
			]);
		}
		if (url.pathname === "/rest/api/2/issue/QR-1/assignee" && req.method === "PUT") {
			if (failing()) return;
			const body = await record();
			editable.assignee =
				body?.name === "yusuf"
					? { name: "yusuf", displayName: "YUSUF KOCAK - Quickres Gelistirme Takimi" }
					: null;
			return noContent();
		}
		if (url.pathname === "/rest/agile/1.0/board/5/sprint") {
			return json(res, {
				values: [
					{ id: 27, name: "Kırmızı Sprint 27", state: "active" },
					{ id: 28, name: "Kırmızı Sprint 28", state: "future" },
				],
			});
		}
		if (
			(url.pathname.startsWith("/rest/agile/1.0/sprint/") ||
				url.pathname === "/rest/agile/1.0/backlog/issue") &&
			req.method === "POST"
		) {
			if (failing()) return;
			await record();
			return noContent();
		}
		if (url.pathname === "/rest/api/2/issue/QR-1/editmeta") {
			return json(res, {
				fields: {
					customfield_11: {
						allowedValues: [
							{ id: "1", value: "Kırmızı" },
							{ id: "2", value: "Mavi" },
						],
					},
				},
			});
		}
		if (url.pathname === "/rest/api/2/issue/QR-1" && req.method === "PUT") {
			if (failing()) return;
			const body = await record();
			const update = (body?.update ?? {}) as { labels?: { add?: string; remove?: string }[] };
			for (const step of update.labels ?? []) {
				if (step.add !== undefined) editable.labels.push(step.add);
				if (step.remove !== undefined) {
					editable.labels = editable.labels.filter((label) => label !== step.remove);
				}
			}
			return noContent();
		}
		if (url.pathname === "/rest/api/1.0/labels/suggest") {
			return json(res, { suggestions: [{ label: "AnalizTamam" }, { label: "Trophy" }] });
		}
		if (url.pathname === "/rest/api/2/user/picker") {
			return json(res, {
				users: [
					{
						name: "isil.sen",
						displayName:
							"ISIL SEN (Gelir Yonetimi Bsk. (Dogrudan Dagitim Kanallari Md.) - Bassorumlu)",
					},
				],
			});
		}
		if (url.pathname === "/rest/api/2/issue/QR-1/comment" && req.method === "POST") {
			const body = (await record()) as { body: string };
			const comment = {
				id: String(100 + addedComments.length),
				author: { name: "ayse", displayName: "Ayşe Balcı" },
				created: "2026-11-13T09:30:00.000+0300",
				body: body.body,
			};
			addedComments.push(comment);
			return json(res, { ...comment, renderedBody: `<p>${body.body}</p>` }, 201);
		}
		if (url.pathname === "/rest/api/2/myself") {
			return json(res, { displayName: "Ayşe Balcı", key: "JIRAUSER1", name: "ayse" });
		}
		// Tempo Timesheets: its work attributes, its accounts, and a work log sent to it.
		// As Tempo answers on Jira Server: an account whose billing keys are at its `externalUrl`
		// for the issue, and a dynamic drop-down served by ScriptRunner on the same Jira.
		if (url.pathname === "/rest/tempo-core/1/work-attribute") {
			return json(res, [
				{
					id: 21,
					key: "_Sirket_",
					name: "Faturalandırılacak Şirket",
					externalUrl: "/rest/tempo-rest/1.0/accounts/json/billingKeyList/{IssueKey}",
					type: { name: "Account", value: "ACCOUNT", systemType: false },
					required: false,
					sequence: 0,
				},
				{
					id: 102,
					key: "_Servis_",
					name: "Servis",
					externalUrl: `${base.site}/rest/scriptrunner/latest/custom/serviceList`,
					type: { name: "Dynamic Dropdown", value: "DYNAMIC_DROPDOWN", systemType: false },
					required: true,
					sequence: 2,
				},
			]);
		}
		if (url.pathname === "/rest/tempo-rest/1.0/accounts/json/billingKeyList/QR-1") {
			return json(res, { values: [{ key: "TKAO", value: "TKAO - Türk Hava Yolları A.O." }] });
		}
		if (url.pathname === "/rest/scriptrunner/latest/custom/serviceList") {
			// Jira's rate limit turns the first ask away; Kalem waits and asks again.
			if (serviceListAsked++ === 0) {
				res.writeHead(429, { "Retry-After": "0", "Content-Type": "application/json" });
				return res.end(JSON.stringify({ message: "Rate limit exceeded" }));
			}
			// ScriptRunner answers Tempo as JSONP, with the service's number as its key.
			res.writeHead(200, { "Content-Type": "application/javascript" });
			return res.end(
				`${url.searchParams.get("callback")}(${JSON.stringify({
					values: [
						{ key: "3350", value: "Sigorta Servisi" },
						{ key: "3351", value: "Satış Kanalı (QuickRes) Uygulaması" },
						{ key: "3352", value: "Ana Sayfa Servisi" },
					],
				})});`,
			);
		}
		if (url.pathname === "/rest/tempo-timesheets/4/worklogs/search" && req.method === "POST") {
			return json(res, []);
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
		if (url.pathname === "/rest/api/2/issue/QR-1/transitions") {
			if (req.method === "POST") {
				let body = "";
				for await (const chunk of req) body += chunk;
				transitions.push(JSON.parse(body));
				status = { name: "Test", category: "indeterminate" };
				res.writeHead(204);
				return res.end();
			}
			return json(res, {
				transitions: [
					{
						id: "21",
						name: "Start Test",
						to: { name: "Test", statusCategory: { key: "indeterminate" } },
					},
					{
						id: "31",
						name: "Resolve",
						to: { name: "Done", statusCategory: { key: "done" } },
						fields: {
							resolution: { required: true, name: "Resolution", allowedValues: [{ name: "Done" }] },
						},
					},
					{
						id: "41",
						name: "Reject",
						to: { name: "Rejected", statusCategory: { key: "done" } },
						fields: { customfield_1: { required: true, name: "Reason" } },
					},
				],
			});
		}
		// The Development panel, as Bitbucket Server fills it.
		if (url.pathname === "/rest/dev-status/1.0/issue/summary") {
			if (url.searchParams.get("issueId") !== "10001") return json(res, { summary: {} });
			return json(res, {
				summary: {
					branch: {
						overall: { count: 2, lastUpdated: "2026-11-03T10:00:00.000+0300" },
						byInstanceType: { stash: { count: 2 } },
					},
					repository: {
						overall: { count: 8, lastUpdated: "2026-11-07T10:00:00.000+0300" },
						byInstanceType: { stash: { count: 8 } },
					},
					pullrequest: {
						overall: { count: 1, lastUpdated: "2026-11-07T11:00:00.000+0300", state: "MERGED" },
						byInstanceType: { stash: { count: 1 } },
					},
				},
			});
		}
		if (url.pathname === "/rest/dev-status/1.0/issue/detail") {
			return json(res, {
				detail: [
					{
						pullRequests: [
							{
								name: "QR-1 Oturum süresi",
								url: "https://git.example.com/pr/9",
								status: "MERGED",
								author: { name: "Ayşe Balcı" },
								source: { branch: "feature/QR-1", repository: { name: "web" } },
								destination: { branch: "develop" },
								lastUpdate: "2026-11-07T11:00:00.000+0300",
							},
						],
					},
				],
			});
		}
		if (url.pathname === "/rest/api/2/issue/QR-1") {
			const base = issue("QR-1", "Giriş zaman aşımı", status.name, status.category);
			return json(res, {
				id: "10001",
				...base,
				names: {
					customfield_9: "Takım",
					customfield_18: "Time In Open",
					customfield_19: "Time In Test",
					customfield_20: "Analist",
					customfield_10: "Sprint",
					customfield_11: "Takım",
					customfield_12: "Team",
					customfield_13: "Story Origin",
					customfield_14: "Parent Link",
					customfield_15: "Branch",
				},
				schema: {
					customfield_10: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
					customfield_11: {
						type: "option",
						custom: "com.atlassian.jira.plugin.system.customfieldtypes:select",
					},
					customfield_13: {
						type: "option",
						custom: "com.atlassian.jira.plugin.system.customfieldtypes:select",
					},
					customfield_20: { type: "user" },
				},
				editmeta: {
					fields: {
						customfield_11: {
							allowedValues: [
								{ id: "1", value: "Kırmızı" },
								{ id: "2", value: "Mavi" },
							],
						},
						customfield_13: {
							allowedValues: [
								{ id: "7", value: "Business Requirement" },
								{ id: "8", value: "Technical Debt" },
							],
						},
					},
				},
				changelog: {
					histories: [
						{
							created: "2026-10-01T09:00:00.000+0300",
							items: [{ field: "status", fromString: "Open", toString: "In Analysis" }],
						},
						{
							created: "2026-10-08T09:00:00.000+0300",
							items: [{ field: "status", fromString: "In Analysis", toString: status.name }],
						},
					],
				},
				fields: {
					...base.fields,
					priority: { name: "High" },
					timetracking: {
						timeSpentSeconds:
							12 * 3600 + worklogs.reduce((all, log) => all + Number(log.timeSpentSeconds), 0),
						remainingEstimateSeconds: 8 * 3600,
					},
					reporter: { displayName: "Mehmet" },
					created: "2026-09-28T09:00:00.000+0300",
					assignee: editable.assignee,
					customfield_9: null,
					customfield_10: [editable.sprint],
					customfield_11: editable.team,
					customfield_12: { value: "Kırmızı" },
					customfield_13: { id: "7", value: "Business Requirement" },
					customfield_14: "FT-30468",
					customfield_15: "None",
					customfield_18:
						"TimeInStatus(running=false, updateTime=1794560819397, timeInStatus=469176000)",
					customfield_19: "TimeInStatus(running=false, updateTime=1794560819397, timeInStatus=0)",
					customfield_20: { name: "kubra", displayName: "KUBRA DANIS - Quickres Analist Takimi" },
					attachment: [
						{
							id: 501,
							filename: "pastedImage_1.png",
							mimeType: "image/png",
							content: `${jiraSite()}/secure/attachment/501/pastedImage_1.png`,
						},
					],
					// An HTML editor plug-in keeps the description as HTML, lines joined by backslashes.
					description:
						'<div class="jePanel_warning" style="border:1px solid #d4a19e">\\\n<p dir="auto"><b>HATA</b>: Oturum <u>30 sn</u> sonra düşüyor.</p>\\\n</div><ul>\\\n<li>Chrome</li><li>Edge</li></ul>',
					labels: [...editable.labels],
					subtasks: [issue("QR-2", "Süreyi ayarla", "Done", "done")],
					comment: {
						total: 4 + addedComments.length,
						comments: [
							{
								author: { name: "gulden", displayName: "GULDEN BAYKARA - Quickres Analist Takimi" },
								created: "2026-10-07T11:56:00.000+0300",
								body: `<p>Merhaba <a href="${jiraSite()}/secure/ViewProfile.jspa?name=isil.sen" class="user-hover" rel="isil.sen">ISIL SEN (Gelir Yonetimi Bsk. (Dogrudan Dagitim Kanallari Md.) - Bassorumlu)</a> ,</p><p>&nbsp;</p><p>Analizi tamamladım. Kontrol edebilir misiniz?</p><p><br></p><p>Teşekkürler.</p><p>&nbsp;</p><p>&nbsp;</p>`,
							},
							{
								author: {
									name: "isil.sen",
									displayName:
										"ISIL SEN (Gelir Yonetimi Bsk. (Dogrudan Dagitim Kanallari Md.) - Bassorumlu)",
								},
								created: "2026-10-08T07:47:00.000+0300",
								body: "<p>Uygundur</p><p>&nbsp;</p>",
							},
							{
								author: { name: "can", displayName: "Can" },
								created: "2026-11-09T17:45:00.000+0300",
								body: "Bende de oluyor.",
							},
							{
								author: { name: "yusuf", displayName: "YUSUF KOCAK - Quickres Gelistirme Takimi" },
								created: "2026-11-09T17:45:00.000+0300",
								body: "Geliştirme yaptım.\n\n!pastedImage_1.png!\n\n!kayip.png!\n\n[TK PNRı Olmayan Bilette - Doğrudan Satış - Confluence|https://wiki.example.com/pages/viewpage.action?pageId=77]",
							},
							...addedComments,
						],
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
	base.site = site;
	return {
		site,
		searches,
		worklogs,
		transitions,
		confluence,
		edits,
		editable,
		close: () => new Promise<void>((done) => server.close(() => done())),
	};
}

/**
 * Confluence Server with one page naming a Jira issue. Its application
 * links need an administrator; the Jira macro's servers do not.
 */
export async function fakeJiraConfluence(jiraSite: string) {
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
