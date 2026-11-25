import { faultOf, readWsdl } from "./wsdl.js";

const MAX_RECENT = 12;
const MAX_TOOL_BODY = 30_000;

export async function activate(kalem) {
	const read = async (key, fallback) => (await kalem.storage.get(key)) ?? fallback;
	const loaded = new Map();

	async function fetchText(url, headers = {}) {
		const response = await kalem.http.fetch(url, {
			headers: { Accept: "text/xml, application/xml, */*", ...headers },
			timeoutMs: 60_000,
		});
		if (!response.ok)
			throw new Error(`${url}: the server answered ${response.status} ${response.statusText}`);
		return response.body;
	}

	/** A WSDL's services and operations, each with its sample request (as plain data). */
	async function load(url, force = false) {
		const address = String(url ?? "").trim();
		if (address === "") throw new Error("Give the WSDL's address (…?wsdl).");
		if (!force && loaded.has(address)) return loaded.get(address);
		const wsdl = await readWsdl(await fetchText(address), address, (target) => fetchText(target));
		const plain = {
			url: address,
			name: wsdl.name,
			targetNamespace: wsdl.targetNamespace,
			services: wsdl.services.map((service) => ({
				name: service.name,
				ports: service.ports.map((port) => ({
					name: port.name,
					version: port.version,
					endpoint: port.endpoint,
					operations: port.operations.map((operation) => ({
						name: operation.name,
						action: operation.action,
						documentation: operation.documentation,
						sample: operation.sample(),
					})),
				})),
			})),
		};
		loaded.set(address, plain);
		const recent = (await read("recent", [])).filter((each) => each.url !== address);
		recent.unshift({ url: address, name: plain.name });
		await kalem.storage.set("recent", recent.slice(0, MAX_RECENT));
		return plain;
	}

	async function call(input) {
		const version = input?.version === "1.2" ? "1.2" : "1.1";
		const endpoint = String(input?.endpoint ?? "").trim();
		if (endpoint === "") throw new Error("Give the endpoint's address.");
		const action = String(input?.action ?? "");
		const headers = {
			...(version === "1.1"
				? { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${action}"` }
				: {
						"Content-Type": `application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ""}`,
					}),
			...(input?.headers ?? {}),
		};
		if (input?.username) {
			const bytes = new TextEncoder().encode(`${input.username}:${input.password ?? ""}`);
			headers.Authorization = `Basic ${btoa(String.fromCharCode(...bytes))}`;
		}
		const started = performance.now();
		const response = await kalem.http.fetch(endpoint, {
			method: "POST",
			headers,
			body: String(input?.envelope ?? ""),
			timeoutMs: 120_000,
		});
		const time = Math.round(performance.now() - started);
		return {
			...response,
			time,
			size: new TextEncoder().encode(response.body).byteLength,
			fault: faultOf(response.body),
			sentHeaders: headers,
		};
	}

	await kalem.ui.handle("recent", () => read("recent", []));
	await kalem.ui.handle("forget", async (url) => {
		await kalem.storage.set(
			"recent",
			(await read("recent", [])).filter((each) => each.url !== url),
		);
		loaded.delete(url);
		return read("recent", []);
	});
	await kalem.ui.handle("load", (input) => load(input?.url, input?.force === true));
	await kalem.ui.handle("call", call);
	await kalem.ui.handle("envelopes", () => read("envelopes", {}));
	await kalem.ui.handle("keepEnvelope", async (input) => {
		const envelopes = await read("envelopes", {});
		if (input?.text) envelopes[input.key] = input.text;
		else delete envelopes[input?.key];
		await kalem.storage.set("envelopes", envelopes);
		return null;
	});
	await kalem.commands.register("open", () => kalem.ui.showPane("client"));

	const findOperation = (wsdl, name) => {
		for (const service of wsdl.services) {
			for (const port of service.ports) {
				const operation = port.operations.find((each) => each.name === name);
				if (operation) return { port, operation };
			}
		}
		return null;
	};

	await kalem.assistant.registerTool(
		{
			name: "soap_operations",
			description:
				"Reads a WSDL and lists its services, endpoints, SOAP versions and operations (with their SOAPAction).",
			parameters: {
				type: "object",
				properties: { wsdl: { type: "string", description: "The WSDL's address." } },
				required: ["wsdl"],
			},
		},
		async (input) => {
			const wsdl = await load(input?.wsdl);
			return wsdl.services
				.flatMap((service) =>
					service.ports.map(
						(port) =>
							`${service.name} / ${port.name} (SOAP ${port.version}) at ${port.endpoint}\n${port.operations.map((operation) => `  - ${operation.name}${operation.action ? ` [${operation.action}]` : ""}${operation.documentation ? `: ${operation.documentation}` : ""}`).join("\n")}`,
					),
				)
				.join("\n\n");
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "soap_sample_request",
			description:
				"Returns a sample SOAP envelope for one of a WSDL's operations, made from its schema, to fill in.",
			parameters: {
				type: "object",
				properties: { wsdl: { type: "string" }, operation: { type: "string" } },
				required: ["wsdl", "operation"],
			},
		},
		async (input) => {
			const found = findOperation(await load(input?.wsdl), input?.operation);
			return found === null
				? `There is no operation named ${input?.operation}.`
				: found.operation.sample;
		},
	);
	await kalem.assistant.registerTool(
		{
			name: "soap_call",
			description:
				"Calls a SOAP operation of a WSDL with the envelope given, and returns the response (and its fault, if any). The user is asked before each call.",
			parameters: {
				type: "object",
				properties: {
					wsdl: { type: "string" },
					operation: { type: "string" },
					envelope: { type: "string", description: "The whole SOAP envelope." },
				},
				required: ["wsdl", "operation", "envelope"],
			},
			writes: true,
		},
		async (input) => {
			const found = findOperation(await load(input?.wsdl), input?.operation);
			if (found === null) return `There is no operation named ${input?.operation}.`;
			const result = await call({
				version: found.port.version,
				endpoint: found.port.endpoint,
				action: found.operation.action,
				envelope: input.envelope,
			});
			const body =
				result.body.length > MAX_TOOL_BODY
					? `${result.body.slice(0, MAX_TOOL_BODY)}\n…`
					: result.body;
			const fault = result.fault
				? `\nSOAP fault ${result.fault.code}: ${result.fault.message}`
				: "";
			return `${result.status} ${result.statusText} in ${result.time} ms${fault}\n\n${body}`;
		},
	);
}
