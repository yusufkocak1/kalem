/**
 * The assistant's Jira look-ups, run on the connected Jira: an issue by its
 * key and JQL searches. An API model and Claude Code (through Kalem's MCP
 * server) call them as tools; Copilot writes them in a `kalem-jira` block.
 * They only read.
 */
import type { JiraIssue } from "../shared/jira.js";
import { issueText, searchText } from "../shared/jira.js";
import type { JiraRequest } from "../shared/jira-tool.js";
import { jiraRequestOf } from "../shared/jira-tool.js";
import type { JiraClient } from "./jira-client.js";
import type { ToolDefinition, ToolStep } from "./workspace-tools.js";

export const JIRA_TOOLS: readonly ToolDefinition[] = [
	{
		name: "jira_get_issue",
		description:
			"Reads one Jira issue by its key (ABC-123) or address: type, status, assignee, dates, description, sub-tasks, linked issues and the latest comments.",
		parameters: {
			type: "object",
			properties: {
				key: { type: "string", description: "The issue key, e.g. ABC-123." },
			},
			required: ["key"],
		},
	},
	{
		name: "jira_search",
		description:
			"Searches Jira. Give `jql` (e.g. `project = ABC AND status != Done ORDER BY updated DESC`, `assignee = currentUser() AND resolution = Unresolved`, `sprint in openSprints()`), or `query`: words to find in issues' text. Returns each issue's key, summary, type, status, assignee and address.",
		parameters: {
			type: "object",
			properties: {
				jql: { type: "string", description: "A JQL query." },
				query: { type: "string", description: "Words to find, when there is no JQL." },
			},
			required: [],
		},
	},
];

export const isJiraTool = (name: string): boolean => JIRA_TOOLS.some((tool) => tool.name === name);

/** The look-ups for one answer. */
export class JiraLookups {
	readonly #client: JiraClient;
	/** Issues read for this answer, so reading one again costs nothing. */
	readonly #issues = new Map<string, JiraIssue>();

	constructor(client: JiraClient) {
		this.#client = client;
	}

	get site(): string {
		return this.#client.site;
	}

	/** Runs one request; what it found, or why it failed, as text for the model. */
	async run(request: JiraRequest, step: (step: ToolStep) => void): Promise<string> {
		try {
			if (request.kind === "search") {
				step({ tool: "jira_search", detail: request.jql });
				return searchText(await this.#client.search(request.jql), this.#client.site);
			}
			let issue = this.#issues.get(request.key);
			if (issue === undefined) {
				issue = await this.#client.issue(request.key);
				this.#issues.set(request.key, issue);
			}
			step({ tool: "jira_get_issue", detail: `${issue.key} ${issue.summary}` });
			return issueText(issue);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const what =
				request.kind === "search" ? `Jira search \`${request.jql}\`` : `Reading ${request.key}`;
			return `${what} failed: ${message}`;
		}
	}

	/** A tool call of a model. */
	runTool(name: string, input: unknown, step: (step: ToolStep) => void): Promise<string> {
		const request = jiraRequestOf(input, name === "jira_get_issue" ? "issue" : "search");
		if (request === null)
			return Promise.resolve(
				`The ${name} call needs ${name === "jira_get_issue" ? "an issue key" : "jql or a query"}.`,
			);
		return this.run(request, step);
	}

	/** A round of a CLI's requests, as the next question. */
	async runAll(requests: readonly JiraRequest[], step: (step: ToolStep) => void): Promise<string> {
		const results: string[] = [];
		for (const request of requests) results.push(await this.run(request, step));
		return `<jira-results>\n${results.join("\n\n---\n\n")}\n</jira-results>\n\nLook up more with another \`kalem-jira\` block if you need to, or answer now from what you found (link the issues as [KEY](address)).`;
	}
}
