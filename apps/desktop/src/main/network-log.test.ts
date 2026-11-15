import { describe, expect, it, vi } from "vitest";
import type { NetworkEvent } from "../shared/network.js";
import { MASK, MAX_BODY_BYTES, MAX_ENTRIES } from "../shared/network.js";
import { describeRequestBody, NetworkLog } from "./network-log.js";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function server(answer: () => Response): { fetch: Fetch; calls: RequestInit[] } {
	const calls: RequestInit[] = [];
	return {
		calls,
		fetch: async (_url, init) => {
			calls.push(init ?? {});
			return answer();
		},
	};
}

const json = (value: unknown, status = 200): Response =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});

/** The log has heard the last of a request once its row is no longer pending. */
async function settled(log: NetworkLog, id = 1): Promise<void> {
	await vi.waitFor(() => expect(log.entry(id)?.state).not.toBe("pending"));
}

describe("NetworkLog", () => {
	it("hands requests on untouched while debug mode is off", async () => {
		const log = new NetworkLog();
		const listener = vi.fn();
		log.onChange(listener);
		const answer = json({ ok: true });
		const { fetch, calls } = server(() => answer);
		const init = { method: "POST", body: "x" };

		const response = await log.trace("jira", fetch)("https://x.test/a", init);

		expect(response).toBe(answer);
		expect(calls).toEqual([init]);
		expect(log.state().entries).toEqual([]);
		expect(listener).not.toHaveBeenCalled();
		// The body was not read: the caller still can.
		expect(response.bodyUsed).toBe(false);
	});

	it("records a request and its answer with credentials masked", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const { fetch } = server(() => json({ token: "secret-token", name: "Ada" }));

		const response = await log.trace("jira", fetch)("https://x.test/rest/api/2/myself?key=k", {
			method: "post",
			headers: { Authorization: "Basic dXNlcjpwYXNz", "Content-Type": "application/json" },
			body: JSON.stringify({ password: "hunter2", summary: "A" }),
		});
		// The caller reads the answer as it would have without the log.
		expect(await response.json()).toEqual({ token: "secret-token", name: "Ada" });
		await settled(log);

		const entry = log.entry(1);
		expect(entry).toMatchObject({
			source: "jira",
			method: "POST",
			url: `https://x.test/rest/api/2/myself?key=${MASK}`,
			status: 200,
			state: "done",
			mimeType: "application/json",
			size: 37,
		});
		expect(entry?.requestHeaders).toEqual([
			{ name: "authorization", value: `Basic ${MASK}` },
			{ name: "content-type", value: "application/json" },
		]);
		expect(JSON.parse(entry?.requestBody?.text ?? "")).toEqual({ password: MASK, summary: "A" });
		expect(JSON.parse(entry?.responseBody?.text ?? "")).toEqual({ token: MASK, name: "Ada" });
		expect(entry?.waiting).toBeGreaterThanOrEqual(0);
		expect(entry?.duration).toBeGreaterThanOrEqual(entry?.waiting ?? 0);
		expect(JSON.stringify(log.entries())).not.toMatch(/hunter2|secret-token|dXNlcjpwYXNz/);
	});

	it("tells its listeners about each change", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const events: NetworkEvent[] = [];
		log.onChange((event) => events.push(event));

		await log.trace(
			"confluence",
			server(() => json([])).fetch,
		)("https://x.test/wiki/rest/api/space");
		await settled(log);

		const states = events.map((event) => (event.type === "entry" ? event.entry.state : "state"));
		expect(states[0]).toBe("pending");
		expect(states.at(-1)).toBe("done");
		expect(events.every((event) => event.type !== "entry" || event.first === 1)).toBe(true);
	});

	it("does not copy files and pictures, only notes their size", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const image = new Response(new Uint8Array([1, 2, 3]), {
			headers: { "content-type": "image/png", "content-length": "3" },
		});
		const cloned = vi.spyOn(image, "clone");

		await log.trace("jira", server(() => image).fetch)("https://x.test/secure/attachment/1/a.png");

		expect(cloned).not.toHaveBeenCalled();
		expect(log.entry(1)).toMatchObject({
			state: "done",
			size: 3,
			responseBody: { text: null, size: 3, kind: "image/png" },
		});
	});

	it("keeps the first part of a long answer and its whole size", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const text = "a".repeat(MAX_BODY_BYTES + 10);
		const answer = new Response(text, { headers: { "content-type": "text/plain" } });

		await (await log.trace("updates", server(() => answer).fetch)("https://x.test/big")).text();
		await settled(log);

		expect(log.entry(1)?.responseBody).toEqual({
			text: "a".repeat(MAX_BODY_BYTES),
			size: MAX_BODY_BYTES + 10,
			truncated: true,
		});
	});

	it("records a streamed answer as it ends, while the caller reads its own copy", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		let push: (text: string | null) => void = () => {};
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				push = (text) => {
					if (text === null) controller.close();
					else controller.enqueue(new TextEncoder().encode(text));
				};
			},
		});
		const answer = new Response(body, { headers: { "content-type": "text/event-stream" } });

		const response = await log.trace(
			"assistant",
			server(() => answer).fetch,
		)("https://api.example.com/v1/messages");
		push("data: one\n\n");
		expect(log.entry(1)?.state).toBe("pending");
		push("data: two\n\n");
		push(null);
		expect(await response.text()).toBe("data: one\n\ndata: two\n\n");
		await settled(log);
		expect(log.entry(1)?.responseBody?.text).toBe("data: one\n\ndata: two\n\n");
	});

	it("records a failed request and lets the error through", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const failing: Fetch = async () => {
			throw new TypeError("fetch failed", { cause: new Error("ENOTFOUND x.test") });
		};

		await expect(log.trace("mcp", failing)("https://x.test/mcp")).rejects.toThrow("fetch failed");

		expect(log.entry(1)).toMatchObject({
			state: "failed",
			status: null,
			error: "fetch failed (ENOTFOUND x.test)",
		});
	});

	it("tells a cancelled request from a failed one", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const controller = new AbortController();
		const aborting: Fetch = async () => {
			controller.abort();
			throw new DOMException("The operation was aborted.", "AbortError");
		};

		await expect(
			log.trace("assistant", aborting)("https://x.test/a", { signal: controller.signal }),
		).rejects.toThrow();

		expect(log.entry(1)?.state).toBe("aborted");
	});

	it("does not record while paused, and forgets all when debug mode goes off", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const traced = log.trace("jira", server(() => new Response(null, { status: 204 })).fetch);

		await traced("https://x.test/1");
		log.setRecording(false);
		await traced("https://x.test/2");
		expect(log.state()).toMatchObject({ recording: false, entries: [{ id: 1 }] });

		log.setRecording(true);
		log.setEnabled(false);
		expect(log.state()).toEqual({ recording: false, entries: [] });
		expect(log.entry(1)).toBeNull();
	});

	it("drops the oldest rows past its limit", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		const traced = log.trace("jira", server(() => new Response(null, { status: 204 })).fetch);

		for (let i = 0; i < MAX_ENTRIES + 3; i++) await traced(`https://x.test/${i}`);

		const { entries } = log.state();
		expect(entries).toHaveLength(MAX_ENTRIES);
		expect(entries[0]?.id).toBe(4);
		expect(log.entry(1)).toBeNull();
	});

	it("does not bring back a row cleared while its answer was coming", async () => {
		const log = new NetworkLog();
		log.setEnabled(true);
		let answer: (response: Response) => void = () => {};
		const slow: Fetch = () =>
			new Promise((resolve) => {
				answer = resolve;
			});

		const pending = log.trace("jira", slow)("https://x.test/slow");
		log.clear();
		answer(json({}));
		await pending;

		expect(log.state().entries).toEqual([]);
	});
});

describe("describeRequestBody", () => {
	it("keeps text, and describes what is not text", () => {
		expect(describeRequestBody(undefined, "")).toBeNull();
		expect(describeRequestBody(new URLSearchParams({ a: "1", password: "p" }), "")).toEqual({
			text: `a=1&password=${MASK}`,
			size: 14,
			truncated: false,
		});
		expect(describeRequestBody(new TextEncoder().encode('{"a":1}'), "application/json")).toEqual({
			text: '{"a":1}',
			size: 7,
			truncated: false,
		});
		expect(describeRequestBody(new Uint8Array(5), "image/png")).toEqual({
			text: null,
			size: 5,
			truncated: false,
			kind: "image/png",
		});
		const form = new FormData();
		form.append("comment", "hi");
		form.append("file", new Blob(["abc"], { type: "text/plain" }), "a.txt");
		expect(describeRequestBody(form, "")).toEqual({
			text: "comment: hi\nfile: [a.txt, text/plain, 3 B]",
			size: null,
			truncated: false,
			kind: "FormData",
		});
	});
});
