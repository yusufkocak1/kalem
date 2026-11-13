/**
 * The user's say over what the assistant's tools change: kinds of change
 * allowed for this run of the app, kinds allowed always (kept in the
 * settings), and the questions waiting for an answer in a window. Anything
 * online is asked every time, whatever was allowed, unless the user set
 * that tool to run without asking in Settings.
 */
import type { WebContents } from "electron";
import { CHANNEL } from "../shared/bridge.js";
import type {
	ApprovalAnswer,
	ApprovalRequest,
	ApprovalScope,
	ToolPolicy,
	ToolRisk,
} from "../shared/tool-protocol.js";
import { DENIED } from "../shared/tool-protocol.js";

export interface PermissionStore {
	/** The kinds of change allowed always. */
	always(): readonly string[];
	setAlways(permissions: readonly string[]): void;
	/** What the user set for a tool in Settings; `undefined` for its risk's way. */
	toolPolicy?(tool: string): ToolPolicy | undefined;
}

export class PermissionGate {
	readonly #store: PermissionStore;
	readonly #session = new Set<string>();
	readonly #waiting = new Map<
		string,
		{ resolve: (answer: ApprovalAnswer) => void; chatId: string; sender: WebContents }
	>();
	#count = 0;

	constructor(store: PermissionStore) {
		this.#store = store;
	}

	/** Whether a change of this kind runs without asking. */
	allowed(permission: string, risk: Exclude<ToolRisk, "read">): boolean {
		if (risk === "external") return false;
		return this.#session.has(permission) || this.#store.always().includes(permission);
	}

	#remember(permission: string, scope: ApprovalScope): void {
		if (scope === "session") this.#session.add(permission);
		if (scope === "always") {
			const always = this.#store.always();
			if (!always.includes(permission)) this.#store.setAlways([...always, permission]);
		}
	}

	/**
	 * Asks the user in the chat's window, unless the kind of change is
	 * allowed already; resolves with the answer, a refusal when the window
	 * goes or the reply is stopped.
	 */
	ask(sender: WebContents, request: Omit<ApprovalRequest, "id">): Promise<ApprovalAnswer> {
		const policy = this.#store.toolPolicy?.(request.tool);
		if (policy === "off") return Promise.resolve(DENIED);
		// Set to run without asking: everything is allowed, a form to fill in and what must be asked excepted.
		if (policy === "auto" && request.fields === undefined && request.mustAsk !== true) {
			return Promise.resolve({ approved: true, scope: "once" });
		}
		const everyTime = policy === "ask" || request.everyTime === true || request.mustAsk === true;
		if (
			!everyTime &&
			request.items === undefined &&
			request.fields === undefined &&
			this.allowed(request.permission, request.risk)
		) {
			return Promise.resolve({ approved: true, scope: "once" });
		}
		if (everyTime) request = { ...request, scopes: ["once"], everyTime: true };
		if (sender.isDestroyed()) return Promise.resolve(DENIED);
		const id = `approval-${Date.now().toString(36)}-${++this.#count}`;
		return new Promise((resolve) => {
			const gone = (): void => this.answer(id, DENIED);
			sender.once("destroyed", gone);
			this.#waiting.set(id, {
				chatId: request.chatId,
				sender,
				resolve: (answer) => {
					sender.removeListener("destroyed", gone);
					if (answer.approved && request.mustAsk !== true) {
						this.#remember(request.permission, answer.scope);
					}
					resolve(answer);
				},
			});
			sender.send(CHANNEL.assistantApproval, { ...request, id });
		});
	}

	/** The user answered in the window. */
	answer(id: string, answer: ApprovalAnswer): void {
		const waiting = this.#waiting.get(id);
		if (waiting === undefined) return;
		this.#waiting.delete(id);
		waiting.resolve(answer);
	}

	/** The chat's reply was stopped: what it waits for is refused. */
	cancel(sender: WebContents, chatId: string): void {
		for (const [id, waiting] of this.#waiting) {
			if (waiting.sender === sender && waiting.chatId === chatId) this.answer(id, DENIED);
		}
	}

	/** Forgets what was allowed for this run. */
	forgetSession(): void {
		this.#session.clear();
	}
}
