/**
 * The assistant's Jira look-ups: what it is told about them, the requests
 * a CLI writes in a `kalem-jira` block (an API and Claude Code call them as
 * tools instead), and how they are read. Pure: the main process asks Jira.
 */
import type { LookupWay } from "./confluence-tool.js";
import { MAX_REQUESTS, MAX_ROUNDS } from "./confluence-tool.js";
import { issueKey, issueKeyFromUrl, searchJql } from "./jira.js";

/** The code fence language of a CLI's Jira requests. */
export const JIRA_FENCE = "kalem-jira";

export type JiraRequest =
	| { readonly kind: "issue"; readonly key: string }
	| { readonly kind: "search"; readonly jql: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** One request as a tool call's input or in a block; `null` when it is none. */
export function jiraRequestOf(raw: unknown, kind?: "issue" | "search"): JiraRequest | null {
	if (!isRecord(raw)) return null;
	const named =
		typeof raw.issue === "string" ? raw.issue : typeof raw.key === "string" ? raw.key : "";
	const key = issueKey(named) ?? issueKeyFromUrl(named);
	if ((kind === undefined || kind === "issue") && key !== null) return { kind: "issue", key };
	if (kind === "issue") return null;
	const jql = typeof raw.jql === "string" ? raw.jql.trim() : "";
	const words =
		typeof raw.search === "string" ? raw.search : typeof raw.query === "string" ? raw.query : "";
	if (jql !== "") return { kind: "search", jql: jql.slice(0, 2000) };
	if (words.trim() !== "") return { kind: "search", jql: searchJql(words.slice(0, 500)) };
	return null;
}

export const fenceBlock = (fence: string): RegExp =>
	new RegExp(
		`^ {0,3}(\`{3,}|~{3,})[ \\t]*${fence}[ \\t]*\\n([\\s\\S]*?)\\n {0,3}\\1[\`~]*[ \\t]*$`,
		"gm",
	);

/** The requests in a reply's `kalem-jira` blocks: a JSON object, or an array of them. */
export function jiraRequests(reply: string): JiraRequest[] {
	const requests: JiraRequest[] = [];
	for (const match of reply.matchAll(fenceBlock(JIRA_FENCE))) {
		let data: unknown;
		try {
			data = JSON.parse(match[2] ?? "");
		} catch {
			continue;
		}
		for (const item of Array.isArray(data) ? data : [data]) {
			const request = jiraRequestOf(item);
			if (request !== null) requests.push(request);
		}
	}
	return requests.slice(0, MAX_REQUESTS);
}

/** What the model is told about Jira; `site` is `null` when the app is not connected to one. */
export function jiraInstructions(site: string | null, way: LookupWay): string {
	if (site === null) {
		return `## Jira
The user is not connected to Jira. If they ask about a Jira issue (a key like ABC-123), tell them to connect first ("File" → "Jira…"), then ask again.`;
	}
	const how =
		way === "mcp"
			? "Look issues up with Kalem's tools `mcp__kalem__jira_get_issue` (one issue by its key: fields, description, sub-tasks, links, comments) and `mcp__kalem__jira_search` (JQL, or words to find). They use the app's own connection. Do not use WebFetch, curl, Bash or any other tool for Jira: it is behind the user's sign-in, and only these tools reach it."
			: way === "block"
				? `To look something up, reply with ONLY a \`${JIRA_FENCE}\` code block holding a JSON array of requests, and nothing else:

\`\`\`${JIRA_FENCE}
[
  { "issue": "ABC-123" },
  { "jql": "project = ABC AND status != Done ORDER BY priority DESC" },
  { "search": "login timeout" }
]
\`\`\`

Kalem runs them and sends you what they found in <jira-results>; then ask again, or answer. At most ${MAX_REQUESTS} requests a round and ${MAX_ROUNDS} rounds. "issue" reads one issue by its key; "jql" runs a JQL search; "search" looks for words in issues' text. Do not use your own tools (WebFetch, Bash…) for Jira: they cannot reach it.`
				: "Look issues up with the tools `jira_get_issue` (one issue by its key: fields, description, sub-tasks, links, comments) and `jira_search` (JQL, or words to find).";
	return `## Jira
The user is connected to Jira at ${site}. Confluence pages and documents name Jira issues by their keys (ABC-123) or by addresses like ${site}/browse/ABC-123. When the user asks about an issue, a sprint, who works on what, or what a page's tasks are, read the issues yourself instead of saying you cannot.

${how}

Answer from what you read, and link each issue you mention as [ABC-123](${site}/browse/ABC-123). Read only; you cannot change issues.`;
}
