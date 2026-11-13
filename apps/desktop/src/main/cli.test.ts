import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalCli, SearchLog, shimTarget, textOutput } from "./cli.js";
import type { Host } from "./cli-find.js";
import { localHost } from "./cli-find.js";

describe("the reply of a CLI", () => {
	it("passes plain text on as the reply", () => {
		const output = textOutput();
		expect(output.answered).toBe(false);
		expect(output.push("")).toEqual([]);
		expect(output.push("Merhaba")).toEqual([{ kind: "text", text: "Merhaba" }]);
		expect(output.answered).toBe(true);
		expect(output.finished).toBe(false);
	});
});

describe("what an npm link starts", () => {
	const npm = "C:\\Users\\a\\AppData\\Roaming\\npm";
	const head = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start"];

	it("finds the script, which Node runs", () => {
		const shim = [
			...head,
			"SETLOCAL",
			"CALL :find_dp0",
			"",
			'IF EXIST "%dp0%\\node.exe" (',
			'  SET "_prog=%dp0%\\node.exe"',
			") ELSE (",
			'  SET "_prog=node"',
			")",
			'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*',
		].join("\r\n");
		expect(shimTarget(`${npm}\\copilot.cmd`, shim)).toBe(
			`${npm}\\node_modules\\@github\\copilot\\npm-loader.js`,
		);
		// Older npm wrote the line without what comes before the program.
		expect(
			shimTarget(
				`${npm}\\claude.cmd`,
				'"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
			),
		).toBe(`${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`);
	});

	it("finds the program itself, as Claude Code's package is installed now", () => {
		const shim = [
			...head,
			"SETLOCAL",
			"CALL :find_dp0",
			'"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
		].join("\r\n");
		expect(shimTarget(`${npm}\\claude.cmd`, shim)).toBe(
			`${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
		);
	});

	it("reads pnpm's and Yarn's way of naming the link's folder", () => {
		const shim = [
			"@SETLOCAL",
			'@IF EXIST "%~dp0\\node.exe" (',
			'  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\@github\\copilot\\npm-loader.js" %*',
			") ELSE (",
			'  node  "%~dp0\\global\\5\\node_modules\\@github\\copilot\\npm-loader.js" %*',
			")",
		].join("\r\n");
		expect(shimTarget("C:\\Users\\a\\AppData\\Local\\pnpm\\copilot.cmd", shim)).toBe(
			"C:\\Users\\a\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@github\\copilot\\npm-loader.js",
		);
		expect(shimTarget("D:\\bin\\claude.cmd", '@"%~dp0\\..\\lib\\claude.exe" %*')).toBe(
			"D:\\lib\\claude.exe",
		);
	});

	it("leaves a link it cannot read alone", () => {
		expect(shimTarget("C:\\x\\claude.cmd", "@echo off\r\nclaude.exe %*")).toBeNull();
		// Only the Node next to the link: there is nothing for it to run.
		expect(shimTarget("C:\\x\\claude.cmd", '"%dp0%\\node.exe" %*')).toBeNull();
	});
});

/** A program that answers `--version`, and writes down that it was started. */
async function program(path: string, version = "1.2.3 (Claude Code)"): Promise<string> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `#!/bin/sh\necho started >> "${path}.log"\necho "${version}"\n`);
	await chmod(path, 0o755);
	return path;
}

const started = (path: string): Promise<boolean> =>
	readFile(`${path}.log`, "utf8").then(
		() => true,
		() => false,
	);

// The programs here are shell scripts; the Windows side is tested on a made-up computer.
describe.skipIf(process.platform === "win32")("finding a CLI on this computer", () => {
	const folders: string[] = [];
	afterAll(async () => {
		for (const folder of folders) await rm(folder, { recursive: true, force: true });
	});

	/** A computer that is this one, but only knows the files under a new folder. */
	async function sandbox(env: Record<string, string> = {}): Promise<{ root: string; host: Host }> {
		const root = await mkdtemp(join(tmpdir(), "kalem-cli-"));
		folders.push(root);
		const real = localHost();
		const inside = (path: string): boolean => path.startsWith(`${root}/`) || path === root;
		const host: Host = {
			...real,
			home: join(root, "home"),
			env: { PATH: join(root, "bin"), ...env },
			isFile: async (path) => inside(path) && (await real.isFile(path)),
			list: async (path) => (inside(path) ? real.list(path) : []),
			read: async (path) => (inside(path) ? real.read(path) : null),
			run: async () => null,
		};
		return { root, host };
	}

	it("finds the program on PATH", async () => {
		const { root, host } = await sandbox();
		const path = await program(join(root, "bin", "claude"));
		const cli = new LocalCli("claude", { configured: () => "", host });
		expect(await cli.locate()).toEqual({ found: true, path, version: "1.2.3 (Claude Code)" });
		expect(cli.launch).toEqual({ command: path, prefix: [], path });
	});

	it("looks only at an override", async () => {
		const { root, host } = await sandbox({ KALEM_COPILOT: "/nothing/here" });
		await program(join(root, "bin", "copilot"));
		const cli = new LocalCli("copilot", { configured: () => "", host });
		expect(await cli.locate()).toEqual({ found: false });
	});

	it("uses the program built for this computer where npm left a note in the package's place", async () => {
		const { root, host } = await sandbox();
		const modules = join(root, "home", ".npm-global", "lib", "node_modules");
		const pkg = join(modules, "@anthropic-ai", "claude-code");
		await mkdir(join(pkg, "bin"), { recursive: true });
		await writeFile(
			join(pkg, "package.json"),
			JSON.stringify({ bin: { claude: "bin/claude.exe" } }),
		);
		// As the package is published: the install's script, which did not run, would have replaced it.
		await writeFile(join(pkg, "bin", "claude.exe"), 'echo "not installed" >&2\nexit 1\n');
		await chmod(join(pkg, "bin", "claude.exe"), 0o755);
		await mkdir(join(root, "home", ".npm-global", "bin"), { recursive: true });
		await symlink(
			join(pkg, "bin", "claude.exe"),
			join(root, "home", ".npm-global", "bin", "claude"),
		);
		const system = process.platform === "darwin" ? "darwin" : "linux";
		const native = await program(
			join(modules, "@anthropic-ai", `claude-code-${system}-${process.arch}`, "claude"),
			"2.1.322 (Claude Code)",
		);
		const cli = new LocalCli("claude", { configured: () => "", host });
		expect(await cli.locate()).toEqual({
			found: true,
			path: native,
			version: "2.1.322 (Claude Code)",
		});
		// What did not answer is in the report, for whoever has to find out why.
		expect(cli.report()).toContain(`${join(root, "home", ".npm-global", "bin", "claude")} → `);
		expect(cli.report()).toContain(`npm: ${native} → 2.1.322 (Claude Code)`);
	});

	it("runs a package's script with Node", async () => {
		const { root, host } = await sandbox();
		const pkg = join(root, "home", ".npm-global", "lib", "node_modules", "@github", "copilot");
		await mkdir(pkg, { recursive: true });
		await writeFile(join(pkg, "package.json"), JSON.stringify({ bin: { copilot: "index.js" } }));
		await writeFile(join(pkg, "index.js"), 'console.log("0.0.400");\n');
		const cli = new LocalCli("copilot", { configured: () => "", host });
		expect(await cli.locate()).toEqual({
			found: true,
			path: join(pkg, "index.js"),
			version: "0.0.400",
		});
		expect(cli.launch?.prefix).toEqual([join(pkg, "index.js")]);
	});

	it("finds the copy an editor's extension brings", async () => {
		const { root, host } = await sandbox();
		const path = await program(
			join(
				root,
				"home",
				".vscode",
				"extensions",
				"anthropic.claude-code-2.1.322-linux-x64",
				"resources",
				"native-binary",
				"claude",
			),
		);
		const cli = new LocalCli("claude", { configured: () => "", host });
		expect(await cli.locate()).toMatchObject({ found: true, path });
	});

	it("does not start a desktop app of the same name", async () => {
		const { root, host } = await sandbox();
		const path = await program(join(root, "bin", "claude"));
		await writeFile(join(root, "bin", "resources.pak"), "");
		const cli = new LocalCli("claude", { configured: () => "", host });
		expect(await cli.locate()).toEqual({ found: false });
		expect(await started(path)).toBe(false);
		expect(cli.report()).toContain("a desktop app");
	});

	it("offers what going through folders finds, and starts it only when the user picks it", async () => {
		const { root, host } = await sandbox();
		const path = await program(join(root, "home", "tools", "portable", "claude"));
		const kept: string[] = [];
		const searches = new SearchLog(join(root, "search.json"));
		const cli = new LocalCli("claude", {
			configured: () => "",
			remember: (found) => kept.push(found),
			searches,
			host,
		});
		// Not looked for folder by folder unasked (outside Windows, never).
		expect(await cli.locate()).toEqual({ found: false });
		expect(cli.offered()).toEqual([]);

		expect(await cli.search()).toEqual({ found: false });
		expect(cli.offered()).toEqual([path]);
		// A file of that name in some folder may be anything: it was not started.
		expect(await started(path)).toBe(false);
		expect(await searches.found("claude")).toEqual([path]);

		// The page cannot make the app start a file the search did not offer.
		expect(await cli.use(join(root, "bin", "other"))).toBe(false);
		expect(await cli.use(path)).toBe(true);
		expect(await started(path)).toBe(true);
		expect(cli.status()).toMatchObject({ found: true, path });
		expect(cli.offered()).toEqual([]);
		expect(kept).toEqual([path]);
	});

	it("offers one installation once, and tries its other files when the first does not start", async () => {
		const { root, host } = await sandbox();
		const prefix = join(root, "home", "tools", "node-v22");
		const pkg = join(prefix, "node_modules", "@anthropic-ai", "claude-code");
		await mkdir(join(pkg, "bin"), { recursive: true });
		await writeFile(
			join(pkg, "package.json"),
			JSON.stringify({ bin: { claude: "bin/claude.exe" } }),
		);
		await writeFile(join(pkg, "bin", "claude.exe"), "exit 1\n");
		// The folder holds a broken link too.
		await writeFile(join(prefix, "claude"), "exit 1\n");
		const system = process.platform === "darwin" ? "darwin" : "linux";
		const native = await program(
			join(
				prefix,
				"node_modules",
				"@anthropic-ai",
				`claude-code-${system}-${process.arch}`,
				"claude",
			),
		);
		const cli = new LocalCli("claude", { configured: () => "", host });
		await cli.search();
		expect(cli.offered()).toEqual([join(prefix, "claude")]);
		expect(await cli.use(join(prefix, "claude"))).toBe(true);
		expect(cli.status()).toMatchObject({ found: true, path: native });
	});

	it("takes a folder the user gives for the program in it", async () => {
		const { root, host } = await sandbox();
		const path = await program(join(root, "elsewhere", "copilot"));
		const cli = new LocalCli("copilot", { configured: () => "", host });
		expect(await cli.check(join(root, "nowhere"))).toBe(false);
		expect(await cli.check(join(root, "elsewhere"))).toBe(true);
		expect(cli.status()).toMatchObject({ found: true, path });
	});

	it("tries the program kept from before first", async () => {
		const { root, host } = await sandbox();
		await program(join(root, "bin", "claude"), "1.0.0");
		const kept = await program(join(root, "kept", "claude"), "2.0.0");
		const cli = new LocalCli("claude", { configured: () => kept, host });
		expect(await cli.locate()).toMatchObject({ path: kept, version: "2.0.0" });
		// Gone since: the search goes on as if nothing had been kept.
		await rm(kept);
		expect(await cli.locate()).toMatchObject({ path: join(root, "bin", "claude") });
	});
});

describe("when the folders were last gone through", () => {
	it("is due at first, then again after a week", async () => {
		const folder = await mkdtemp(join(tmpdir(), "kalem-search-"));
		let now = 1_000_000;
		const log = new SearchLog(join(folder, "deep", "search.json"), () => now);
		expect(await log.due("claude")).toBe(true);
		await log.note("claude", ["/x/claude"]);
		expect(await log.due("claude")).toBe(false);
		// Each program has its own time.
		expect(await log.due("copilot")).toBe(true);
		expect(await log.found("claude")).toEqual(["/x/claude"]);
		now += 6 * 24 * 60 * 60 * 1000;
		expect(await log.due("claude")).toBe(false);
		now += 2 * 24 * 60 * 60 * 1000;
		expect(await log.due("claude")).toBe(true);
		// A clock set back does not put it off for ever.
		now = 5;
		expect(await log.due("claude")).toBe(true);
		await writeFile(join(folder, "deep", "search.json"), "not json");
		expect(await log.due("claude")).toBe(true);
		expect(await log.found("claude")).toEqual([]);
		await rm(folder, { recursive: true, force: true });
	});
});
