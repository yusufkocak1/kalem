import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliProgram, Entry, Host, Place } from "./cli-find.js";
import {
	Budget,
	cliCandidates,
	fromCodes,
	isAppFolder,
	nativePackages,
	newestFirst,
	npmGlobalBin,
	npmGlobalRoot,
	npmrcPrefix,
	ownRoots,
	packageBin,
	packagePrograms,
	places,
	placesNear,
	registryEnvironment,
	registryValues,
	scan,
	sharedRoots,
	walk,
} from "./cli-find.js";

/** A computer made of the files named: their folders are the ones on their paths. */
function computer(
	platform: NodeJS.Platform,
	files: Readonly<Record<string, string>>,
	more: Partial<Host> = {},
): Host {
	const paths = platform === "win32" ? win32 : posix;
	const clean = (path: string): string => {
		const normal = paths.normalize(path);
		return normal === paths.parse(normal).root ? normal : normal.replace(/[\\/]+$/, "");
	};
	// kalem-locale-ok: a made-up file system that compares names as Windows does
	const key = (path: string): string =>
		platform === "win32" ? clean(path).toLowerCase() : clean(path);
	const texts = new Map(Object.entries(files).map(([path, text]) => [key(path), text]));
	const folders = new Map<string, Map<string, Entry>>();
	for (const path of Object.keys(files)) {
		let child = clean(path);
		let file = true;
		for (;;) {
			const dir = paths.dirname(child);
			if (dir === child) break;
			const entries = folders.get(key(dir)) ?? new Map<string, Entry>();
			folders.set(key(dir), entries);
			const name = paths.basename(child);
			if (!entries.has(name)) entries.set(name, { name, directory: !file, file, link: false });
			child = dir;
			file = false;
		}
	}
	return {
		platform,
		arch: "x64",
		env: {},
		home: platform === "win32" ? "C:\\Users\\a" : "/home/a",
		isFile: async (path) => texts.has(key(path)),
		list: async (path) => [...(folders.get(key(path))?.values() ?? [])],
		read: async (path) => texts.get(key(path)) ?? null,
		run: async () => null,
		...more,
	};
}

/** The places that hold a file, in the order they would be tried. */
async function found(program: CliProgram, host: Host): Promise<Place[]> {
	const existing: Place[] = [];
	for await (const place of places(program, host)) {
		if (await host.isFile(place.path)) existing.push(place);
	}
	return existing;
}

async function all(paths: AsyncIterable<string>): Promise<string[]> {
	const list: string[] = [];
	for await (const path of paths) list.push(path);
	return list;
}

const WINDOWS_ENV = {
	Path: "C:\\Windows\\System32",
	APPDATA: "C:\\Users\\a\\AppData\\Roaming",
	LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
	USERPROFILE: "C:\\Users\\a",
	ProgramFiles: "C:\\Program Files",
	ProgramData: "C:\\ProgramData",
	SystemRoot: "C:\\Windows",
	SystemDrive: "C:",
};

describe("the folders a CLI is looked for in", () => {
	it("tries PATH, then the installers' folders", () => {
		const paths = cliCandidates("claude", "darwin", { PATH: "/usr/bin:/opt/tools" }, "/Users/a");
		expect(paths[0]).toBe("/usr/bin/claude");
		expect(paths.indexOf("/opt/tools/claude")).toBeLessThan(
			paths.indexOf("/Users/a/.local/bin/claude"),
		);
		expect(paths).toContain("/Users/a/.claude/local/claude");
		expect(paths).toContain("/opt/homebrew/bin/claude");
		// Each place once.
		expect(paths.filter((path) => path === "/usr/bin/claude")).toHaveLength(1);
	});

	it("only tries an override", () => {
		expect(
			cliCandidates("claude", "linux", { PATH: "/usr/bin", KALEM_CLAUDE: "/x/claude" }, "/h"),
		).toEqual(["/x/claude"]);
	});

	it("looks for the program and the npm link on Windows", () => {
		const paths = cliCandidates(
			"claude",
			"win32",
			{ Path: "C:\\Tools;C:\\Node", APPDATA: "C:\\Users\\a\\AppData\\Roaming" },
			"C:\\Users\\a",
		);
		expect(paths.slice(0, 2)).toEqual(["C:\\Tools\\claude.exe", "C:\\Tools\\claude.cmd"]);
		expect(paths).toContain("C:\\Users\\a\\.local\\bin\\claude.exe");
		expect(paths).toContain("C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd");
	});

	it("looks for Copilot where its installers put it", () => {
		const paths = cliCandidates("copilot", "win32", { Path: "", LOCALAPPDATA: "C:\\L" }, "C:\\U");
		expect(paths).toContain("C:\\L\\Microsoft\\WinGet\\Links\\copilot.exe");
		expect(paths).toContain("C:\\U\\.local\\bin\\copilot.exe");
		expect(cliCandidates("copilot", "linux", { KALEM_COPILOT: "/x/copilot" }, "/h")).toEqual([
			"/x/copilot",
		]);
		expect(
			cliCandidates("copilot", "linux", { KALEM_CLAUDE: "/x/claude", PATH: "/bin" }, "/h")[0],
		).toBe("/bin/copilot");
	});

	it("reads Windows' variables whatever their case, and a second home on a network drive", () => {
		const paths = cliCandidates(
			"claude",
			"win32",
			{
				PATH: '"C:\\Program Files\\Tools";relative',
				homedrive: "H:",
				HOMEPATH: "\\",
				pnpm_home: "D:\\pnpm",
			},
			"C:\\Users\\a",
		);
		expect(paths[0]).toBe("C:\\Program Files\\Tools\\claude.exe");
		// A folder that is not a full path is not one to start programs from.
		expect(paths.some((path) => path.startsWith("relative"))).toBe(false);
		expect(paths).toContain("H:\\.local\\bin\\claude.exe");
		expect(paths).toContain("D:\\pnpm\\claude.cmd");
	});

	it("finds npm's link folder from `npm root -g`", () => {
		expect(npmGlobalBin("/Users/a/.nvm/versions/node/v22.1.0/lib/node_modules", "darwin")).toBe(
			"/Users/a/.nvm/versions/node/v22.1.0/bin",
		);
		expect(npmGlobalBin("/usr/local/lib/node_modules/", "linux")).toBe("/usr/local/bin");
		expect(npmGlobalBin("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules", "win32")).toBe(
			"C:\\Users\\a\\AppData\\Roaming\\npm",
		);
	});

	it("reads the script a package runs", () => {
		expect(packageBin({ bin: { claude: "cli.js" } }, "claude")).toBe("cli.js");
		expect(packageBin({ bin: "npm-loader.js" }, "copilot")).toBe("npm-loader.js");
		expect(packageBin({ bin: { other: "x.js" } }, "claude")).toBeNull();
		expect(packageBin(null, "claude")).toBeNull();
	});

	it("reads where an npm configuration sends global packages", () => {
		const env = { APPDATA: "C:\\Users\\a\\AppData\\Roaming" };
		expect(npmrcPrefix("; a note\nprefix=D:\\npm-global\n", env, "C:\\Users\\a", "win32")).toBe(
			"D:\\npm-global",
		);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: npm's own way of naming a variable
		expect(npmrcPrefix('prefix = "${APPDATA}\\npm"', env, "C:\\Users\\a", "win32")).toBe(
			"C:\\Users\\a\\AppData\\Roaming\\npm",
		);
		expect(npmrcPrefix("registry=https://x/\nprefix=~/.npm-global", {}, "/home/a", "linux")).toBe(
			"/home/a/.npm-global",
		);
		expect(npmrcPrefix("#prefix=/no\nregistry=https://x/", {}, "/home/a", "linux")).toBeNull();
	});

	it("orders versions newest first", () => {
		const names = ["v9.11.2", "v22.1.0", "v22.11.0", "v18.20.4"];
		expect(names.sort(newestFirst)).toEqual(["v22.11.0", "v22.1.0", "v18.20.4", "v9.11.2"]);
	});

	it("names the package built for the computer, its own processor first", () => {
		expect(nativePackages("claude", "win32", "arm64")).toEqual([
			"@anthropic-ai/claude-code-win32-arm64",
			"@anthropic-ai/claude-code-win32-x64",
		]);
		expect(nativePackages("copilot", "linux", "x64")).toContain("@github/copilot-linuxmusl-x64");
		expect(nativePackages("claude", "linux", "x64")).toContain(
			"@anthropic-ai/claude-code-linux-x64-musl",
		);
	});
});

describe("a CLI installed with npm on Windows", () => {
	const npm = "C:\\Users\\a\\AppData\\Roaming\\npm";

	it("is found as its own program where npm's link is missing", async () => {
		const host = computer(
			"win32",
			{
				[`${npm}\\node_modules\\@anthropic-ai\\claude-code\\package.json`]: JSON.stringify({
					bin: { claude: "bin/claude.exe" },
				}),
				[`${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`]: "",
				[`${npm}\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe`]: "",
			},
			{ env: WINDOWS_ENV },
		);
		expect(await found("claude", host)).toEqual([
			// The one built for this computer first: the other may be the note npm leaves in its place.
			{
				path: `${npm}\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe`,
				source: "npm",
			},
			{ path: `${npm}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, source: "npm" },
		]);
	});

	it("is found in the Node folder on PATH, the link first", async () => {
		const node = "C:\\Program Files\\nodejs";
		const host = computer(
			"win32",
			{
				[`${node}\\node.exe`]: "",
				[`${node}\\copilot.cmd`]: "",
				[`${node}\\node_modules\\@github\\copilot\\package.json`]: JSON.stringify({
					bin: { copilot: "npm-loader.js" },
				}),
				[`${node}\\node_modules\\@github\\copilot\\npm-loader.js`]: "",
				// Where npm puts it when the package's own folder is the only one that may hold it.
				[`${node}\\node_modules\\@github\\copilot\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`]:
					"",
			},
			{ env: { ...WINDOWS_ENV, Path: `C:\\Windows\\System32;${node}\\` } },
		);
		expect((await found("copilot", host)).map((place) => place.path)).toEqual([
			`${node}\\copilot.cmd`,
			`${node}\\node_modules\\@github\\copilot\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`,
			`${node}\\node_modules\\@github\\copilot\\npm-loader.js`,
		]);
	});

	it("is found where the user's .npmrc sends global packages", async () => {
		const host = computer(
			"win32",
			{
				"C:\\Users\\a\\.npmrc": "prefix=D:\\Tools\\npm-global\r\n",
				"D:\\Tools\\npm-global\\claude.cmd": "",
			},
			{ env: WINDOWS_ENV },
		);
		expect(await found("claude", host)).toEqual([
			{ path: "D:\\Tools\\npm-global\\claude.cmd", source: "npm" },
		]);
	});

	it("is found in a version manager's Node folder that is on no PATH", async () => {
		const host = computer(
			"win32",
			{
				"D:\\nvm\\v18.20.4\\node.exe": "",
				"D:\\nvm\\v22.11.0\\node.exe": "",
				"D:\\nvm\\v22.11.0\\claude.cmd": "",
				"D:\\nvm\\v18.20.4\\claude.cmd": "",
			},
			{ env: { ...WINDOWS_ENV, NVM_HOME: "D:\\nvm" } },
		);
		expect(await found("claude", host)).toEqual([
			{ path: "D:\\nvm\\v22.11.0\\claude.cmd", source: "node" },
			{ path: "D:\\nvm\\v18.20.4\\claude.cmd", source: "node" },
		]);
	});

	it("asks npm where its packages are, as a script run with Node", async () => {
		const node = "C:\\Program Files\\nodejs";
		const calls: string[][] = [];
		const host = computer(
			"win32",
			{
				[`${node}\\node.exe`]: "",
				[`${node}\\node_modules\\npm\\bin\\npm-cli.js`]: "",
				"E:\\global\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe": "",
			},
			{
				env: { ...WINDOWS_ENV, Path: node },
				run: async (command, args) => {
					calls.push([command, ...args]);
					return command.endsWith("node.exe") ? "E:\\global\\node_modules\r\n" : null;
				},
			},
		);
		expect(await npmGlobalRoot(host)).toBe("E:\\global\\node_modules");
		// Not `npm.cmd`: that would need the command prompt.
		expect(calls).toEqual([
			[`${node}\\node.exe`, `${node}\\node_modules\\npm\\bin\\npm-cli.js`, "root", "-g"],
		]);
		expect((await found("claude", host)).map((place) => place.path)).toEqual([
			"E:\\global\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe",
		]);
	});
});

describe("a CLI that an editor or an app brings", () => {
	it("is found in VS Code's extension, the newest version first", async () => {
		const extensions = "C:\\Users\\a\\.vscode\\extensions";
		const host = computer(
			"win32",
			{
				[`${extensions}\\anthropic.claude-code-2.1.99-win32-x64\\resources\\native-binary\\claude.exe`]:
					"",
				[`${extensions}\\anthropic.claude-code-2.1.322-win32-x64\\resources\\native-binary\\claude.exe`]:
					"",
				[`${extensions}\\ms-python.python-2026.1.0\\claude.exe`]: "",
			},
			{ env: WINDOWS_ENV },
		);
		expect(await found("claude", host)).toEqual([
			{
				path: `${extensions}\\anthropic.claude-code-2.1.322-win32-x64\\resources\\native-binary\\claude.exe`,
				source: "editor",
			},
			{
				path: `${extensions}\\anthropic.claude-code-2.1.99-win32-x64\\resources\\native-binary\\claude.exe`,
				source: "editor",
			},
		]);
	});

	it("is found wherever a later version of the extension keeps it", async () => {
		const extension = "/home/a/.cursor/extensions/anthropic.claude-code-3.0.0-linux-x64";
		const host = computer("linux", { [`${extension}/bin/native/claude`]: "" });
		expect(await found("claude", host)).toEqual([
			{ path: `${extension}/bin/native/claude`, source: "editor" },
		]);
	});

	it("is found in the Copilot extension's packages", async () => {
		const extension = "C:\\Users\\a\\.vscode\\extensions\\github.copilot-chat-0.40.1";
		const host = computer(
			"win32",
			{
				[`${extension}\\node_modules\\@github\\copilot\\package.json`]: JSON.stringify({
					bin: { copilot: "npm-loader.js" },
				}),
				[`${extension}\\node_modules\\@github\\copilot\\npm-loader.js`]: "",
				[`${extension}\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`]: "",
			},
			{ env: WINDOWS_ENV },
		);
		expect((await found("copilot", host)).map((place) => place.path)).toEqual([
			`${extension}\\node_modules\\@github\\copilot-win32-x64\\copilot.exe`,
			`${extension}\\node_modules\\@github\\copilot\\npm-loader.js`,
		]);
	});

	it("is found in the copy Claude's desktop app keeps, and in the installer's versions", async () => {
		const host = computer(
			"win32",
			{
				"C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2.1.300\\claude.exe": "",
				"C:\\Users\\a\\.local\\share\\claude\\versions\\2.1.322": "",
				"C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe":
					"",
			},
			{ env: WINDOWS_ENV },
		);
		expect(await found("claude", host)).toEqual([
			{
				path: "C:\\Users\\a\\AppData\\Roaming\\Claude\\claude-code\\2.1.300\\claude.exe",
				source: "app",
			},
			{ path: "C:\\Users\\a\\.local\\share\\claude\\versions\\2.1.322", source: "app" },
			{
				path: "C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe",
				source: "app",
			},
		]);
	});
});

describe("what Windows itself knows", () => {
	it("reads the values `reg query` prints", () => {
		const output = [
			"",
			"HKEY_CURRENT_USER\\Environment",
			"    OneDrive    REG_EXPAND_SZ    C:\\Users\\a\\OneDrive",
			"    Path    REG_EXPAND_SZ    %TOOLS%\\bin;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps;",
			"    TOOLS    REG_SZ    D:\\Tools",
			"    Count    REG_DWORD    0x1",
			"    Empty    REG_SZ",
			"",
		].join("\r\n");
		expect(registryValues(output)).toEqual({
			OneDrive: "C:\\Users\\a\\OneDrive",
			Path: "%TOOLS%\\bin;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps;",
			TOOLS: "D:\\Tools",
			Empty: "",
		});
	});

	it("joins the computer's PATH and the user's, and fills in the names", () => {
		const env = registryEnvironment(
			{ Path: "%SystemRoot%\\System32", NVM_HOME: "D:\\nvm" },
			{ Path: "%NVM_HOME%;%TOOLS%\\bin;%Nothing%", TOOLS: "%USERPROFILE%\\tools" },
			{ SystemRoot: "C:\\Windows", UserProfile: "C:\\Users\\a", Path: "C:\\Old" },
		);
		expect(env.PATH).toBe("C:\\Windows\\System32;D:\\nvm;C:\\Users\\a\\tools\\bin;%Nothing%");
		expect(env.NVM_HOME).toBe("D:\\nvm");
	});

	it("finds a program on the PATH the registry holds, which a running app has not got yet", async () => {
		const host = computer(
			"win32",
			{ "D:\\Tools\\bin\\claude.exe": "" },
			{
				env: WINDOWS_ENV,
				run: async (command, args) => {
					if (!command.endsWith("reg.exe")) return null;
					return args[1] === "HKCU\\Environment"
						? "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %TOOLS%\\bin\r\n    TOOLS    REG_SZ    D:\\Tools\r\n"
						: null;
				},
			},
		);
		expect(await found("claude", host)).toEqual([
			{ path: "D:\\Tools\\bin\\claude.exe", source: "registry" },
		]);
	});

	it("reads paths printed as character codes", () => {
		const codes = (text: string): string =>
			[...text].map((letter) => letter.charCodeAt(0)).join(" ");
		expect(fromCodes(`${codes("C:\\Users\\Koçak\\claude.exe")}\r\n\r\nnot numbers\r\n`)).toEqual([
			"C:\\Users\\Koçak\\claude.exe",
		]);
	});

	it("finds the program an editor is running, but not the desktop app of the same name", async () => {
		const codes = (text: string): string =>
			[...text].map((letter) => letter.charCodeAt(0)).join(" ");
		const running = [
			"E:\\Portable\\claude\\claude.exe",
			"C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\Claude.exe",
			"C:\\Program Files\\WindowsApps\\Claude_1.0\\app\\claude.exe",
		];
		const scripts: string[] = [];
		const host = computer("win32", Object.fromEntries(running.map((path) => [path, ""])), {
			env: WINDOWS_ENV,
			run: async (command, args) => {
				if (!command.endsWith("powershell.exe")) return null;
				scripts.push(args.at(-1) ?? "");
				return running.map(codes).join("\r\n");
			},
		});
		expect(await found("claude", host)).toEqual([
			{ path: "E:\\Portable\\claude\\claude.exe", source: "running" },
		]);
		// Only this user's session's programs, and nothing the constrained mode refuses.
		expect(scripts[0]).toContain("Get-Process -Name claude");
		expect(scripts[0]).toContain("SessionId");
		expect(scripts[0]).not.toContain('"');
	});

	it("asks the login shell where the program is, outside Windows", async () => {
		const calls: string[][] = [];
		const host = computer(
			"darwin",
			{ "/Users/a/tools/bin/copilot": "" },
			{
				home: "/Users/a",
				env: { SHELL: "/bin/zsh" },
				run: async (command, args) => {
					calls.push([command, ...args]);
					return args.at(-1) === "command -v copilot"
						? "Welcome!\n/Users/a/tools/bin/copilot\n"
						: null;
				},
			},
		);
		expect(await found("copilot", host)).toEqual([
			{ path: "/Users/a/tools/bin/copilot", source: "shell" },
		]);
		expect(calls).toContainEqual(["/bin/zsh", "-ilc", "command -v copilot"]);
	});
});

describe("going through folders", () => {
	const tree = {
		"C:\\Users\\a\\tools\\node-v22\\node.exe": "",
		"C:\\Users\\a\\tools\\node-v22\\node_modules\\@anthropic-ai\\claude-code\\package.json":
			JSON.stringify({ bin: { claude: "bin/claude.exe" } }),
		"C:\\Users\\a\\tools\\node-v22\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe": "",
		// Deep inside another package: `node_modules` is not gone into.
		"C:\\Users\\a\\tools\\node-v22\\node_modules\\other\\vendor\\claude.exe": "",
		"C:\\Users\\a\\Downloads\\claude.exe": "",
		// Claude's desktop app: Chromium's files are next to it, and its name begins with a capital.
		"C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\Claude.exe": "",
		"C:\\Users\\a\\AppData\\Local\\AnthropicClaude\\resources.pak": "",
		"C:\\Users\\a\\apps\\copy\\claude.exe": "",
		"C:\\Users\\a\\apps\\copy\\chrome_100_percent.pak": "",
		"C:\\Users\\a\\OneDrive - Firma\\claude.exe": "",
		"C:\\Users\\a\\a\\b\\c\\d\\e\\claude.exe": "",
	};

	it("finds the program's file and the package in a node_modules, nearer ones first", async () => {
		const host = computer("win32", tree, { env: WINDOWS_ENV });
		expect(await all(walk("claude", host, "C:\\Users\\a", 4, new Budget(60_000)))).toEqual([
			"C:\\Users\\a\\Downloads\\claude.exe",
			"C:\\Users\\a\\tools\\node-v22\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
		]);
	});

	it("tells a desktop app's folder", () => {
		const entry = (name: string): Entry => ({ name, directory: false, file: true, link: false });
		expect(isAppFolder([entry("Claude.exe"), entry("Resources.pak")])).toBe(true);
		expect(isAppFolder([entry("claude.exe"), entry("LICENSE")])).toBe(false);
	});

	it("stops when its time is up, and reads no folder twice", async () => {
		const host = computer("win32", tree, { env: WINDOWS_ENV });
		let now = 0;
		const listed: string[] = [];
		const slow: Host = {
			...host,
			list: async (path) => {
				listed.push(path);
				now += 1_000;
				return host.list(path);
			},
		};
		const budget = new Budget(1_500, new Set(), () => now);
		// The folder itself and the ones in it are read; the time is up before the next level.
		expect(await all(walk("claude", slow, "C:\\Users\\a", 4, budget))).toEqual([
			"C:\\Users\\a\\Downloads\\claude.exe",
		]);
		expect(budget.alive()).toBe(false);
		const again = new Budget(60_000, budget.seen);
		await all(walk("claude", slow, "C:\\Users\\a", 0, again));
		expect(listed.filter((path) => path === "C:\\Users\\a")).toHaveLength(1);
	});

	it("goes through the user's own folders, then the rest of the computer's disks when asked", async () => {
		const host = computer(
			"win32",
			{ ...tree, "D:\\Programs\\nodejs\\claude.cmd": "", "C:\\ProgramData\\x\\claude.exe": "" },
			{
				env: WINDOWS_ENV,
				run: async (command) => (command.endsWith("powershell.exe") ? "C:\r\nD:\r\n" : null),
			},
		);
		expect(ownRoots(host).map((root) => root.path)).toEqual([
			"C:\\Users\\a\\AppData\\Local",
			"C:\\Users\\a\\AppData\\Roaming",
			"C:\\Users\\a",
			"C:\\Program Files",
		]);
		const shared = await sharedRoots(host);
		expect(shared.map((root) => root.path)).toEqual(["C:\\ProgramData", "C:\\", "D:\\"]);
		const budget = new Budget(60_000);
		const own = await all(scan("claude", host, ownRoots(host), budget));
		expect(own).toContain("C:\\Users\\a\\Downloads\\claude.exe");
		// What the first half read is passed by in the second.
		expect(await all(scan("claude", host, shared, new Budget(60_000, budget.seen)))).toEqual([
			"C:\\ProgramData\\x\\claude.exe",
			"D:\\Programs\\nodejs\\claude.cmd",
		]);
	});

	it("takes the disks of the user's folders when the disks cannot be asked for", async () => {
		const host = computer("win32", {}, { env: { ...WINDOWS_ENV, Path: "E:\\Tools" } });
		expect((await sharedRoots(host)).map((root) => root.path)).toEqual([
			"C:\\ProgramData",
			"C:\\",
			"E:\\",
		]);
		expect(await sharedRoots(computer("linux", {}))).toEqual([]);
	});

	it("leaves the folders macOS asks about alone", async () => {
		const host = computer(
			"darwin",
			{
				"/Users/a/Documents/claude": "",
				"/Users/a/Applications/Claude.app/Contents/MacOS/claude": "",
				"/Users/a/dev/bin/claude": "",
			},
			{ home: "/Users/a" },
		);
		expect(await all(walk("claude", host, "/Users/a", 4, new Budget(60_000)))).toEqual([
			"/Users/a/dev/bin/claude",
		]);
	});
});

describe("a path the user gives", () => {
	it("may be the folder of Node, of npm's packages, or of the package itself", async () => {
		const node = "C:\\Program Files\\nodejs";
		const native = `${node}\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe`;
		const host = computer(
			"win32",
			{
				[`${node}\\node_modules\\@anthropic-ai\\claude-code\\package.json`]: "{}",
				[native]: "",
			},
			{ env: WINDOWS_ENV },
		);
		const existing = async (path: string): Promise<string[]> => {
			const paths: string[] = [];
			for await (const near of placesNear("claude", path, host)) {
				if ((await host.isFile(near)) && !paths.includes(near)) paths.push(near);
			}
			return paths;
		};
		expect(await existing(node)).toEqual([native]);
		expect(await existing(`${node}\\node_modules`)).toEqual([native]);
		expect(await existing(`${node}\\node_modules\\@anthropic-ai\\claude-code`)).toEqual([native]);
		expect(await existing(native)).toEqual([native]);
		expect(await packagePrograms("claude", "C:\\Nowhere\\node_modules", host)).toEqual([]);
	});
});
