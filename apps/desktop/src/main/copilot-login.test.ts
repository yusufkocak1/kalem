import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfluenceStore } from "./confluence-store.js";
import { CopilotLogin, CopilotLoginError } from "./copilot-login.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const box = {
	encrypt: (text: string) => Buffer.from(text),
	decrypt: (data: Buffer) => data.toString(),
};

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function setup(tokenAnswers: unknown[], copilotStatus = 200) {
	const store = new ConfluenceStore(join(await mkdtemp(join(tmpdir(), "copilot-")), "l.json"), box);
	const calls: string[] = [];
	const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
		calls.push(url);
		if (url.endsWith("/login/device/code")) {
			expect(String(init?.body)).toContain("client_id=Iv1.b507a08c87ecfe98");
			return json({
				device_code: "dev",
				user_code: "C9C0-5C02",
				verification_uri: "https://github.com/login/device",
				expires_in: 900,
				interval: 5,
			});
		}
		if (url.endsWith("/access_token")) return json(tokenAnswers.shift());
		if (url.endsWith("/copilot_internal/v2/token")) return json({}, copilotStatus);
		if (url.endsWith("/user")) return json({ login: "octocat" });
		throw new Error(url);
	};
	const waits: number[] = [];
	const login = new CopilotLogin(store, fetch, async (ms) => {
		waits.push(ms);
	});
	return { login, store, calls, waits };
}

describe("Copilot device login", () => {
	afterEach(() => {
		delete process.env.COPILOT_GITHUB_TOKEN;
	});

	it("waits for the approval, keeps the token and hands it to the CLI", async () => {
		const { login, store, waits } = await setup([
			{ error: "authorization_pending" },
			{ error: "slow_down", interval: 10 },
			{ access_token: "ghu_token" },
		]);
		expect(await login.begin()).toEqual({
			userCode: "C9C0-5C02",
			verificationUri: "https://github.com/login/device",
			expiresIn: 900,
		});
		expect(await login.wait()).toEqual({ login: "octocat" });
		expect(waits).toEqual([5000, 5000, 10000]);
		expect(process.env.COPILOT_GITHUB_TOKEN).toBe("ghu_token");
		expect((await store.get())?.token).toBe("ghu_token");
		expect(await login.account()).toEqual({ login: "octocat" });

		await login.logout();
		expect(process.env.COPILOT_GITHUB_TOKEN).toBeUndefined();
		expect(await login.account()).toBeNull();
	});

	it("says why a login did not happen", async () => {
		const denied = await setup([{ error: "access_denied" }]);
		await denied.login.begin();
		await expect(denied.login.wait()).rejects.toEqual(new CopilotLoginError("denied"));

		const noLicense = await setup([{ access_token: "ghu_x" }], 403);
		await noLicense.login.begin();
		await expect(noLicense.login.wait()).rejects.toMatchObject({ reason: "noCopilot" });
		expect(await noLicense.login.account()).toBeNull();
		expect(process.env.COPILOT_GITHUB_TOKEN).toBeUndefined();
	});

	it("stops polling when cancelled", async () => {
		const { login, calls } = await setup([{ error: "authorization_pending" }]);
		await login.begin();
		login.cancel();
		await expect(login.wait()).rejects.toMatchObject({ reason: "cancelled" });
		expect(calls.filter((url) => url.endsWith("/access_token"))).toEqual([]);
	});
});
