import { app, ipcMain, net, session } from "electron";
import type { ProxyAccount, ProxyTestResult, Settings } from "../shared/bridge.js";
import { CHANNEL } from "../shared/bridge.js";
import type { ProxyCredentials, ProxyEnvName } from "../shared/proxy.js";
import { chromiumProxy, PROXY_ENV_NAMES, proxyEnv } from "../shared/proxy.js";
import type { ConfluenceStore } from "./confluence-store.js";

const TEST_URL = "https://api.github.com/";
const TEST_WAIT = 15_000;
/** A proxy that keeps refusing the login is not answered again until the login changes. */
const MAX_LOGIN_TRIES = 3;

export class ProxyManager {
	readonly #store: ConfluenceStore;
	readonly #settings: () => Settings;
	readonly #systemEnv: Partial<Record<ProxyEnvName, string>>;
	#credentials: ProxyCredentials | null = null;
	#tries = new Map<string, number>();
	#applied = "";

	constructor(store: ConfluenceStore, settings: () => Settings) {
		this.#store = store;
		this.#settings = settings;
		this.#systemEnv = Object.fromEntries(
			PROXY_ENV_NAMES.flatMap((name) => {
				const value = process.env[name];
				return value === undefined ? [] : [[name, value]];
			}),
		);
	}

	async start(): Promise<void> {
		const stored = await this.#store.get();
		this.#credentials =
			stored === null ? null : { username: stored.username, password: stored.token };
		app.on("login", (event, _webContents, _details, authInfo, callback) => {
			if (!authInfo.isProxy || this.#credentials === null) return;
			const key = `${authInfo.host}:${authInfo.port}`;
			const tries = (this.#tries.get(key) ?? 0) + 1;
			this.#tries.set(key, tries);
			if (tries > MAX_LOGIN_TRIES) return;
			event.preventDefault();
			callback(this.#credentials.username, this.#credentials.password);
		});
		await this.apply();
	}

	/** Follows the settings; nothing is done when the proxy did not change. */
	async apply(): Promise<void> {
		const settings = this.#settings();
		const config = chromiumProxy(settings);
		const env = proxyEnv(settings, this.#credentials);
		const signature = JSON.stringify([config, env]);
		if (signature === this.#applied) return;
		this.#applied = signature;
		this.#setEnv(env);
		await Promise.all([session.defaultSession.setProxy(config), app.setProxy(config)]);
		await session.defaultSession.closeAllConnections();
	}

	#setEnv(env: ReturnType<typeof proxyEnv>): void {
		for (const name of PROXY_ENV_NAMES) {
			const value = env === undefined ? this.#systemEnv[name] : env[name];
			if (value === undefined || value === null) delete process.env[name];
			else process.env[name] = value;
		}
	}

	account(): ProxyAccount | null {
		const credentials = this.#credentials;
		if (credentials === null) return null;
		return { username: credentials.username, hasPassword: credentials.password !== "" };
	}

	async setLogin(username: string, password: string | null): Promise<void> {
		this.#tries.clear();
		if (username === "") {
			this.#credentials = null;
			await this.#store.clear();
		} else {
			const kept = password ?? this.#credentials?.password ?? "";
			this.#credentials = { username, password: kept };
			await this.#store.set({ site: "proxy", username, token: kept });
		}
		await this.apply();
		await session.defaultSession.closeAllConnections();
	}

	async test(): Promise<ProxyTestResult> {
		this.#tries.clear();
		const route = await session.defaultSession.resolveProxy(TEST_URL).catch(() => "?");
		try {
			const response = await net.fetch(TEST_URL, {
				method: "HEAD",
				signal: AbortSignal.timeout(TEST_WAIT),
			});
			return { ok: response.status !== 407, route, status: response.status };
		} catch (error) {
			return { ok: false, route, error: error instanceof Error ? error.message : String(error) };
		}
	}
}

function text(value: unknown, maxLength: number): string {
	if (typeof value !== "string" || value.length > maxLength) throw new Error("Invalid proxy login");
	return value;
}

export function registerProxyIpc(proxy: ProxyManager): void {
	ipcMain.handle(CHANNEL.proxyAccount, () => proxy.account());
	ipcMain.handle(CHANNEL.proxySetLogin, async (_event, raw: unknown) => {
		const login = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
		const username = text(login.username, 512).trim();
		const password = login.password === null ? null : text(login.password, 1024);
		await proxy.setLogin(username, password);
	});
	ipcMain.handle(CHANNEL.proxyTest, () => proxy.test());
}
