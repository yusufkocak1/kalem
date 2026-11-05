import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { fakeClaude } from "./fake-claude.js";
import { clickMenu, launch, showPane, tempDir } from "./launch.js";

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
	await showPane(page, "files");
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
	await page.locator(".files-menu-item", { hasText: "Commit Changes…" }).click();
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

test("marks changed files, compares them, commits only some and discards others", async () => {
	const base = await tempDir("git-files");
	const work = join(base, "work");
	git(base, "init", "--initial-branch=main", "work");
	await mkdir(join(work, "docs"), { recursive: true });
	await writeFile(join(work, "notes.md"), "# Notes\nbir\n");
	await writeFile(join(work, "docs", "plan.md"), "# Plan\n");
	git(work, "add", "--all");
	git(work, "commit", "-m", "First");

	const { app, page, errors } = await launch({
		env: { ...IDENTITY, KALEM_CLAUDE: join(base, "nothing-here") },
	});
	await app.evaluate(({ dialog }, folder) => {
		dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never;
		// "Discard" in the confirmation.
		dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
	}, work);
	await clickMenu(app, "File", "Open Folder…");
	const bar = page.locator(".files-git");
	await expect(bar.locator(".files-git-name")).toHaveText("main");
	const row = (name: string) => page.locator(".files-item", { hasText: name });

	// Changes made elsewhere show on their own: a letter on the file, a dot on its folder.
	await writeFile(join(work, "notes.md"), "# Notes\niki\n");
	await writeFile(join(work, "docs", "new.md"), "yeni\n");
	await expect(row("notes.md").locator(".files-git-badge")).toHaveText("M");
	await expect(row("docs")).toHaveClass(/git-dirty/);
	await expect(bar.locator(".files-git-state")).toContainText("2 changed");
	await row("docs").click();
	await expect(row("new.md").locator(".files-git-badge")).toHaveText("U");

	// Compared with the last commit.
	await row("notes.md").click({ button: "right" });
	await page.locator(".files-menu-item", { hasText: "Compare with Last Commit" }).click();
	const diff = page.locator(".git-diff-dialog[open]");
	await expect(diff.locator(".git-diff-line.remove")).toContainText(["-bir"]);
	await expect(diff.locator(".git-diff-line.add")).toContainText(["+iki"]);
	await diff.getByRole("button", { name: "Close" }).click();

	// Committing only the new file; the message cannot be suggested without an assistant.
	await bar.locator(".files-git-more").click();
	await page.locator(".files-menu-item", { hasText: "Commit Changes…" }).click();
	const commit = page.locator(".git-commit[open]");
	await expect(commit.locator(".git-file-path")).toHaveText(["notes.md", "docs/new.md"]);
	await commit.getByRole("button", { name: "✨ Suggest" }).click();
	await expect(commit.locator(".git-error")).toContainText("No message could be suggested");
	await commit.getByRole("checkbox", { name: /notes\.md/ }).uncheck();
	await commit.locator("textarea").fill("Add the new page");
	await commit.getByRole("button", { name: "Commit", exact: true }).click();
	await expect(bar.locator(".files-git-state")).toContainText("1 changed");
	expect(git(work, "show", "--name-only", "--format=%s", "HEAD")).toBe(
		"Add the new page\n\ndocs/new.md",
	);
	await expect(row("new.md").locator(".files-git-badge")).toHaveCount(0);

	// Discarded: back to the last commit.
	await row("notes.md").click({ button: "right" });
	await page.locator(".files-menu-item", { hasText: "Discard Changes…" }).click();
	await expect(row("notes.md").locator(".files-git-badge")).toHaveCount(0);
	expect(await readFile(join(work, "notes.md"), "utf8")).toBe("# Notes\nbir\n");

	// A branch switched in a terminal shows without a refresh.
	git(work, "switch", "-c", "terminal");
	await expect(bar.locator(".files-git-name")).toHaveText("terminal");
	await page.screenshot({ path: "test-results/git-files.png" });

	expect(errors).toEqual([]);
	await app.close();
});

test("lets the assistant write the commit message from the chosen files' changes", async () => {
	const base = await tempDir("git-suggest");
	const work = join(base, "work");
	git(base, "init", "--initial-branch=main", "work");
	await writeFile(join(work, "notes.md"), "bir\n");
	git(work, "add", "--all");
	git(work, "commit", "-m", "docs: add the notes");
	const claude = await fakeClaude(base, "```\ndocs: say iki instead of bir\n```");
	const { app, page, errors } = await launch({
		env: { ...IDENTITY, KALEM_CLAUDE: claude.path },
	});
	await app.evaluate(({ dialog }, folder) => {
		dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never;
	}, work);
	await clickMenu(app, "File", "Open Folder…");
	const bar = page.locator(".files-git");
	await writeFile(join(work, "notes.md"), "iki\n");
	await expect(bar.locator(".files-git-state")).toContainText("1 changed");
	await bar.locator(".files-git-more").click();
	await page.locator(".files-menu-item", { hasText: "Commit Changes…" }).click();
	const commit = page.locator(".git-commit[open]");
	await commit.getByRole("button", { name: "✨ Suggest" }).click();
	await expect(commit.locator("textarea")).toHaveValue("docs: say iki instead of bir");
	const [call] = await claude.calls();
	// It was given the diff and the style of the last commits, and nothing to resume.
	expect(call?.prompt).toContain("+iki");
	expect(call?.prompt).toContain("Recent commit subjects:\ndocs: add the notes");
	expect(call?.args).not.toContain("--resume");
	await commit.getByRole("button", { name: "Commit", exact: true }).click();
	await expect
		.poll(() => git(work, "log", "-1", "--format=%s"))
		.toBe("docs: say iki instead of bir");
	expect(errors).toEqual([]);
	await app.close();
});
