/**
 * The assistant's chats, kept on disk so they can be picked up again: what
 * was asked and answered, and how to continue the conversation (the
 * service, its session and, for a CLI, the folder it ran in).
 */
import type { ChatMessage, ProviderId } from "./providers.js";
import { isProvider } from "./providers.js";

export interface StoredMessage {
	readonly role: "user" | "assistant";
	/** The question as typed (not the document sent with it), or the reply. */
	readonly text: string;
	readonly error: string | null;
	/** What went with a question: the document, the selection. */
	readonly notes: readonly string[];
}

export interface StoredChat {
	readonly id: string;
	readonly title: string;
	readonly provider: ProviderId;
	readonly sessionId: string | null;
	readonly folder: string | null;
	readonly created: number;
	readonly updated: number;
	readonly messages: readonly StoredMessage[];
}

export interface ChatSummary {
	readonly id: string;
	readonly title: string;
	readonly provider: ProviderId;
	readonly updated: number;
	readonly count: number;
}

export const MAX_CHATS = 100;
const MAX_MESSAGES = 400;
const MAX_TEXT = 200_000;

/** A chat's name: the start of its first question. */
export function chatTitle(question: string): string {
	const line = question.replace(/\s+/g, " ").trim();
	return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

const str = (value: unknown, max: number): string =>
	typeof value === "string" ? value.slice(0, max) : "";

const time = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Date.now();

/** A chat read from disk or sent by a window; `null` when it is not one. */
export function parseChat(raw: unknown): StoredChat | null {
	if (typeof raw !== "object" || raw === null) return null;
	const chat = raw as Record<string, unknown>;
	const id = str(chat.id, 100);
	if (!/^[\w-]{1,100}$/.test(id) || !isProvider(chat.provider)) return null;
	const messages = (Array.isArray(chat.messages) ? chat.messages : [])
		.slice(-MAX_MESSAGES)
		.flatMap((item): StoredMessage[] => {
			if (typeof item !== "object" || item === null) return [];
			const message = item as Record<string, unknown>;
			if (message.role !== "user" && message.role !== "assistant") return [];
			return [
				{
					role: message.role,
					text: str(message.text, MAX_TEXT),
					error: typeof message.error === "string" ? message.error.slice(0, 4000) : null,
					notes: (Array.isArray(message.notes) ? message.notes : [])
						.filter((note): note is string => typeof note === "string")
						.slice(0, 5)
						.map((note) => note.slice(0, 300)),
				},
			];
		});
	const sessionId = str(chat.sessionId, 100);
	const folder = str(chat.folder, 4096);
	return {
		id,
		title: str(chat.title, 200),
		provider: chat.provider,
		sessionId: /^[\w-]{1,100}$/.test(sessionId) ? sessionId : null,
		folder: folder === "" ? null : folder,
		created: time(chat.created),
		updated: time(chat.updated),
		messages,
	};
}

export function chatSummary(chat: StoredChat): ChatSummary {
	return {
		id: chat.id,
		title: chat.title,
		provider: chat.provider,
		updated: chat.updated,
		count: chat.messages.length,
	};
}

/**
 * What an API is sent again to continue a chat it has not seen in this
 * run: answered questions with their replies, taking turns, without the
 * documents that went with them.
 */
export function historyOf(messages: readonly StoredMessage[], max = 40): ChatMessage[] {
	const history: ChatMessage[] = [];
	for (let i = 0; i + 1 < messages.length; i++) {
		const question = messages[i] as StoredMessage;
		const reply = messages[i + 1] as StoredMessage;
		if (question.role !== "user" || reply.role !== "assistant") continue;
		if (reply.text.trim() === "" || question.text.trim() === "") continue;
		history.push(
			{ role: "user", content: question.text },
			{ role: "assistant", content: reply.text },
		);
		i++;
	}
	return history.slice(-max);
}
