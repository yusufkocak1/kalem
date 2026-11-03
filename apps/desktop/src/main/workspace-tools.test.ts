import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { KeptEdit, ToolStep } from "./workspace-tools.js";
import {
	applyEdit,
	globMatcher,
	looksLikeToolText,
	Workspace,
	WorkspaceIndexes,
} from "./workspace-tools.js";

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

describe("workspace index", () => {
	it("follows Git's ignore rules in a repository, hidden tracked files included", async () => {
		const root = await folder({
			".gitignore": "generated/\n*.log\n",
			".github/workflows/ci.yml": "name: ci\n",
			"src/App.ts": "export const app = 1;\n",
			"generated/big.ts": "export const app = 2;\n",
			"debug.log": "app\n",
			"vendor/lib.ts": "export const vendored = 1;\n",
		});
		execFileSync("git", ["init", "-q"], { cwd: root });
		execFileSync("git", ["add", "src", ".gitignore", ".github"], { cwd: root });
		const workspace = new Workspace([root], new WorkspaceIndexes());
		const listed = await workspace.run("list_files", {});
		expect(listed).toContain(".github/workflows/ci.yml");
		expect(listed).toContain("src/App.ts");
		// Not ignored, only not added yet: Git shows it, so the index does.
		expect(listed).toContain("vendor/lib.ts");
		expect(listed).not.toContain("generated");
		expect(listed).not.toContain("debug.log");
		const found = await workspace.run("search", { query: "export const" });
		expect(found).toContain("src/App.ts:1");
		expect(found).not.toContain("generated");
	});

	it("searches what a file says now, not what it said when it was first read", async () => {
		const root = await folder({ "a.txt": "eski metin\n" });
		const workspace = new Workspace([root], new WorkspaceIndexes());
		expect(await workspace.run("search", { query: "metin" })).toContain("a.txt:1: eski metin");
		await writeFile(join(root, "a.txt"), "yeni metin, daha uzun\n");
		expect(await workspace.run("search", { query: "metin" })).toContain("a.txt:1: yeni metin");
		expect(await workspace.run("search", { query: "eski" })).toBe("No matches.");
	});

	it("finds the same with and without ripgrep, the Turkish way when it is not ASCII", async () => {
		const root = await folder({
			"a.md": "İstanbul ve ISPARTA\n",
			"b.md": "istanbul\n",
			"c.md": "Ankara\n",
		});
		const workspace = new Workspace([root], new WorkspaceIndexes());
		const ascii = await workspace.run("search", { query: "ISTANBUL" });
		expect(ascii).toContain("b.md:1");
		const turkish = await workspace.run("search", { query: "istanbul", regex: false });
		expect(turkish).toContain("b.md:1");
		expect(await workspace.run("search", { query: "İSTANBUL" })).toContain("a.md:1");
		expect(await workspace.run("search", { query: "an[kx]ara", regex: true })).toContain("c.md:1");
	});
});

describe("proposed edits", () => {
	it("are checked when proposed, and written only when applied", async () => {
		const root = await folder({
			"src/a.ts": "const a = 1;\r\nconst b = 2;\r\nconst b2 = 2;\r\n",
			"legacy.txt": Buffer.from([0x67, 0xfc, 0x6e, 0x0a]).toString("latin1"),
		});
		await writeFile(join(root, "legacy.txt"), Buffer.from([0x67, 0xfc, 0x6e, 0x0a]));
		const proposed: KeptEdit[] = [];
		const workspace = new Workspace([root], new WorkspaceIndexes(), (edit) => proposed.push(edit));
		const run = (input: Record<string, string>): Promise<string> =>
			workspace.run("propose_edit", input);

		expect(await run({ path: "src/a.ts", old_text: "const c", new_text: "x" })).toContain(
			"not in src/a.ts",
		);
		expect(await run({ path: "src/a.ts", old_text: "= 2;", new_text: "= 3;" })).toContain(
			"occurs 2 times",
		);
		expect(await run({ path: "legacy.txt", old_text: "g", new_text: "k" })).toContain("UTF-8");
		expect(await run({ path: "../x.ts", old_text: "", new_text: "x" })).toContain(
			"not a file of the workspace",
		);
		expect(proposed).toHaveLength(0);

		// CRLF from the model matches the file's text; the file keeps its CRLF.
		expect(
			await run({
				path: "src/a.ts",
				old_text: "const b = 2;\r\n",
				new_text: "const b = 20;\r\n",
				summary: "b büyür",
			}),
		).toContain("Proposed");
		expect(await run({ path: "src/new/b.ts", old_text: "", new_text: "export {};\n" })).toContain(
			"Proposed",
		);
		expect(proposed.map((edit) => [edit.path, edit.summary])).toEqual([
			["src/a.ts", "b büyür"],
			["src/new/b.ts", ""],
		]);
		expect(await readFile(join(root, "src/a.ts"), "utf8")).toContain("const b = 2;");

		await applyEdit(proposed[0] as KeptEdit);
		await applyEdit(proposed[1] as KeptEdit);
		expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe(
			"const a = 1;\r\nconst b = 20;\r\nconst b2 = 2;\r\n",
		);
		expect(await readFile(join(root, "src/new/b.ts"), "utf8")).toBe("export {};\n");
		// Applied twice, or after the file changed: it no longer fits.
		await expect(applyEdit(proposed[0] as KeptEdit)).rejects.toThrow("not in src/a.ts");
		await expect(applyEdit(proposed[1] as KeptEdit)).rejects.toThrow("already exists");
	});

	it("are refused when the chat takes none", async () => {
		const root = await folder({ "a.md": "a\n" });
		const workspace = new Workspace([root], new WorkspaceIndexes());
		expect(
			await workspace.run("propose_edit", { path: "a.md", old_text: "a", new_text: "b" }),
		).toContain("no tool");
	});
});

describe("tool calls written as text", () => {
	it("are told apart from answers that show code", () => {
		expect(looksLikeToolText('{"name": "search", "arguments": {"query": "x"}}')).toBe(true);
		expect(looksLikeToolText("<tool_call>\n{...}\n</tool_call>")).toBe(true);
		expect(looksLikeToolText('read_file({"path": "a.ts"})')).toBe(true);
		expect(looksLikeToolText("Main sınıfı boş.")).toBe(false);
		expect(
			looksLikeToolText("Şöyle çağırın:\n```js\nsearch(query)\nconst x = 1;\n```\nBitti."),
		).toBe(false);
	});
});
