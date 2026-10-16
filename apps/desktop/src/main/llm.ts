/**
 * Asking a service over its API: the Anthropic Messages API through the
 * Anthropic SDK, everything else through an OpenAI-compatible Chat
 * Completions endpoint. Requests go through Electron's network stack, so
 * the system's proxy settings apply.
 */
import Anthropic from "@anthropic-ai/sdk";
import { net } from "electron";
import type { ChatMessage, Connection, ProviderInfo } from "../shared/providers.js";
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
	readonly signal: AbortSignal;
	/** More of the reply. */
	text(chunk: string): void;
}

/** Streams one reply; rejects with the service's message when it fails. */
export async function askApi(options: AskOptions): Promise<void> {
	if (options.provider.protocol === "anthropic") await askAnthropic(options);
	else await askChatCompletions(options);
}

async function askAnthropic(options: AskOptions): Promise<void> {
	const client = anthropic(options.connection, options.key);
	try {
		const stream = client.messages.stream(
			{
				model: options.connection.model,
				max_tokens: MAX_OUTPUT_TOKENS,
				system: options.system,
				messages: options.messages.map(({ role, content }) => ({ role, content })),
			},
			{ signal: options.signal },
		);
		for await (const event of stream) {
			if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
				options.text(event.delta.text);
			}
		}
		const message = await stream.finalMessage();
		if (message.stop_reason === "refusal") {
			const details = message.stop_details;
			throw new Error(details?.explanation || "The model declined to answer this request.");
		}
	} catch (error) {
		if (options.signal.aborted) return;
		throw anthropicError(error);
	}
}

async function askChatCompletions(options: AskOptions): Promise<void> {
	const { url, init } = chatCompletionsRequest(
		options.connection,
		options.key,
		options.system,
		options.messages,
	);
	let response: Response;
	try {
		response = await net.fetch(url, { ...init, signal: options.signal });
	} catch (error) {
		if (options.signal.aborted) return;
		throw error;
	}
	if (!response.ok) throw new Error(httpErrorMessage(response.status, await response.text()));
	const reader = response.body?.getReader();
	if (reader === undefined) return;
	const decoder = new TextDecoder();
	const sse = new SseReader();
	const handle = (data: string): boolean => {
		const delta = chatCompletionsDelta(data);
		if (delta.error !== undefined) throw new Error(delta.error);
		if (delta.text !== undefined) options.text(delta.text);
		return delta.done === true;
	};
	try {
		for (;;) {
			const { done, value } = await reader.read();
			const events = done ? sse.end() : sse.push(decoder.decode(value, { stream: true }));
			for (const event of events) if (handle(event.data)) return;
			if (done) return;
		}
	} catch (error) {
		if (options.signal.aborted) return;
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
