import { describe, expect, it } from "vitest";
import { MAX_PARALLEL, RateGate, RateLimited, retryAfter } from "./jira-rate.js";

/** A clock that moves only when the gate sleeps. */
function clock() {
	let now = 1_000_000;
	const slept: number[] = [];
	return {
		now: () => now,
		sleep: async (ms: number) => {
			slept.push(ms);
			now += ms;
		},
		slept,
	};
}

const headers = (values: Record<string, string>) => ({
	get: (name: string) => values[name] ?? null,
});

describe("Jira's rate limit", () => {
	it("reads Retry-After as seconds or a date, and stops at two minutes", () => {
		expect(retryAfter("30", 1000)).toBe(30_000);
		expect(retryAfter("0", 1000)).toBe(0);
		expect(retryAfter(null, 1000)).toBe(1000);
		expect(retryAfter("junk", 1000)).toBe(1000);
		expect(retryAfter("3600", 1000)).toBe(120_000);
		expect(retryAfter(new Date(10_000).toUTCString(), 1000, 0)).toBe(10_000);
	});

	it("stops every request to the site after a 429: the user's wait, the background's are not sent", async () => {
		const time = clock();
		const gate = new RateGate(time.now, time.sleep);
		expect(gate.block("https://jira", 30_000)).toBe(30);
		await expect(gate.enter("https://jira", true)).rejects.toBeInstanceOf(RateLimited);
		// Another site is not stopped.
		(await gate.enter("https://other", true))();
		const done = await gate.enter("https://jira", false);
		expect(time.slept).toEqual([30_000]);
		expect(gate.blockedFor("https://jira")).toBe(0);
		done();
	});

	it("spaces requests to Jira's fill rate when little is left", async () => {
		const time = clock();
		const gate = new RateGate(time.now, time.sleep);
		gate.record(
			"https://jira",
			headers({
				"X-RateLimit-Remaining": "1",
				"X-RateLimit-FillRate": "2",
				"X-RateLimit-Interval-Seconds": "1",
			}),
		);
		(await gate.enter("https://jira", false))();
		(await gate.enter("https://jira", false))();
		// Two a second: the second waits half a second after the first.
		expect(time.slept).toEqual([500]);
		gate.record("https://jira", headers({ "X-RateLimit-Remaining": "50" }));
		(await gate.enter("https://jira", false))();
		expect(time.slept).toEqual([500]);
	});

	it("sends only a few at a time", async () => {
		const gate = new RateGate();
		const ends = await Promise.all(
			Array.from({ length: MAX_PARALLEL }, () => gate.enter("https://jira", false)),
		);
		let third = false;
		const waiting = gate.enter("https://jira", false).then((end) => {
			third = true;
			return end;
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(third).toBe(false);
		ends[0]?.();
		(await waiting)();
		expect(third).toBe(true);
		for (const end of ends) end();
	});
});
