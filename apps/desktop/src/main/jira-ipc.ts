import { ipcMain, net } from "electron";
import { CHANNEL } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import type { JiraAccount } from "../shared/jira.js";
import { searchJql } from "../shared/jira.js";
import type { ConfluenceCredentials } from "./confluence-client.js";
import { isCloudHost } from "./confluence-client.js";
import { confluenceClient } from "./confluence-ipc.js";
import type { ConfluenceStore } from "./confluence-store.js";
import { JiraClient } from "./jira-client.js";

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

	ipcMain.handle(CHANNEL.jiraIssue, async (_event, key: unknown) =>
		(await connected()).issue(text(key, "issue key")),
	);

	ipcMain.handle(CHANNEL.jiraSearch, async (_event, query: unknown, next: unknown) =>
		(await connected()).search(
			searchJql(text(query, "search").slice(0, 2000)),
			typeof next === "string" && next.length < 4000 ? next : null,
		),
	);

	return { jira };
}
