import { join } from "node:path";
import { app, ipcMain, net } from "electron";
import { CHANNEL } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import type { JiraAccount, JiraIssue } from "../shared/jira.js";
import { searchJql } from "../shared/jira.js";
import type { WorklogContext, WorklogEntry } from "../shared/jira-worklog.js";
import type { ConfluenceCredentials } from "./confluence-client.js";
import { isCloudHost, pageReference } from "./confluence-client.js";
import { confluenceClient } from "./confluence-ipc.js";
import type { ConfluenceStore } from "./confluence-store.js";
import { JiraClient } from "./jira-client.js";
import { WorklogDefaultsStore } from "./jira-worklog-store.js";

export interface JiraIpcContext {
	/** The Jira login, stored like Confluence's (the token encrypted). */
	readonly jira: ConfluenceStore;
	readonly confluence: ConfluenceStore;
	strings(): Strings;
}

export function jiraClient(credentials: ConfluenceCredentials): JiraClient {
	return new JiraClient(credentials, (url, init) => net.fetch(url, init));
}

/**
 * The Jira the app reaches: its own login, or else Confluence Cloud's,
 * since an Atlassian Cloud site's Jira takes the same e-mail and API token.
 * `shared` says which.
 */
export async function jiraConnection(
	ctx: Pick<JiraIpcContext, "jira" | "confluence">,
): Promise<{ client: JiraClient; username: string; shared: boolean } | null> {
	const own = await ctx.jira.get();
	if (own !== null) return { client: jiraClient(own), username: own.username, shared: false };
	const confluence = await ctx.confluence.get();
	if (confluence === null) return null;
	const url = new URL(confluenceClient(confluence).site);
	if (!isCloudHost(url.hostname) || confluence.username === "") return null;
	return {
		client: jiraClient({ ...confluence, site: url.origin }),
		username: confluence.username,
		shared: true,
	};
}

const account = (connection: {
	client: JiraClient;
	username: string;
	shared: boolean;
}): JiraAccount => ({
	site: connection.client.site,
	username: connection.username,
	cloud: connection.client.cloud,
	shared: connection.shared,
});

const text = (value: unknown, name: string): string => {
	if (typeof value !== "string") throw new Error(`Invalid ${name}`);
	return value;
};

export function registerJiraIpc(ctx: JiraIpcContext): {
	/** The connected Jira, asked for each time: the connection can change. */
	jira(): Promise<JiraClient | null>;
} {
	const jira = async (): Promise<JiraClient | null> =>
		(await jiraConnection(ctx).catch(() => null))?.client ?? null;
	const connected = async (): Promise<JiraClient> => {
		const client = await jira();
		if (client === null) throw new Error(ctx.strings().jiraNotConnected);
		return client;
	};

	ipcMain.handle(CHANNEL.jiraAccount, async () => {
		const connection = await jiraConnection(ctx);
		return connection === null ? null : account(connection);
	});

	ipcMain.handle(CHANNEL.jiraConnect, async (_event, raw: unknown) => {
		const login = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const credentials = {
			site: text(login.site, "site").trim(),
			username: text(login.username, "user name").trim(),
			token: text(login.token, "token").trim(),
		};
		if (credentials.site === "" || credentials.token === "") throw new Error("Missing login");
		const client = jiraClient(credentials);
		await client.verify();
		const username = client.bearer ? "" : credentials.username;
		await ctx.jira.set({ ...credentials, username, site: client.site });
		return account({ client, username, shared: false });
	});

	ipcMain.handle(CHANNEL.jiraDisconnect, () => ctx.jira.clear());

	ipcMain.handle(CHANNEL.jiraSuggestedSite, async () => {
		const credentials = await ctx.confluence.get();
		if (credentials === null) return null;
		return confluenceClient(credentials)
			.jiraBase("")
			.catch(() => null);
	});

	ipcMain.handle(CHANNEL.jiraIssue, async (_event, key: unknown): Promise<JiraIssue> => {
		const issue = await (await connected()).issue(text(key, "issue key"));
		// A Confluence page on the connected site opens in Kalem: its id is found in its address.
		const confluence = await ctx.confluence.get().catch(() => null);
		if (confluence === null || issue.remoteLinks.length === 0) return issue;
		const client = confluenceClient(confluence);
		const host = new URL(client.site).hostname;
		const remoteLinks = await Promise.all(
			issue.remoteLinks.map(async (link) => {
				const reference = pageReference(link.url);
				if (reference === null || reference.host !== host) return link;
				if (reference.kind === "id") return { ...link, pageId: reference.id };
				// A `/display/SPACE/Title` address: the page is looked up by its title.
				const [found] = await client.search(link.url, null).catch(() => []);
				return found === undefined ? link : { ...link, pageId: found.id };
			}),
		);
		return { ...issue, remoteLinks };
	});

	const worklogDefaults = new WorklogDefaultsStore(
		join(app.getPath("userData"), "jira-worklog.json"),
	);

	ipcMain.handle(
		CHANNEL.jiraWorklogContext,
		async (_event, key: unknown): Promise<WorklogContext> => {
			const client = await connected();
			return client.worklogContext(text(key, "issue key"), await worklogDefaults.get(client.site));
		},
	);

	ipcMain.handle(CHANNEL.jiraLogWork, async (_event, key: unknown, raw: unknown) => {
		const client = await connected();
		const given = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const attributes: Record<string, string> = {};
		for (const [name, value] of Object.entries(
			typeof given.attributes === "object" && given.attributes !== null ? given.attributes : {},
		)) {
			if (typeof value === "string") attributes[name] = value;
		}
		const remaining = given.remainingSeconds;
		const entry: WorklogEntry = {
			date: text(given.date, "date"),
			seconds: typeof given.seconds === "number" ? Math.round(given.seconds) : 0,
			remainingSeconds:
				typeof remaining === "number" && remaining >= 0 ? Math.round(remaining) : null,
			comment: typeof given.comment === "string" ? given.comment.slice(0, 5000) : "",
			attributes,
			remember: given.remember === true,
		};
		const offset = typeof given.offsetMinutes === "number" ? given.offsetMinutes : 0;
		await client.logWork(text(key, "issue key"), entry, offset);
		if (entry.remember) await worklogDefaults.set(client.site, attributes);
	});

	ipcMain.handle(CHANNEL.jiraSearch, async (_event, query: unknown, next: unknown) =>
		(await connected()).search(
			searchJql(text(query, "search").slice(0, 2000)),
			typeof next === "string" && next.length < 4000 ? next : null,
		),
	);

	return { jira };
}
