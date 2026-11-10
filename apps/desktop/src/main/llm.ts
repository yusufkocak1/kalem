/**
 * Asking a service over its API: the Anthropic Messages API through the
 * Anthropic SDK, everything else through an OpenAI-compatible Chat
 * Completions endpoint. Requests go through Electron's network stack, so
 * the system's proxy settings apply.
 */
import Anthropic from "@anthropic-ai/sdk";
import { net } from "electron";
import type { PromptImage } from "../shared/claude.js";
import { promptContent } from "../shared/claude.js";
import type { ChatMessage, ChatTool, Connection, ProviderInfo } from "../shared/providers.js";
import {
	chatCompletionsDelta,
	chatCompletionsRequest,
	httpErrorMessage,
	MAX_OUTPUT_TOKENS,
	modelIds,
	SseReader,
} from "../shared/providers.js";

const electronFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
	net.fetch(
		input instanceof URL ? input.toString() : (input as string | Request),
		init,
	)) as typeof fetch;

function anthropic(connection: Connection, key: string | null): Anthropic {
	return new Anthropic({
		apiKey: key ?? "",
		baseURL: connection.baseUrl,
		fetch: electronFetch,
		maxRetries: 2,
	});
}

/** The SDK's errors carry the service's own message; the status alone says little. */
function anthropicError(error: unknown): Error {
	if (error instanceof Anthropic.AuthenticationError)
		return new Error(`HTTP 401: ${error.message}`);
	if (error instanceof Anthropic.APIError) return new Error(error.message);
	return error instanceof Error ? error : new Error(String(error));
}

export interface AskOptions {
	readonly provider: ProviderInfo;
	readonly connection: Connection;
	readonly key: string | null;
	readonly system: string;
	readonly messages: readonly ChatMessage[];
	/** Pictures that go with the last message. */
	readonly images?: readonly PromptImage[];
	readonly signal: AbortSignal;
	/** More of the reply. */
	text(chunk: string): void;
	/** Tools the model may call while it answers (a workspace's search and read). */
	readonly tools?: AskTools;
	/** What a round of the answer cost, in tokens. */
	usage?(usage: { input: number; output: number; cached: number }): void;
}

export interface AskTools {
	readonly definitions: readonly ChatTool[];
	/** Runs one call; what it returns goes back to the model. */
	run(name: string, input: unknown): Promise<string>;
}

/** Calls of tools one answer may make; the last round must answer with what it has. */
export const MAX_TOOL_ROUNDS = 30;

/** Text of a new round after earlier text starts on a new paragraph. */
function paragraphs(text: (chunk: string) => void): { write(chunk: string): void; round(): void } {
	let written = false;
	let fresh = false;
	return {
		write(chunk) {
			if (chunk === "") return;
			if (fresh && written) text("\n\n");
			fresh = false;
			written = true;
			text(chunk);
		},
		round() {
			fresh = true;
		},
	};
}

/**
 * Streams one reply; rejects with the service's message when it fails. A
 * model that does not read pictures is asked again without them.
 */
export async function askApi(options: AskOptions): Promise<void> {
	const ask = (asked: AskOptions): Promise<void> =>
		asked.provider.protocol === "anthropic" ? askAnthropic(asked) : askChatCompletions(asked);
	if ((options.images ?? []).length === 0) return ask(options);
	let answered = false;
	try {
		await ask({
			...options,
			text: (chunk) => {
				answered = true;
				options.text(chunk);
			},
		});
	} catch (error) {
		if (answered || options.signal.aborted) throw error;
		await ask({ ...options, images: [] });
	}
}

const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * The messages with a cache breakpoint on the last one: the next round (a
 * tool's result) and the next question start with all of this, so the
 * service reads it from its prompt cache instead of processing it again.
 * Only the last message carries one; with the system prompt and the tools
 * that makes three, under the service's limit of four.
 */
export function cachedUpToHere(
	messages: readonly Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
	return messages.map((message, i) => {
		if (i !== messages.length - 1) return message;
		const blocks: Anthropic.ContentBlockParam[] =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: [...message.content];
		const last = blocks.at(-1);
		if (last === undefined || last.type === "thinking" || last.type === "redacted_thinking") {
			return message;
		}
		blocks[blocks.length - 1] = { ...last, cache_control: EPHEMERAL };
		return { ...message, content: blocks };
	});
}

async function askAnthropic(options: AskOptions): Promise<void> {
	const client = anthropic(options.connection, options.key);
	const tools = options.tools;
	const out = paragraphs(options.text);
	const messages: Anthropic.MessageParam[] = options.messages.map(({ role, content }, i) =>
		i === options.messages.length - 1 && role === "user"
			? { role, content: promptContent(content, options.images ?? []) }
			: { role, content },
	);
	try {
		for (let round = 1; ; round++) {
			const last = round >= MAX_TOOL_ROUNDS;
			const stream = client.messages.stream(
				{
					model: options.connection.model,
					max_tokens: MAX_OUTPUT_TOKENS,
					// What does not change between questions and rounds is read from the cache.
					system: [{ type: "text", text: options.system, cache_control: EPHEMERAL }],
					messages: cachedUpToHere(messages),
					...(tools === undefined
						? {}
						: {
								tools: tools.definitions.map(({ name, description, parameters }, i) => ({
									name,
									description,
									input_schema: parameters as Anthropic.Tool.InputSchema,
									...(i === tools.definitions.length - 1 ? { cache_control: EPHEMERAL } : {}),
								})),
								...(last ? { tool_choice: { type: "none" as const } } : {}),
							}),
				},
				{ signal: options.signal },
			);
			for await (const event of stream) {
				if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
					out.write(event.delta.text);
				}
			}
			const message = await stream.finalMessage();
			options.usage?.({
				input: message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0),
				output: message.usage.output_tokens,
				cached: message.usage.cache_read_input_tokens ?? 0,
			});
			if (message.stop_reason === "refusal") {
				const details = message.stop_details;
				throw new Error(details?.explanation || "The model declined to answer this request.");
			}
			const calls = message.content.filter(
				(block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
			);
			if (tools === undefined || message.stop_reason !== "tool_use" || calls.length === 0) return;
			// Calls the model made together run together; their results keep its order.
			const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
				calls.map(async (call) => ({
					type: "tool_result" as const,
					tool_use_id: call.id,
					content: await tools.run(call.name, call.input),
				})),
			);
			messages.push(
				{ role: "assistant", content: message.content as Anthropic.ContentBlockParam[] },
				{ role: "user", content: results },
			);
			out.round();
		}
	} catch (error) {
		if (options.signal.aborted) return;
		throw anthropicError(error);
	}
}

/** A tool call put together from its streamed pieces. */
interface ToolCall {
	id: string;
	name: string;
	arguments: string;
}

async function askChatCompletions(options: AskOptions): Promise<void> {
	const tools = options.tools;
	const out = paragraphs(options.text);
	const turn: unknown[] = [];
	for (let round = 1; ; round++) {
		const last = round >= MAX_TOOL_ROUNDS;
		const { url, init } = chatCompletionsRequest(
			options.connection,
			options.key,
			options.system,
			options.messages,
			options.images,
			// The last round has no tools left: it answers with what it found.
			{
				...(tools === undefined ? {} : { tools: last ? [] : tools.definitions, turn }),
				// Only the services known to take it: others may refuse a field they do not know.
				usage: options.provider.id === "openai" || options.provider.id === "openrouter",
			},
		);
		const calls = new Map<number, ToolCall>();
		let said = "";
		const ended = await streamChatCompletions(url, init, options.signal, (delta) => {
			if (delta.text !== undefined) {
				said += delta.text;
				out.write(delta.text);
			}
			if (delta.usage !== undefined) options.usage?.(delta.usage);
			for (const piece of delta.toolCalls ?? []) {
				const call = calls.get(piece.index) ?? { id: "", name: "", arguments: "" };
				if (piece.id !== undefined) call.id = piece.id;
				if (piece.name !== undefined) call.name += piece.name;
				if (piece.arguments !== undefined) call.arguments += piece.arguments;
				calls.set(piece.index, call);
			}
		});
		if (!ended || tools === undefined || calls.size === 0) return;
		const made = [...calls.values()].map((call, i) => ({
			...call,
			id: call.id === "" ? `call_${round}_${i}` : call.id,
		}));
		turn.push({
			role: "assistant",
			content: said === "" ? null : said,
			tool_calls: made.map(({ id, name, arguments: args }) => ({
				id,
				type: "function",
				function: { name, arguments: args === "" ? "{}" : args },
			})),
		});
		// Calls the model made together run together; their results keep its order.
		const results = await Promise.all(
			made.map(async (call) => {
				let input: unknown = {};
				try {
					input = JSON.parse(call.arguments === "" ? "{}" : call.arguments);
				} catch {
					// Arguments that are not JSON: the tool says what it misses.
				}
				return { role: "tool", tool_call_id: call.id, content: await tools.run(call.name, input) };
			}),
		);
		turn.push(...results);
		out.round();
	}
}

/** Reads one streamed answer; `false` when it was stopped. */
async function streamChatCompletions(
	url: string,
	init: RequestInit,
	signal: AbortSignal,
	handle: (delta: ReturnType<typeof chatCompletionsDelta>) => void,
): Promise<boolean> {
	let response: Response;
	try {
		response = await net.fetch(url, { ...init, signal });
	} catch (error) {
		if (signal.aborted) return false;
		throw error;
	}
	if (!response.ok) throw new Error(httpErrorMessage(response.status, await response.text()));
	const reader = response.body?.getReader();
	if (reader === undefined) return true;
	const decoder = new TextDecoder();
	const sse = new SseReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			const events = done ? sse.end() : sse.push(decoder.decode(value, { stream: true }));
			for (const event of events) {
				const delta = chatCompletionsDelta(event.data);
				if (delta.error !== undefined) throw new Error(delta.error);
				handle(delta);
				if (delta.done === true) return true;
			}
			if (done) return true;
		}
	} catch (error) {
		if (signal.aborted) return false;
		throw error;
	} finally {
		reader.releaseLock();
	}
}

/** The models the service offers, for the model field's suggestions. */
export async function listModels(
	provider: ProviderInfo,
	connection: Connection,
	key: string | null,
): Promise<string[]> {
	if (provider.protocol === "anthropic") {
		try {
			const ids: string[] = [];
			for await (const model of anthropic(connection, key).models.list()) ids.push(model.id);
			return ids;
		} catch (error) {
			throw anthropicError(error);
		}
	}
	const response = await net.fetch(provider.modelsUrl ?? `${connection.baseUrl}/models`, {
		headers: key ? { authorization: `Bearer ${key}` } : {},
	});
	const body = await response.text();
	if (!response.ok) throw new Error(httpErrorMessage(response.status, body));
	try {
		return modelIds(JSON.parse(body));
	} catch {
		return [];
	}
}
