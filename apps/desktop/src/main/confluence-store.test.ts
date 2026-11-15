import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfluenceStore } from "./confluence-store.js";

const box = (strong: boolean) => ({
	encrypt: (text: string) => (strong ? Buffer.from(`sealed:${text}`) : null),
	decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, ""),
});

describe("ConfluenceStore", () => {
	it("keeps the token on disk only encrypted", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-store-")), "c.json");
		await new ConfluenceStore(file, box(true)).set({ site: "s", username: "u", token: "t" });
		expect(await readFile(file, "utf8")).not.toContain('"t"');
		expect(await new ConfluenceStore(file, box(true)).get()).toEqual({
			site: "s",
			username: "u",
			token: "t",
		});
	});

	it("moves a token stored under weaker encryption into memory and off the disk", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-store-")), "c.json");
		await writeFile(
			file,
			JSON.stringify({
				site: "s",
				username: "u",
				token: Buffer.from("sealed:t").toString("base64"),
			}),
		);
		const store = new ConfluenceStore(file, box(false));
		expect((await store.get())?.token).toBe("t");
		await expect(readFile(file)).rejects.toThrow();
	});
});
