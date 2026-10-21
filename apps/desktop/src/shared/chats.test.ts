import { describe, expect, it } from "vitest";
import type { StoredMessage } from "./chats.js";
import { chatSummary, chatTitle, historyOf, parseChat } from "./chats.js";

const message = (
	role: "user" | "assistant",
	text: string,
	error: string | null = null,
): StoredMessage => ({
	role,
	text,
	error,
	notes: [],
});

describe("chats", () => {
	it("are named after their first question", () => {
		expect(chatTitle("  Bu   belgeyi\nözetle ")).toBe("Bu belgeyi özetle");
		expect(chatTitle("a".repeat(80))).toBe(`${"a".repeat(59)}…`);
	});

	it("keep their sources", () => {
		const base = { id: "c-2", provider: "claude-code", messages: [] };
		expect(parseChat({ ...base, sources: ["/kod", 3, "", "/notlar/analiz.txt"] })?.sources).toEqual(
			["/kod", "/notlar/analiz.txt"],
		);
		expect(parseChat(base)).not.toHaveProperty("sources");
	});

	it("are read back only when they make sense", () => {
		const chat = parseChat({
			id: "c-1",
			title: "Özet",
			provider: "copilot",
			sessionId: "bad id!",
			folder: "/docs",
			created: 1,
			updated: 2,
			messages: [
				{ role: "user", text: "Özetle", notes: ["with “a.md”", 3] },
				{ role: "system", text: "x" },
				{ role: "assistant", text: "Kısaca…", error: null, model: "gpt-x" },
			],
		});
		expect(chat).toEqual({
			id: "c-1",
			title: "Özet",
			provider: "copilot",
			sessionId: null,
			folder: "/docs",
			created: 1,
			updated: 2,
			messages: [
				{ role: "user", text: "Özetle", error: null, notes: ["with “a.md”"] },
				{ role: "assistant", text: "Kısaca…", error: null, notes: [], model: "gpt-x" },
			],
		});
		expect(chat === null ? null : chatSummary(chat)).toEqual({
			id: "c-1",
			title: "Özet",
			provider: "copilot",
			updated: 2,
			count: 2,
		});
		expect(parseChat({ id: "c", provider: "nobody" })).toBeNull();
		expect(parseChat({ id: "../x", provider: "openai" })).toBeNull();
		expect(parseChat(null)).toBeNull();
	});

	it("give an API the answered questions, taking turns", () => {
		expect(
			historyOf([
				message("user", "Bir"),
				message("assistant", "1"),
				message("user", "İki"),
				message("assistant", "", "HTTP 500"),
				message("user", "Üç"),
				message("assistant", "3"),
				message("user", "Dört"),
			]),
		).toEqual([
			{ role: "user", content: "Bir" },
			{ role: "assistant", content: "1" },
			{ role: "user", content: "Üç" },
			{ role: "assistant", content: "3" },
		]);
		const long = Array.from({ length: 30 }, (_, i) => [
			message("user", `q${i}`),
			message("assistant", `a${i}`),
		]).flat();
		const kept = historyOf(long);
		expect(kept).toHaveLength(40);
		expect(kept[0]).toEqual({ role: "user", content: "q10" });
	});
});
