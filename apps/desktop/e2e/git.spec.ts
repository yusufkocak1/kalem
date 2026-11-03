import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { launch, tempDir } from "./launch.js";

const IDENTITY = {
	GIT_AUTHOR_NAME: "Kalem",
	GIT_AUTHOR_EMAIL: "kalem@example.com",
	GIT_COMMITTER_NAME: "Kalem",
	GIT_COMMITTER_EMAIL: "kalem@example.com",
};

const git = (cwd: string, ...args: string[]): string =>
	execFileSync("git", args, { cwd, env: { ...process.env, ...IDENTITY } })
		.toString()
		.trim();

test("knows a folder with .git, commits, pushes, branches and clones", async () => {
	const base = await tempDir("git");
	const remote = join(base, "remote.git");
	git(base, "init", "--bare", "--initial-branch=main", remote);
	git(base, "clone", remote, "work");
	const work = join(base, "work");
	const doc = join(work, "notes.md");
	await writeFile(doc, "# Notes\n");
	git(work, "add", "--all");
	git(work, "commit", "-m", "First");
	git(work, "push", "-u", "origin", "main");

	const { app, page, errors } = await launch({ args: [doc], env: IDENTITY });
	await page.locator('.side-pane-tab[data-pane="files"]').click();
	const bar = page.locator(".files-git");
	// The folder is a repository: its branch is shown without being asked.
	await expect(bar.locator(".files-git-name")).toHaveText("main");
	await expect(bar.locator(".files-git-state")).toHaveText("origin/main · Up to date");

	// Commit everything that changed.
	await writeFile(join(work, "more.md"), "More\n");
	await page.locator(".files-toolbar").hover();
	await page.locator(".files-toolbar").getByRole("button", { name: "Refresh" }).click();
	await expect(bar.locator(".files-git-state")).toContainText("1 changed");
	await bar.locator(".files-git-more").click();
	await page.locator(".files-menu-item", { hasText: "Commit All Changes…" }).click();
	const form = page.locator(".git-dialog[open] .git-form");
	await form.locator("textarea").fill("More notes");
	await form.locator("button[type=submit]").click();
	await expect(bar.locator(".files-git-state")).toContainText("1 to push");
	expect(git(work, "log", "-1", "--format=%s")).toBe("More notes");

	await bar.getByRole("button", { name: "Push" }).click();
	await expect(bar.locator(".files-git-state")).toHaveText("origin/main · Up to date");
	expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("More notes");

	// A new branch, then back to main from the list.
	await bar.locator(".files-git-more").click();
	await page.locator(".files-menu-item", { hasText: "New Branch…" }).click();
	await form.locator("input").fill("draft");
	await form.locator("button[type=submit]").click();
	await expect(bar.locator(".files-git-name")).toHaveText("draft");
	await bar.locator(".files-git-branch").click();
	const branches = page.locator(".git-branches[open] .git-branch");
	await expect(branches.locator(".quick-open-name")).toHaveText(["draft", "main"]);
	await page.locator(".git-branches[open] .quick-open-input").fill("ma");
	await page.keyboard.press("Enter");
	await expect(bar.locator(".files-git-name")).toHaveText("main");
	await page.screenshot({ path: "test-results/git-bar.png" });

	// Someone else pushes: pull brings it in.
	git(base, "clone", remote, "other");
	await writeFile(join(base, "other", "theirs.md"), "Theirs\n");
	git(join(base, "other"), "add", "--all");
	git(join(base, "other"), "commit", "-m", "Theirs");
	git(join(base, "other"), "push");
	await bar.getByRole("button", { name: "Fetch" }).click();
	await expect(bar.locator(".files-git-state")).toContainText("1 to pull");
	await bar.getByRole("button", { name: "Pull" }).click();
	await expect(page.locator(".files-item", { hasText: "theirs.md" })).toBeVisible();

	// Clone: the folder it goes in is asked for, then it opens next to the others.
	const target = await tempDir("git-clone");
	await app.evaluate(({ dialog }, folder) => {
		dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never;
	}, target);
	await page.locator(".files-toolbar").hover();
	await page.getByRole("button", { name: "Clone Git Repository…" }).click();
	const clone = page.locator(".git-dialog[open] .git-form");
	await clone.locator("input").fill("not a url");
	await clone.locator("button[type=submit]").click();
	// The box stays, saying what is wrong.
	await expect(clone.locator(".git-error")).toHaveText("“not a url” is not a repository URL.");
	await clone.locator("input").fill(pathToFileURL(remote).href);
	await clone.locator("button[type=submit]").click();
	// The opened folder takes the place of the document's folder.
	await expect(page.locator(".files-title")).toHaveText("remote");
	await expect(bar.locator(".files-git-name")).toHaveText("main");
	expect(git(join(target, "remote"), "log", "-1", "--format=%s")).toBe("Theirs");

	expect(errors).toEqual([]);
	await app.close();
});
