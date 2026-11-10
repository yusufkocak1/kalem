/**
 * How Kalem keeps to a Jira's rate limit. Jira Data Center counts the REST
 * calls made with a token or a password (the browser's own are not
 * counted), and turns them away with HTTP 429 once its allowance is spent.
 * Each site has one gate for every request to it:
 *
 * - few requests at a time;
 * - Jira's `X-RateLimit-*` headers say how much is left and how fast it
 *   fills: when little is left, requests are spaced to the fill rate;
 * - a 429 stops every request to the site for the time Jira asks
 *   (`Retry-After`), not only the one turned away; while it lasts, a
 *   request made in the background (a card, a list's choices) is not sent
 *   at all, and one the user asked for waits.
 */

/** Requests one site is sent at the same time. */
export const MAX_PARALLEL = 2;
/** Longest stop after a 429, whatever Jira says. */
const MAX_BLOCK = 120_000;
/** Below this much allowance left, requests are spaced to the fill rate. */
const LOW = 2;

export class RateLimited extends Error {
	/** Seconds until Jira allows requests again. */
	readonly seconds: number;

	constructor(seconds: number) {
		super(
			`HTTP 429: Jira is limiting requests (rate limit); it allows them again in ${seconds} s.`,
		);
		this.name = "RateLimited";
		this.seconds = seconds;
	}
}

interface SiteState {
	running: number;
	waiting: (() => void)[];
	/** No request is sent before this time (ms). */
	blockedUntil: number;
	/** What Jira said is left; `null` before it said. */
	remaining: number | null;
	/** Time between two requests at Jira's fill rate (ms); 0 when unknown. */
	spacing: number;
	lastSent: number;
}

/** How long to wait from a `Retry-After` header (seconds or a date); `fallback` when it has none. */
export function retryAfter(header: string | null, fallback: number, now = Date.now()): number {
	let wait = Number.NaN;
	if (header !== null && header.trim() !== "") {
		const seconds = Number(header);
		wait = Number.isFinite(seconds) ? seconds * 1000 : new Date(header).getTime() - now;
	}
	if (!Number.isFinite(wait) || wait < 0) wait = fallback;
	return Math.min(wait, MAX_BLOCK);
}

export class RateGate {
	readonly #sites = new Map<string, SiteState>();
	readonly #now: () => number;
	readonly #sleep: (ms: number) => Promise<void>;

	constructor(
		now: () => number = Date.now,
		sleep: (ms: number) => Promise<void> = (ms) =>
			new Promise((resolve) => setTimeout(resolve, ms)),
	) {
		this.#now = now;
		this.#sleep = sleep;
	}

	#state(site: string): SiteState {
		let state = this.#sites.get(site);
		if (state === undefined) {
			state = {
				running: 0,
				waiting: [],
				blockedUntil: 0,
				remaining: null,
				spacing: 0,
				lastSent: 0,
			};
			this.#sites.set(site, state);
		}
		return state;
	}

	/** Seconds the site is still stopped for; 0 when it is not. */
	blockedFor(site: string): number {
		return Math.max(0, Math.ceil((this.#state(site).blockedUntil - this.#now()) / 1000));
	}

	/**
	 * Waits for a turn to send a request to `site`; returns the call that
	 * ends it. A `background` request throws `RateLimited` instead of
	 * waiting out a stop.
	 */
	async enter(site: string, background: boolean): Promise<() => void> {
		const state = this.#state(site);
		for (;;) {
			const now = this.#now();
			if (state.blockedUntil > now) {
				if (background) throw new RateLimited(this.blockedFor(site));
				await this.#sleep(state.blockedUntil - now);
				continue;
			}
			if (state.remaining !== null && state.remaining < LOW && state.spacing > 0) {
				const next = state.lastSent + state.spacing;
				if (next > now) {
					await this.#sleep(next - now);
					continue;
				}
			}
			if (state.running >= MAX_PARALLEL) {
				await new Promise<void>((resolve) => state.waiting.push(resolve));
				continue;
			}
			break;
		}
		state.running++;
		state.lastSent = this.#now();
		if (state.remaining !== null) state.remaining = Math.max(0, state.remaining - 1);
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			state.running--;
			state.waiting.shift()?.();
		};
	}

	/** What Jira's answer said of its allowance (`X-RateLimit-Remaining`, `-FillRate`, `-Interval-Seconds`). */
	record(site: string, headers: { get(name: string): string | null }): void {
		const state = this.#state(site);
		const remaining = Number(headers.get("X-RateLimit-Remaining"));
		if (headers.get("X-RateLimit-Remaining") !== null && Number.isFinite(remaining)) {
			state.remaining = remaining;
		}
		const fill = Number(headers.get("X-RateLimit-FillRate"));
		const interval = Number(headers.get("X-RateLimit-Interval-Seconds") ?? "1");
		if (Number.isFinite(fill) && fill > 0 && Number.isFinite(interval) && interval > 0) {
			state.spacing = (interval * 1000) / fill;
		}
	}

	/** Stops every request to `site` for `ms`; returns the seconds. */
	block(site: string, ms: number): number {
		const state = this.#state(site);
		state.blockedUntil = Math.max(state.blockedUntil, this.#now() + ms);
		state.remaining = 0;
		return this.blockedFor(site);
	}
}
