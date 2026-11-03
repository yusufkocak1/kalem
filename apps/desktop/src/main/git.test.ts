import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	backgroundFetch,
	cloneRepository,
	commitContext,
	GitError,
	gitBranches,
	gitDiff,
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
			conflicts: 0,
			files: [
				{ path: "notes.md", kind: "modified" },
				{ path: "new.md", kind: "untracked" },
			],
		});
		expect(parseStatus("# branch.oid 1234\n# branch.head (detached)\n")).toEqual({
			branch: null,
			upstream: null,
			ahead: 0,
			behind: 0,
			changed: 0,
			conflicts: 0,
			files: [],
		});
		// With -z: paths as they are (spaces, no quotes); a rename's old path is its own entry.
		const z = parseStatus(
			[
				"# branch.head main",
				"1 A. N... 000000 100644 100644 0 a yeni dosya.md",
				"1 .D N... 100644 100644 000000 a a silinen.md",
				"2 R. N... 100644 100644 100644 a a R100 yeni ad.md",
				"eski ad.md",
				"u UU N... 100644 100644 100644 100644 a b c çakışan.md",
				"? klasör/yeni.txt",
				"",
			].join("\0"),
		);
		expect(z.files).toEqual([
			{ path: "yeni dosya.md", kind: "added" },
			{ path: "silinen.md", kind: "deleted" },
			{ path: "yeni ad.md", kind: "renamed" },
			{ path: "çakışan.md", kind: "conflict" },
			{ path: "klasör/yeni.txt", kind: "untracked" },
		]);
		expect(z.conflicts).toBe(1);
		expect(z.changed).toBe(5);
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
		expect(toGitAction({ kind: "pull", how: "rebase" })).toEqual({ kind: "pull", how: "rebase" });
		expect(toGitAction({ kind: "commit", message: "m", paths: ["a.md"] })).toEqual({
			kind: "commit",
			message: "m",
			paths: ["a.md"],
		});
		// Paths that are options or lead out of the repository never reach git.
		for (const path of ["-rf", "../x", "/etc/passwd", "C:/Windows", "a/../../b"]) {
			expect(() => toGitAction({ kind: "discard", paths: [path] })).toThrow();
		}
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

describe.skipIf(!hasGit)("git for changed files", () => {
	let base: string;

	beforeAll(async () => {
		Object.assign(process.env, {
			GIT_AUTHOR_NAME: "Kalem",
			GIT_AUTHOR_EMAIL: "kalem@example.com",
			GIT_COMMITTER_NAME: "Kalem",
			GIT_COMMITTER_EMAIL: "kalem@example.com",
		});
		base = await mkdtemp(join(tmpdir(), "kalem-git-files-"));
	});

	const repository = async (): Promise<string> => {
		const folder = await mkdtemp(join(base, "r-"));
		execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: folder });
		await writeFile(join(folder, "a.md"), "bir\niki\n");
		await writeFile(join(folder, "b.md"), "b\n");
		execFileSync("git", ["add", "."], { cwd: folder });
		execFileSync("git", ["commit", "-q", "-m", "İlk"], { cwd: folder, env: process.env });
		return folder;
	};

	it("lists what changed, shows it, and commits only the files chosen", async () => {
		const folder = await repository();
		await writeFile(join(folder, "a.md"), "bir\nüç\n");
		await writeFile(join(folder, "b.md"), "b değişti\n");
		await writeFile(join(folder, "yeni.md"), "yeni\n");
		const status = await gitStatus(folder);
		expect(status?.files).toEqual([
			{ path: "a.md", kind: "modified" },
			{ path: "b.md", kind: "modified" },
			{ path: "yeni.md", kind: "untracked" },
		]);
		expect(status?.operation).toBeNull();

		const diff = await gitDiff(folder, "a.md");
		expect(diff).toContain("-iki");
		expect(diff).toContain("+üç");
		expect(await gitDiff(folder, "yeni.md")).toContain("+yeni");

		await runGitAction(folder, {
			kind: "commit",
			message: "Yalnızca a ve yeni",
			paths: ["a.md", "yeni.md"],
		});
		expect((await gitStatus(folder))?.files).toEqual([{ path: "b.md", kind: "modified" }]);
		const shown = execFileSync("git", ["show", "--name-only", "--format=%s", "HEAD"], {
			cwd: folder,
		}).toString();
		expect(shown).toContain("Yalnızca a ve yeni");
		expect(shown).toContain("a.md");
		expect(shown).not.toContain("b.md");
	});

	it("discards changes: back to the last commit, new files to the recycle bin", async () => {
		const folder = await repository();
		await writeFile(join(folder, "a.md"), "bozuldu\n");
		await writeFile(join(folder, "yeni.md"), "yeni\n");
		const trashed: string[] = [];
		await runGitAction(folder, { kind: "discard", paths: ["a.md", "yeni.md"] }, async (path) => {
			trashed.push(path);
			await rm(path);
		});
		expect(await readFile(join(folder, "a.md"), "utf8")).toBe("bir\niki\n");
		expect(trashed).toEqual([join(folder, "yeni.md")]);
		expect((await gitStatus(folder))?.files).toEqual([]);
	});

	it("says when a merge stopped on a conflict, and aborts it", async () => {
		const folder = await repository();
		execFileSync("git", ["switch", "-q", "-c", "yan"], { cwd: folder });
		await writeFile(join(folder, "a.md"), "yan dal\n");
		execFileSync("git", ["commit", "-q", "-am", "Yan"], { cwd: folder });
		execFileSync("git", ["switch", "-q", "main"], { cwd: folder });
		await writeFile(join(folder, "a.md"), "ana dal\n");
		execFileSync("git", ["commit", "-q", "-am", "Ana"], { cwd: folder });
		try {
			execFileSync("git", ["merge", "yan"], { cwd: folder, stdio: "ignore" });
		} catch {
			// A conflict: what is tested.
		}
		const status = await gitStatus(folder);
		expect(status?.operation).toBe("merge");
		expect(status?.conflicts).toBe(1);
		expect(status?.files).toEqual([{ path: "a.md", kind: "conflict" }]);
		await runGitAction(folder, { kind: "abort" });
		const after = await gitStatus(folder);
		expect(after?.operation).toBeNull();
		expect(await readFile(join(folder, "a.md"), "utf8")).toBe("ana dal\n");
	});

	it("asks how to pull when the branches went apart, then does as told", async () => {
		const remote = join(base, `remote-${Date.now()}.git`);
		execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main", remote]);
		const mine = await repository();
		execFileSync("git", ["remote", "add", "origin", remote], { cwd: mine });
		execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd: mine, stdio: "ignore" });
		const theirs = join(base, `theirs-${Date.now()}`);
		execFileSync("git", ["clone", "-q", remote, theirs], { stdio: "ignore" });
		await writeFile(join(theirs, "b.md"), "onlar\n");
		execFileSync("git", ["commit", "-q", "-am", "Onlar"], { cwd: theirs });
		execFileSync("git", ["push", "-q"], { cwd: theirs, stdio: "ignore" });
		await writeFile(join(mine, "a.md"), "ben\n");
		execFileSync("git", ["commit", "-q", "-am", "Ben"], { cwd: mine });

		// Fetching in the background brings what is to pull.
		expect(await backgroundFetch(mine)).toBe(true);
		expect((await gitStatus(mine))?.behind).toBe(1);
		const error = await runGitAction(mine, { kind: "pull" }).catch((caught: unknown) => caught);
		// Git with a pull.rebase or pull.ff setting does not ask; without one it does.
		if (error instanceof GitError) {
			expect(error.problem).toBe("diverged");
			await runGitAction(mine, { kind: "pull", how: "rebase" });
		}
		const after = await gitStatus(mine);
		expect(after?.behind).toBe(0);
		expect(await readFile(join(mine, "b.md"), "utf8")).toBe("onlar\n");
		// A repository without a remote is not fetched.
		expect(await backgroundFetch(await repository())).toBe(false);
	});

	it("gives the assistant the changes and the recent subjects for a message", async () => {
		const folder = await repository();
		await writeFile(join(folder, "a.md"), "bir\nüç\n");
		await writeFile(join(folder, "yeni.md"), "yeni\n");
		const context = await commitContext(folder, ["a.md"]);
		expect(context).toContain("Recent commit subjects:\nİlk");
		expect(context).toContain("modified: a.md");
		expect(context).toContain("+üç");
		expect(context).not.toContain("yeni.md");
	});
});
