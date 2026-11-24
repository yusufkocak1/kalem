import { describe, expect, it, vi } from "vitest";
import { PROVIDER_INFO } from "../shared/providers.js";
import { steeringNote } from "../shared/steering.js";

/** What was sent, and what is answered in turn: as Chat Completions streams, and as Anthropic messages. */
const state = vi.hoisted(() => ({
	sent: [] as { url: string; body: Record<string, unknown> }[],
	answers: [] as string[],
	anthropicSent: [] as Record<string, unknown>[],
	anthropicAnswers: [] as Record<string, unknown>[],
}));

vi.mock("electron", () => ({
	net: {
		fetch: async (url: string, init?: RequestInit) => {
			state.sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
			return new Response(state.answers.shift() ?? "", {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		},
	},
}));

// The SDK's part is its own: here it hands over the messages it is given and answers as it is told.
vi.mock("@anthropic-ai/sdk", () => {
	class APIError extends Error {}
	class AuthenticationError extends APIError {}
	class Anthropic {
		static APIError = APIError;
		static AuthenticationError = AuthenticationError;
		messages = {
			stream: (params: Record<string, unknown>) => {
				state.anthropicSent.push(structuredClone(params));
				const message = state.anthropicAnswers.shift() as {
					content: { type: string; text?: string }[];
				};
				return {
					async *[Symbol.asyncIterator]() {
						for (const block of message.content) {
							if (block.type !== "text") continue;
							yield {
								type: "content_block_delta",
								delta: { type: "text_delta", text: block.text },
							};
						}
					},
					finalMessage: async () => message,
				};
			},
		};
	}
	return { default: Anthropic };
});

const { askApi } = await import("./llm.js");

const usage = { input_tokens: 1, output_tokens: 1 };
const search = {
	definitions: [{ name: "search", description: "Arar", parameters: { type: "object" } }],
	run: async () => "bulundu",
};

const chunk = (delta: Record<string, unknown>): string =>
	`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;

describe("what the user adds while an API answers", () => {
	it("goes to Anthropic with the results of the round of tools it came during", async () => {
		state.anthropicSent.length = 0;
		state.anthropicAnswers = [
			{
				content: [
					{ type: "text", text: "Arıyorum." },
					{ type: "tool_use", id: "t1", name: "search", input: { query: "onay" } },
				],
				stop_reason: "tool_use",
				usage,
			},
			{
				content: [{ type: "text", text: "Tabloyla birlikte hazır." }],
				stop_reason: "end_turn",
				usage,
			},
		];
		const added = [["Tabloyu da ekle"], []];
		let said = "";
		await askApi({
			provider: PROVIDER_INFO.anthropic,
			connection: { baseUrl: "http://anthropic.test", model: "claude-test" },
			key: "k",
			system: "sistem",
			messages: [{ role: "user", content: "Akışı çiz" }],
			signal: new AbortController().signal,
			text: (text) => {
				said += text;
			},
			steer: () => added.shift() ?? [],
			tools: search,
		});
		expect(said).toBe("Arıyorum.\n\nTabloyla birlikte hazır.");
		expect(state.anthropicSent).toHaveLength(2);
		const messages = state.anthropicSent[1]?.messages as { role: string; content: unknown }[];
		const turn = messages.at(-1) as { role: string; content: Record<string, unknown>[] };
		expect(turn.role).toBe("user");
		expect(turn.content.map((block) => block.type)).toEqual(["tool_result", "text"]);
		expect(turn.content[0]).toMatchObject({ tool_use_id: "t1", content: "bulundu" });
		expect(turn.content[1]?.text).toBe(steeringNote(["Tabloyu da ekle"]));
	});

	it("goes to an OpenAI-compatible service after the tools' results", async () => {
		state.sent.length = 0;
		state.answers = [
			`${chunk({
				tool_calls: [
					{ index: 0, id: "c1", function: { name: "search", arguments: '{"query":"onay"}' } },
				],
			})}data: [DONE]\n\n`,
			`${chunk({ content: "Hazır." })}data: [DONE]\n\n`,
		];
		await askApi({
			provider: PROVIDER_INFO.openai,
			connection: { baseUrl: "http://openai.test/v1", model: "gpt-test" },
			key: "k",
			system: "sistem",
			messages: [{ role: "user", content: "Akışı çiz" }],
			signal: new AbortController().signal,
			text: () => {},
			steer: () => ["Kısa tut"],
			tools: search,
		});
		expect(state.sent).toHaveLength(2);
		const messages = state.sent[1]?.body.messages as { role: string; content: unknown }[];
		expect(messages.slice(-3).map((message) => message.role)).toEqual([
			"assistant",
			"tool",
			"user",
		]);
		expect(messages.at(-1)?.content).toBe(steeringNote(["Kısa tut"]));
	});

	it("leaves the round as it was when nothing was added", async () => {
		state.sent.length = 0;
		state.answers = [
			`${chunk({
				tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: "{}" } }],
			})}data: [DONE]\n\n`,
			`${chunk({ content: "Hazır." })}data: [DONE]\n\n`,
		];
		await askApi({
			provider: PROVIDER_INFO.openai,
			connection: { baseUrl: "http://openai.test/v1", model: "gpt-test" },
			key: "k",
			system: "sistem",
			messages: [{ role: "user", content: "Akışı çiz" }],
			signal: new AbortController().signal,
			text: () => {},
			steer: () => [],
			tools: search,
		});
		const messages = state.sent[1]?.body.messages as { role: string }[];
		expect(messages.at(-1)?.role).toBe("tool");
	});
});

describe("pictures a tool returns", () => {
	const picture = { label: "shot.png", mediaType: "image/png" as const, data: "iVBOR" };
	const looking = {
		definitions: [{ name: "look", description: "Bakar", parameters: { type: "object" } }],
		run: async () => ({ text: "Resim:", images: [picture] }),
	};

	it("go to Anthropic inside the tool's result", async () => {
		state.anthropicSent.length = 0;
		state.anthropicAnswers = [
			{
				content: [{ type: "tool_use", id: "t1", name: "look", input: {} }],
				stop_reason: "tool_use",
				usage,
			},
			{ content: [{ type: "text", text: "Gördüm." }], stop_reason: "end_turn", usage },
		];
		await askApi({
			provider: PROVIDER_INFO.anthropic,
			connection: { baseUrl: "http://anthropic.test", model: "claude-test" },
			key: "k",
			system: "sistem",
			messages: [{ role: "user", content: "Bak" }],
			signal: new AbortController().signal,
			text: () => {},
			tools: looking,
		});
		const messages = state.anthropicSent[1]?.messages as { content: unknown }[];
		const turn = messages.at(-1)?.content as { content: unknown }[];
		expect(turn[0]?.content).toEqual([
			{ type: "text", text: "Resim:" },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
		]);
	});

	it("follow the tool's message to an OpenAI-compatible service", async () => {
		state.sent.length = 0;
		state.answers = [
			`${chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "look", arguments: "{}" } }] })}data: [DONE]\n\n`,
			`${chunk({ content: "Gördüm." })}data: [DONE]\n\n`,
		];
		await askApi({
			provider: PROVIDER_INFO.openai,
			connection: { baseUrl: "http://openai.test/v1", model: "gpt-test" },
			key: "k",
			system: "sistem",
			messages: [{ role: "user", content: "Bak" }],
			signal: new AbortController().signal,
			text: () => {},
			tools: looking,
		});
		const messages = state.sent[1]?.body.messages as { role: string; content: unknown }[];
		expect(messages.at(-2)).toMatchObject({ role: "tool", content: "Resim:" });
		expect(messages.at(-1)?.role).toBe("user");
		expect(JSON.stringify(messages.at(-1)?.content)).toContain("data:image/png;base64,iVBOR");
	});
});
