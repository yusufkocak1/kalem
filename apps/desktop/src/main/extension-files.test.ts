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

	it("reads whole lines from a byte offset, or the end of a file, to follow a log", async () => {
		base = await mkdtemp(join(tmpdir(), "kalem-files-"));
		const lines = ["first ç", "second", "third", "fourth (partial"].join("\n");
		await fileCall("fs.writeText", ["app.log", lines], base);
		const size = Buffer.byteLength(lines);
		expect(await fileCall("fs.readRange", ["app.log", { start: 0, length: 12 }], base)).toEqual({
			text: "first ç\n",
			start: 0,
			end: 9,
			size,
		});
		expect(await fileCall("fs.readRange", ["app.log", { start: 9 }], base)).toEqual({
			text: "second\nthird\nfourth (partial",
			start: 9,
			end: size,
			size,
		});
		expect(
			await fileCall("fs.readRange", ["app.log", { start: 3, length: 13, align: true }], base),
		).toEqual({
			text: "second\n",
			start: 9,
			end: 16,
			size,
		});
		const tail = (await fileCall("fs.readRange", ["app.log", { tail: 20 }], base)) as {
			text: string;
		};
		expect(tail.text).toBe("fourth (partial");
		expect(await fileCall("fs.readRange", ["app.log", { start: size }], base)).toMatchObject({
			text: "",
			start: size,
		});
	});

	it("needs an open folder for a relative path", () => {
		expect(() => resolvePath("a.txt", null)).toThrow(/no folder is open/);
		expect(() => resolvePath("", "/x")).toThrow();
	});
});
