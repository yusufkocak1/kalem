import { normalize, resolveRequest, variablesOf } from "./requests.js";

const MAX_HISTORY = 50;
const MAX_TOOL_BODY = 30_000;

export async function activate(kalem) {
	const read = async (key, fallback) => (await kalem.storage.get(key)) ?? fallback;

	async function state() {
		return {
			collection: (await read("collection", [])).map(normalize),
			history: await read("history", []),
			environments: await read("environments", []),
			environment: await read("environment", null),
		};
	}

	async function environmentVars(name) {
		const environments = await read("environments", []);
		const chosen = name ?? (await read("environment", null));
		return variablesOf(environments.find((each) => each.id === chosen || each.name === chosen));
	}

	async function send(raw, environment) {
		const request = normalize(raw);
		const resolved = resolveRequest(request, await environmentVars(environment));
		if (resolved.url === "") throw new Error("Give the request an address.");
		const started = performance.now();
		const response = await kalem.http.fetch(resolved.url, {
			method: resolved.method,
			headers: resolved.headers,
			body: resolved.body,
			timeoutMs: 120_000,
		});
		const time = Math.round(performance.now() - started);
		const size = new TextEncoder().encode(response.body).byteLength;
		const history = await read("history", []);
		history.unshift({
			id: `${Date.now()}`,
			at: Date.now(),
			status: response.status,
			time,
			request: { ...request, id: `h${Date.now()}` },
		});
		await kalem.storage.set("history", history.slice(0, MAX_HISTORY));
		return { ...response, time, size, sent: resolved };
	}

	await kalem.ui.handle("state", state);
	await kalem.ui.handle("send", (input) => send(input?.request ?? {}, input?.environment ?? null));
	await kalem.ui.handle("save", async (raw) => {
		const request = normalize(raw);
		const collection = (await read("collection", [])).map(normalize);
		const at = collection.findIndex((each) => each.id === request.id);
		if (at === -1) collection.push(request);
		else collection[at] = request;
		await kalem.storage.set("collection", collection);
		return state();
	});
	await kalem.ui.handle("delete", async (id) => {
		await kalem.storage.set(
			"collection",
			(await read("collection", [])).filter((each) => each.id !== id),
		);
		return state();
	});
	await kalem.ui.handle("clearHistory", async () => {
		await kalem.storage.set("history", []);
		return state();
	});
	await kalem.ui.handle("environments", async (input) => {
		await kalem.storage.set(
			"environments",
			Array.isArray(input?.environments) ? input.environments : [],
		);
		await kalem.storage.set("environment", input?.environment ?? null);
		return state();
	});
	await kalem.commands.register("open", () => kalem.ui.showPane("client"));

	const describe = (result) => {
		const headers = Object.entries(result.headers)
			.map(([name, value]) => `${name}: ${value}`)
			.join("\n");
		const body =
			result.body.length > MAX_TOOL_BODY
				? `${result.body.slice(0, MAX_TOOL_BODY)}\n… (${result.size} bytes in all)`
				: result.body;
		return `${result.sent.method} ${result.sent.url}\n→ ${result.status} ${result.statusText} in ${result.time} ms, ${result.size} bytes\n\n${headers}\n\n${body}`;
	};

	await kalem.assistant.registerTool(
		{
			name: "rest_request",
			description:
				"Sends an HTTP request with the REST client (as Postman does) and returns the status, headers and body. {{variables}} take the active environment's values. The user is asked before each call.",
			parameters: {
				type: "object",
				properties: {
					method: {
						type: "string",
						enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
					},
					url: { type: "string" },
					headers: { type: "object", additionalProperties: { type: "string" } },
					body: { type: "string", description: "The body as text (JSON as a string)." },
				},
				required: ["method", "url"],
			},
			writes: true,
		},
		async (input) => {
			const headers = Object.entries(input?.headers ?? {}).map(([key, value]) => ({
				key,
				value: String(value),
				on: true,
			}));
			const isJson = typeof input?.body === "string" && /^\s*[[{]/.test(input.body);
			const result = await send({
				method: input?.method,
				url: input?.url,
				headers,
				body: input?.body ? { mode: isJson ? "json" : "text", text: input.body } : { mode: "none" },
			});
			return describe(result);
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "rest_saved_requests",
			description:
				"Lists the REST client's saved requests (name, method, address) and its environments.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		async () => {
			const current = await state();
			const requests = current.collection.map(
				(each) => `- ${each.name || "(unnamed)"}: ${each.method} ${each.url}`,
			);
			const environments = current.environments.map(
				(each) =>
					`- ${each.name}${each.id === current.environment ? " (active)" : ""}: ${each.vars.map((row) => row.key).join(", ")}`,
			);
			return `Saved requests:\n${requests.join("\n") || "(none)"}\n\nEnvironments:\n${environments.join("\n") || "(none)"}`;
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "rest_send_saved",
			description:
				"Sends one of the REST client's saved requests by its name. The user is asked before each call.",
			parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
			writes: true,
		},
		async (input) => {
			const saved = (await state()).collection.find((each) => each.name === input?.name);
			if (saved === undefined) return `There is no saved request named "${input?.name}".`;
			return describe(await send(saved));
		},
	);
}
