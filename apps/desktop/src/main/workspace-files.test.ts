import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	checkName,
	createEntry,
	isInside,
	movedPath,
	renameEntry,
	WorkspaceFileError,
} from "./workspace-files.js";

const problem = async (work: Promise<unknown>): Promise<string> => {
	try {
		await work;
		return "none";
	} catch (error) {
		return error instanceof WorkspaceFileError ? error.problem : String(error);
	}
};

describe("workspace files", () => {
	it("takes one usable name, never a path", () => {
		expect(checkName("  Rapor.md ")).toBe("Rapor.md");
		for (const bad of [
			"",
			" ",
			".",
			"..",
			"a/b",
			"a\\b",
			"ne?",
			"nokta.",
			"CON",
			"nul.txt",
			"x".repeat(256),
		]) {
			expect(() => checkName(bad), bad).toThrow(WorkspaceFileError);
		}
	});

	it("knows what lies inside the shown folders", () => {
		const root = join(tmpdir(), "kok");
		expect(isInside(root, [root])).toBe(true);
		expect(isInside(join(root, "a", "b.md"), [root])).toBe(true);
		expect(isInside(`${root}-baska`, [root])).toBe(false);
		expect(isInside(join(root, "..", "x"), [root])).toBe(false);
	});

	it("creates files and folders in a shown folder only, and not over another", async () => {
		const root = await mkdtemp(join(tmpdir(), "kalem-files-"));
		const file = await createEntry(root, "notlar.md", "file", [root]);
		expect(file).toBe(join(root, "notlar.md"));
		await createEntry(root, "alt", "folder", [root]);
		expect((await readdir(root)).sort()).toEqual(["alt", "notlar.md"]);
		expect(await problem(createEntry(root, "notlar.md", "file", [root]))).toBe("exists");
		expect(await problem(createEntry(tmpdir(), "x.md", "file", [root]))).toBe("outside");
		expect(await problem(createEntry(root, "../kacak.md", "file", [root]))).toBe("invalid-name");
	});

	it("renames within the folder; a root itself or onto another file is refused", async () => {
		const root = await mkdtemp(join(tmpdir(), "kalem-files-"));
		await mkdir(join(root, "eski"));
		await writeFile(join(root, "eski", "a.md"), "a");
		await writeFile(join(root, "b.md"), "b");
		const renamed = await renameEntry(join(root, "eski"), "yeni", [root]);
		expect(renamed).toBe(join(root, "yeni"));
		expect(await readdir(join(root, "yeni"))).toEqual(["a.md"]);
		expect(await problem(renameEntry(join(root, "b.md"), "yeni", [root]))).toBe("exists");
		expect(await problem(renameEntry(root, "baska", [root]))).toBe("outside");
		expect(await problem(renameEntry(join(root, "yok.md"), "x.md", [root]))).toBe("missing");
		// Only the case changes: allowed.
		expect(await renameEntry(join(root, "b.md"), "B.md", [root])).toBe(join(root, "B.md"));
	});

	it("follows a renamed file or folder", () => {
		const root = join(tmpdir(), "kok");
		expect(movedPath(join(root, "a.md"), join(root, "a.md"), join(root, "b.md"))).toBe(
			join(root, "b.md"),
		);
		expect(movedPath(join(root, "eski", "x", "a.md"), join(root, "eski"), join(root, "yeni"))).toBe(
			join(root, "yeni", "x", "a.md"),
		);
		expect(
			movedPath(join(root, "eskiler", "a.md"), join(root, "eski"), join(root, "yeni")),
		).toBeNull();
	});
});
