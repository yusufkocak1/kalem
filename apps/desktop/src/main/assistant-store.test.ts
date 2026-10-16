import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AssistantStore } from "./assistant-store.js";

// A stand-in for the OS encryption: reversible, and not the plain text.
const box = {
	encrypt: (text: string) => Buffer.from([...text].reverse().join(""), "utf8"),
	decrypt: (data: Buffer) => [...data.toString("utf8")].reverse().join(""),
};

describe("assistant settings", () => {
	it("starts with Claude Code and each service's own address", async () => {
		const store = new AssistantStore(
			join(await mkdtemp(join(tmpdir(), "kalem-a-")), "a.json"),
			box,
		);
		const config = await store.config();
		expect(config.provider).toBe("claude-code");
		expect(config.connections.openai).toEqual({
			baseUrl: "https://api.openai.com/v1",
			model: "",
			hasKey: false,
		});
		expect(config.connections.anthropic.model).toBe("claude-opus-5-5");
		expect(config.encrypted).toBe(true);
	});

	it("keeps keys encrypted on disk, and forgets them on request", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-a-")), "a.json");
		const store = new AssistantStore(file, box);
		await store.update(
			"openai",
			{ baseUrl: "https://api.openai.com/v1", model: "m1" },
			"sk-secret",
		);
		expect(await readFile(file, "utf8")).not.toContain("sk-secret");

		const again = new AssistantStore(file, box);
		expect(await again.active()).toEqual({
			provider: "openai",
			connection: { baseUrl: "https://api.openai.com/v1", model: "m1" },
			key: "sk-secret",
		});
		// Left out, the key stays; another service's settings do not touch it.
		await again.update("openai", { baseUrl: "https://api.openai.com/v1", model: "m2" }, undefined);
		await again.update(
			"ollama",
			{ baseUrl: "http://localhost:11434/v1", model: "llama" },
			undefined,
		);
		expect(await again.key("openai")).toBe("sk-secret");
		expect((await again.config()).connections.openai).toMatchObject({ model: "m2", hasKey: true });
		await again.update("openai", { baseUrl: "https://api.openai.com/v1", model: "m2" }, null);
		expect(await new AssistantStore(file, box).key("openai")).toBeNull();
	});

	it("keeps a key only in memory without encryption", async () => {
		const file = join(await mkdtemp(join(tmpdir(), "kalem-a-")), "a.json");
		const plain = { encrypt: () => null, decrypt: () => "" };
		const store = new AssistantStore(file, plain);
		await store.update("gemini", { baseUrl: "https://g", model: "x" }, "AIza-secret");
		expect(await store.key("gemini")).toBe("AIza-secret");
		expect((await store.config()).encrypted).toBe(false);
		expect(await readFile(file, "utf8")).not.toContain("AIza-secret");
		expect(await new AssistantStore(file, plain).key("gemini")).toBeNull();
	});
});
