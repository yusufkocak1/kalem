/**
 * The services the assistant can talk to: the Claude Code and GitHub
 * Copilot CLIs on this computer, the Anthropic API, and any service with an
 * OpenAI-compatible Chat Completions API (OpenAI, Google Gemini, GitHub
 * Models, OpenRouter, Ollama, LM Studio, or another address). Pure: the
 * main process makes the requests.
 */
import type { PromptImage } from "./claude.js";
import type { Strings } from "./i18n.js";

export const PROVIDERS = [
	"claude-code",
	"copilot",
	"anthropic",
	"openai",
	"gemini",
	"github-models",
	"openrouter",
	"ollama",
	"lmstudio",
	"custom",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export interface ProviderInfo {
	readonly id: ProviderId;
	/** How it is asked: a CLI on this computer, the Anthropic Messages API, or Chat Completions. */
	readonly protocol: "claude-cli" | "copilot-cli" | "anthropic" | "openai";
	/** Brand name; `null` for the two named in the interface's language. */
	readonly name: string | null;
	readonly baseUrl: string;
	readonly defaultModel: string;
	readonly needsKey: boolean;
	/** Where to get a key. */
	readonly keyUrl: string | null;
	/** Where its models are listed, when not at `<baseUrl>/models`. */
	readonly modelsUrl?: string;
}

/** Models offered for a service that cannot list its own: Claude Code's aliases. */
export const SUGGESTED_MODELS: Readonly<Partial<Record<ProviderId, readonly string[]>>> = {
	"claude-code": ["opus", "sonnet", "haiku"],
};

/**
 * The models a CLI's `--help` lists for its `--model` option: GitHub
 * Copilot's reads `(choices: "claude-sonnet-4.5", "gpt-5", …)`. Model names
 * the option's description quotes as examples count too (Claude Code's
 * `'sonnet'`, `'claude-sonnet-…'`). Empty when the help names none.
 */
export function modelsFromHelp(help: string): string[] {
	const lines = help.split(/\r?\n/);
	const start = lines.findIndex((line) => /^\s*(?:-\w,\s*)?--model[\s=<]/.test(line));
	if (start === -1) return [];
	// The option's text runs until the next option.
	let text = lines[start] ?? "";
	for (const line of lines.slice(start + 1)) {
		if (/^\s*-/.test(line) || line.trim() === "") break;
		text += ` ${line.trim()}`;
	}
	const names = [...text.matchAll(/["'`]([\w.:/@-]+)["'`]/g)].map((match) => match[1] as string);
	return [...new Set(names.filter((name) => /[a-z]/i.test(name) && !name.startsWith("-")))];
}

/** Whether the service is a program on this computer rather than an API. */
export const isCli = (info: ProviderInfo): boolean =>
	info.protocol === "claude-cli" || info.protocol === "copilot-cli";

export const PROVIDER_INFO: Readonly<Record<ProviderId, ProviderInfo>> = {
	"claude-code": {
		id: "claude-code",
		protocol: "claude-cli",
		name: null,
		baseUrl: "",
		defaultModel: "",
		needsKey: false,
		keyUrl: null,
	},
	copilot: {
		id: "copilot",
		protocol: "copilot-cli",
		name: null,
		baseUrl: "",
		defaultModel: "",
		needsKey: false,
		keyUrl: null,
	},
	anthropic: {
		id: "anthropic",
		protocol: "anthropic",
		name: "Anthropic (Claude API)",
		baseUrl: "https://api.anthropic.com",
		defaultModel: "claude-opus-5-5",
		needsKey: true,
		keyUrl: "https://console.anthropic.com/settings/keys",
	},
	openai: {
		id: "openai",
		protocol: "openai",
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		defaultModel: "",
		needsKey: true,
		keyUrl: "https://platform.openai.com/api-keys",
	},
	gemini: {
		id: "gemini",
		protocol: "openai",
		name: "Google Gemini",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
		defaultModel: "",
		needsKey: true,
		keyUrl: "https://aistudio.google.com/apikey",
	},
	"github-models": {
		id: "github-models",
		protocol: "openai",
		name: "GitHub Models",
		baseUrl: "https://models.github.ai/inference",
		defaultModel: "openai/gpt-4.1",
		needsKey: true,
		keyUrl: "https://github.com/settings/personal-access-tokens/new",
		modelsUrl: "https://models.github.ai/catalog/models",
	},
	openrouter: {
		id: "openrouter",
		protocol: "openai",
		name: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		defaultModel: "",
		needsKey: true,
		keyUrl: "https://openrouter.ai/keys",
	},
	ollama: {
		id: "ollama",
		protocol: "openai",
		name: "Ollama",
		baseUrl: "http://localhost:11434/v1",
		defaultModel: "",
		needsKey: false,
		keyUrl: null,
	},
	lmstudio: {
		id: "lmstudio",
		protocol: "openai",
		name: "LM Studio",
		baseUrl: "http://localhost:1234/v1",
		defaultModel: "",
		needsKey: false,
		keyUrl: null,
	},
	custom: {
		id: "custom",
		protocol: "openai",
		name: null,
		baseUrl: "",
		defaultModel: "",
		needsKey: false,
		keyUrl: null,
	},
};

/** The service's name as the interface shows it. */
export function providerLabel(t: Strings, id: ProviderId): string {
	if (id === "claude-code") return t.providerClaudeCode;
	if (id === "copilot") return t.providerCopilot;
	if (id === "custom") return t.providerCustom;
	return PROVIDER_INFO[id].name ?? id;
}

export const isProvider = (value: unknown): value is ProviderId =>
	typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);

/** A service's address and model, as the user set them. */
export interface Connection {
	readonly baseUrl: string;
	readonly model: string;
}

/** What the renderer sees of the settings: never a key, only whether one is kept. */
export interface AssistantConfig {
	readonly provider: ProviderId;
	readonly connections: Readonly<Record<ProviderId, Connection & { readonly hasKey: boolean }>>;
	/** Whether keys are kept encrypted on disk, rather than until the app quits. */
	readonly encrypted: boolean;
}

/** A change to one service's settings; it becomes the one in use. */
export interface AssistantUpdate {
	readonly provider: ProviderId;
	readonly baseUrl: string;
	readonly model: string;
	/** A new key; `null` forgets the kept one, left out keeps it. */
	readonly key?: string | null;
}

/** An address the main process may send a document to: http(s) only. */
export function checkBaseUrl(value: string): string {
	const text = value.trim().replace(/\/+$/, "");
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw new Error(`Not an address: ${value}`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error(`Not an address: ${value}`);
	return text;
}

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
	readonly role: ChatRole;
	readonly content: string;
}

/** Longer answers are cut by the service; this leaves room for long documents. */
export const MAX_OUTPUT_TOKENS = 64_000;

/** A Chat Completions request that streams. */
export function chatCompletionsRequest(
	connection: Connection,
	key: string | null,
	system: string,
	messages: readonly ChatMessage[],
	images: readonly PromptImage[] = [],
): { url: string; init: RequestInit } {
	// Pictures go with the last question, each after its name.
	const sent = messages.map(({ role, content }, i) =>
		images.length > 0 && i === messages.length - 1 && role === "user"
			? {
					role,
					content: [
						{ type: "text", text: content },
						...images.flatMap(({ label, mediaType, data }) => [
							{ type: "text", text: `[${label}]` },
							{ type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } },
						]),
					],
				}
			: { role, content },
	);
	return {
		url: `${connection.baseUrl}/chat/completions`,
		init: {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
				...(key ? { authorization: `Bearer ${key}` } : {}),
			},
			body: JSON.stringify({
				model: connection.model,
				stream: true,
				messages: [{ role: "system", content: system }, ...sent],
			}),
		},
	};
}

export interface SseEvent {
	readonly event: string;
	readonly data: string;
}

/** Server-sent events from a stream that arrives in pieces. */
export class SseReader {
	#rest = "";
	#event = "";
	#data: string[] = [];

	push(chunk: string): SseEvent[] {
		const text = this.#rest + chunk;
		const lines = text.split(/\r?\n/);
		this.#rest = lines.pop() ?? "";
		const events: SseEvent[] = [];
		for (const line of lines) {
			if (line === "") {
				if (this.#data.length > 0)
					events.push({ event: this.#event || "message", data: this.#data.join("\n") });
				this.#event = "";
				this.#data = [];
			} else if (line.startsWith("data:")) this.#data.push(line.slice(5).replace(/^ /, ""));
			else if (line.startsWith("event:")) this.#event = line.slice(6).trim();
		}
		return events;
	}

	/** What is left when the stream ends without a blank line. */
	end(): SseEvent[] {
		const events = this.push("\n\n");
		this.#rest = "";
		return events;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** One Chat Completions stream event: more text, the end, or an error. */
export function chatCompletionsDelta(data: string): {
	text?: string;
	done?: boolean;
	error?: string;
} {
	if (data.trim() === "[DONE]") return { done: true };
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return {};
	}
	if (!isRecord(parsed)) return {};
	if (parsed.error !== undefined) return { error: errorText(parsed.error) };
	const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
	if (!isRecord(choice)) return {};
	const delta = isRecord(choice.delta) ? choice.delta : {};
	const text = typeof delta.content === "string" ? delta.content : "";
	return text === "" ? {} : { text };
}

function errorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (isRecord(error) && typeof error.message === "string") return error.message;
	return JSON.stringify(error);
}

/** A failed request's message, from the body most services send with it. */
export function httpErrorMessage(status: number, body: string): string {
	let detail = body.trim().slice(0, 500);
	try {
		const parsed: unknown = JSON.parse(body);
		const inner = isRecord(parsed) ? (parsed.error ?? parsed.message ?? parsed.detail) : undefined;
		const first = Array.isArray(parsed) ? parsed[0] : undefined;
		const found = inner ?? (isRecord(first) ? first.error : undefined);
		if (found !== undefined) detail = errorText(found);
	} catch {
		// Not JSON: the text itself.
	}
	return detail === "" ? `HTTP ${status}` : `HTTP ${status}: ${detail}`;
}

/** Model ids from a `/models` answer (OpenAI-compatible and Anthropic both use `data[].id`), or a catalog list. */
export function modelIds(json: unknown): string[] {
	// GitHub Models' catalog is a bare array.
	const list = Array.isArray(json) ? json : isRecord(json) ? (json.data ?? json.models) : undefined;
	if (!Array.isArray(list)) return [];
	const ids = list
		.map((item) => (isRecord(item) ? (item.id ?? item.name) : item))
		.filter((id): id is string => typeof id === "string" && id !== "")
		// Gemini lists its models as `models/<id>`; requests take the id alone.
		.map((id) => id.replace(/^models\//, ""));
	return [...new Set(ids)].sort((a, b) => a.localeCompare(b, "en"));
}
