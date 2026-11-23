/**
 * The messages the user adds to an answer while it runs: kept until the
 * answer can take them in, and passed on at once while it can (Claude
 * Code's input is open). Once the answer ends no more are taken; those it
 * never took in are the window's, which asks them as the next question.
 */
import type { Steered } from "../shared/steering.js";

export class Steering {
	#queued: Steered[] = [];
	#closed = false;
	#added: (() => void) | null = null;

	/** Whether the answer has ended. */
	get closed(): boolean {
		return this.#closed;
	}

	/** Keeps a message for the answer; `false` once it has ended. */
	add(message: Steered): boolean {
		if (this.#closed) return false;
		this.#queued.push(message);
		this.#added?.();
		return true;
	}

	/** Takes back a message the answer has not taken in yet; whether there was one. */
	withdraw(id: string): boolean {
		const before = this.#queued.length;
		this.#queued = this.#queued.filter((message) => message.id !== id);
		return this.#queued.length < before;
	}

	/** The messages waiting, in the order they came, now taken in by the answer. */
	take(): Steered[] {
		const taken = this.#queued;
		this.#queued = [];
		return taken;
	}

	/** Called each time a message comes; `null` stops it. */
	listen(added: (() => void) | null): void {
		this.#added = added;
	}

	/** The answer has ended: no more are taken. */
	close(): void {
		this.#closed = true;
		this.#added = null;
	}
}
