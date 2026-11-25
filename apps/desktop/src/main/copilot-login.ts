import { ipcMain } from "electron";
import type {
	CopilotAccount,
	CopilotDeviceCode,
	CopilotLoginFailure,
	CopilotLoginResult,
} from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { ConfluenceStore } from "./confluence-store.js";

/** GitHub Copilot's own OAuth app, as the editor plugins use it. */
export const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const COPILOT_URL = "https://api.github.com/copilot_internal/v2/token";
const ENV_NAME = "COPILOT_GITHUB_TOKEN";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class CopilotLoginError extends Error {
	readonly reason: CopilotLoginFailure;
	constructor(reason: CopilotLoginFailure) {
		super(reason);
		this.reason = reason;
	}
}

interface Pending {
	readonly deviceCode: string;
	readonly expires: number;
	interval: number;
	cancelled: boolean;
}

const form = (fields: Record<string, string>): RequestInit => ({
	method: "POST",
	headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
	body: new URLSearchParams(fields).toString(),
});

/**
 * Signs in to GitHub with a device code: the user types the code on
 * github.com, and the token is kept encrypted and handed to the Copilot CLI
 * as COPILOT_GITHUB_TOKEN.
 */
export class CopilotLogin {
	readonly #store: ConfluenceStore;
	readonly #fetch: Fetch;
	readonly #sleep: (ms: number) => Promise<void>;
	readonly #systemToken = process.env[ENV_NAME];
	#pending: Pending | null = null;

	constructor(
		store: ConfluenceStore,
		fetch: Fetch,
		sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
	) {
		this.#store = store;
		this.#fetch = fetch;
		this.#sleep = sleep;
	}

	async start(): Promise<void> {
		const kept = await this.#store.get();
		if (kept !== null) process.env[ENV_NAME] = kept.token;
	}

	async account(): Promise<CopilotAccount | null> {
		const kept = await this.#store.get();
		return kept === null ? null : { login: kept.username };
	}

	async begin(): Promise<CopilotDeviceCode> {
		this.cancel();
		const response = await this.#fetch(
			DEVICE_URL,
			form({ client_id: COPILOT_CLIENT_ID, scope: "read:user" }),
		);
		if (!response.ok) throw new CopilotLoginError("failed");
		const body = (await response.json()) as Record<string, unknown>;
		const { device_code, user_code, verification_uri, expires_in, interval } = body;
		if (
			typeof device_code !== "string" ||
			typeof user_code !== "string" ||
			typeof verification_uri !== "string"
		) {
			throw new CopilotLoginError("failed");
		}
		const seconds = typeof expires_in === "number" ? expires_in : 900;
		this.#pending = {
			deviceCode: device_code,
			expires: Date.now() + seconds * 1000,
			interval: typeof interval === "number" ? interval : 5,
			cancelled: false,
		};
		return { userCode: user_code, verificationUri: verification_uri, expiresIn: seconds };
	}

	/** Waits until the code is approved on GitHub, then keeps the login. */
	async wait(): Promise<CopilotAccount> {
		const pending = this.#pending;
		if (pending === null) throw new CopilotLoginError("cancelled");
		const token = await this.#poll(pending);
		const login = await this.#verify(token);
		await this.#store.set({ site: "github.com", username: login, token });
		process.env[ENV_NAME] = token;
		return { login };
	}

	async #poll(pending: Pending): Promise<string> {
		for (;;) {
			await this.#sleep(pending.interval * 1000);
			if (pending.cancelled || this.#pending !== pending) throw new CopilotLoginError("cancelled");
			if (Date.now() > pending.expires) throw new CopilotLoginError("expired");
			const response = await this.#fetch(
				TOKEN_URL,
				form({
					client_id: COPILOT_CLIENT_ID,
					device_code: pending.deviceCode,
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				}),
			).catch(() => null);
			if (response === null) continue;
			const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
			if (typeof body.access_token === "string") {
				this.#pending = null;
				return body.access_token;
			}
			switch (body.error) {
				case "authorization_pending":
					break;
				case "slow_down":
					pending.interval =
						typeof body.interval === "number" ? body.interval : pending.interval + 5;
					break;
				case "access_denied":
					throw new CopilotLoginError("denied");
				case "expired_token":
					throw new CopilotLoginError("expired");
				default:
					throw new CopilotLoginError("failed");
			}
		}
	}

	async #verify(token: string): Promise<string> {
		const headers = { Authorization: `token ${token}`, Accept: "application/json" };
		const copilot = await this.#fetch(COPILOT_URL, { headers });
		if (!copilot.ok) throw new CopilotLoginError("noCopilot");
		const user = await this.#fetch(USER_URL, { headers });
		const body = (await user.json().catch(() => ({}))) as Record<string, unknown>;
		return typeof body.login === "string" ? body.login : "GitHub";
	}

	cancel(): void {
		if (this.#pending !== null) this.#pending.cancelled = true;
		this.#pending = null;
	}

	async logout(): Promise<void> {
		this.cancel();
		await this.#store.clear();
		if (this.#systemToken === undefined) delete process.env[ENV_NAME];
		else process.env[ENV_NAME] = this.#systemToken;
	}
}

export function registerCopilotLoginIpc(login: CopilotLogin): void {
	ipcMain.handle(CHANNEL.copilotAccount, () => login.account());
	ipcMain.handle(CHANNEL.copilotLoginBegin, () => login.begin());
	ipcMain.handle(CHANNEL.copilotLoginWait, async (): Promise<CopilotLoginResult> => {
		try {
			return { account: await login.wait() };
		} catch (error) {
			if (error instanceof CopilotLoginError) return { error: error.reason };
			return { error: "failed", detail: error instanceof Error ? error.message : String(error) };
		}
	});
	ipcMain.handle(CHANNEL.copilotLoginCancel, () => login.cancel());
	ipcMain.handle(CHANNEL.copilotLogout, () => login.logout());
}
