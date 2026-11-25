const MAX_LIMIT = 1000;
const MAX_TOOL_TEXT = 40_000;
const collator = new Intl.Collator(navigator.language);

const clamp = (value, low, high, fallback) => {
	const number = Number(value);
	return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), low), high) : fallback;
};

const fieldList = (text) =>
	String(text ?? "")
		.split(",")
		.map((field) => field.trim())
		.filter((field) => /^[\w.@-]{1,100}$/.test(field));

export function createGraylog(kalem) {
	async function request(path, { method = "GET", body } = {}) {
		const base = String((await kalem.settings.get("url")) ?? "")
			.trim()
			.replace(/\/+$/, "");
		if (base === "") throw new Error("Set the Graylog address in Settings › Extensions › Graylog.");
		const token = await kalem.secrets.get("token");
		if (!token) throw new Error("Save a Graylog access token in Settings › Extensions › Graylog.");
		const api = /\/api$/.test(base) ? base : `${base}/api`;
		const response = await kalem.http.fetch(`${api}${path}`, {
			method,
			headers: {
				Authorization: `Basic ${btoa(`${token}:token`)}`,
				Accept: "application/json",
				"X-Requested-By": "kalem",
				...(body === undefined ? {} : { "Content-Type": "application/json" }),
			},
			body: body === undefined ? null : JSON.stringify(body),
			timeoutMs: 60_000,
		});
		if (response.status === 401) throw new Error("Graylog did not accept the token (401).");
		if (response.status === 403)
			throw new Error("The token's user may not do this in Graylog (403).");
		let json = null;
		try {
			json = response.body === "" ? null : JSON.parse(response.body);
		} catch {
			if (response.ok)
				throw new Error(`Graylog's answer is not JSON. Is ${base} Graylog's address?`);
		}
		return { status: response.status, ok: response.ok, json };
	}

	const failure = (answer) =>
		new Error(
			`Graylog answered ${answer.status}: ${answer.json?.message ?? answer.json?.type ?? "no details"}`,
		);

	const timerangeOf = (options) =>
		options.from && options.to
			? {
					type: "absolute",
					from: new Date(options.from).toISOString(),
					to: new Date(options.to).toISOString(),
				}
			: { type: "relative", range: clamp(options.minutes, 1, 60 * 24 * 90, 15) * 60 };

	async function settings() {
		return {
			fields: fieldList(await kalem.settings.get("fields")),
			limit: clamp(await kalem.settings.get("limit"), 1, MAX_LIMIT, 100),
		};
	}

	async function info() {
		const [system, streams] = await Promise.all([request("/system"), request("/streams")]);
		if (!system.ok) throw failure(system);
		return {
			version: String(system.json?.version ?? "").replace(/\+.*/, ""),
			streams: (streams.ok ? (streams.json?.streams ?? []) : [])
				.filter((stream) => !stream.disabled)
				.map((stream) => ({ id: stream.id, title: stream.title }))
				.sort((a, b) => collator.compare(a.title, b.title)),
			...(await settings()),
		};
	}

	async function search(options = {}) {
		const defaults = await settings();
		const query = String(options.query ?? "").trim() || "*";
		const fields = fieldList(
			Array.isArray(options.fields) ? options.fields.join(",") : options.fields,
		);
		const wanted =
			fields.length > 0
				? fields
				: defaults.fields.length > 0
					? defaults.fields
					: ["timestamp", "source", "message"];
		if (!wanted.includes("timestamp")) wanted.unshift("timestamp");
		const size = clamp(options.limit, 1, MAX_LIMIT, defaults.limit);
		const streams = options.stream ? [String(options.stream)] : [];
		const timerange = timerangeOf(options);
		const started = Date.now();

		const body = { query, timerange, fields: wanted, size, streams };
		let answer = await request("/search/messages", {
			method: "POST",
			body: { ...body, sort: "timestamp", sort_order: "Descending" },
		});
		// A version that reads the sort differently: Graylog's own order (newest first) is kept.
		if (answer.status === 400) answer = await request("/search/messages", { method: "POST", body });
		if (answer.ok) {
			const columns = (answer.json?.schema ?? []).map((column) => column.field ?? column.name);
			const rows = (answer.json?.datarows ?? []).map((row) =>
				Object.fromEntries(columns.map((column, index) => [column, row[index]])),
			);
			return {
				fields: wanted,
				rows,
				total: rows.length,
				took: Date.now() - started,
				api: "search/messages",
			};
		}
		if (answer.status !== 404 && answer.status !== 405) throw failure(answer);

		const params = new URLSearchParams({
			query,
			limit: String(size),
			fields: wanted.join(","),
			sort: "timestamp:desc",
		});
		if (streams.length > 0) params.set("filter", `streams:${streams[0]}`);
		let path = "/search/universal/relative";
		if (timerange.type === "absolute") {
			path = "/search/universal/absolute";
			params.set("from", timerange.from);
			params.set("to", timerange.to);
		} else {
			params.set("range", String(timerange.range));
		}
		const legacy = await request(`${path}?${params}`);
		if (!legacy.ok) throw failure(legacy);
		const rows = (legacy.json?.messages ?? []).map((each) =>
			Object.fromEntries(wanted.map((field) => [field, each.message?.[field] ?? null])),
		);
		return {
			fields: wanted,
			rows,
			total: legacy.json?.total_results ?? rows.length,
			took: Date.now() - started,
			api: "search/universal",
		};
	}

	async function topValues(options = {}) {
		const field = fieldList(options.field)[0];
		if (field === undefined) throw new Error("Give a field, e.g. source.");
		const query = String(options.query ?? "").trim() || "*";
		const limit = clamp(options.limit, 1, 100, 10);
		const timerange = timerangeOf(options);
		const answer = await request("/search/aggregate", {
			method: "POST",
			body: {
				query,
				timerange,
				group_by: [{ field, limit }],
				metrics: [{ function: "count" }],
				...(options.stream ? { streams: [String(options.stream)] } : {}),
			},
		});
		if (answer.ok) {
			return (answer.json?.datarows ?? []).map((row) => ({
				value: row[0],
				count: row[row.length - 1],
			}));
		}
		if (answer.status !== 404 && answer.status !== 405) throw failure(answer);
		const params = new URLSearchParams({ field, query, size: String(limit) });
		if (timerange.type === "absolute") {
			params.set("from", timerange.from);
			params.set("to", timerange.to);
		} else {
			params.set("range", String(timerange.range));
		}
		const legacy = await request(
			`/search/universal/${timerange.type === "absolute" ? "absolute" : "relative"}/terms?${params}`,
		);
		if (!legacy.ok) throw failure(legacy);
		return Object.entries(legacy.json?.terms ?? {})
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count);
	}

	return { info, search, topValues };
}

export function asText(result) {
	if (result.rows.length === 0) return "No messages matched.";
	const lines = [
		`${result.rows.length} message(s), newest first. Fields: ${result.fields.join(" | ")}`,
	];
	let size = lines[0].length;
	for (const row of result.rows) {
		const line = result.fields
			.map((field) => {
				const value = row[field];
				const text =
					value === null || value === undefined
						? ""
						: typeof value === "string"
							? value
							: JSON.stringify(value);
				return text.replace(/\s+/g, " ").slice(0, field === "message" ? 1000 : 200);
			})
			.join(" | ");
		size += line.length + 1;
		if (size > MAX_TOOL_TEXT) {
			lines.push(
				`… ${result.rows.length - lines.length + 1} more not shown; narrow the query or the time.`,
			);
			break;
		}
		lines.push(line);
	}
	return lines.join("\n");
}

const TIME_PARAMETERS = {
	minutes: {
		type: "integer",
		description:
			"How far back to look, in minutes (default 15). Ignored when from and to are given.",
	},
	from: { type: "string", description: "Start of an absolute time range (ISO 8601)." },
	to: { type: "string", description: "End of an absolute time range (ISO 8601)." },
	stream: {
		type: "string",
		description: "A stream's id, from graylog_streams, to search only it.",
	},
};

export async function activate(kalem) {
	const graylog = createGraylog(kalem);

	await kalem.ui.handle("info", () => graylog.info());
	await kalem.ui.handle("search", (input) => graylog.search(input ?? {}));
	await kalem.ui.handle("topValues", (input) => graylog.topValues(input ?? {}));
	await kalem.commands.register("open", () => kalem.ui.showPane("search"));

	await kalem.assistant.registerTool(
		{
			name: "graylog_search",
			description:
				'Searches the logs in Graylog with Graylog\'s query language (Lucene: `level:3 AND source:api*`, `"OutOfMemoryError"`, `http_status:[500 TO 599]`) and returns the matching messages, newest first.',
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "The Graylog query; * for everything." },
					...TIME_PARAMETERS,
					limit: {
						type: "integer",
						description: "At most this many messages (default as set, at most 1000).",
					},
					fields: {
						type: "array",
						items: { type: "string" },
						description: "Fields to return; the configured ones when missing.",
					},
				},
				required: ["query"],
			},
		},
		async (input) => asText(await graylog.search(input ?? {})),
	);

	await kalem.assistant.registerTool(
		{
			name: "graylog_top_values",
			description:
				"Counts the messages matching a Graylog query by the values of one field (which sources, which errors, which hosts occur most), for an overview before reading messages.",
			parameters: {
				type: "object",
				properties: {
					field: { type: "string", description: "The field to count by, e.g. source." },
					query: { type: "string", description: "The Graylog query; * for everything." },
					...TIME_PARAMETERS,
					limit: { type: "integer", description: "How many values (default 10)." },
				},
				required: ["field"],
			},
		},
		async (input) => {
			const values = await graylog.topValues(input ?? {});
			return values.length === 0
				? "Nothing matched."
				: values.map((each) => `${each.value}: ${each.count}`).join("\n");
		},
	);

	await kalem.assistant.registerTool(
		{
			name: "graylog_streams",
			description: "Lists Graylog's streams (id and title) and its version.",
			parameters: { type: "object", properties: {}, required: [] },
		},
		async () => {
			const info = await graylog.info();
			return [
				`Graylog ${info.version}`,
				...info.streams.map((stream) => `${stream.id}: ${stream.title}`),
			].join("\n");
		},
	);
}
