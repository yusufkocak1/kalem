import { describe, expect, it } from "vitest";
import { CHECK_INTERVAL, checkDue, compareVersions, latestRelease } from "./updates.js";

describe("compareVersions", () => {
	it("compares numerically, part by part", () => {
		expect(compareVersions("1.3.10", "1.3.9")).toBe(1);
		expect(compareVersions("1.3.8", "1.4.0")).toBe(-1);
		expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
		expect(compareVersions("1.0.0-beta", "0.9.0")).toBe(0);
	});
});

describe("latestRelease", () => {
	const release = (tag: string, extra: Record<string, unknown> = {}) => ({
		tag_name: tag,
		draft: false,
		prerelease: false,
		html_url: `https://github.com/yusufkocak1/kalem/releases/tag/${tag}`,
		assets: [{ name: "Kalem-Setup.exe" }],
		...extra,
	});

	it("picks the newest published desktop release", () => {
		const latest = latestRelease([
			release("v2.0.0"),
			release("desktop-v1.3.8"),
			release("desktop-v1.10.0", { assets: [{ name: "latest.yml" }] }),
			release("desktop-v1.11.0", { prerelease: true }),
			release("desktop-v1.12.0", { draft: true }),
			release("desktop-vnext"),
		]);
		expect(latest).toEqual({
			version: "1.10.0",
			tag: "desktop-v1.10.0",
			page: "https://github.com/yusufkocak1/kalem/releases/tag/desktop-v1.10.0",
			downloads: "https://github.com/yusufkocak1/kalem/releases/download/desktop-v1.10.0",
			installable: true,
		});
	});

	it("survives unexpected responses", () => {
		expect(latestRelease({ message: "API rate limit exceeded" })).toBeNull();
		expect(latestRelease([null, 1, { tag_name: 5 }])).toBeNull();
	});
});

describe("checkDue", () => {
	it("checks once a day, and again if the clock went back", () => {
		expect(checkDue(null, 1000)).toBe(true);
		expect(checkDue(1000, 1000 + CHECK_INTERVAL - 1)).toBe(false);
		expect(checkDue(1000, 1000 + CHECK_INTERVAL)).toBe(true);
		expect(checkDue(5000, 1000)).toBe(true);
	});
});
