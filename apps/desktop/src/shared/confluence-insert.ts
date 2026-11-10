/**
 * Mentions and Jira issues added while writing. In the Markdown they are
 * links like the atoms a page already had (`ATOM_PREFIX` in
 * `confluence-storage.ts`), but their target names what they are instead
 * of a page's XML: `#confluence-keep-mention-a-<account id>` or
 * `#confluence-keep-jira-ABC-12/<server id>/<server name>`. Saving to
 * Confluence writes them as a real mention (`ri:user`) and a real Jira
 * macro. Pure; kept apart from `confluence-storage.ts` so that one can
 * import it.
 */

/** Must start like `ATOM_PREFIX`, so they show and save as kept atoms do. */
export const MENTION_PREFIX = "#confluence-keep-mention-";
export const JIRA_PREFIX = "#confluence-keep-jira-";

/** A user as a search found them: Cloud's account id, Server's user key or name. */
export interface MentionUser {
	readonly name: string;
	readonly accountId?: string;
	readonly key?: string;
	readonly username?: string;
	/** A second line for the picker: the e-mail or the user name. */
	readonly detail?: string;
}

/** The Jira the Confluence site's Jira macro knows. */
export interface JiraServer {
	readonly id: string;
	readonly name: string;
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

const escapeXml = (value: string): string =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const decode = (part: string): string | null => {
	try {
		return decodeURIComponent(part);
	} catch {
		return null;
	}
};

/** The link target of a mention of the user; `null` when the user has no id. */
export function mentionHref(user: MentionUser): string | null {
	if (user.accountId) return `${MENTION_PREFIX}a-${encodeURIComponent(user.accountId)}`;
	if (user.key) return `${MENTION_PREFIX}k-${encodeURIComponent(user.key)}`;
	if (user.username) return `${MENTION_PREFIX}u-${encodeURIComponent(user.username)}`;
	return null;
}

/** The link target of a Jira issue, with the Jira it is on when known. */
export function jiraHref(key: string, server: JiraServer | null = null): string | null {
	const upper = key.trim().toUpperCase(); // kalem-locale-ok: issue keys are ASCII
	if (!ISSUE_KEY.test(upper)) return null;
	if (server === null || server.id === "") return `${JIRA_PREFIX}${upper}`;
	return `${JIRA_PREFIX}${upper}/${encodeURIComponent(server.id)}/${encodeURIComponent(server.name)}`;
}

/** Whether the link is a mention or a Jira issue added while writing. */
export const isInsertedAtom = (href: string): boolean =>
	href.startsWith(MENTION_PREFIX) || href.startsWith(JIRA_PREFIX);

/**
 * The Confluence XML of a mention or a Jira issue added while writing;
 * `null` for any other link, or one whose target is broken.
 */
export function insertedAtomXml(href: string): string | null {
	if (href.startsWith(MENTION_PREFIX)) {
		const rest = href.slice(MENTION_PREFIX.length);
		const attribute = { a: "ri:account-id", k: "ri:userkey", u: "ri:username" }[rest.slice(0, 1)];
		const id = rest.charAt(1) === "-" ? decode(rest.slice(2)) : null;
		if (attribute === undefined || id === null || id === "") return null;
		return `<ac:link><ri:user ${attribute}="${escapeXml(id)}" /></ac:link>`;
	}
	if (href.startsWith(JIRA_PREFIX)) {
		const [key = "", rawId = "", rawName = ""] = href.slice(JIRA_PREFIX.length).split("/");
		const id = decode(rawId) ?? "";
		const name = decode(rawName) ?? "";
		if (!ISSUE_KEY.test(key)) return null;
		const param = (name: string, value: string): string =>
			value === "" ? "" : `<ac:parameter ac:name="${name}">${escapeXml(value)}</ac:parameter>`;
		return `<ac:structured-macro ac:name="jira" ac:schema-version="1">${param("server", name)}${param("serverId", id)}${param("key", key)}</ac:structured-macro>`;
	}
	return null;
}

const asJson = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The users in a user search's answer. Confluence answers in several
 * shapes (Cloud's `/search/user`, Server's CQL search, the old prototype
 * API), so any object with an id and a name is taken; the same user
 * once.
 */
export function usersOf(data: unknown, limit = 10): MentionUser[] {
	const users: MentionUser[] = [];
	const seen = new Set<string>();
	const visit = (value: unknown): void => {
		if (users.length >= limit) return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (typeof value !== "object" || value === null) return;
		const record = asJson(value);
		const accountId = asString(record.accountId);
		const key = asString(record.userKey) || asString(record.userkey);
		const username = asString(record.username) || asString(record.name);
		const name =
			asString(record.displayName) ||
			asString(record.publicName) ||
			asString(record.fullName) ||
			asString(record.title);
		const isUser =
			name !== "" &&
			(accountId !== "" || key !== "" || (username !== "" && asString(record.type) !== "page"));
		if (isUser && asString(record.accountType) !== "app") {
			const id = accountId || key || username;
			if (!seen.has(id)) {
				seen.add(id);
				const email = asString(record.email);
				const detail = email || (username !== name ? username : "");
				users.push({
					name,
					...(accountId === "" ? {} : { accountId }),
					...(key === "" ? {} : { key }),
					...(username === "" || accountId !== "" ? {} : { username }),
					...(detail === "" ? {} : { detail }),
				});
			}
			return;
		}
		for (const child of Object.values(record)) visit(child);
	};
	visit(data);
	return users;
}

/**
 * The Jira server a new Jira macro names, from the Jira macro's server list
 * (`/rest/jiraanywhere/1.0/servers`): the one on `host` (the Jira Kalem is
 * connected to), else the one marked as the default, else the only one.
 */
export function jiraServerOf(data: unknown, host: string | null): JiraServer | null {
	const servers: { id: string; name: string; url: string; selected: boolean }[] = [];
	for (const item of Array.isArray(data) ? data : []) {
		const record = asJson(item);
		const id = asString(record.id);
		if (id === "") continue;
		servers.push({
			id,
			name: asString(record.name),
			url: asString(record.displayUrl) || asString(record.url) || asString(record.rpcUrl),
			selected: record.selected === true || record.primary === true,
		});
	}
	const hostOf = (url: string): string => {
		try {
			return new URL(url).host;
		} catch {
			return "";
		}
	};
	const found =
		(host === null ? undefined : servers.find((server) => hostOf(server.url) === host)) ??
		servers.find((server) => server.selected) ??
		(servers.length === 1 ? servers[0] : undefined);
	return found === undefined ? null : { id: found.id, name: found.name };
}
