import { el, icon } from "./dom.js";
import { translator } from "./i18n.js";

const kalem = window.kalem;
const t = translator(kalem.language);
const app = document.getElementById("app");

const LEVELS = ["emerg", "alert", "crit", "error", "warn", "notice", "info", "debug"];
const RANGES = [
	["5", "Last 5 minutes"],
	["15", "Last 15 minutes"],
	["60", "Last hour"],
	["240", "Last 4 hours"],
	["1440", "Last day"],
	["10080", "Last 7 days"],
];
const EXAMPLES = ["level:3", "source:api*", '"Exception"', "http_status:[500 TO 599]"];

const remembered = (() => {
	try {
		return JSON.parse(localStorage.getItem("graylog") ?? "{}");
	} catch {
		return {};
	}
})();

let loaded = false;
let searched = false;
let version = "";
const open = new Set();

// --- Controls --------------------------------------------------------------------------

const query = el("input", {
	id: "query",
	class: "k-input k-mono",
	type: "search",
	placeholder: "level:3 AND source:api*",
	spellcheck: "false",
	autocomplete: "off",
	"aria-label": "Query",
});
query.value = remembered.query ?? "";
const range = el(
	"select",
	{ id: "range", class: "k-select graylog-range", "aria-label": "Time" },
	RANGES.map(([value, label]) => el("option", { value, text: t(label) })),
);
range.value = remembered.range ?? "15";
const stream = el(
	"select",
	{ id: "stream", class: "k-select graylog-stream", "aria-label": "Stream" },
	[el("option", { value: "", text: t("All streams") })],
);
const go = el("button", { id: "go", class: "k-button primary", type: "submit" }, [
	icon("search"),
	document.createTextNode(t("Search")),
]);
const form = el("form", { id: "form", class: "k-toolbar graylog-bar" }, [
	el("div", { class: "k-search" }, [icon("search"), query]),
	range,
	stream,
	go,
]);
form.addEventListener("submit", (event) => {
	event.preventDefault();
	void run();
});

const connection = el("span", { class: "graylog-connection" });
const status = el("p", { id: "status", class: "graylog-status", role: "status" });
const levels = el("div", { class: "graylog-levels" });
const summary = el("div", { class: "graylog-summary" }, [
	status,
	levels,
	el("span", { class: "k-spacer" }),
	connection,
]);
const results = el("div", { class: "k-scroll k-grow graylog-results" });

const say = (text, error = false) => {
	status.textContent = text;
	status.classList.toggle("error", error);
};

function showConnection(ok, detail = "") {
	connection.replaceChildren(
		el("span", { class: `k-dot ${ok ? "ok" : "error"}` }),
		el("span", { text: ok ? `${t("Connected")} · Graylog ${detail}` : t("Not connected") }),
	);
}

// --- Results ---------------------------------------------------------------------------

const cellText = (value) =>
	value === null || value === undefined
		? ""
		: typeof value === "string"
			? value
			: JSON.stringify(value);

function timeText(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return cellText(value);
	const pad = (number, size = 2) => String(number).padStart(size, "0");
	return `${date.toLocaleDateString(navigator.language)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

const levelKind = (level) =>
	level <= 3 ? "error" : level === 4 ? "warn" : level <= 6 ? "info" : "";

function levelBadge(value) {
	const level = Number(value);
	if (!Number.isInteger(level)) return el("span", { text: cellText(value) });
	const kind = levelKind(level);
	return el("span", {
		class: `k-badge ${kind} level-${kind === "warn" ? "warning" : kind}`,
		text: LEVELS[level] ?? String(level),
	});
}

function empty() {
	return el("div", { class: "k-empty" }, [
		el("span", { class: "k-empty-icon" }, [icon("search")]),
		el("strong", { text: t("Search Graylog") }),
		el("p", { text: t("Write a query, or start from one of these:") }),
		el(
			"div",
			{ class: "graylog-examples" },
			EXAMPLES.map((example) =>
				el(
					"button",
					{
						type: "button",
						class: "k-button small graylog-example",
						onclick: () => {
							query.value = example;
							void run();
						},
					},
					[el("code", { text: example })],
				),
			),
		),
	]);
}

function show(result) {
	const counts = new Map();
	for (const row of result.rows) {
		const kind = levelKind(Number(row.level));
		if (kind !== "") counts.set(kind, (counts.get(kind) ?? 0) + 1);
	}
	levels.replaceChildren(
		...["error", "warn", "info"]
			.filter((kind) => counts.has(kind))
			.map((kind) => el("span", { class: `k-badge ${kind}`, text: `${counts.get(kind)} ${kind}` })),
	);
	if (result.rows.length === 0) {
		results.replaceChildren(
			el("div", { class: "k-empty" }, [
				el("span", { class: "k-empty-icon" }, [icon("search")]),
				el("strong", { text: t("No messages matched") }),
				el("p", { text: t("Widen the time, or loosen the query.") }),
			]),
		);
		return;
	}
	open.clear();
	const body = el("tbody");
	result.rows.forEach((row, index) => {
		const line = el(
			"tr",
			{ class: "row", "data-index": String(index) },
			result.fields.map((field) => {
				if (field === "timestamp")
					return el("td", { class: "graylog-time k-mono", text: timeText(row[field]) });
				if (field === "level") return el("td", {}, [levelBadge(row[field])]);
				if (field === "message")
					return el("td", { class: "message k-mono", text: cellText(row[field]) });
				return el("td", { class: "graylog-cell", text: cellText(row[field]) });
			}),
		);
		line.addEventListener("click", () => {
			const next = line.nextElementSibling;
			if (next?.classList.contains("detail")) {
				next.remove();
				line.removeAttribute("aria-expanded");
				return;
			}
			line.setAttribute("aria-expanded", "true");
			const copy = el(
				"button",
				{
					class: "k-button ghost small",
					onclick: async (event) => {
						event.stopPropagation();
						try {
							await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
						} catch {}
						copy.replaceChildren(icon("check"), document.createTextNode(t("Copied")));
					},
				},
				[icon("copy"), document.createTextNode(t("Copy"))],
			);
			line.after(
				el("tr", { class: "detail" }, [
					el("td", { colspan: String(result.fields.length) }, [
						el("div", { class: "graylog-detail" }, [
							el(
								"dl",
								{ class: "graylog-kv" },
								Object.entries(row).flatMap(([key, value]) => [
									el("dt", { text: key }),
									el("dd", { class: "k-mono", text: cellText(value) }),
								]),
							),
							copy,
						]),
					]),
				]),
			);
		});
		body.append(line);
	});
	results.replaceChildren(
		el("table", { id: "table", class: "k-table graylog-table" }, [
			el("thead", {}, [
				el(
					"tr",
					{},
					result.fields.map((field) => el("th", { text: field })),
				),
			]),
			body,
		]),
	);
}

// --- Searching -------------------------------------------------------------------------

async function loadInfo() {
	const info = await kalem.call("info");
	stream.replaceChildren(
		el("option", { value: "", text: t("All streams") }),
		...info.streams.map((each) => el("option", { value: each.id, text: each.title })),
	);
	if (remembered.stream) stream.value = remembered.stream;
	loaded = true;
	version = info.version;
	showConnection(true, version);
	return info;
}

async function run() {
	try {
		localStorage.setItem(
			"graylog",
			JSON.stringify({ query: query.value, range: range.value, stream: stream.value }),
		);
	} catch {}
	searched = true;
	go.disabled = true;
	levels.replaceChildren();
	status.replaceChildren(
		el("span", { class: "k-spinner" }),
		document.createTextNode(` ${t("Searching")}`),
	);
	try {
		if (!loaded) await loadInfo();
		const result = await kalem.call("search", {
			query: query.value,
			minutes: Number(range.value),
			stream: stream.value || undefined,
		});
		show(result);
		say(
			result.rows.length === 0
				? ""
				: `${t("{0} of {1} messages", result.rows.length, result.total)} · ${t("{0} ms", result.took)}`,
		);
	} catch (error) {
		results.replaceChildren(
			el("div", { class: "graylog-error" }, [
				el("div", { class: "k-notice error" }, [
					icon("alert"),
					el("span", { text: error.message }),
				]),
			]),
		);
		say("");
		showConnection(false);
	} finally {
		go.disabled = false;
	}
}

const connect = () =>
	loadInfo().then(
		() => {
			if (!searched) say("");
		},
		(error) => {
			showConnection(false);
			if (!searched) say(error.message, true);
		},
	);

app.append(form, summary, results);
results.append(empty());
kalem.onSettingsChanged(connect);
void connect();
