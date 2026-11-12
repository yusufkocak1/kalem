import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSession, SessionStore } from "./session-store.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("parseSession", () => {
	it("keeps tabs that can be opened again, in order, and the active one", () => {
		const session = parseSession({
			windows: [
				{
					bounds: { width: 900, height: 700, x: 10, y: 20, maximized: true },
					active: B,
					tabs: [
						{ id: A, path: "/a.md", scroll: 120 },
						{ id: B, draft: true, path: null },
						{ id: C, page: { site: "https://x/wiki", id: "42" } },
						{ id: "not-an-id", path: "/b.md" },
						{ id: A, path: "/again.md" },
						{ id: "44444444-4444-4444-8444-444444444444" },
					],
				},
				{ tabs: [] },
				"bogus",
			],
		});
		expect(session.windows).toHaveLength(1);
		const [win] = session.windows;
		expect(win?.active).toBe(B);
		expect(win?.bounds?.maximized).toBe(true);
		expect(
			win?.tabs.map((tab) => [tab.id, tab.draft, tab.path, tab.page?.id ?? null, tab.scroll]),
		).toEqual([
			[A, false, "/a.md", null, 120],
			[B, true, null, null, 0],
			[C, false, null, "42", 0],
		]);
	});

	it("drops an active tab that is not among the tabs", () => {
		const session = parseSession({ windows: [{ active: C, tabs: [{ id: A, path: "/a.md" }] }] });
		expect(session.windows[0]?.active).toBeNull();
		expect(parseSession(null).windows).toEqual([]);
	});
});

describe("SessionStore", () => {
	it("gives the session once", async () => {
		const store = new SessionStore(join(await mkdtemp(join(tmpdir(), "session-")), "session.json"));
		expect(store.take()).toBeNull();
		store.write({
			windows: [
				{
					bounds: null,
					active: A,
					tabs: [{ id: A, draft: false, path: "/a.md", page: null, scroll: 0 }],
				},
			],
		});
		expect(store.take()?.windows[0]?.tabs[0]?.path).toBe("/a.md");
		expect(store.take()).toBeNull();
	});
});
