import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findRepoRoot, isTrustedRepo } from "./git-trust.js";

describe("git trust", () => {
	it("finds the repository a folder is in without running git", async () => {
		const base = await mkdtemp(join(tmpdir(), "kalem-trust-"));
		await mkdir(join(base, "repo", ".git"), { recursive: true });
		await mkdir(join(base, "repo", "docs", "deep"), { recursive: true });
		await mkdir(join(base, "plain"), { recursive: true });
		expect(await findRepoRoot(join(base, "repo", "docs", "deep"))).toBe(join(base, "repo"));
		expect(await findRepoRoot(join(base, "plain"))).toBeNull();
	});

	it("trusts a repository the user trusted, or one inside a trusted folder", () => {
		const trusted = [join("/home", "u", "work")];
		expect(isTrustedRepo(join("/home", "u", "work"), trusted)).toBe(true);
		expect(isTrustedRepo(join("/home", "u", "work", "app"), trusted)).toBe(true);
		expect(isTrustedRepo(join("/home", "u", "workshop"), trusted)).toBe(false);
		expect(isTrustedRepo(join("/home", "u", "downloads", "x"), trusted)).toBe(false);
	});
});
