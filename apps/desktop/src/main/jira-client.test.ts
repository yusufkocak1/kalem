import { describe, expect, it } from "vitest";
import type { Fetch } from "./confluence-client.js";
import { JiraClient, JiraError } from "./jira-client.js";

/** Answers requests by URL substring, in order of the routes. */
function fakeFetch(routes: [string, unknown, number?][]): {
	fetch: Fetch;
	calls: string[];
	auth: string[];
} {
	const calls: string[] = [];
	const auth: string[] = [];
	const fetch: Fetch = async (url, init) => {
		calls.push(url);
		auth.push(String((init?.headers as Record<string, string> | undefined)?.Authorization));
		const route = routes.find(([part]) => url.includes(part));
		if (route === undefined) return new Response("{}", { status: 404 });
		const [, body, status = 200] = route;
		return new Response(JSON.stringify(body), { status });
	};
	return { fetch, calls, auth };
}

const issue = (key: string) => ({
	key,
	fields: { summary: `Kayıt ${key}`, status: { name: "Open", statusCategory: { key: "new" } } },
});

describe("JiraClient", () => {
	it("reads an issue on Server with a personal access token", async () => {
		const server = fakeFetch([["/rest/api/2/issue/DEV-7?fields=", issue("DEV-7")]]);
		const client = new JiraClient(
			{ site: "https://jira.example.com/browse/DEV-1", username: "", token: "pat" },
			server.fetch,
		);
		expect(client.site).toBe("https://jira.example.com");
		const found = await client.issue("dev-7");
		expect(found).toMatchObject({
			key: "DEV-7",
			summary: "Kayıt DEV-7",
			url: "https://jira.example.com/browse/DEV-7",
		});
		expect(server.auth[0]).toBe("Bearer pat");
		expect(server.calls[0]).toContain(
			"fields=*all&expand=renderedFields,names,schema,changelog,editmeta",
		);
		await expect(client.issue("../../admin")).rejects.toThrow("Invalid issue key");
	});

	it("pages a Server search by its start", async () => {
		const server = fakeFetch([
			["startAt=0", { issues: [issue("DEV-1"), issue("DEV-2")], total: 3, startAt: 0 }],
			["startAt=2", { issues: [issue("DEV-3")], total: 3, startAt: 2 }],
		]);
		const client = new JiraClient(
			{ site: "https://jira.example.com", username: "", token: "t" },
			server.fetch,
		);
		const first = await client.search("project = DEV");
		expect(first).toMatchObject({ total: 3, next: "2" });
		expect(first.issues.map((row) => row.key)).toEqual(["DEV-1", "DEV-2"]);
		expect(server.calls[0]).toContain("/rest/api/2/search?");
		const second = await client.search("project = DEV", first.next);
		expect(second.next).toBeNull();
		await expect(client.search("x", "-1")).rejects.toThrow("Invalid search cursor");
	});

	it("searches Cloud with /search/jql and its page tokens", async () => {
		const cloud = fakeFetch([
			["nextPageToken=abc", { issues: [issue("A-2")], isLast: true }],
			["/rest/api/2/search/jql?", { issues: [issue("A-1")], nextPageToken: "abc" }],
		]);
		const client = new JiraClient(
			{ site: "https://acme.atlassian.net/wiki", username: "a@b.c", token: "t" },
			cloud.fetch,
		);
		expect(client.site).toBe("https://acme.atlassian.net");
		expect(cloud.auth).toEqual([]);
		const first = await client.search("project = A");
		expect(first).toMatchObject({ total: null, next: "abc" });
		const second = await client.search("project = A", "abc");
		expect(second).toMatchObject({ next: null, issues: [{ key: "A-2" }] });
		expect(cloud.auth[0]).toBe(`Basic ${Buffer.from("a@b.c:t").toString("base64")}`);
	});

	it("tries a Server token sent with a user name again as a bearer token", async () => {
		let calls = 0;
		const fetch: Fetch = async (_url, init) => {
			calls++;
			const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization);
			if (auth !== "Bearer pat")
				return new Response(JSON.stringify({ errorMessages: ["No"] }), { status: 401 });
			return new Response(JSON.stringify({ displayName: "Ayşe" }));
		};
		const client = new JiraClient(
			{ site: "https://jira.example.com", username: "ayse", token: "pat" },
			fetch,
		);
		expect(await client.verify()).toBe("Ayşe");
		expect(client.bearer).toBe(true);
		expect(calls).toBe(2);
	});

	it("says what Jira answered when it fails", async () => {
		const server = fakeFetch([
			["/issue/DEV-404", { errorMessages: ["Issue does not exist"] }, 404],
		]);
		const client = new JiraClient(
			{ site: "https://jira.example.com", username: "", token: "t" },
			server.fetch,
		);
		const failure = await client.issue("DEV-404").catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(JiraError);
		expect((failure as JiraError).message).toBe("HTTP 404: Issue does not exist");
	});
});
