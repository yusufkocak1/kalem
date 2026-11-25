import { icon } from "./dom.js";
import { translator } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const kalem = window.kalem;
const t = translator(kalem.language);

const TYPE_MARKS = {
	command: "$",
	npm: "N",
	maven: "M",
	gradle: "G",
	application: "J",
	jar: "J",
	tomcat: "T",
	compound: "⧉",
};

const view = {
	selected: $("selected"),
	run: $("run"),
	stop: $("stop"),
	edit: $("edit"),
	clear: $("clear"),
	message: $("message"),
	console: $("console"),
	tabs: $("tabs"),
	output: $("output"),
	editor: $("editor"),
	add: $("add"),
	copy: $("copy"),
	remove: $("remove"),
	configs: $("configs"),
	form: $("form"),
	problems: $("problems"),
	cancel: $("cancel"),
	save: $("save"),
};

let state = { folder: null, configurations: [], selected: null, types: {}, sessions: [] };
let current = null;
const outputs = new Map();
let draft = null;
let draftIndex = 0;

const el = (tag, props = {}, children = []) => {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (key === "class") element.className = value;
		else if (key === "text") element.textContent = value;
		else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
		else if (value !== undefined && value !== null && value !== false)
			element.setAttribute(key, value === true ? "" : value);
	}
	element.append(...children);
	return element;
};

const say = (text, error = false) => {
	view.message.textContent = text;
	view.message.classList.toggle("error", error);
};

const attempt = async (work) => {
	try {
		say("");
		return await work();
	} catch (error) {
		say(error.message, true);
		return undefined;
	}
};

// --- Output, with the colours of ANSI escapes ----------------------------------------

const ESC = String.fromCharCode(27);
const SGR_SPLIT = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
const OTHER_ESCAPES = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

const COLORS = ["#555", "#c33", "#2a8a2a", "#b58900", "#2f6fd0", "#a3a", "#1a9a9a", "#888"];
const BRIGHT = ["#777", "#e55", "#3c3", "#d9a400", "#59f", "#c6c", "#2bb", "#aaa"];
let style = { color: null, bold: false };

/** Programs write their logs to stderr too (Tomcat does): only errors are red there. */
function levelOf(line) {
	if (/\b(?:SEVERE|ERROR|FATAL)\b|Exception\b|^\s+at |^Caused by:|\bnpm ERR!/.test(line))
		return "stderr";
	if (/\bWARN(?:ING)?\b/.test(line)) return "warning";
	return "plain";
}

function appendText(target, stream, text) {
	const parts = text.split(SGR_SPLIT);
	for (const part of parts) {
		const sgr = SGR.exec(part);
		if (sgr !== null) {
			for (const code of (sgr[1] || "0").split(";").map(Number)) {
				if (code === 0) style = { color: null, bold: false };
				else if (code === 1) style.bold = true;
				else if (code === 22) style.bold = false;
				else if (code === 39) style.color = null;
				else if (code >= 30 && code <= 37) style.color = COLORS[code - 30];
				else if (code >= 90 && code <= 97) style.color = BRIGHT[code - 90];
			}
			continue;
		}
		const clean = part.replace(OTHER_ESCAPES, "").replace(/\r(?!\n)/g, "");
		if (clean === "") continue;
		const pieces = stream === "stderr" ? clean.split(/(?<=\n)/) : [clean];
		for (const piece of pieces) {
			const kind = stream === "stderr" ? levelOf(piece) : stream;
			const span = el("span", {
				class: [kind, style.bold ? "bold" : ""].join(" ").trim(),
				text: piece,
			});
			if (style.color !== null && kind !== "stderr") span.style.color = style.color;
			target.append(span);
		}
	}
}

function showOutput() {
	const chunks = current === null ? [] : (outputs.get(current) ?? []);
	view.output.replaceChildren();
	style = { color: null, bold: false };
	if (current === null) {
		view.output.append(
			el("span", {
				class: "empty",
				text:
					state.configurations.length === 0
						? t("No run configurations yet: Edit Configurations… adds one.")
						: t("Run a configuration: its output shows here."),
			}),
		);
		return;
	}
	for (const chunk of chunks) appendText(view.output, chunk.stream, chunk.text);
	view.output.scrollTop = view.output.scrollHeight;
}

async function choose(id) {
	current = id;
	if (id !== null && !outputs.has(id)) outputs.set(id, (await kalem.call("output", id)) ?? []);
	renderTabs();
	showOutput();
	renderButtons();
}

function renderTabs() {
	view.tabs.replaceChildren(
		...state.sessions.map((session) =>
			el(
				"button",
				{
					class: "tab",
					type: "button",
					role: "tab",
					"aria-selected": String(session.id === current),
					"data-session": session.id,
					title:
						session.status === "running"
							? t("Running")
							: t("{0}, exit code {1}", t(session.status), session.code),
					onclick: () => void choose(session.id),
				},
				[
					el("span", { class: "dot", "data-status": session.status }),
					el("span", { text: session.name }),
					...(session.status === "running"
						? []
						: [
								el("span", {
									class: "close",
									role: "button",
									title: t("Close"),
									text: "×",
									onclick: (event) => {
										event.stopPropagation();
										void forget(session.id);
									},
								}),
							]),
				],
			),
		),
	);
}

async function forget(id) {
	await kalem.call("forget", id);
	state.sessions = state.sessions.filter((each) => each.id !== id);
	outputs.delete(id);
	if (current === id) current = state.sessions.at(-1)?.id ?? null;
	renderTabs();
	showOutput();
}

function renderButtons() {
	const name = view.selected.value;
	const busy = state.sessions.some((each) => each.name === name && each.status === "running");
	view.run.disabled = name === "";
	view.run.replaceChildren(
		icon(busy ? "refresh" : "play"),
		document.createTextNode(busy ? t("Rerun") : t("Run")),
	);
	view.stop.disabled = !busy;
	view.edit.disabled = state.folder === null;
}

function renderSelect() {
	view.selected.replaceChildren(
		...state.configurations.map((config) =>
			el("option", {
				value: config.name,
				text: `${config.name} — ${t(state.types[config.type]?.title ?? config.type)}`,
			}),
		),
	);
	if (state.selected !== null) view.selected.value = state.selected;
	view.selected.disabled = state.configurations.length === 0;
	if (state.folder === null)
		say(
			t(
				"Open a folder (File › Open Folder): its run configurations are kept in it, in .kalem/run.json.",
			),
		);
	renderButtons();
}

async function refresh() {
	const next = await attempt(() => kalem.call("state"));
	if (next === undefined) return;
	state = next;
	renderSelect();
	renderTabs();
	if (current === null && state.sessions.length > 0) await choose(state.sessions.at(-1).id);
	else showOutput();
}

kalem.onMessage((message) => {
	if (message.type === "session") {
		const at = state.sessions.findIndex((each) => each.id === message.session.id);
		if (at === -1) {
			state.sessions.push(message.session);
			outputs.set(message.session.id, []);
			if (message.session.parent === null || current === null) current = message.session.id;
			renderTabs();
			showOutput();
		} else {
			state.sessions[at] = message.session;
			renderTabs();
		}
		renderButtons();
	} else if (message.type === "output") {
		const chunks = outputs.get(message.session);
		if (chunks === undefined) return;
		chunks.push({ stream: message.stream, text: message.text });
		if (message.session === current) {
			const atEnd =
				view.output.scrollHeight - view.output.scrollTop - view.output.clientHeight < 40;
			if (view.output.querySelector(".empty")) view.output.replaceChildren();
			appendText(view.output, message.stream, message.text);
			if (atEnd) view.output.scrollTop = view.output.scrollHeight;
		}
	} else if (message.type === "edit") {
		void openEditor();
	}
});

view.selected.addEventListener("change", () => {
	state.selected = view.selected.value;
	void kalem.call("select", view.selected.value);
	renderButtons();
});
view.run.addEventListener(
	"click",
	() => void attempt(() => kalem.call("run", view.selected.value)),
);
view.stop.addEventListener("click", () => {
	const session = state.sessions.find(
		(each) => each.name === view.selected.value && each.status === "running",
	);
	if (session !== undefined) void attempt(() => kalem.call("stop", session.id));
});
view.clear.addEventListener("click", () => {
	if (current !== null) outputs.set(current, []);
	showOutput();
});
view.edit.addEventListener("click", () => void openEditor());

// --- The configurations' editor --------------------------------------------------------

const clone = (value) => JSON.parse(JSON.stringify(value));

function uniqueName(base) {
	const names = new Set(draft.map((each) => each.name));
	if (!names.has(base)) return base;
	for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
}

function newConfig(type) {
	const config = { name: uniqueName(t(state.types[type].title)), type };
	for (const field of state.types[type].fields)
		if (field.default !== undefined) config[field.key] = field.default;
	return config;
}

async function openEditor() {
	await refresh();
	if (state.folder === null) return;
	draft = clone(state.configurations);
	draftIndex = Math.max(
		0,
		draft.findIndex((each) => each.name === view.selected.value),
	);
	view.add.replaceChildren(
		el("option", { value: "", text: t("+ Add…") }),
		...Object.entries(state.types).map(([id, type]) =>
			el("option", { value: id, text: t(type.title) }),
		),
	);
	view.problems.textContent = "";
	view.console.hidden = true;
	view.editor.hidden = false;
	view.clear.hidden = true;
	renderList();
	renderForm();
}

function closeEditor() {
	draft = null;
	view.editor.hidden = true;
	view.console.hidden = false;
	view.clear.hidden = false;
}

function renderList() {
	view.configs.replaceChildren(
		...draft.map((config, index) =>
			el(
				"li",
				{
					"data-selected": index === draftIndex,
					onclick: () => {
						draftIndex = index;
						renderList();
						renderForm();
					},
				},
				[
					el("span", {
						class: "type-badge",
						"data-type": config.type,
						text: TYPE_MARKS[config.type] ?? "?",
					}),
					el("span", { class: "config-text" }, [
						el("span", { class: "config-name", text: config.name || t("(no name)") }),
						el("small", { text: t(state.types[config.type]?.title ?? config.type) }),
					]),
				],
			),
		),
	);
	view.copy.disabled = view.remove.disabled = draft.length === 0;
}

function field(label, control, id) {
	return [el("label", { class: "title", for: id, text: label }), control];
}

let fieldCount = 0;

function renderForm() {
	view.form.replaceChildren();
	const config = draft[draftIndex];
	if (config === undefined) {
		view.form.append(el("p", { class: "empty", text: t("Add a configuration with + Add…") }));
		return;
	}
	const type = state.types[config.type];
	const set = (key, value) => {
		config[key] = value;
		if (key === "name") renderList();
	};

	const input = (key, attrs = {}) => {
		const id = `f${++fieldCount}`;
		const control = el("input", { id, name: key, type: "text", spellcheck: "false", ...attrs });
		control.value = config[key] ?? "";
		control.addEventListener("input", () =>
			set(key, attrs.type === "number" ? Number(control.value) : control.value),
		);
		return [id, control];
	};

	const [nameId, name] = input("name");
	view.form.append(...field(t("Name"), el("div", { class: "field" }, [name]), nameId));

	for (const spec of type.fields) {
		let id;
		let control;
		if (spec.kind === "checkbox") {
			[id, control] = input(spec.key, { type: "checkbox" });
			control.checked = config[spec.key] ?? spec.default ?? false;
			control.addEventListener("change", () => set(spec.key, control.checked));
			view.form.append(
				el("span"),
				el("label", { class: "field" }, [control, el("span", { text: t(spec.label) })]),
			);
			continue;
		}
		if (spec.kind === "textarea" || spec.kind === "env") {
			id = `f${++fieldCount}`;
			control = el("textarea", {
				id,
				name: spec.key,
				spellcheck: "false",
				placeholder: t(spec.placeholder ?? ""),
			});
			control.value = config[spec.key] ?? "";
			control.addEventListener("input", () => set(spec.key, control.value));
		} else if (spec.kind === "select") {
			id = `f${++fieldCount}`;
			control = el(
				"select",
				{ id, name: spec.key },
				spec.options.map((option) => el("option", { value: option, text: option })),
			);
			control.value = config[spec.key] ?? spec.default ?? spec.options[0];
			control.addEventListener("change", () => set(spec.key, control.value));
		} else if (spec.kind === "configurations") {
			id = `f${++fieldCount}`;
			control = checklist(config, spec.key, id);
		} else {
			[id, control] = input(spec.key, {
				type: spec.kind === "number" ? "number" : "text",
				placeholder: t(spec.placeholder ?? ""),
				...(spec.kind === "script" ? { list: `scripts-${fieldCount + 1}` } : {}),
			});
		}
		const children = [control];
		if (spec.kind === "folder" || spec.kind === "file") {
			children.push(
				el("button", {
					type: "button",
					text: "…",
					title: t("Browse"),
					onclick: async () => {
						const path = await attempt(() =>
							kalem.call("pick", { folder: spec.kind === "folder", title: t(spec.label) }),
						);
						if (path) {
							control.value = path;
							set(spec.key, path);
						}
					},
				}),
			);
		}
		if (spec.kind === "script") {
			const list = el("datalist", { id: control.getAttribute("list") });
			children.push(list);
			void kalem.call("scripts", { workingDir: config.workingDir }).then((scripts) => {
				list.replaceChildren(...scripts.map((script) => el("option", { value: script })));
			});
		}
		view.form.append(
			...field(
				t(spec.label) + (spec.required ? " *" : ""),
				el("div", { class: "field" }, children),
				id,
			),
		);
	}

	if (config.type !== "compound") {
		view.form.append(el("h3", { text: t("Before launch") }));
		const id = `f${++fieldCount}`;
		view.form.append(...field(t("Run first"), checklist(config, "beforeLaunch", id), id));
	}
}

function checklist(config, key, id) {
	const others = draft.filter((each) => each !== config);
	if (others.length === 0)
		return el("span", { id, class: "empty", text: t("No other configurations.") });
	const chosen = new Set(config[key] ?? []);
	return el(
		"div",
		{ id, class: "checks" },
		others.map((other) => {
			const box = el("input", { type: "checkbox", value: other.name });
			box.checked = chosen.has(other.name);
			box.addEventListener("change", () => {
				const names = new Set(config[key] ?? []);
				if (box.checked) names.add(other.name);
				else names.delete(other.name);
				config[key] = others.map((each) => each.name).filter((name) => names.has(name));
			});
			return el("label", {}, [box, el("span", { text: ` ${other.name}` })]);
		}),
	);
}

view.add.addEventListener("change", () => {
	if (view.add.value === "") return;
	draft.push(newConfig(view.add.value));
	draftIndex = draft.length - 1;
	view.add.value = "";
	renderList();
	renderForm();
	view.form.querySelector("input")?.select();
});
view.copy.addEventListener("click", () => {
	const source = draft[draftIndex];
	if (source === undefined) return;
	draft.push({ ...clone(source), name: uniqueName(source.name) });
	draftIndex = draft.length - 1;
	renderList();
	renderForm();
});
view.remove.addEventListener("click", () => {
	const removed = draft.splice(draftIndex, 1)[0];
	if (removed !== undefined) {
		for (const config of draft) {
			for (const key of ["beforeLaunch", "configurations"]) {
				if (Array.isArray(config[key]))
					config[key] = config[key].filter((name) => name !== removed.name);
			}
		}
	}
	draftIndex = Math.max(0, Math.min(draftIndex, draft.length - 1));
	renderList();
	renderForm();
});
view.cancel.addEventListener("click", closeEditor);
view.save.addEventListener("click", async () => {
	view.problems.textContent = "";
	try {
		state = await kalem.call("save", {
			configurations: draft,
			selected: draft[draftIndex]?.name ?? null,
		});
		closeEditor();
		renderSelect();
		showOutput();
	} catch (error) {
		view.problems.textContent = error.message;
	}
});

kalem.onSettingsChanged(() => void refresh());
void refresh();
window.addEventListener("focus", () => {
	if (draft === null) void refresh();
});

for (const [id, text, mark] of [
	["run", "Run", "play"],
	["stop", "Stop", "stop"],
	["edit", "Edit Configurations…", "settings"],
	["clear", "Clear", "trash"],
	["copy", "Copy", "copy"],
	["remove", "Remove", "trash"],
	["cancel", "Cancel", null],
	["save", "Save", "check"],
]) {
	$(id).replaceChildren(...(mark === null ? [] : [icon(mark)]), document.createTextNode(t(text)));
}
$("clear").title = t("Clear the output");
$("selected").setAttribute("aria-label", t("Configuration"));
