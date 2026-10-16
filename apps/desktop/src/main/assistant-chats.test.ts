import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoredChat } from "../shared/chats.js";
import { ChatStore } from "./assistant-chats.js";

const chat = (id: string, updated: number): StoredChat => ({
	id,
	title: id,
	provider: "anthropic",
	sessionId: null,
	folder: null,
	created: 1,
	updated,
	messages: [{ role: "user", text: `soru ${id}`, error: null, notes: [] }],
});

describe("chat store", () => {
	it("keeps chats newest first, across runs, and deletes them", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-chats-")), "chats.json");
		const store = new ChatStore(file);
		await store.put(chat("a", 10));
		await store.put(chat("b", 20));
		await store.put({ ...chat("a", 30), title: "a again" });
		expect((await store.list()).map((summary) => summary.title)).toEqual(["a again", "b"]);

		const again = new ChatStore(file);
		expect((await again.get("b"))?.messages[0]?.text).toBe("soru b");
		await again.delete("a");
		expect((await new ChatStore(file).list()).map((summary) => summary.id)).toEqual(["b"]);
		expect(JSON.parse(await readFile(file, "utf8")).chats).toHaveLength(1);
	});

	it("keeps at most a hundred chats", async () => {
		const store = new ChatStore(join(await mkdtemp(join(tmpdir(), "kalem-chats-")), "chats.json"));
		for (let i = 0; i < 105; i++) await store.put(chat(`c${i}`, i + 1));
		const list = await store.list();
		expect(list).toHaveLength(100);
		expect(list[0]?.id).toBe("c104");
		expect(list.at(-1)?.id).toBe("c5");
	});
});
