import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	cloneRepository,
	GitError,
	gitBranches,
	gitMessage,
	gitStatus,
	isCloneUrl,
	parseBranches,
	parseStatus,
	repositoryName,
	runGitAction,
	toGitAction,
} from "./git.js";

const hasGit = (() => {
	try {
		execFileSync("git", ["--version"]);
		return true;
	} catch {
		return false;
	}
})();

describe("git output", () => {
	it("reads the branch, what is pending and the changed files", () => {
		const status = parseStatus(
			[
				"# branch.oid 1234",
				"# branch.head main",
				"# branch.upstream origin/main",
				"# branch.ab +2 -3",
				"1 .M N... 100644 100644 100644 aaa bbb notes.md",
				"? new.md",
				"",
			].join("\n"),
		);
		expect(status).toEqual({
			branch: "main",
			upstream: "origin/main",
			ahead: 2,
			behind: 3,
			changed: 2,
		});
		expect(parseStatus("# branch.oid 1234\n# branch.head (detached)\n")).toEqual({
			branch: null,
			upstream: null,
			ahead: 0,
			behind: 0,
			changed: 0,
		});
	});

	it("lists local branches first and remote ones without a local twin", () => {
		const branches = parseBranches(
			[
				"refs/heads/main\t*",
				"refs/heads/feature/x\t ",
				"refs/remotes/origin/HEAD\t ",
				"refs/remotes/origin/main\t ",
				"refs/remotes/origin/release/2\t ",
			].join("\n"),
		);
		expect(branches).toEqual([
			{ name: "main", remote: null, current: true },
			{ name: "feature/x", remote: null, current: false },
			{ name: "release/2", remote: "origin", current: false },
		]);
	});

	it("names the folder a clone goes in", () => {
		expect(repositoryName("https://github.com/user/kalem.git")).toBe("kalem");
		expect(repositoryName("git@github.com:user/notes.git/")).toBe("notes");
		expect(repositoryName("ssh://git@host:22/team/docs")).toBe("docs");
	});

	it("takes repository URLs and nothing that git would read as an option", () => {
		for (const url of [
			"https://github.com/user/repo.git",
			"git@github.com:user/repo.git",
			"ssh://git@host/repo",
			"file:///srv/repo.git",
		]) {
			expect(isCloneUrl(url)).toBe(true);
		}
		for (const url of ["", "--upload-pack=evil", "https://", "repo", "C:\\repo", "a b"]) {
			expect(isCloneUrl(url)).toBe(false);
		}
	});

	it("checks actions coming from the page", () => {
		expect(toGitAction({ kind: "pull" })).toEqual({ kind: "pull" });
		expect(toGitAction({ kind: "checkout", branch: " dev " })).toEqual({
			kind: "checkout",
			branch: "dev",
		});
		expect(() => toGitAction({ kind: "commit", message: "  " })).toThrow();
		expect(() => toGitAction({ kind: "reset" })).toThrow();
		expect(() => toGitAction(null)).toThrow();
	});

	it("drops git's prefixes from what it says", () => {
		expect(gitMessage("fatal: not a git repository\n")).toBe("not a git repository");
	});
});

describe.skipIf(!hasGit)("git in a folder", () => {
	let base: string;
	let remote: string;

	beforeAll(async () => {
		process.env.GIT_AUTHOR_NAME = "Kalem";
		process.env.GIT_AUTHOR_EMAIL = "kalem@example.com";
		process.env.GIT_COMMITTER_NAME = "Kalem";
		process.env.GIT_COMMITTER_EMAIL = "kalem@example.com";
		base = await mkdtemp(join(tmpdir(), "kalem-git-"));
		remote = join(base, "remote.git");
		execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
	});

	it("is not a repository until one is made", async () => {
		const folder = await mkdtemp(join(base, "plain-"));
		expect(await gitStatus(folder)).toBeNull();
		await runGitAction(folder, { kind: "init" });
		expect(await gitStatus(folder)).not.toBeNull();
	});

	it("clones, commits, pushes, branches and pulls", async () => {
		const url = pathToFileURL(remote).href;
		const first = await cloneRepository(url, await mkdtemp(join(base, "a-")));
		expect(first.endsWith("remote")).toBe(true);
		await expect(cloneRepository(url, join(first, ".."))).rejects.toMatchObject({
			problem: "exists",
		});

		await writeFile(join(first, "notes.md"), "# Notes\n");
		expect((await gitStatus(first))?.changed).toBe(1);
		await runGitAction(first, { kind: "commit", message: "Notes" });
		const committed = await gitStatus(first);
		expect(committed?.changed).toBe(0);
		// Never pushed: the first push sets where it goes.
		await runGitAction(first, { kind: "push" });
		expect((await gitStatus(first))?.upstream).toBe("origin/main");

		await runGitAction(first, { kind: "create-branch", branch: "draft" });
		expect((await gitStatus(first))?.branch).toBe("draft");
		await runGitAction(first, { kind: "push" });
		await runGitAction(first, { kind: "checkout", branch: "main" });
		expect((await gitStatus(first))?.branch).toBe("main");

		const second = await cloneRepository(url, await mkdtemp(join(base, "b-")));
		expect((await gitBranches(second)).map((branch) => branch.name)).toEqual(["main", "draft"]);
		// A branch only on the remote gets a local one that follows it.
		await runGitAction(second, { kind: "checkout", branch: "draft" });
		expect((await gitStatus(second))?.upstream).toBe("origin/draft");

		await runGitAction(second, { kind: "checkout", branch: "main" });
		await writeFile(join(first, "more.md"), "More\n");
		await runGitAction(first, { kind: "commit", message: "More" });
		await runGitAction(first, { kind: "push" });
		await runGitAction(second, { kind: "fetch" });
		expect((await gitStatus(second))?.behind).toBe(1);
		await runGitAction(second, { kind: "pull" });
		expect((await gitStatus(second))?.behind).toBe(0);
	});

	it("refuses branch names git would not take", async () => {
		const folder = await mkdtemp(join(base, "names-"));
		await runGitAction(folder, { kind: "init" });
		for (const branch of ["-x", "a..b", "bad name"]) {
			const error = await runGitAction(folder, { kind: "create-branch", branch }).catch(
				(caught: unknown) => caught,
			);
			expect(error).toBeInstanceOf(GitError);
			expect((error as GitError).problem).toBe("invalid-branch");
		}
	});

	it("passes git's own words on when it fails", async () => {
		const folder = await mkdtemp(join(base, "fail-"));
		await runGitAction(folder, { kind: "init" });
		await expect(runGitAction(folder, { kind: "push" })).rejects.toMatchObject({
			problem: "failed",
		});
	});
});
