import { describe, expect, it } from "vitest";
import { stringsFor } from "./i18n.js";
import {
	chatCompletionsDelta,
	chatCompletionsRequest,
	checkBaseUrl,
	httpErrorMessage,
	modelIds,
	PROVIDER_INFO,
	PROVIDERS,
	providerLabel,
	SseReader,
} from "./providers.js";

describe("services", () => {
	it("has a name and, except for the CLI and custom, an address for each", () => {
		const t = stringsFor("tr");
		for (const id of PROVIDERS) {
			expect(providerLabel(t, id)).not.toBe("");
			if (id !== "claude-code" && id !== "custom")
				expect(checkBaseUrl(PROVIDER_INFO[id].baseUrl)).toBe(PROVIDER_INFO[id].baseUrl);
		}
		expect(providerLabel(t, "claude-code")).toBe("Claude Code (bu bilgisayar)");
		expect(PROVIDER_INFO.anthropic.defaultModel).toBe("claude-opus-5-5");
		expect(PROVIDER_INFO.ollama.needsKey).toBe(false);
	});

	it("takes only http(s) addresses, without a trailing slash", () => {
		expect(checkBaseUrl(" https://example.com/v1/ ")).toBe("https://example.com/v1");
		expect(() => checkBaseUrl("file:///etc/passwd")).toThrow();
		expect(() => checkBaseUrl("not a url")).toThrow();
	});
});

describe("Chat Completions", () => {
	it("streams with the system prompt first and the key as a bearer token", () => {
		const { url, init } = chatCompletionsRequest(
			{ baseUrl: "http://localhost:11434/v1", model: "llama" },
			"sk-1",
			"SYSTEM",
			[{ role: "user", content: "Merhaba" }],
		);
		expect(url).toBe("http://localhost:11434/v1/chat/completions");
		expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-1");
		expect(JSON.parse(init.body as string)).toEqual({
			model: "llama",
			stream: true,
			messages: [
				{ role: "system", content: "SYSTEM" },
				{ role: "user", content: "Merhaba" },
			],
		});
	});

	it("sends no authorization without a key", () => {
		const { init } = chatCompletionsRequest({ baseUrl: "http://x", model: "m" }, null, "", []);
		expect((init.headers as Record<string, string>).authorization).toBeUndefined();
	});

	it("reads text, the end and errors from stream events", () => {
		expect(chatCompletionsDelta('{"choices":[{"delta":{"content":"Mer"}}]}')).toEqual({
			text: "Mer",
		});
		expect(chatCompletionsDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toEqual({});
		expect(chatCompletionsDelta("[DONE]")).toEqual({ done: true });
		expect(chatCompletionsDelta('{"error":{"message":"quota"}}')).toEqual({ error: "quota" });
		expect(chatCompletionsDelta(": keep-alive")).toEqual({});
	});
});

describe("server-sent events", () => {
	it("joins events that arrive in pieces", () => {
		const reader = new SseReader();
		expect(reader.push('event: content_block_delta\ndata: {"a"')).toEqual([]);
		expect(reader.push(":1}\r\n\r\ndata: one\ndata: two\n\n: comment\n")).toEqual([
			{ event: "content_block_delta", data: '{"a":1}' },
			{ event: "message", data: "one\ntwo" },
		]);
		expect(reader.push("data: [DONE]")).toEqual([]);
		expect(reader.end()).toEqual([{ event: "message", data: "[DONE]" }]);
	});
});

describe("errors and models", () => {
	it("takes a failed request's message from its body", () => {
		expect(httpErrorMessage(401, '{"error":{"message":"Incorrect API key"}}')).toBe(
			"HTTP 401: Incorrect API key",
		);
		expect(httpErrorMessage(400, '[{"error":{"code":400,"message":"API key not valid"}}]')).toBe(
			"HTTP 400: API key not valid",
		);
		expect(httpErrorMessage(404, '{"error":"model not found"}')).toBe("HTTP 404: model not found");
		expect(httpErrorMessage(502, "Bad Gateway")).toBe("HTTP 502: Bad Gateway");
		expect(httpErrorMessage(500, "")).toBe("HTTP 500");
	});

	it("lists model ids, sorted, without Gemini's prefix", () => {
		expect(modelIds({ data: [{ id: "b" }, { id: "models/a" }, { id: "b" }, {}] })).toEqual([
			"a",
			"b",
		]);
		expect(modelIds({ models: [{ name: "llama3" }] })).toEqual(["llama3"]);
		expect(modelIds({})).toEqual([]);
	});
});
