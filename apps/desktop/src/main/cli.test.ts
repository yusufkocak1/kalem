import { describe, expect, it } from "vitest";
import { cliCandidates, shimScript, textOutput } from "./cli.js";

describe("finding Claude Code", () => {
	it("tries PATH, then the installers' folders", () => {
		const found = cliCandidates("claude", "darwin", { PATH: "/usr/bin:/opt/tools" }, "/Users/a");
		expect(found[0]).toBe("/usr/bin/claude");
		expect(found.indexOf("/opt/tools/claude")).toBeLessThan(
			found.indexOf("/Users/a/.local/bin/claude"),
		);
		expect(found).toContain("/Users/a/.claude/local/claude");
		expect(found).toContain("/opt/homebrew/bin/claude");
		// Each place once.
		expect(found.filter((path) => path === "/usr/bin/claude")).toHaveLength(1);
	});

	it("only tries an override", () => {
		expect(
			cliCandidates("claude", "linux", { PATH: "/usr/bin", KALEM_CLAUDE: "/x/claude" }, "/h"),
		).toEqual(["/x/claude"]);
	});

	it("looks for the program and the npm shim on Windows", () => {
		const found = cliCandidates(
			"claude",
			"win32",
			{ Path: "C:\\Tools\\;C:\\Node", APPDATA: "C:\\Users\\a\\AppData\\Roaming" },
			"C:\\Users\\a",
		);
		expect(found.slice(0, 2)).toEqual(["C:\\Tools\\claude.exe", "C:\\Tools\\claude.cmd"]);
		expect(found).toContain("C:\\Users\\a\\.local\\bin\\claude.exe");
		expect(found).toContain("C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd");
	});

	it("looks for Copilot where its installers put it", () => {
		const found = cliCandidates("copilot", "win32", { Path: "", LOCALAPPDATA: "C:\\L" }, "C:\\U");
		expect(found).toContain("C:\\L\\Microsoft\\WinGet\\Links\\copilot.exe");
		expect(found).toContain("C:\\U\\.local\\bin\\copilot.exe");
		expect(cliCandidates("copilot", "linux", { KALEM_COPILOT: "/x/copilot" }, "/h")).toEqual([
			"/x/copilot",
		]);
		expect(
			cliCandidates("copilot", "linux", { KALEM_CLAUDE: "/x/claude", PATH: "/bin" }, "/h")[0],
		).toBe("/bin/copilot");
	});

	it("passes plain text on as the reply", () => {
		const output = textOutput();
		expect(output.answered).toBe(false);
		expect(output.push("")).toEqual([]);
		expect(output.push("Merhaba")).toEqual([{ kind: "text", text: "Merhaba" }]);
		expect(output.answered).toBe(true);
		expect(output.finished).toBe(false);
	});

	it("finds the script an npm shim runs", () => {
		const shim = [
			"@ECHO off",
			"GOTO start",
			":find_dp0",
			"SET dp0=%~dp0",
			"EXIT /b",
			":start",
			"SETLOCAL",
			'"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
		].join("\r\n");
		expect(shimScript("C:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd", shim)).toBe(
			"C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js",
		);
		expect(shimScript("C:\\x\\claude.cmd", "@echo off\r\nclaude.exe %*")).toBeNull();
	});
});
