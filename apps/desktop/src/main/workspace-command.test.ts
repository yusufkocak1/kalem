import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clipOutput, commandLine, commandReport, runCommand } from "./workspace-command.js";

describe("run_command", () => {
	it("runs in the folder and gives back what it printed, with the exit code", async () => {
		const root = await mkdtemp(join(tmpdir(), "kalem-command-"));
		await writeFile(join(root, "a.txt"), "merhaba\n");
		const read = process.platform === "win32" ? "type a.txt" : "cat a.txt";
		const result = await runCommand(read, root);
		expect(result).toMatchObject({ code: 0, timedOut: false });
		expect(result.output).toContain("merhaba");
		const failed = await runCommand("exit 3", root);
		expect(failed.code).toBe(3);
		expect(commandReport("exit 3", failed, 120)).toContain("exited with code 3");
	});

	it("is stopped when it runs too long", async () => {
		if (process.platform === "win32") return;
		const root = await mkdtemp(join(tmpdir(), "kalem-command-"));
		const result = await runCommand("echo start; sleep 30", root, 1);
		expect(result.timedOut).toBe(true);
		expect(result.code).toBeNull();
		expect(commandReport("sleep", result, 1)).toContain("Stopped after 1 s");
	}, 10_000);

	it("says when the folder is not there", async () => {
		const result = await runCommand("echo x", join(tmpdir(), "kalem-no-such-folder-x"));
		expect(result.output).toContain("is not a folder");
	});

	it("keeps the start and the end of a long output", () => {
		const text = `${"a".repeat(100)}${"b".repeat(100)}`;
		const clipped = clipOutput(text, 40);
		expect(clipped.startsWith("a".repeat(20))).toBe(true);
		expect(clipped.endsWith("b".repeat(20))).toBe(true);
		expect(clipped).toContain("160 characters left out");
		expect(commandLine("  ls  ")).toBe("ls");
		expect(commandLine(3)).toBe("");
	});
});
