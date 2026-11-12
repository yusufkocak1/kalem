import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalNotesStore } from "./local-notes-store.js";

describe("LocalNotesStore", () => {
	it("keeps notes by document in its own file, and forgets a document with none", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "notes-")), "local-notes.json");
		const store = new LocalNotesStore(file);
		expect(await store.get("file:/a.md")).toEqual([]);
		await store.set("file:/a.md", [
			{ id: "n", quote: "metin", text: "anlamadım", kind: "question" },
		]);
		const again = new LocalNotesStore(file);
		const [note] = await again.get("file:/a.md");
		expect(note?.text).toBe("anlamadım");
		expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
		await again.set("file:/a.md", []);
		expect(await new LocalNotesStore(file).get("file:/a.md")).toEqual([]);
	});
});
