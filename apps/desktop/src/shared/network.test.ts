import { describe, expect, it } from "vitest";
import type { NetworkEntry, NetworkSummary } from "./network.js";
import {
	curlCommand,
	formatBytes,
	formatDuration,
	harLog,
	isSecretHeader,
	isTextType,
	MASK,
	maskBody,
	maskHeader,
	maskUrl,
	matchesFilter,
	prettyBody,
	shortName,
} from "./network.js";

const summary: NetworkSummary = {
	id: 1,
	source: "jira",
	method: "GET",
	url: "https://jira.example.com/rest/api/2/issue/KAL-12?expand=names",
	status: 404,
	statusText: "Not Found",
	state: "done",
	started: Date.UTC(2026, 10, 15, 12, 0, 0),
	waiting: 80,
	duration: 120,
	size: 42,
	mimeType: "application/json;charset=UTF-8",
};

const entry: NetworkEntry = {
	...summary,
	method: "POST",
	requestHeaders: [
		{ name: "authorization", value: `Bearer ${MASK}` },
		{ name: "content-type", value: "application/json" },
	],
	responseHeaders: [{ name: "content-type", value: "application/json" }],
	requestBody: { text: `{"body":"it's done"}`, size: 20, truncated: false },
	responseBody: { text: `{"errorMessages":["Issue does not exist"]}`, size: 42, truncated: false },
};

describe("masking", () => {
	it("knows credential headers, and lets harmless look-alikes through", () => {
		for (const name of [
			"Authorization",
			"proxy-authorization",
			"Cookie",
			"set-cookie",
			"x-api-key",
			"X-Goog-Api-Key",
			"x-my-token",
			"mcp-session-id",
		]) {
			expect(isSecretHeader(name), name).toBe(true);
		}
		for (const name of ["content-type", "accept", "x-atlassian-token", "www-authenticate"]) {
			expect(isSecretHeader(name), name).toBe(false);
		}
	});

	it("keeps an authorization scheme and masks the credential", () => {
		expect(maskHeader({ name: "authorization", value: "Basic dXNlcjpwYXNz" })).toEqual({
			name: "authorization",
			value: `Basic ${MASK}`,
		});
		expect(maskHeader({ name: "Authorization", value: "token ghu_abc" }).value).toBe(
			`token ${MASK}`,
		);
		expect(maskHeader({ name: "x-api-key", value: "sk-ant-secret" }).value).toBe(MASK);
		expect(maskHeader({ name: "accept", value: "application/json" }).value).toBe(
			"application/json",
		);
	});

	it("masks credentials in an address and nothing else", () => {
		expect(maskUrl("https://api.example.com/v1/models?key=AIza123&alt=json")).toBe(
			`https://api.example.com/v1/models?key=${MASK}&alt=json`,
		);
		expect(maskUrl("https://x.test/a?access_token=1&api_key=2&page=3#top")).toBe(
			`https://x.test/a?access_token=${MASK}&api_key=${MASK}&page=3#top`,
		);
		expect(maskUrl("https://user:pass@x.test/a")).toBe(`https://${MASK}@x.test/a`);
		const plain = "https://jira.example.com/rest/api/2/search?jql=project%20%3D%20KAL&spaceKey=A";
		expect(maskUrl(plain)).toBe(plain);
	});

	it("masks credential fields of JSON bodies, at any depth, but not Jira's keys", () => {
		const masked = JSON.parse(
			maskBody(
				JSON.stringify({
					token: "tid=1;exp=2",
					expires_at: 2,
					nested: [{ refresh_token: "r", password: "p", apiKey: "k" }],
					key: "KAL-12",
				}),
				"application/json",
			),
		);
		expect(masked).toEqual({
			token: MASK,
			expires_at: 2,
			nested: [{ refresh_token: MASK, password: MASK, apiKey: MASK }],
			key: "KAL-12",
		});
	});

	it("leaves a body without credentials as it was written", () => {
		const text = '{\n  "fields": { "summary": "A" }\n}';
		expect(maskBody(text, "application/json")).toBe(text);
		expect(maskBody("data: {not json", "text/event-stream")).toBe("data: {not json");
	});

	it("masks credential fields of a form", () => {
		expect(
			maskBody(
				"grant_type=refresh&client_secret=s&refresh_token=t",
				"application/x-www-form-urlencoded",
			),
		).toBe(`grant_type=refresh&client_secret=${MASK}&refresh_token=${MASK}`);
	});
});

describe("formatting", () => {
	it("reads text types", () => {
		expect(isTextType("application/json; charset=utf-8")).toBe(true);
		expect(isTextType("application/vnd.github+json")).toBe(true);
		expect(isTextType("text/event-stream")).toBe(true);
		expect(isTextType("image/png")).toBe(false);
		expect(isTextType("application/octet-stream")).toBe(false);
		expect(isTextType("")).toBe(false);
	});

	it("writes sizes and times", () => {
		expect(formatBytes(null)).toBe("—");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(4200)).toBe("4.2 kB");
		expect(formatBytes(1_300_000)).toBe("1.3 MB");
		expect(formatDuration(null)).toBe("—");
		expect(formatDuration(84.4)).toBe("84 ms");
		expect(formatDuration(1240)).toBe("1.24 s");
	});

	it("names a row by the end of its path", () => {
		expect(shortName(summary.url)).toBe("KAL-12?expand=names");
		expect(shortName("https://api.github.com/")).toBe("api.github.com");
		expect(shortName("https://x.test/wiki/a%20b")).toBe("a b");
	});

	it("indents JSON and leaves other text alone", () => {
		expect(prettyBody('{"a":[1]}', "application/json")).toBe('{\n  "a": [\n    1\n  ]\n}');
		expect(prettyBody("plain", "text/plain")).toBe("plain");
		expect(prettyBody("{broken", "application/json")).toBe("{broken");
	});
});

describe("matchesFilter", () => {
	it("matches every word, and none of the words starting with a dash", () => {
		expect(matchesFilter(summary, "")).toBe(true);
		expect(matchesFilter(summary, "issue 404")).toBe(true);
		expect(matchesFilter(summary, "ISSUE jira")).toBe(true);
		expect(matchesFilter(summary, "issue 500")).toBe(false);
		expect(matchesFilter(summary, "issue -get")).toBe(false);
		expect(matchesFilter(summary, "issue -post")).toBe(true);
	});
});

describe("curlCommand", () => {
	it("writes the request with its headers and body, quoted for a shell", () => {
		expect(curlCommand(entry)).toBe(
			[
				"curl 'https://jira.example.com/rest/api/2/issue/KAL-12?expand=names'",
				"-X POST",
				`-H 'authorization: Bearer ${MASK}'`,
				"-H 'content-type: application/json'",
				`--data-raw '{"body":"it'\\''s done"}'`,
			].join(" \\\n  "),
		);
	});
});

describe("harLog", () => {
	it("writes HAR 1.2 that browsers open", () => {
		const har = harLog([entry], { name: "Kalem", version: "3.17.0" }) as {
			log: { version: string; creator: unknown; entries: Record<string, unknown>[] };
		};
		expect(har.log.version).toBe("1.2");
		expect(har.log.creator).toEqual({ name: "Kalem", version: "3.17.0" });
		const [first] = har.log.entries;
		expect(first?.startedDateTime).toBe("2026-11-15T12:00:00.000Z");
		expect(first?.request).toMatchObject({
			method: "POST",
			queryString: [{ name: "expand", value: "names" }],
			postData: { mimeType: "application/json", text: `{"body":"it's done"}` },
		});
		expect(first?.response).toMatchObject({
			status: 404,
			content: { size: 42, text: `{"errorMessages":["Issue does not exist"]}` },
		});
		expect(first?.timings).toEqual({ send: 0, wait: 80, receive: 40 });
	});
});
