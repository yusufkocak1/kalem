/**
 * Records the main process's requests for the hidden debug mode's network
 * panel. Each place that reaches a server wraps its fetch with `trace`;
 * while debug mode is off the wrapper hands the request on untouched, so
 * nothing is copied, kept or slowed down.
 *
 * Credentials are masked as a request is recorded (`maskHeader`, `maskUrl`,
 * `maskBody`): they never reach the log, the panel or an exported file.
 */
import type {
	NetworkBody,
	NetworkEntry,
	NetworkEvent,
	NetworkHeader,
	NetworkLogState,
	NetworkSource,
	NetworkState,
	NetworkSummary,
} from "../shared/network.js";
import {
	isTextType,
	MAX_BODY_BYTES,
	MAX_ENTRIES,
	MAX_LOG_BYTES,
	maskBody,
	maskHeaders,
	maskUrl,
} from "../shared/network.js";

type FetchInput = string | URL | Request;

interface Recorded {
	summary: NetworkSummary;
	finalUrl?: string;
	requestHeaders: readonly NetworkHeader[];
	responseHeaders: readonly NetworkHeader[];
	requestBody: NetworkBody | null;
	responseBody: NetworkBody | null;
	/** `performance.now()` when it was sent. */
	readonly t0: number;
}

function headerList(headers: Headers): NetworkHeader[] {
	const list: NetworkHeader[] = [];
	headers.forEach((value, name) => {
		list.push({ name, value });
	});
	return list;
}

function requestHeaders(input: FetchInput, init: RequestInit | undefined): Headers {
	const headers = new Headers(input instanceof Request ? input.headers : undefined);
	if (init?.headers !== undefined) {
		new Headers(init.headers).forEach((value, name) => {
			headers.set(name, value);
		});
	}
	return headers;
}

function urlOf(input: FetchInput): string {
	if (typeof input === "string") return input;
	return input instanceof URL ? input.href : input.url;
}

function errorText(error: unknown): string {
	if (error instanceof Error) {
		const cause = (error as { cause?: unknown }).cause;
		return cause instanceof Error && cause.message !== error.message
			? `${error.message} (${cause.message})`
			: error.message;
	}
	return String(error);
}

const encoder = new TextEncoder();

function textBody(text: string, mimeType: string): NetworkBody {
	const size = encoder.encode(text).length;
	const truncated = text.length > MAX_BODY_BYTES;
	return {
		text: maskBody(truncated ? text.slice(0, MAX_BODY_BYTES) : text, mimeType),
		size,
		truncated,
	};
}

/** What was sent: text is kept (masked), anything else is described. */
export function describeRequestBody(body: unknown, mimeType: string): NetworkBody | null {
	if (body === undefined || body === null) return null;
	if (typeof body === "string") return textBody(body, mimeType);
	if (body instanceof URLSearchParams) {
		return textBody(body.toString(), mimeType || "application/x-www-form-urlencoded");
	}
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		const bytes =
			body instanceof ArrayBuffer
				? new Uint8Array(body)
				: new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
		if (isTextType(mimeType)) {
			return { ...textBody(new TextDecoder().decode(bytes), mimeType), size: bytes.byteLength };
		}
		return { text: null, size: bytes.byteLength, truncated: false, kind: mimeType || "binary" };
	}
	if (body instanceof Blob) {
		return { text: null, size: body.size, truncated: false, kind: body.type || "Blob" };
	}
	if (body instanceof FormData) {
		const lines: string[] = [];
		body.forEach((value, name) => {
			lines.push(
				typeof value === "string"
					? `${name}: ${value}`
					: `${name}: [${value.name || "blob"}, ${value.type || "binary"}, ${value.size} B]`,
			);
		});
		const text = lines.join("\n");
		return { text, size: null, truncated: false, kind: "FormData" };
	}
	return { text: null, size: null, truncated: false, kind: "stream" };
}

export class NetworkLog {
	#enabled = false;
	#recording = true;
	readonly #entries = new Map<number, Recorded>();
	#bytes = 0;
	#nextId = 1;
	readonly #listeners = new Set<(event: NetworkEvent) => void>();

	/** Debug mode is on: requests are recorded, unless the panel paused it. */
	get enabled(): boolean {
		return this.#enabled;
	}

	get recording(): boolean {
		return this.#recording;
	}

	/** Turning debug mode off forgets what was recorded. */
	setEnabled(on: boolean): void {
		if (on === this.#enabled) return;
		this.#enabled = on;
		this.#recording = true;
		if (!on) this.#reset();
		this.#emitState();
	}

	setRecording(on: boolean): void {
		if (on === this.#recording) return;
		this.#recording = on;
		this.#emitState();
	}

	clear(): void {
		this.#reset();
		this.#emitState();
	}

	state(): NetworkLogState {
		return {
			recording: this.#enabled && this.#recording,
			entries: [...this.#entries.values()].map((entry) => entry.summary),
		};
	}

	entry(id: number): NetworkEntry | null {
		const recorded = this.#entries.get(id);
		return recorded === undefined ? null : this.#full(recorded);
	}

	/** All of them, oldest first, for an exported file. */
	entries(): NetworkEntry[] {
		return [...this.#entries.values()].map((recorded) => this.#full(recorded));
	}

	onChange(listener: (event: NetworkEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * `fetchImpl` with its requests recorded as coming from `source`. The
	 * answer the caller gets is the one `fetchImpl` gave: its body is read
	 * from a copy (text only), and not at all when debug mode is off.
	 */
	trace<I extends FetchInput>(
		source: NetworkSource,
		fetchImpl: (input: I, init?: RequestInit) => Promise<Response>,
	): (input: I, init?: RequestInit) => Promise<Response> {
		return async (input, init) => {
			if (!this.#enabled || !this.#recording) return fetchImpl(input, init);
			const recorded = this.#begin(source, input, init);
			const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
			let response: Response;
			try {
				response = await fetchImpl(input, init);
			} catch (error) {
				this.#update(recorded, {
					state: signal?.aborted === true ? "aborted" : "failed",
					error: errorText(error),
					duration: performance.now() - recorded.t0,
				});
				throw error;
			}
			this.#respond(recorded, response, signal ?? undefined);
			return response;
		};
	}

	#begin(source: NetworkSource, input: FetchInput, init: RequestInit | undefined): Recorded {
		const headers = requestHeaders(input, init);
		const method = init?.method ?? (input instanceof Request ? input.method : "GET");
		const body =
			init?.body !== undefined
				? describeRequestBody(init.body, headers.get("content-type") ?? "")
				: input instanceof Request && input.body !== null
					? describeRequestBody(input.body, "")
					: null;
		const recorded: Recorded = {
			summary: {
				id: this.#nextId++,
				source,
				// kalem-locale-ok: HTTP methods are ASCII
				method: method.toUpperCase(),
				url: maskUrl(urlOf(input)),
				status: null,
				statusText: "",
				state: "pending",
				started: Date.now(),
				waiting: null,
				duration: null,
				size: null,
				mimeType: "",
			},
			requestHeaders: maskHeaders(headerList(headers)),
			responseHeaders: [],
			requestBody: body,
			responseBody: null,
			t0: performance.now(),
		};
		this.#entries.set(recorded.summary.id, recorded);
		this.#bytes += body?.text?.length ?? 0;
		this.#trim();
		this.#emit(recorded);
		return recorded;
	}

	#respond(recorded: Recorded, response: Response, signal: AbortSignal | undefined): void {
		const mimeType = response.headers.get("content-type") ?? "";
		const length = Number(response.headers.get("content-length") ?? Number.NaN);
		const declared = Number.isFinite(length) && length >= 0 ? length : null;
		const waiting = performance.now() - recorded.t0;
		const redirected =
			response.url !== "" && maskUrl(response.url) !== recorded.summary.url
				? maskUrl(response.url)
				: undefined;
		if (redirected !== undefined) recorded.finalUrl = redirected;
		recorded.responseHeaders = maskHeaders(headerList(response.headers));
		const head = {
			status: response.status,
			statusText: response.statusText,
			mimeType,
			waiting,
		};
		const empty =
			response.body === null || recorded.summary.method === "HEAD" || response.status === 204;
		if (empty || !isTextType(mimeType)) {
			// Files and pictures are not copied: only their size, when the server says it.
			recorded.responseBody = empty
				? null
				: { text: null, size: declared, truncated: false, kind: mimeType || "binary" };
			this.#update(recorded, {
				...head,
				state: "done",
				size: empty ? (declared ?? 0) : declared,
				duration: waiting,
			});
			return;
		}
		this.#update(recorded, head);
		void this.#readBody(recorded, response.clone(), mimeType, signal);
	}

	/** Reads the copy to its end, keeping the first `MAX_BODY_BYTES`; streamed answers too. */
	async #readBody(
		recorded: Recorded,
		copy: Response,
		mimeType: string,
		signal: AbortSignal | undefined,
	): Promise<void> {
		const reader = copy.body?.getReader();
		if (reader === undefined) return;
		const kept: Uint8Array[] = [];
		let keptBytes = 0;
		let size = 0;
		let failure: unknown = null;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (keptBytes < MAX_BODY_BYTES) {
					const part = value.subarray(0, MAX_BODY_BYTES - keptBytes);
					kept.push(part);
					keptBytes += part.byteLength;
				}
			}
		} catch (error) {
			failure = error;
		}
		const bytes = new Uint8Array(keptBytes);
		let offset = 0;
		for (const part of kept) {
			bytes.set(part, offset);
			offset += part.byteLength;
		}
		const text = maskBody(new TextDecoder().decode(bytes), mimeType);
		recorded.responseBody = { text, size, truncated: size > keptBytes };
		if (this.#entries.has(recorded.summary.id)) this.#bytes += text.length;
		this.#update(recorded, {
			size,
			duration: performance.now() - recorded.t0,
			...(failure === null
				? { state: "done" as NetworkState }
				: {
						state: (signal?.aborted === true ? "aborted" : "failed") as NetworkState,
						error: errorText(failure),
					}),
		});
		this.#trim();
	}

	#update(recorded: Recorded, patch: Partial<NetworkSummary>): void {
		recorded.summary = { ...recorded.summary, ...patch };
		this.#emit(recorded);
	}

	#full(recorded: Recorded): NetworkEntry {
		return {
			...recorded.summary,
			...(recorded.finalUrl === undefined ? {} : { finalUrl: recorded.finalUrl }),
			requestHeaders: recorded.requestHeaders,
			responseHeaders: recorded.responseHeaders,
			requestBody: recorded.requestBody,
			responseBody: recorded.responseBody,
		};
	}

	/** The oldest rows go first when there are too many or their bodies are too large. */
	#trim(): void {
		while (
			this.#entries.size > MAX_ENTRIES ||
			(this.#bytes > MAX_LOG_BYTES && this.#entries.size > 1)
		) {
			const [id, oldest] = this.#entries.entries().next().value as [number, Recorded];
			this.#entries.delete(id);
			this.#bytes -=
				(oldest.requestBody?.text?.length ?? 0) + (oldest.responseBody?.text?.length ?? 0);
		}
	}

	#reset(): void {
		this.#entries.clear();
		this.#bytes = 0;
	}

	#emit(recorded: Recorded): void {
		// A row cleared away or dropped while its answer was coming is not brought back.
		if (!this.#entries.has(recorded.summary.id)) return;
		const first = this.#entries.keys().next().value ?? recorded.summary.id;
		const event: NetworkEvent = { type: "entry", entry: recorded.summary, first };
		for (const listener of this.#listeners) listener(event);
	}

	#emitState(): void {
		const event: NetworkEvent = { type: "state", state: this.state() };
		for (const listener of this.#listeners) listener(event);
	}
}

/** The app's one log; `main.ts` turns it on with debug mode. */
export const networkLog = new NetworkLog();
