import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileCall, resolvePath } from "./extension-files.js";

let base = "";
afterEach(async () => {
	if (base !== "") await rm(base, { recursive: true, force: true });
});

describe("fileCall", () => {
	it("reads, writes, lists and copies, relative to the open folder", async () => {
		base = await mkdtemp(join(tmpdir(), "kalem-files-"));
		await fileCall("fs.writeText", [".kalem/run.json", "{}"], base);
		expect(await fileCall("fs.readText", [join(base, ".kalem/run.json")], base)).toBe("{}");
		expect(await fileCall("fs.exists", [".kalem/none"], base)).toBe(false);
		expect(await fileCall("fs.stat", [".kalem"], base)).toMatchObject({ type: "folder" });
		await fileCall("fs.copy", [".kalem", "copy"], base);
		expect(await fileCall("fs.list", ["copy"], base)).toEqual([{ name: "run.json", type: "file" }]);
	});

	it("needs an open folder for a relative path", () => {
		expect(() => resolvePath("a.txt", null)).toThrow(/no folder is open/);
		expect(() => resolvePath("", "/x")).toThrow();
	});
});
