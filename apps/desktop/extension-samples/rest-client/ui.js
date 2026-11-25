import { el, formatSize, icon, renderBody } from "./highlight.js";
import { translator } from "./i18n.js";
import {
	AUTH_TYPES,
	BODY_MODES,
	METHODS,
	newId,
	newRequest,
	normalize,
	paramsOf,
	resolveRequest,
	statusKind,
	toCurl,
	variablesOf,
	withParams,
} from "./requests.js";

const kalem = window.kalem;
const t = translator(kalem.language);
const app = document.getElementById("app");

let data = { collection: [], history: [], environments: [], environment: null };
let request = newRequest();
let side = "collection";
let requestTab = "params";
let responseTab = "body";
let pretty = true;
let response = null;
let sending = false;
let filter = "";

// --- Small pieces ----------------------------------------------------------------------

const methodBadge = (method) =>
	el("span", { class: "k-method", "data-method": method, text: method });

function kvEditor(list, onChange, placeholderKey = t("Key")) {
	const grid = el("div", { class: "k-kv" }, [
		el("span"),
		el("span", { class: "k-kv-head", text: t("Key") }),
		el("span", { class: "k-kv-head", text: t("Value") }),
		el("span"),
	]);
	const rows = [...list, { key: "", value: "", on: true, blank: true }];
	rows.forEach((row, index) => {
		const update = () => {
			const next = rows
				.filter((each) => !each.blank || each.key !== "" || each.value !== "")
				.map(({ blank, ...rest }) => rest);
			onChange(next, row.blank && (row.key !== "" || row.value !== ""));
		};
		const check = el("input", { type: "checkbox", "aria-label": t("Value") });
		check.checked = row.on;
		check.disabled = row.blank === true;
		check.addEventListener("change", () => {
			row.on = check.checked;
			update();
		});
		const key = el("input", {
			class: "k-input",
			placeholder: placeholderKey,
			value: row.key,
			spellcheck: "false",
			"data-row": String(index),
			"data-col": "key",
		});
		const value = el("input", {
			class: "k-input",
			placeholder: t("Value"),
			value: row.value,
			spellcheck: "false",
			"data-row": String(index),
			"data-col": "value",
		});
		key.addEventListener("input", () => {
			row.key = key.value;
			update();
		});
		value.addEventListener("input", () => {
			row.value = value.value;
			update();
		});
		const remove = el(
			"button",
			{
				class: "k-button ghost icon small",
				title: t("Remove"),
				"aria-label": t("Remove"),
				onclick: () => {
					rows.splice(index, 1);
					update();
					drawRequestTab(true);
				},
			},
			[icon("close")],
		);
		remove.hidden = row.blank === true;
		grid.append(check, key, value, remove);
	});
	return grid;
}

/** Keeps the cursor where it was when a part of the page is drawn again. */
function keepFocus(draw) {
	const active = document.activeElement;
	const where =
		active?.dataset?.row !== undefined
			? { row: active.dataset.row, col: active.dataset.col, at: active.selectionStart }
			: null;
	draw();
	if (where !== null) {
		const target = app.querySelector(`[data-row="${where.row}"][data-col="${where.col}"]`);
		if (target) {
			target.focus();
			target.setSelectionRange?.(where.at, where.at);
		}
	}
}

// --- Sidebar ---------------------------------------------------------------------------

const sideList = el("ul", { class: "k-list rest-list" });
const sideSearch = el("input", {
	class: "k-input",
	placeholder: t("Filter"),
	type: "search",
	"aria-label": t("Filter"),
});
sideSearch.addEventListener("input", () => {
	filter = sideSearch.value.trim().toLocaleLowerCase(kalem.language);
	drawSide();
});
const sideTabs = el("div", { class: "k-segmented", role: "tablist" });
for (const [id, label] of [
	["collection", t("Collection")],
	["history", t("History")],
]) {
	sideTabs.append(
		el(
			"button",
			{
				type: "button",
				"data-side": id,
				"aria-pressed": String(side === id),
				onclick: () => {
					side = id;
					drawSide();
				},
			},
			[document.createTextNode(label)],
		),
	);
}
const envSelect = el("select", { class: "k-select rest-env", "aria-label": t("Environment") });
envSelect.addEventListener("change", async () => {
	data = await kalem.call("environments", {
		environments: data.environments,
		environment: envSelect.value || null,
	});
	drawSide();
});
const envButton = el(
	"button",
	{
		class: "k-button ghost icon",
		title: t("Environments"),
		"aria-label": t("Environments"),
		onclick: () => openEnvironments(),
	},
	[icon("settings")],
);

function drawSide() {
	for (const button of sideTabs.children)
		button.setAttribute("aria-pressed", String(button.dataset.side === side));
	const matches = (item) =>
		filter === "" ||
		`${item.name} ${item.url} ${item.method}`.toLocaleLowerCase(kalem.language).includes(filter);
	if (side === "collection") {
		const items = data.collection.filter(matches);
		sideList.replaceChildren(
			...(items.length === 0
				? [
						el("li", { class: "rest-side-empty" }, [
							el("strong", { text: t("No saved requests yet") }),
							el("span", { text: t("Save a request to keep it here.") }),
						]),
					]
				: items.map((item) =>
						el(
							"li",
							{
								class: "k-list-item",
								"aria-selected": String(item.id === request.id),
								"data-request": item.name,
								onclick: () => open(item),
							},
							[
								methodBadge(item.method),
								el("span", { class: "k-name", text: item.name || item.url }),
								el("span", { class: "k-actions" }, [
									el(
										"button",
										{
											class: "k-button ghost icon small",
											title: t("Delete"),
											"aria-label": t("Delete"),
											onclick: async (event) => {
												event.stopPropagation();
												data = await kalem.call("delete", item.id);
												if (request.id === item.id) request = newRequest();
												draw();
											},
										},
										[icon("trash")],
									),
								]),
							],
						),
					)),
		);
	} else {
		const items = data.history.filter((entry) => matches(entry.request));
		sideList.replaceChildren(
			...(items.length === 0
				? [el("li", { class: "rest-side-empty" }, [el("strong", { text: t("Nothing sent yet") })])]
				: items.map((entry) =>
						el(
							"li",
							{
								class: "k-list-item rest-history",
								onclick: () => open({ ...entry.request, id: newId() }),
							},
							[
								methodBadge(entry.request.method),
								el("span", { class: "k-name", text: entry.request.url }),
								el("span", {
									class: `rest-code ${statusKind(entry.status)}`,
									text: String(entry.status),
								}),
							],
						),
					)),
		);
	}
	envSelect.replaceChildren(
		el("option", { value: "", text: t("No environment") }),
		...data.environments.map((each) => el("option", { value: each.id, text: each.name })),
	);
	envSelect.value = data.environment ?? "";
}

function open(item) {
	request = normalize(JSON.parse(JSON.stringify(item)));
	response = null;
	responseTab = "body";
	draw();
}

// --- Request ---------------------------------------------------------------------------

const nameInput = el("input", {
	class: "k-input rest-name",
	placeholder: t("Untitled request"),
	spellcheck: "false",
	"aria-label": t("Name"),
});
nameInput.addEventListener("input", () => {
	request.name = nameInput.value;
});
const methodSelect = el(
	"select",
	{ class: "k-select rest-method", "aria-label": "Method" },
	METHODS.map((method) => el("option", { value: method, text: method })),
);
methodSelect.addEventListener("change", () => {
	request.method = methodSelect.value;
	methodSelect.dataset.method = request.method;
});
const urlInput = el("input", {
	class: "k-input k-mono rest-url",
	placeholder: t("Enter a URL, e.g. {{baseUrl}}/users"),
	spellcheck: "false",
	"aria-label": "URL",
});
urlInput.addEventListener("input", () => {
	request.url = urlInput.value;
	if (requestTab === "params") drawRequestTab();
	updateCounts();
});
urlInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter") void send();
});
const sendButton = el(
	"button",
	{ class: "k-button primary rest-send", onclick: () => void send() },
	[icon("send"), document.createTextNode(t("Send"))],
);
const saveButton = el("button", { class: "k-button small", onclick: () => void save() }, [
	icon("save"),
	document.createTextNode(t("Save")),
]);
const curlButton = el(
	"button",
	{
		class: "k-button ghost small",
		onclick: () => void copy(toCurl(resolveRequest(request, currentVars())), curlButton),
	},
	[icon("code"), document.createTextNode(t("Copy as cURL"))],
);

const currentVars = () =>
	variablesOf(data.environments.find((each) => each.id === data.environment));

const requestTabs = el("div", { class: "k-tabs", role: "tablist" });
const requestBody = el("div", { class: "rest-pane-body k-scroll" });
const counts = {};
for (const [id, label] of [
	["params", t("Params")],
	["headers", t("Headers")],
	["body", t("Body")],
	["auth", t("Auth")],
]) {
	counts[id] = el("span", { class: "k-tab-count", hidden: true });
	requestTabs.append(
		el(
			"button",
			{
				class: "k-tab",
				role: "tab",
				"data-tab": id,
				onclick: () => {
					requestTab = id;
					drawRequestTab();
				},
			},
			[document.createTextNode(label), counts[id]],
		),
	);
}

function updateCounts() {
	const set = (id, n) => {
		counts[id].textContent = String(n);
		counts[id].hidden = n === 0;
	};
	set("params", paramsOf(request.url).length);
	set("headers", request.headers.filter((row) => row.on && row.key !== "").length);
	counts.body.hidden = request.body.mode === "none";
	// kalem-locale-ok: HTTP methods and header names are ASCII
	counts.body.textContent = request.body.mode.toUpperCase();
	counts.auth.hidden = request.auth.type === "none";
	// kalem-locale-ok: HTTP methods and header names are ASCII
	counts.auth.textContent =
		request.auth.type === "apikey" ? "KEY" : request.auth.type.toUpperCase();
}

function choice(options, current, onPick, labels = {}) {
	return el(
		"div",
		{ class: "k-segmented" },
		options.map((option) =>
			el(
				"button",
				{
					type: "button",
					"aria-pressed": String(option === current),
					onclick: () => onPick(option),
				},
				[document.createTextNode(labels[option] ?? option)],
			),
		),
	);
}

function labelled(label, control) {
	return el("label", { class: "rest-field" }, [
		el("span", { class: "rest-field-label", text: label }),
		control,
	]);
}

function textInput(value, onInput, attrs = {}) {
	const input = el("input", { class: "k-input k-mono", value, spellcheck: "false", ...attrs });
	input.addEventListener("input", () => onInput(input.value));
	return input;
}

function drawRequestTab(keep = false) {
	for (const tab of requestTabs.children)
		tab.setAttribute("aria-selected", String(tab.dataset.tab === requestTab));
	const draw = () => {
		if (requestTab === "params") {
			requestBody.replaceChildren(
				kvEditor(paramsOf(request.url), (rows, grew) => {
					request.url = withParams(request.url, rows);
					urlInput.value = request.url;
					updateCounts();
					if (grew) keepFocus(() => drawRequestTab());
				}),
			);
		} else if (requestTab === "headers") {
			requestBody.replaceChildren(
				kvEditor(
					request.headers,
					(rows, grew) => {
						request.headers = rows;
						updateCounts();
						if (grew) keepFocus(() => drawRequestTab());
					},
					"Content-Type",
				),
			);
		} else if (requestTab === "body") {
			const editor =
				request.body.mode === "none"
					? el("p", { class: "k-muted rest-hint", text: t("No body") })
					: request.body.mode === "form"
						? kvEditor(request.body.form, (rows, grew) => {
								request.body.form = rows;
								if (grew) keepFocus(() => drawRequestTab());
							})
						: (() => {
								const area = el("textarea", {
									class: "k-textarea rest-body",
									spellcheck: "false",
									"aria-label": t("Body"),
								});
								area.value = request.body.text;
								area.placeholder =
									request.body.mode === "json"
										? '{\n  "name": "Kalem"\n}'
										: request.body.mode === "xml"
											? "<request/>"
											: "";
								area.addEventListener("input", () => {
									request.body.text = area.value;
								});
								return area;
							})();
			requestBody.replaceChildren(
				el("div", { class: "rest-body-modes" }, [
					choice(
						BODY_MODES,
						request.body.mode,
						(mode) => {
							request.body.mode = mode;
							updateCounts();
							drawRequestTab();
						},
						{ none: t("none"), json: "JSON", xml: "XML", text: "Text", form: "Form" },
					),
				]),
				editor,
			);
		} else {
			const { auth } = request;
			const fields =
				auth.type === "bearer"
					? [
							labelled(
								t("Token"),
								textInput(auth.token, (value) => (auth.token = value), {
									placeholder: "{{token}}",
								}),
							),
						]
					: auth.type === "basic"
						? [
								labelled(
									t("Username"),
									textInput(auth.username, (value) => (auth.username = value)),
								),
								labelled(
									t("Password"),
									textInput(auth.password, (value) => (auth.password = value), {
										type: "password",
									}),
								),
							]
						: auth.type === "apikey"
							? [
									labelled(
										t("Key"),
										textInput(auth.key, (value) => (auth.key = value), {
											placeholder: "X-Api-Key",
										}),
									),
									labelled(
										t("Value"),
										textInput(auth.value, (value) => (auth.value = value), {
											placeholder: "{{apiKey}}",
										}),
									),
									labelled(
										t("Add to"),
										choice(
											["header", "query"],
											auth.in,
											(where) => {
												auth.in = where;
												drawRequestTab();
											},
											{ header: t("Header"), query: t("Query") },
										),
									),
								]
							: [el("p", { class: "k-muted rest-hint", text: t("No auth") })];
			requestBody.replaceChildren(
				el("div", { class: "rest-body-modes" }, [
					choice(
						AUTH_TYPES,
						auth.type,
						(type) => {
							auth.type = type;
							updateCounts();
							drawRequestTab();
						},
						{ none: t("none"), bearer: "Bearer", basic: "Basic", apikey: "API Key" },
					),
				]),
				el("div", { class: "rest-auth" }, fields),
			);
		}
	};
	if (keep) keepFocus(draw);
	else draw();
}

// --- Response --------------------------------------------------------------------------

const responseHead = el("div", { class: "rest-response-head" });
const responseTabs = el("div", { class: "k-tabs rest-response-tabs", role: "tablist" });
const responseBody = el("div", { class: "rest-pane-body k-scroll" });

function drawResponse() {
	if (sending) {
		responseHead.replaceChildren(
			el("span", { class: "k-spinner" }),
			el("span", { class: "k-muted", text: t("Sending") }),
		);
		responseTabs.hidden = true;
		responseBody.replaceChildren();
		return;
	}
	if (response === null) {
		responseHead.replaceChildren(el("span", { class: "k-section-title", text: t("Response") }));
		responseTabs.hidden = true;
		responseBody.replaceChildren(
			el("div", { class: "k-empty" }, [
				el("span", { class: "k-empty-icon" }, [icon("send")]),
				el("strong", { text: t("Send a request") }),
				el("p", {
					text: t("Its response shows here: status, time, size, headers and the body, pretty."),
				}),
			]),
		);
		return;
	}
	if (response.error) {
		responseHead.replaceChildren(el("span", { class: "k-badge error", text: t("Request failed") }));
		responseTabs.hidden = true;
		responseBody.replaceChildren(
			el("div", { class: "rest-error" }, [
				el("div", { class: "k-notice error" }, [
					icon("alert"),
					el("span", { text: response.error }),
				]),
			]),
		);
		return;
	}
	// kalem-locale-ok: HTTP methods and header names are ASCII
	const contentType =
		Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1] ??
		"";
	const copyButton = el(
		"button",
		{ class: "k-button ghost small", onclick: () => void copy(response.body, copyButton) },
		[icon("copy"), document.createTextNode(t("Copy"))],
	);
	responseHead.replaceChildren(
		el("span", {
			class: `k-badge ${statusKind(response.status)} rest-status`,
			text: `${response.status} ${response.statusText}`.trim(),
		}),
		el("span", { class: "rest-metric" }, [
			el("span", { class: "k-muted", text: "Time " }),
			el("strong", { text: `${response.time} ms` }),
		]),
		el("span", { class: "rest-metric" }, [
			el("span", { class: "k-muted", text: "Size " }),
			el("strong", { text: formatSize(response.size) }),
		]),
		el("span", { class: "k-spacer" }),
		...(responseTab === "body"
			? [
					choice(
						["pretty", "raw"],
						pretty ? "pretty" : "raw",
						(mode) => {
							pretty = mode === "pretty";
							drawResponse();
						},
						{ pretty: t("Pretty"), raw: t("Raw") },
					),
				]
			: []),
		copyButton,
	);
	responseTabs.hidden = false;
	responseTabs.replaceChildren(
		...[
			["body", t("Body")],
			["headers", t("Headers"), Object.keys(response.headers).length],
		].map(([id, label, count]) =>
			el(
				"button",
				{
					class: "k-tab",
					role: "tab",
					"aria-selected": String(responseTab === id),
					onclick: () => {
						responseTab = id;
						drawResponse();
					},
				},
				[
					document.createTextNode(label),
					...(count ? [el("span", { class: "k-tab-count", text: String(count) })] : []),
				],
			),
		),
	);
	if (responseTab === "headers") {
		responseBody.replaceChildren(
			el("table", { class: "k-table rest-headers" }, [
				el("thead", {}, [
					el("tr", {}, [el("th", { text: t("Key") }), el("th", { text: t("Value") })]),
				]),
				el(
					"tbody",
					{},
					Object.entries(response.headers).map(([name, value]) =>
						el("tr", {}, [
							el("td", { class: "k-mono rest-header-name", text: name }),
							el("td", { class: "k-mono", text: value }),
						]),
					),
				),
			]),
		);
		return;
	}
	const pre = el("pre", { class: "k-code wrap rest-response" });
	if (pretty) renderBody(pre, response.body, contentType);
	else pre.textContent = response.body;
	responseBody.replaceChildren(pre);
}

// --- Actions ---------------------------------------------------------------------------

async function send() {
	if (sending) return;
	sending = true;
	sendButton.disabled = true;
	drawResponse();
	try {
		response = await kalem.call("send", { request, environment: data.environment });
		data = await kalem.call("state");
		drawSide();
	} catch (error) {
		response = { error: error.message };
	} finally {
		sending = false;
		sendButton.disabled = false;
		drawResponse();
	}
}

async function save() {
	if (request.name.trim() === "") {
		request.name = request.url.replace(/^https?:\/\//, "").slice(0, 60) || t("Untitled request");
		nameInput.value = request.name;
	}
	data = await kalem.call("save", request);
	side = "collection";
	drawSide();
	flash(saveButton, t("Saved"));
}

async function copy(text, button) {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const area = el("textarea", { class: "rest-clip" });
		area.value = text;
		document.body.append(area);
		area.select();
		document.execCommand("copy");
		area.remove();
	}
	flash(button, t("Copied"));
}

function flash(button, text) {
	const before = [...button.childNodes];
	button.replaceChildren(icon("check"), document.createTextNode(text));
	setTimeout(() => button.replaceChildren(...before), 1200);
}

// --- Environments ----------------------------------------------------------------------

const dialog = el("dialog", { class: "rest-dialog" });
function openEnvironments() {
	let environments = JSON.parse(JSON.stringify(data.environments));
	let chosen =
		environments.find((each) => each.id === data.environment)?.id ?? environments[0]?.id ?? null;
	const draw = () => {
		const current = environments.find((each) => each.id === chosen);
		const list = el(
			"ul",
			{ class: "k-list" },
			environments.map((each) =>
				el(
					"li",
					{
						class: "k-list-item",
						"aria-selected": String(each.id === chosen),
						onclick: () => {
							chosen = each.id;
							draw();
						},
					},
					[
						el("span", { class: "k-dot ok", hidden: each.id !== data.environment }),
						el("span", { class: "k-name", text: each.name }),
					],
				),
			),
		);
		const add = el(
			"button",
			{
				class: "k-button small",
				onclick: () => {
					const environment = { id: newId(), name: t("New environment"), vars: [] };
					environments.push(environment);
					chosen = environment.id;
					draw();
				},
			},
			[icon("plus"), document.createTextNode(t("Add environment"))],
		);
		const editor =
			current === undefined
				? el("div", { class: "k-empty" }, [
						el("strong", { text: t("Environments") }),
						el("p", { text: t("Use {{name}} in addresses, headers and bodies.") }),
					])
				: el("div", { class: "k-stack" }, [
						el("div", { class: "k-row" }, [
							labelled(
								t("Name"),
								textInput(
									current.name,
									(value) => {
										current.name = value;
									},
									{ "data-row": "env", "data-col": "name" },
								),
							),
							el(
								"button",
								{
									class: "k-button ghost small rest-env-delete",
									onclick: () => {
										environments = environments.filter((each) => each !== current);
										chosen = environments[0]?.id ?? null;
										draw();
									},
								},
								[icon("trash"), document.createTextNode(t("Delete"))],
							),
						]),
						el("p", { class: "k-section-title", text: t("Variables") }),
						kvEditor(current.vars, (rows, grew) => {
							current.vars = rows;
							if (grew) keepFocus(draw);
						}),
					]);
		dialog.replaceChildren(
			el("header", { class: "rest-dialog-head" }, [
				el("strong", { text: t("Environments") }),
				el("span", {
					class: "k-muted k-small",
					text: t("Use {{name}} in addresses, headers and bodies."),
				}),
			]),
			el("div", { class: "rest-dialog-body" }, [
				el("aside", { class: "rest-dialog-side" }, [list, add]),
				el("section", { class: "rest-dialog-main" }, [editor]),
			]),
			el("footer", { class: "rest-dialog-foot" }, [
				el(
					"button",
					{
						class: "k-button primary",
						onclick: async () => {
							const active = environments.some((each) => each.id === data.environment)
								? data.environment
								: (chosen ?? null);
							data = await kalem.call("environments", { environments, environment: active });
							dialog.close();
							drawSide();
						},
					},
					[document.createTextNode(t("Done"))],
				),
			]),
		);
	};
	draw();
	if (!dialog.open) dialog.showModal();
}

// --- The page --------------------------------------------------------------------------

function draw() {
	nameInput.value = request.name;
	methodSelect.value = request.method;
	methodSelect.dataset.method = request.method;
	urlInput.value = request.url;
	updateCounts();
	drawSide();
	drawRequestTab();
	drawResponse();
}

app.append(
	el("div", { class: "rest-layout" }, [
		el("aside", { class: "k-sidebar rest-side" }, [
			el("div", { class: "rest-side-head" }, [
				sideTabs,
				el(
					"button",
					{
						class: "k-button ghost icon small",
						title: t("New request"),
						"aria-label": t("New request"),
						onclick: () => {
							request = newRequest();
							response = null;
							responseTab = "body";
							draw();
							urlInput.focus();
						},
					},
					[icon("plus")],
				),
			]),
			el("div", { class: "rest-side-search k-search" }, [icon("search"), sideSearch]),
			el("div", { class: "k-scroll k-grow" }, [sideList]),
			el("div", { class: "rest-side-foot" }, [
				el("span", { class: "k-muted", title: t("Environment") }, [icon("globe")]),
				envSelect,
				envButton,
			]),
		]),
		el("main", { class: "rest-main" }, [
			el("div", { class: "k-toolbar rest-toolbar" }, [
				nameInput,
				el("span", { class: "k-spacer" }),
				curlButton,
				saveButton,
			]),
			el("div", { class: "rest-line" }, [
				el("div", { class: "k-group" }, [methodSelect, urlInput, sendButton]),
			]),
			el("div", { class: "k-split rest-split" }, [
				el("section", { class: "rest-pane" }, [requestTabs, requestBody]),
				el("section", { class: "rest-pane rest-response-pane" }, [
					responseHead,
					responseTabs,
					responseBody,
				]),
			]),
		]),
	]),
	dialog,
);

data = await kalem.call("state");
draw();
