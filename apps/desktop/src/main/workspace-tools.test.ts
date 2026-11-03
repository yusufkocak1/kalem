import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolStep } from "./workspace-tools.js";
import { globMatcher, Workspace, WorkspaceIndexes } from "./workspace-tools.js";

async function folder(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kalem-ws-"));
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), text);
	}
	return root;
}

describe("glob patterns", () => {
	it("matches names anywhere and paths from the top", () => {
		expect(globMatcher("*.java")("src/a/User.java")).toBe(true);
		expect(globMatcher("**/*.java")("User.java")).toBe(true);
		expect(globMatcher("src/**/User*")("src/a/b/UserService.ts")).toBe(true);
		expect(globMatcher("src/*.ts")("src/a/b.ts")).toBe(false);
		expect(globMatcher("README.md")("docs/readme.md")).toBe(true);
	});
});

describe("workspace tools", () => {
	let root: string;
	let workspace: Workspace;

	beforeAll(async () => {
		root = await folder({
			"README.md": "# Proje\nKurulum anlatılır.\n",
			"src/app/UserService.java": [
				"package app;",
				"",
				"class UserService {",
				"\tUser find(String id) { return repo.byId(id); }",
				"}",
				"",
			].join("\n"),
			"src/app/Order.java": "class Order { İşlem islem; }\n",
			"src/long.txt": Array.from({ length: 1000 }, (_, i) => `satır ${i + 1}`).join("\n"),
			"node_modules/lib/index.js": "class UserService {}",
			".git/config": "UserService",
		});
		workspace = new Workspace([root], new WorkspaceIndexes());
	});

	it("tells what the folder holds without its files' text", async () => {
		const overview = await workspace.overview();
		expect(overview).toContain("4 files");
		expect(overview).toContain("src/ (3)");
		expect(overview).toContain("README.md");
		expect(overview).not.toContain("Kurulum");
	});

	it("lists files, narrowed by folder and pattern, without build or hidden folders", async () => {
		const all = await workspace.run("list_files", {});
		expect(all).toContain("src/app/UserService.java");
		expect(all).not.toContain("node_modules");
		expect(all).not.toContain(".git");
		expect(await workspace.run("list_files", { pattern: "*.java" })).not.toContain("README");
		expect(await workspace.run("list_files", { folder: "src/app" })).not.toContain("long.txt");
		expect(await workspace.run("list_files", { folder: "../.." })).toContain("not a folder");
	});

	it("searches lines, case folded the Turkish way too", async () => {
		const steps: ToolStep[] = [];
		const found = await workspace.run("search", { query: "userservice" }, (step) =>
			steps.push(step),
		);
		expect(found).toContain("src/app/UserService.java:3: class UserService {");
		expect(found).not.toContain("node_modules");
		expect(steps).toEqual([{ tool: "search", detail: "userservice" }]);
		expect(await workspace.run("search", { query: "işlem" })).toContain("Order.java:1");
		expect(await workspace.run("search", { query: "find\\(\\w+", regex: true })).toContain(
			"UserService.java:4",
		);
		expect(await workspace.run("search", { query: "class", pattern: "Order*" })).toContain(
			"1 matches in 1 files",
		);
		expect(await workspace.run("search", { query: "(", regex: true })).toContain(
			"Not a regular expression",
		);
	});

	it("reads a file, or the lines asked for, with line numbers", async () => {
		const head = await workspace.run("read_file", { path: "src/long.txt" });
		expect(head).toContain("(lines 1-400 of 1000)");
		expect(head).toContain("lines 401-1000 not shown");
		const part = await workspace.run("read_file", {
			path: "./src/long.txt",
			start_line: 500,
			end_line: 502,
		});
		expect(part).toContain("500  satır 500\n501  satır 501\n502  satır 502");
		expect(await workspace.run("read_file", { path: join(root, "README.md") })).toContain(
			"1  # Proje",
		);
	});

	it("reads nothing outside the workspace", async () => {
		const outside = await folder({ "secret.txt": "gizli" });
		await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
		for (const path of ["../secret.txt", join(outside, "secret.txt"), "link.txt", "/etc/passwd"]) {
			const read = await workspace.run("read_file", { path });
			expect(read).not.toContain("gizli");
			expect(read).toContain("not a file of the workspace");
		}
		expect(await workspace.run("delete_file", { path: "README.md" })).toContain("no tool");
	});

	it("names files from their folder's name when there are several", async () => {
		const other = await folder({ "notes.md": "UserService notları" });
		const both = new Workspace([root, other], new WorkspaceIndexes());
		const name = other.split(/[\\/]/).at(-1) as string;
		expect(await both.run("search", { query: "UserService notları" })).toContain(
			`${name}/notes.md:1`,
		);
		expect(await both.run("read_file", { path: `${name}/notes.md` })).toContain("notları");
	});
});
