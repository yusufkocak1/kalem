const $ = (id) => document.getElementById(id);
const form = $("form");
const query = $("query");
const range = $("range");
const stream = $("stream");
const status = $("status");
const table = $("table");
const head = $("head");
const rows = $("rows");

const LEVELS = ["emerg", "alert", "crit", "error", "warn", "notice", "info", "debug"];

const remembered = (() => {
	try {
		return JSON.parse(localStorage.getItem("graylog") ?? "{}");
	} catch {
		return {};
	}
})();
query.value = remembered.query ?? "";
if (remembered.range) range.value = remembered.range;

const say = (text, error = false) => {
	status.textContent = text;
	status.classList.toggle("error", error);
};

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

function levelCell(cell, value) {
	const level = Number(value);
	if (!Number.isInteger(level)) {
		cell.textContent = cellText(value);
		return;
	}
	cell.textContent = LEVELS[level] ?? String(level);
	if (level <= 3) cell.className = "level-error";
	else if (level === 4) cell.className = "level-warning";
}

function show(result) {
	head.replaceChildren(
		...result.fields.map((field) => {
			const th = document.createElement("th");
			th.textContent = field;
			return th;
		}),
	);
	rows.replaceChildren();
	for (const row of result.rows) {
		const tr = document.createElement("tr");
		tr.className = "row";
		for (const field of result.fields) {
			const td = document.createElement("td");
			if (field === "timestamp") td.textContent = timeText(row[field]);
			else if (field === "level") levelCell(td, row[field]);
			else td.textContent = cellText(row[field]);
			if (field === "message") td.classList.add("message");
			tr.append(td);
		}
		tr.addEventListener("click", () => {
			const next = tr.nextElementSibling;
			if (next?.classList.contains("detail")) {
				next.remove();
				return;
			}
			const detail = document.createElement("tr");
			detail.className = "detail";
			const td = document.createElement("td");
			td.colSpan = result.fields.length;
			const pre = document.createElement("pre");
			pre.textContent = JSON.stringify(row, null, 2);
			td.append(pre);
			detail.append(td);
			tr.after(detail);
		});
		rows.append(tr);
	}
	table.hidden = result.rows.length === 0;
}

async function run() {
	const wanted = {
		query: query.value,
		minutes: Number(range.value),
		stream: stream.value || undefined,
	};
	try {
		localStorage.setItem(
			"graylog",
			JSON.stringify({ query: query.value, range: range.value, stream: stream.value }),
		);
	} catch {}
	searched = true;
	$("go").disabled = true;
	say("Searching…");
	try {
		if (!loaded) await loadInfo();
		const result = await window.kalem.call("search", wanted);
		show(result);
		say(
			result.rows.length === 0
				? "No messages matched."
				: `${result.rows.length} of ${result.total} message(s) · ${result.took} ms`,
		);
	} catch (error) {
		table.hidden = true;
		say(error.message, true);
	} finally {
		$("go").disabled = false;
	}
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	void run();
});

let loaded = false;
async function loadInfo() {
	const info = await window.kalem.call("info");
	stream.replaceChildren(stream.options[0]);
	for (const each of info.streams) {
		const option = document.createElement("option");
		option.value = each.id;
		option.textContent = each.title;
		stream.append(option);
	}
	if (remembered.stream) stream.value = remembered.stream;
	loaded = true;
	return info;
}

let searched = false;
const connect = () =>
	loadInfo()
		.then((info) => {
			if (!searched) say(`Graylog ${info.version}`);
		})
		.catch((error) => {
			if (!searched) say(error.message, true);
		});
window.kalem.onSettingsChanged(connect);
void connect();
