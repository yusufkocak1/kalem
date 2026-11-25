import { describe, expect, it } from "vitest";
import { chromiumProxy, normalizeProxyServer, proxyEnv } from "./proxy.js";

const manual = (proxyServer: string, proxyBypass = "") =>
	({ proxyMode: "manual", proxyServer, proxyBypass }) as const;

describe("proxy", () => {
	it("reads an address with or without its scheme", () => {
		expect(normalizeProxyServer("proxy.corp:8080")).toBe("http://proxy.corp:8080");
		expect(normalizeProxyServer(" http://proxy.corp:3128/ ")).toBe("http://proxy.corp:3128");
		expect(normalizeProxyServer("socks5://10.0.0.1")).toBe("socks5://10.0.0.1:1080");
		expect(normalizeProxyServer("proxy.corp")).toBe("http://proxy.corp:80");
	});

	it("refuses what is not a proxy address", () => {
		expect(normalizeProxyServer("")).toBeNull();
		expect(normalizeProxyServer("ftp://proxy:21")).toBeNull();
		expect(normalizeProxyServer("http://user:pw@proxy:8080")).toBeNull();
		expect(normalizeProxyServer("http://proxy:8080/path")).toBeNull();
		expect(normalizeProxyServer("proxy:99999")).toBeNull();
	});

	it("gives Chromium the mode, and a manual proxy its rules", () => {
		expect(chromiumProxy({ proxyMode: "system", proxyServer: "x:1", proxyBypass: "" })).toEqual({
			mode: "system",
		});
		expect(chromiumProxy({ proxyMode: "direct", proxyServer: "", proxyBypass: "" })).toEqual({
			mode: "direct",
		});
		expect(chromiumProxy(manual("proxy.corp:8080", "*.corp.local; 10.0.0.0/8"))).toEqual({
			mode: "fixed_servers",
			proxyRules: "http://proxy.corp:8080",
			proxyBypassRules: "*.corp.local,10.0.0.0/8,<local>",
		});
		expect(chromiumProxy(manual("not a proxy"))).toEqual({ mode: "system" });
	});

	it("passes the proxy to the programs the app starts", () => {
		const env = proxyEnv(manual("proxy.corp:8080", "*.corp.local"), {
			username: "ali@corp",
			password: "p:ss",
		});
		expect(env?.HTTPS_PROXY).toBe("http://ali%40corp:p%3Ass@proxy.corp:8080");
		expect(env?.NO_PROXY).toBe("localhost,127.0.0.1,::1,.corp.local");
		expect(proxyEnv({ proxyMode: "system", proxyServer: "", proxyBypass: "" }, null)).toBe(
			undefined,
		);
		expect(
			proxyEnv({ proxyMode: "direct", proxyServer: "", proxyBypass: "" }, null)?.HTTP_PROXY,
		).toBe(null);
		expect(proxyEnv(manual("socks5://s:1080"), null)?.HTTPS_PROXY).toBeNull();
	});
});
