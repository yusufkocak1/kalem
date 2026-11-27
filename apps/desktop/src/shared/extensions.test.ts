import { describe, expect, it } from "vitest";
import {
	asksForMore,
	compareVersions,
	hostOfSetting,
	isAllowedUrl,
	NO_PERMISSIONS,
	parseManifest,
	safeEntryPath,
	satisfies,
} from "./extensions.js";

const base = {
	id: "acme.graylog",
	name: "Graylog",
	version: "1.0.0",
	engines: { kalem: ">=3.32.0" },
	host: "host.js",
};

describe("parseManifest", () => {
	it("reads a full manifest", () => {
		const result = parseManifest({
			...base,
			ui: "ui.html",
			permissions: { http: ["graylog.acme.local", "*.acme.com:9000"], assistantTools: true },
			contributes: {
				commands: [{ id: "search", title: "Search logs" }],
				settings: [
					{ key: "url", type: "string", title: "Address" },
					{ key: "limit", type: "number", default: 50 },
				],
				secrets: [{ key: "token", title: "Token" }],
				panes: [{ id: "logs", title: "Logs" }],
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.permissions).toEqual({
			http: ["graylog.acme.local", "*.acme.com:9000"],
			httpFromSettings: [],
			assistantTools: true,
			process: false,
			files: false,
		});
		expect(result.manifest.settings[1]).toMatchObject({
			key: "limit",
			type: "number",
			default: 50,
		});
		expect(result.manifest.publisher).toBe("acme");
	});

	it("refuses bad ids, versions and paths", () => {
		expect(parseManifest({ ...base, id: "graylog" }).ok).toBe(false);
		expect(parseManifest({ ...base, version: "1.0" }).ok).toBe(false);
		expect(parseManifest({ ...base, host: "../evil.js" }).ok).toBe(false);
		expect(parseManifest({ ...base, engines: { kalem: "latest" } }).ok).toBe(false);
		expect(parseManifest({ ...base, permissions: { http: ["https://x.com/"] } }).ok).toBe(false);
	});

	it("takes an svg or png icon from the package", () => {
		const icon = parseManifest({ ...base, icon: "icon.svg" });
		expect(icon.ok && icon.manifest.icon).toBe("icon.svg");
		expect(parseManifest({ ...base, icon: "icon.exe" }).ok).toBe(false);
		expect(parseManifest({ ...base, icon: "../icon.png" }).ok).toBe(false);
	});

	it("takes editors, which need a ui", () => {
		const editors = {
			editors: [
				{ id: "diff", title: "Diff" },
				{ id: "Bad id", title: "X" },
			],
		};
		const ok = parseManifest({ ...base, ui: "ui.html", contributes: editors });
		expect(ok.ok && ok.manifest.editors).toEqual([{ id: "diff", title: "Diff" }]);
		expect(parseManifest({ ...base, contributes: editors }).ok).toBe(false);
	});

	it("needs a ui for a pane and a host for a command", () => {
		expect(parseManifest({ ...base, contributes: { panes: [{ id: "p", title: "P" }] } }).ok).toBe(
			false,
		);
		const { host: _host, ...noHost } = base;
		expect(
			parseManifest({ ...noHost, contributes: { commands: [{ id: "c", title: "C" }] } }).ok,
		).toBe(false);
	});
});

describe("httpFromSettings", () => {
	it("takes text settings only, and reads their host", () => {
		const settings = [
			{ key: "url", type: "string", title: "Address" },
			{ key: "limit", type: "number" },
		];
		const ok = parseManifest({
			...base,
			permissions: { httpFromSettings: ["url"] },
			contributes: { settings },
		});
		expect(ok.ok && ok.manifest.permissions.httpFromSettings).toEqual(["url"]);
		expect(
			parseManifest({
				...base,
				permissions: { httpFromSettings: ["limit"] },
				contributes: { settings },
			}).ok,
		).toBe(false);
		expect(hostOfSetting("https://Graylog.acme.local:9000/")).toBe("graylog.acme.local:9000");
		expect(hostOfSetting("http://graylog")).toBe("graylog");
		expect(hostOfSetting("file:///x")).toBeNull();
		expect(hostOfSetting("")).toBeNull();
		const granted = { ...NO_PERMISSIONS };
		expect(asksForMore(granted, { ...NO_PERMISSIONS, httpFromSettings: ["url"] })).toBe(true);
	});
});

describe("versions", () => {
	it("compares", () => {
		expect(compareVersions("3.10.0", "3.9.9")).toBe(1);
		expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
	});

	it("checks ranges", () => {
		expect(satisfies("3.33.0", ">=3.32.0")).toBe(true);
		expect(satisfies("3.31.0", ">=3.32.0")).toBe(false);
		expect(satisfies("3.40.1", "^3.32.0")).toBe(true);
		expect(satisfies("4.0.0", "^3.32.0")).toBe(false);
		expect(satisfies("3.32.5", "~3.32.0")).toBe(true);
		expect(satisfies("3.33.0", "~3.32.0")).toBe(false);
		expect(satisfies("3.33.0", ">=3.32.0 <4.0.0")).toBe(true);
		expect(satisfies("1.2.3", "1.2.3")).toBe(true);
		expect(satisfies("1.2.3", "*")).toBe(true);
	});
});

describe("isAllowedUrl", () => {
	const hosts = ["graylog.acme.local", "*.acme.com", "logs.example.org:9000"];

	it("allows any address only with *", () => {
		expect(isAllowedUrl("https://anything.example/x", ["*"])).toBe(true);
		expect(isAllowedUrl("file:///etc/passwd", ["*"])).toBe(false);
		expect(parseManifest({ ...base, permissions: { http: ["*"] } }).ok).toBe(true);
	});

	it("allows listed hosts only", () => {
		expect(isAllowedUrl("https://graylog.acme.local/api/search", hosts)).toBe(true);
		expect(isAllowedUrl("http://graylog.acme.local:9000/api", hosts)).toBe(true);
		expect(isAllowedUrl("https://a.acme.com/", hosts)).toBe(true);
		expect(isAllowedUrl("https://acme.com/", hosts)).toBe(false);
		expect(isAllowedUrl("https://evil.com/?graylog.acme.local", hosts)).toBe(false);
		expect(isAllowedUrl("https://graylog.acme.local.evil.com/", hosts)).toBe(false);
		expect(isAllowedUrl("https://logs.example.org:9000/", hosts)).toBe(true);
		expect(isAllowedUrl("https://logs.example.org/", hosts)).toBe(false);
		expect(isAllowedUrl("file:///etc/passwd", hosts)).toBe(false);
		expect(isAllowedUrl("https://user:pw@graylog.acme.local/", hosts)).toBe(false);
	});
});

describe("safeEntryPath and permissions", () => {
	it("keeps paths inside the package", () => {
		expect(safeEntryPath("ui/index.html")).toBe("ui/index.html");
		expect(safeEntryPath("..\\x.js")).toBeNull();
		expect(safeEntryPath("/etc/x")).toBeNull();
		expect(safeEntryPath("C:/x")).toBeNull();
	});

	it("notices new permissions", () => {
		const granted = { ...NO_PERMISSIONS, http: ["a.com"] };
		expect(asksForMore(granted, { ...NO_PERMISSIONS, http: ["a.com"] })).toBe(false);
		expect(asksForMore(granted, { ...NO_PERMISSIONS, http: ["b.com"] })).toBe(true);
		expect(asksForMore(granted, { ...NO_PERMISSIONS, process: true })).toBe(true);
	});
});
