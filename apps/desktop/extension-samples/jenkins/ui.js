import { ago, duration, el, icon } from "./dom.js";
import { translator } from "./i18n.js";
import { jobLabel } from "./params.js";
import {
	descendantGroupIds,
	effectiveVariables,
	groupChain,
	resolveParams,
	targetsInSubtree,
} from "./resolve.js";
import { isFinal, newId } from "./runner.js";

const kalem = window.kalem;
const t = translator(kalem.language);
const app = document.getElementById("app");

let config = { pipelines: [], groups: [], targets: [], quickActions: [] };
let settings = {};
let runs = [];
let history = [];
let view = "targets";
let runsTab = "now";
let selected = null;
let selectedPipeline = null;
const collapsed = new Set();
let clipboard = [];
let connection = { state: "idle", text: "" };
let jobsState = {
	folder: "",
	list: null,
	error: "",
	job: null,
	builds: null,
	build: null,
	stages: null,
	log: "",
};

// --- Small pieces -----------------------------------------------------------------------

const button = (text, onclick, kind = "", iconName = null, extra = {}) =>
	el("button", { class: `k-button ${kind}`.trim(), type: "button", onclick, ...extra }, [
		iconName ? icon(iconName) : null,
		text ? el("span", { text }) : null,
	]);

const iconButton = (iconName, title, onclick, extra = {}) =>
	el(
		"button",
		{
			class: "k-button icon small ghost",
			type: "button",
			title,
			"aria-label": title,
			onclick,
			...extra,
		},
		[icon(iconName)],
	);

const STATUS_KIND = {
	SUCCESS: "ok",
	FAILURE: "error",
	ERROR: "error",
	UNSTABLE: "warn",
	ABORTED: "",
	CANCELLED: "",
	NOT_BUILT: "",
	running: "info",
	queued: "info",
	pending: "",
};
const statusBadge = (status) =>
	el("span", { class: `k-badge ${STATUS_KIND[status] ?? ""}`.trim(), text: t(status) });

const colorKind = (color) => {
	if (color.startsWith("blue")) return "ok";
	if (color.startsWith("red")) return "error";
	if (color.startsWith("yellow")) return "warn";
	return "";
};

const pipelineOf = (id) => config.pipelines.find((pipeline) => pipeline.id === id);
const groupOf = (id) => config.groups.find((group) => group.id === id);
const targetOf = (id) => config.targets.find((target) => target.id === id);
const childGroups = (parentId) =>
	config.groups.filter((group) => group.parentId === parentId).sort((a, b) => a.order - b.order);
const groupTargets = (groupId) =>
	config.targets.filter((target) => target.groupId === groupId).sort((a, b) => a.order - b.order);
const actionsOf = (pipelineId) =>
	config.quickActions
		.filter((action) => action.pipelineId === pipelineId)
		.sort((a, b) => a.order - b.order);
const groupPath = (groupId) =>
	groupChain(groupId, config.groups)
		.reverse()
		.map((group) => group.name)
		.join(" / ");

async function save() {
	config = await kalem.call("saveConfig", config);
	render();
}

function toast(text, kind = "") {
	const note = el("div", { class: `jk-toast ${kind}`.trim(), role: "status", text });
	document.body.append(note);
	setTimeout(() => note.remove(), 4000);
}

async function attempt(work) {
	try {
		return await work();
	} catch (error) {
		toast(error.message, "error");
		return undefined;
	}
}

// --- Dialogs ----------------------------------------------------------------------------

function dialog(title, body, actions, { wide = false, onClose } = {}) {
	const element = el("dialog", { class: `jk-dialog${wide ? " wide" : ""}`, "aria-label": title });
	const close = () => {
		element.close();
		element.remove();
		onClose?.();
	};
	element.addEventListener("cancel", (event) => {
		event.preventDefault();
		close();
	});
	element.append(
		el("header", { class: "jk-dialog-head" }, [
			el("h2", { text: title }),
			iconButton("close", t("Close"), close),
		]),
		el("div", { class: "jk-dialog-body" }, Array.isArray(body) ? body : [body]),
		actions ? el("footer", { class: "jk-dialog-actions" }, actions(close)) : null,
	);
	document.body.append(element);
	element.showModal();
	return { element, close };
}

function ask(title, label, value = "", placeholder = "") {
	return new Promise((resolve) => {
		const input = el("input", { class: "k-input", value, placeholder, "aria-label": label });
		let answered = false;
		const done = (close, answer) => {
			answered = true;
			close();
			resolve(answer);
		};
		const form = el("form", { class: "k-stack" }, [
			el("label", { class: "jk-label", text: label }),
			input,
		]);
		const { close } = dialog(
			title,
			form,
			(close) => [
				button(t("Cancel"), () => done(close, null), "ghost"),
				button(t("OK"), () => done(close, input.value.trim() || null), "primary"),
			],
			{
				onClose: () => answered || resolve(null),
			},
		);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			done(close, input.value.trim() || null);
		});
		input.select();
	});
}

function confirmBox(title, text, okText = t("Delete"), kind = "stop") {
	return new Promise((resolve) => {
		let answered = false;
		dialog(
			title,
			el("p", { class: "jk-text", text }),
			(close) => [
				button(
					t("Cancel"),
					() => {
						answered = true;
						close();
						resolve(false);
					},
					"ghost",
				),
				button(
					okText,
					() => {
						answered = true;
						close();
						resolve(true);
					},
					kind,
				),
			],
			{ onClose: () => answered || resolve(false) },
		);
	});
}

function menu(event, items) {
	event.preventDefault();
	event.stopPropagation();
	document.querySelector(".jk-menu")?.remove();
	const list = el("div", { class: "jk-menu", role: "menu" });
	for (const item of items) {
		if (item === "-") {
			list.append(el("div", { class: "jk-menu-line", role: "separator" }));
			continue;
		}
		if (item.heading) {
			list.append(el("div", { class: "jk-menu-heading", text: item.heading }));
			continue;
		}
		list.append(
			el(
				"button",
				{
					class: `jk-menu-item${item.danger ? " danger" : ""}`,
					type: "button",
					role: "menuitem",
					disabled: item.disabled,
					"data-color": item.color,
					onclick: () => {
						list.remove();
						item.run();
					},
				},
				[
					item.icon ? icon(item.icon) : el("span", { class: "jk-menu-swatch" }),
					el("span", { text: item.text }),
				],
			),
		);
	}
	document.body.append(list);
	const box = list.getBoundingClientRect();
	list.style.left = `${Math.min(event.clientX, innerWidth - box.width - 6)}px`;
	list.style.top = `${Math.min(event.clientY, innerHeight - box.height - 6)}px`;
	list.querySelector("button:not(:disabled)")?.focus();
	const away = (other) => {
		if (other.type === "keydown" && other.key !== "Escape") return;
		if (other.type === "mousedown" && list.contains(other.target)) return;
		list.remove();
		removeEventListener("mousedown", away, true);
		removeEventListener("keydown", away, true);
	};
	addEventListener("mousedown", away, true);
	addEventListener("keydown", away, true);
}

// --- Running ----------------------------------------------------------------------------

const describeSource = (source) => {
	switch (source.kind) {
		case "override":
			return t("this run");
		case "action":
			return t("action: {0}", source.actionName);
		case "target":
			return t("target");
		case "group":
			return t("group: {0}", source.groupName);
		case "default":
			return t("default");
		default:
			return t("empty");
	}
};

const sourceChip = (source) =>
	el("span", { class: "jk-source", "data-kind": source.kind, text: describeSource(source) });

/** Runs an action (or a pipeline as it is) on targets, asking first when several would start or the action says so. */
async function runOn({ targetIds = [], groupId = null, actionId = null, edit = false }) {
	const input = { targetIds, groupId, actionId, overrides: {} };
	const planned = await attempt(() => kalem.call("plan", input));
	if (!planned) return;
	if (planned.length === 0) {
		toast(t("Nothing to run here: no target uses this action's pipeline."), "warn");
		return;
	}
	const action = actionId ? config.quickActions.find((each) => each.id === actionId) : null;
	const ask = edit || action?.confirm || (planned.length > 1 && settings.confirmBulk !== false);
	if (!ask) {
		await start(input);
		return;
	}
	preview(input, planned, edit && planned.length === 1);
}

async function start(input) {
	const started = await attempt(() => kalem.call("run", input));
	if (started) {
		runsTab = "now";
		for (const run of started) upsertRun(run);
		renderRuns();
	}
}

function previewTable(item, overrides, onEdit) {
	return el("table", { class: "k-table jk-params" }, [
		el("thead", {}, [
			el("tr", {}, [
				el("th", { text: t("Name") }),
				el("th", { text: t("Value") }),
				el("th", { text: "" }),
			]),
		]),
		el(
			"tbody",
			{},
			item.params.map((param) => {
				let cell;
				if (onEdit) {
					cell = paramInput(param, overrides[param.name] ?? param.value, (value) => {
						overrides[param.name] = value;
						onEdit();
					});
				} else
					cell = el("code", {
						class: "jk-value",
						text: param.sensitive ? "••••••" : param.value || "—",
					});
				return el("tr", {}, [
					el("td", { class: "jk-param-name", text: param.name }),
					el("td", {}, [cell]),
					el("td", {}, [sourceChip(param.source)]),
				]);
			}),
		),
	]);
}

function preview(input, planned, editable) {
	const action = input.actionId
		? config.quickActions.find((each) => each.id === input.actionId)
		: null;
	const body = el("div", { class: "jk-preview" });
	const overrides = input.overrides;
	const draw = (items) => {
		const warnings = [...new Set(items.flatMap((item) => item.warnings))];
		body.replaceChildren(
			...[
				warnings.length
					? el("div", { class: "k-notice warn" }, [
							icon("alert"),
							el("div", {}, [
								el("strong", { text: t("Warnings") }),
								el("p", {
									text: `${warnings.join(" · ")} — ${t("Unresolved variables are sent as they are.")}`,
								}),
							]),
						])
					: null,
				...items.map((item) =>
					el("section", { class: "jk-preview-item" }, [
						el("header", { class: "jk-preview-head" }, [
							icon("target"),
							el("strong", { text: item.target.name }),
							el("span", { class: "k-muted", text: item.target.group }),
							el("span", { class: "k-spacer" }),
							el("span", { class: "k-badge", text: item.pipeline.name }),
						]),
						item.params.length
							? previewTable(item, overrides, editable ? () => undefined : null)
							: el("p", { class: "k-muted k-small", text: "—" }),
					]),
				),
			].filter(Boolean),
		);
	};
	draw(planned);
	const title = action
		? `${action.name} — ${t("{0} targets", planned.length)}`
		: t("Run on {0} targets", planned.length);
	dialog(
		title,
		body,
		(close) => [
			button(t("Cancel"), close, "ghost"),
			button(
				planned.length > 1 ? t("Run ({0})", planned.length) : t("Run"),
				async () => {
					close();
					await start(input);
				},
				"go",
				"play",
			),
		],
		{ wide: true },
	);
}

function paramInput(def, value, onChange) {
	if (def.type === "boolean" || def.def?.type === "boolean") {
		const box = el("input", { type: "checkbox", "aria-label": def.name });
		box.checked = String(value) === "true";
		box.addEventListener("change", () => onChange(String(box.checked)));
		return box;
	}
	const choices = def.choices ?? def.def?.choices;
	if (choices?.length) {
		const select = el("select", { class: "k-select", "aria-label": def.name }, [
			...(choices.includes(value) ? [] : [el("option", { value, text: value || "—" })]),
			...choices.map((choice) => el("option", { value: choice, text: choice })),
		]);
		select.value = value;
		select.addEventListener("change", () => onChange(select.value));
		return select;
	}
	const input = el("input", {
		class: "k-input k-mono",
		type: def.type === "password" || def.sensitive ? "password" : "text",
		value,
		spellcheck: "false",
		"aria-label": def.name,
	});
	input.addEventListener("input", () => onChange(input.value));
	return input;
}

function upsertRun(run) {
	const index = runs.findIndex((each) => each.id === run.id);
	if (index === -1) runs.unshift(run);
	else runs[index] = run;
	if (isFinal(run.status))
		history = [run, ...history.filter((each) => each.id !== run.id)].slice(0, 200);
}

// --- Console ----------------------------------------------------------------------------

function openConsole(buildUrl, title) {
	const code = el("pre", { class: "k-code jk-console", tabindex: "0" });
	const follow = el("span", { class: "jk-follow", hidden: true }, [
		el("span", { class: "k-spinner" }),
		el("span", { text: t("Following the log") }),
	]);
	const stagesBox = el("div", { class: "jk-stages" });
	let start = 0;
	let open = true;
	let timer = 0;
	const pull = async () => {
		if (!open) return;
		const part = await attempt(() => kalem.call("console", { buildUrl, start }));
		if (!part || !open) return;
		const atBottom = code.scrollHeight - code.scrollTop - code.clientHeight < 40;
		if (part.text) code.append(document.createTextNode(part.text));
		start = part.next;
		if (atBottom) code.scrollTop = code.scrollHeight;
		follow.hidden = !part.more;
		const stages = await kalem.call("stages", buildUrl).catch(() => null);
		if (open) drawStages(stagesBox, stages);
		if (part.more) timer = setTimeout(pull, 1500);
	};
	dialog(
		title,
		[stagesBox, code],
		(close) => [follow, el("span", { class: "k-spacer" }), button(t("Close"), close, "ghost")],
		{
			wide: true,
			onClose: () => {
				open = false;
				clearTimeout(timer);
			},
		},
	);
	void pull();
}

function drawStages(box, stages) {
	box.replaceChildren(
		...(stages ?? []).map((stage) =>
			el(
				"span",
				{
					class: "jk-stage",
					"data-status": stage.status,
					title: `${stage.name} · ${stage.status}`,
				},
				[
					el("span", { class: "jk-stage-dot" }),
					el("span", { text: stage.name }),
					stage.durationMillis
						? el("span", { class: "k-muted", text: duration(stage.durationMillis) })
						: null,
				],
			),
		),
	);
	box.hidden = !stages?.length;
}

// --- Targets ----------------------------------------------------------------------------

function actionsFor(groupId) {
	const pipelineIds = new Set(
		targetsInSubtree(groupId, config.groups, config.targets).map((target) => target.pipelineId),
	);
	return config.quickActions
		.filter((action) => pipelineIds.has(action.pipelineId))
		.sort((a, b) => a.order - b.order);
}

function actionMenuItems(actions, scope, countOf) {
	return actions.map((action) => ({
		text: `${action.name} (${countOf(action)})`,
		color: action.color,
		disabled: countOf(action) === 0,
		run: () => runOn({ ...scope, actionId: action.id }),
	}));
}

async function addGroup(parentId) {
	const name = await ask(
		parentId ? t("Add subgroup") : t("Add group"),
		t("Group name"),
		"",
		t("e.g. Test"),
	);
	if (!name) return;
	const group = {
		id: newId("grp"),
		name,
		parentId,
		variables: {},
		order: childGroups(parentId).length,
	};
	config.groups.push(group);
	if (parentId) collapsed.delete(parentId);
	selected = { kind: "group", id: group.id };
	await save();
}

async function addTarget(groupId) {
	if (config.pipelines.length === 0) {
		view = "pipelines";
		render();
		toast(t("Add a pipeline"), "warn");
		return;
	}
	const name = await ask(t("Add target"), t("Target name"), "", t("e.g. crm-web"));
	if (!name) return;
	const target = {
		id: newId("tgt"),
		name,
		groupId,
		pipelineId: config.pipelines[0].id,
		params: {},
		order: groupTargets(groupId).length,
	};
	config.targets.push(target);
	collapsed.delete(groupId);
	selected = { kind: "target", id: target.id };
	await save();
}

async function rename(item, kind) {
	const name = await ask(
		t("Rename"),
		kind === "group" ? t("Group name") : t("Target name"),
		item.name,
	);
	if (!name) return;
	item.name = name;
	await save();
}

async function removeGroup(group) {
	if (!(await confirmBox(t("Delete {0}?", group.name), t("Its subgroups and targets go too."))))
		return;
	const ids = new Set(descendantGroupIds(group.id, config.groups));
	config.groups = config.groups.filter((each) => !ids.has(each.id));
	config.targets = config.targets.filter((each) => !ids.has(each.groupId));
	selected = null;
	await save();
}

async function removeTarget(target) {
	if (!(await confirmBox(t("Delete {0}?", target.name), target.name))) return;
	config.targets = config.targets.filter((each) => each.id !== target.id);
	selected = null;
	await save();
}

async function duplicateTarget(target) {
	const copy = {
		...target,
		id: newId("tgt"),
		name: `${target.name} (2)`,
		params: { ...target.params },
		order: target.order + 0.5,
	};
	config.targets.push(copy);
	selected = { kind: "target", id: copy.id };
	await save();
}

async function paste(groupId) {
	for (const target of clipboard) {
		config.targets.push({
			...target,
			id: newId("tgt"),
			groupId,
			params: { ...target.params },
			order: groupTargets(groupId).length,
		});
	}
	collapsed.delete(groupId);
	await save();
}

function groupMenu(event, group) {
	const subtree = targetsInSubtree(group.id, config.groups, config.targets);
	const actions = actionsFor(group.id);
	menu(event, [
		...(actions.length
			? [
					{ heading: t("Quick actions") },
					...actionMenuItems(
						actions,
						{ groupId: group.id },
						(action) => subtree.filter((target) => target.pipelineId === action.pipelineId).length,
					),
					"-",
				]
			: []),
		{ text: t("Add subgroup"), icon: "folder", run: () => addGroup(group.id) },
		{ text: t("Add target"), icon: "plus", run: () => addTarget(group.id) },
		{
			text: t("Paste"),
			icon: "copy",
			disabled: clipboard.length === 0,
			run: () => paste(group.id),
		},
		{
			text: t("Copy targets"),
			icon: "copy",
			disabled: subtree.length === 0,
			run: () => (clipboard = groupTargets(group.id)),
		},
		"-",
		{ text: t("Rename"), icon: "file", run: () => rename(group, "group") },
		{ text: t("Delete"), icon: "trash", danger: true, run: () => removeGroup(group) },
	]);
}

function targetMenu(event, target) {
	const actions = actionsOf(target.pipelineId);
	menu(event, [
		...(actions.length
			? [
					{ heading: t("Quick actions") },
					...actionMenuItems(actions, { targetIds: [target.id] }, () => 1),
					"-",
				]
			: []),
		{ text: t("Run…"), icon: "play", run: () => runOn({ targetIds: [target.id] }) },
		{
			text: t("Run with parameters…"),
			icon: "settings",
			run: () => runOn({ targetIds: [target.id], edit: true }),
		},
		"-",
		{ text: t("Duplicate"), icon: "copy", run: () => duplicateTarget(target) },
		{ text: t("Copy targets"), icon: "copy", run: () => (clipboard = [target]) },
		{ text: t("Rename"), icon: "file", run: () => rename(target, "target") },
		{ text: t("Delete"), icon: "trash", danger: true, run: () => removeTarget(target) },
	]);
}

function treeNode(group, depth) {
	const open = !collapsed.has(group.id);
	const isSelected = selected?.kind === "group" && selected.id === group.id;
	const count = targetsInSubtree(group.id, config.groups, config.targets).length;
	const row = el(
		"div",
		{
			class: "jk-node",
			role: "treeitem",
			"aria-selected": String(isSelected),
			"aria-expanded": String(open),
			tabindex: "0",
			style: `--depth:${depth}`,
			onclick: () => {
				selected = { kind: "group", id: group.id };
				render();
			},
			oncontextmenu: (event) => groupMenu(event, group),
			onkeydown: (event) => {
				if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
					const box = row.getBoundingClientRect();
					groupMenu(
						{
							preventDefault() {},
							stopPropagation() {},
							clientX: box.left + 40,
							clientY: box.bottom,
						},
						group,
					);
				}
			},
		},
		[
			el(
				"button",
				{
					class: "jk-twisty",
					type: "button",
					"aria-label": group.name,
					tabindex: "-1",
					onclick: (event) => {
						event.stopPropagation();
						if (open) collapsed.add(group.id);
						else collapsed.delete(group.id);
						render();
					},
				},
				[icon(open ? "down" : "chevron")],
			),
			icon("folder"),
			el("span", { class: "jk-node-name", text: group.name }),
			el("span", { class: "k-tab-count", text: String(count) }),
			iconButton("more", t("Quick actions"), (event) => groupMenu(event, group), {
				class: "k-button icon small ghost jk-node-more",
			}),
		],
	);
	const children = open
		? [
				...childGroups(group.id).map((child) => treeNode(child, depth + 1)),
				...groupTargets(group.id).map((target) => targetNode(target, depth + 1)),
			]
		: [];
	return el("div", { role: "group" }, [row, ...children]);
}

function targetNode(target, depth) {
	const isSelected = selected?.kind === "target" && selected.id === target.id;
	const last =
		runs.find((run) => run.targetId === target.id) ??
		history.find((run) => run.targetId === target.id);
	return el(
		"div",
		{
			class: "jk-node jk-target",
			role: "treeitem",
			"aria-selected": String(isSelected),
			tabindex: "0",
			style: `--depth:${depth}`,
			onclick: () => {
				selected = { kind: "target", id: target.id };
				render();
			},
			ondblclick: () => runOn({ targetIds: [target.id] }),
			oncontextmenu: (event) => targetMenu(event, target),
		},
		[
			el("span", { class: "jk-twisty" }),
			icon("target"),
			el("span", { class: "jk-node-name", text: target.name }),
			last
				? el("span", {
						class: `k-dot ${STATUS_KIND[last.status] ?? ""}`.trim(),
						title: t(last.status),
					})
				: null,
			el("span", { class: "jk-node-meta", text: pipelineOf(target.pipelineId)?.name ?? "" }),
			iconButton("more", t("Quick actions"), (event) => targetMenu(event, target), {
				class: "k-button icon small ghost jk-node-more",
			}),
		],
	);
}

function variablesEditor(owned, onChange) {
	const rows = [
		...Object.entries(owned).map(([key, value]) => ({ key, value })),
		{ key: "", value: "", blank: true },
	];
	const grid = el("div", { class: "k-kv jk-vars" }, [
		el("span", { class: "k-kv-head", text: t("Name") }),
		el("span", { class: "k-kv-head", text: t("Value") }),
		el("span"),
	]);
	const commit = (rerender) => {
		const next = {};
		for (const row of rows) if (row.key.trim()) next[row.key.trim()] = row.value;
		onChange(next, rerender);
	};
	rows.forEach((row) => {
		const key = el("input", {
			class: "k-input k-mono",
			value: row.key,
			placeholder: t("Name"),
			spellcheck: "false",
			"aria-label": t("Name"),
		});
		const value = el("input", {
			class: "k-input k-mono",
			value: row.value,
			placeholder: t("Value"),
			spellcheck: "false",
			"aria-label": t("Value"),
		});
		key.addEventListener("input", () => {
			row.key = key.value;
		});
		key.addEventListener("change", () => commit(row.blank));
		value.addEventListener("input", () => {
			row.value = value.value;
		});
		value.addEventListener("change", () => commit(row.blank && row.key !== ""));
		grid.append(
			key,
			value,
			row.blank
				? el("span")
				: iconButton("trash", t("Delete"), () => {
						rows.splice(rows.indexOf(row), 1);
						commit(true);
					}),
		);
	});
	return grid;
}

function actionBar(actions, scope, countOf) {
	if (actions.length === 0) return null;
	return el(
		"div",
		{ class: "jk-actions" },
		actions.map((action) =>
			el(
				"button",
				{
					class: "k-button small jk-action",
					type: "button",
					"data-color": action.color,
					disabled: countOf(action) === 0,
					onclick: () => runOn({ ...scope, actionId: action.id }),
				},
				[
					icon("play"),
					el("span", { text: action.name }),
					countOf(action) > 1
						? el("span", { class: "k-tab-count", text: String(countOf(action)) })
						: null,
				],
			),
		),
	);
}

function groupDetail(group) {
	const inherited = effectiveVariables(group.parentId, config.groups);
	const subtree = targetsInSubtree(group.id, config.groups, config.targets);
	return el("div", { class: "jk-detail" }, [
		el("header", { class: "jk-detail-head" }, [
			el("div", { class: "jk-detail-title" }, [
				icon("folder"),
				el("h2", { text: group.name }),
				el("span", {
					class: "k-muted",
					text: groupChain(group.parentId, config.groups).length ? groupPath(group.parentId) : "",
				}),
			]),
			el("span", { class: "k-spacer" }),
			button(t("Add target"), () => addTarget(group.id), "small", "plus"),
			button(t("Add subgroup"), () => addGroup(group.id), "small ghost", "folder"),
			iconButton("more", t("Quick actions"), (event) => groupMenu(event, group)),
		]),
		actionBar(
			actionsFor(group.id),
			{ groupId: group.id },
			(action) => subtree.filter((target) => target.pipelineId === action.pipelineId).length,
		),
		el("h3", { class: "k-section-title", text: t("Variables") }),
		el("p", {
			class: "k-muted k-small jk-hint",
			text: t(
				"A group's variables pass down to its subgroups and targets; a target's parameters override them.",
			),
		}),
		variablesEditor(group.variables, (next, rerender) => {
			group.variables = next;
			void kalem.call("saveConfig", config).then((saved) => {
				config = saved;
				if (rerender) render();
			});
		}),
		inherited.some((entry) => !Object.hasOwn(group.variables, entry.name))
			? el("div", { class: "jk-inherited" }, [
					el("h3", { class: "k-section-title", text: t("Inherited") }),
					el(
						"div",
						{ class: "jk-inherited-list" },
						inherited
							.filter((entry) => !Object.hasOwn(group.variables, entry.name))
							.map((entry) =>
								el("div", { class: "jk-inherited-row" }, [
									el("code", { class: "jk-param-name", text: entry.name }),
									el("code", { class: "jk-value", text: entry.value }),
									el("span", {
										class: "jk-source",
										"data-kind": "group",
										text: t("from {0}", entry.groupName),
									}),
								]),
							),
					),
				])
			: null,
	]);
}

function targetDetail(target) {
	const pipeline = pipelineOf(target.pipelineId);
	const resolved = resolveParams({
		pipeline,
		target,
		groups: config.groups,
		action: null,
		overrides: {},
	});
	const select = el(
		"select",
		{ class: "k-select", "aria-label": t("Pipeline") },
		config.pipelines.map((each) => el("option", { value: each.id, text: each.name })),
	);
	select.value = target.pipelineId;
	select.addEventListener("change", async () => {
		target.pipelineId = select.value;
		await save();
	});
	const withoutTarget = resolveParams({
		pipeline,
		target: { ...target, params: {} },
		groups: config.groups,
		action: null,
		overrides: {},
	});
	const rows = resolved.params.map((param, index) => {
		const own = Object.hasOwn(target.params, param.name);
		const inheritedValue = withoutTarget.params[index].value;
		const input = el("input", {
			class: "k-input k-mono",
			type: param.def.type === "password" ? "password" : "text",
			value: own ? target.params[param.name] : "",
			placeholder: inheritedValue || t("Leave empty to inherit"),
			spellcheck: "false",
			"aria-label": param.name,
		});
		input.addEventListener("change", async () => {
			if (input.value === "") delete target.params[param.name];
			else target.params[param.name] = input.value;
			await save();
		});
		return el("tr", {}, [
			el("td", {}, [
				el("div", { class: "jk-param-name", text: param.name }),
				param.def.description
					? el("div", { class: "k-muted k-small", text: param.def.description })
					: null,
			]),
			el("td", {}, [input]),
			el("td", { class: "jk-resolved" }, [
				el("code", {
					class: "jk-value",
					text: param.def.type === "password" ? "••••••" : param.value || "—",
				}),
			]),
			el("td", {}, [sourceChip(param.source)]),
		]);
	});
	return el("div", { class: "jk-detail" }, [
		el("header", { class: "jk-detail-head" }, [
			el("div", { class: "jk-detail-title" }, [
				icon("target"),
				el("h2", { text: target.name }),
				el("span", { class: "k-muted", text: groupPath(target.groupId) }),
			]),
			el("span", { class: "k-spacer" }),
			button(
				t("Run with parameters…"),
				() => runOn({ targetIds: [target.id], edit: true }),
				"small ghost",
				"settings",
			),
			button(t("Run"), () => runOn({ targetIds: [target.id] }), "small go", "play"),
			iconButton("more", t("Quick actions"), (event) => targetMenu(event, target)),
		]),
		actionBar(actionsOf(target.pipelineId), { targetIds: [target.id] }, () => 1),
		el("label", { class: "jk-field" }, [
			el("span", { class: "jk-label", text: t("Pipeline") }),
			select,
			el("span", { class: "k-muted k-small k-mono", text: jobLabel(pipeline.jobPath) }),
		]),
		el("h3", { class: "k-section-title", text: t("Parameters") }),
		resolved.warnings.length
			? el("div", { class: "k-notice warn" }, [
					icon("alert"),
					el("span", { text: resolved.warnings.join(" · ") }),
				])
			: null,
		el("table", { class: "k-table jk-params" }, [
			el("thead", {}, [
				el("tr", {}, [
					el("th", { text: t("Name") }),
					el("th", { text: t("target") }),
					el("th", { text: t("Value") }),
					el("th", { text: "" }),
				]),
			]),
			el("tbody", {}, rows),
		]),
	]);
}

function targetsView() {
	const roots = childGroups(null);
	const tree = el(
		"div",
		{ class: "jk-tree", role: "tree", "aria-label": t("Groups") },
		roots.map((group) => treeNode(group, 0)),
	);
	const side = el("aside", { class: "k-sidebar jk-side" }, [
		el("div", { class: "jk-side-head" }, [
			el("span", { class: "k-section-title", text: t("Groups") }),
			el("span", { class: "k-spacer" }),
			iconButton("plus", t("Add group"), () => addGroup(null)),
		]),
		roots.length
			? tree
			: el("div", { class: "jk-side-empty" }, [
					button(t("Add group"), () => addGroup(null), "small", "plus"),
				]),
	]);
	let detail;
	const current =
		selected?.kind === "group"
			? groupOf(selected.id)
			: selected?.kind === "target"
				? targetOf(selected.id)
				: null;
	if (config.groups.length === 0) {
		detail = el("div", { class: "k-empty" }, [
			el("span", { class: "k-empty-icon" }, [icon("server")]),
			el("strong", { text: t("No groups yet") }),
			el("p", {
				text: t(
					"Add a group (an environment such as Test), then targets under it, or import QuickPipeline's config.json.",
				),
			}),
			el("div", { class: "k-row" }, [
				button(t("Add group"), () => addGroup(null), "primary", "plus"),
				button(t("Import QuickPipeline"), () => importExport("import"), "", "upload"),
			]),
		]);
	} else if (!current) {
		detail = el("div", { class: "k-empty" }, [
			el("span", { class: "k-empty-icon" }, [icon("target")]),
			el("strong", { text: t("Pick a group or a target") }),
			el("p", {
				text: t(
					"A group's variables pass down to its subgroups and targets; a target's parameters override them.",
				),
			}),
		]);
	} else detail = selected.kind === "group" ? groupDetail(current) : targetDetail(current);
	return el("div", { class: "k-split jk-body" }, [
		side,
		el("main", { class: "k-scroll jk-main" }, [detail]),
	]);
}

// --- Pipelines --------------------------------------------------------------------------

async function addPipeline(prefill = "") {
	const input = el("input", {
		class: "k-input k-mono",
		value: prefill,
		placeholder: "https://jenkins/job/Folder/job/app/",
		spellcheck: "false",
		"aria-label": t("Pipeline"),
	});
	const found = el("div", { class: "jk-found" });
	let job = null;
	const read = async () => {
		found.replaceChildren(el("span", { class: "k-spinner" }));
		job = await attempt(() => kalem.call("fetchJob", input.value.trim()));
		found.replaceChildren(
			job
				? el("div", { class: "k-notice" }, [
						icon("check"),
						el("div", {}, [
							el("strong", { text: job.fullName }),
							el("p", {
								text: `${t("Parameters")}: ${job.parameters.map((param) => param.name).join(", ") || "—"}`,
							}),
						]),
					])
				: "",
		);
	};
	const form = el("form", { class: "k-stack" }, [
		el("p", {
			class: "k-muted",
			text: t("Paste a job's address; its parameters are read from Jenkins."),
		}),
		el("div", { class: "k-group" }, [input, button(t("Read from Jenkins"), read, "", "refresh")]),
		found,
	]);
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void read();
	});
	dialog(t("Add a pipeline"), form, (close) => [
		button(t("Cancel"), close, "ghost"),
		button(
			t("Add"),
			async () => {
				if (!job) await read();
				if (!job) return;
				close();
				const pipeline = {
					id: newId("pl"),
					name: job.name,
					jobPath: job.jobPath,
					description: job.description,
					parameters: job.parameters,
					originalParameters: job.parameters,
					syncedAt: new Date().toISOString(),
				};
				config.pipelines.push(pipeline);
				selectedPipeline = pipeline.id;
				view = "pipelines";
				await save();
			},
			"primary",
			"plus",
		),
	]);
	if (prefill) void read();
	else input.focus();
}

async function refreshPipeline(pipeline) {
	const job = await attempt(() => kalem.call("fetchJob", pipeline.jobPath));
	if (!job) return;
	const edited = new Map(pipeline.parameters.map((param) => [param.name, param]));
	pipeline.originalParameters = job.parameters;
	pipeline.parameters = job.parameters.map((param) => ({
		...param,
		...(edited.has(param.name) ? { defaultValue: edited.get(param.name).defaultValue } : {}),
	}));
	pipeline.syncedAt = new Date().toISOString();
	await save();
}

function quickActionsEditor(pipeline) {
	const actions = actionsOf(pipeline.id);
	const colors = ["default", "primary", "info", "success", "warning", "error"];
	return el("div", { class: "jk-qa-list" }, [
		...actions.map((action) => {
			const name = el("input", { class: "k-input", value: action.name, "aria-label": t("Name") });
			name.addEventListener("change", async () => {
				action.name = name.value.trim() || action.name;
				await save();
			});
			const color = el(
				"div",
				{ class: "jk-swatches", role: "radiogroup", "aria-label": "color" },
				colors.map((each) =>
					el("button", {
						class: "jk-swatch",
						type: "button",
						role: "radio",
						"aria-checked": String(action.color === each),
						"aria-label": each,
						"data-color": each,
						onclick: async () => {
							action.color = each;
							await save();
						},
					}),
				),
			);
			const confirm = el("input", { type: "checkbox", "aria-label": t("Ask first") });
			confirm.checked = action.confirm;
			confirm.addEventListener("change", async () => {
				action.confirm = confirm.checked;
				await save();
			});
			const params = el(
				"div",
				{ class: "jk-qa-params" },
				pipeline.parameters.map((def) => {
					const on = Object.hasOwn(action.params, def.name);
					const value = paramInput(
						def,
						on ? action.params[def.name] : (def.defaultValue ?? ""),
						async (next) => {
							action.params[def.name] = next;
							await kalem.call("saveConfig", config).then((saved) => (config = saved));
						},
					);
					const check = el("input", { type: "checkbox", "aria-label": def.name });
					check.checked = on;
					check.addEventListener("change", async () => {
						if (check.checked) action.params[def.name] = def.defaultValue ?? "";
						else delete action.params[def.name];
						await save();
					});
					if (!on && "disabled" in value) value.disabled = true;
					return el("label", { class: "jk-qa-param" }, [
						check,
						el("span", { class: "jk-param-name", text: def.name }),
						value,
					]);
				}),
			);
			return el("article", { class: "k-card jk-qa", "data-color": action.color }, [
				el("header", { class: "jk-qa-head" }, [
					el("span", { class: "jk-qa-bar" }),
					name,
					color,
					el("label", { class: "k-check" }, [confirm, el("span", { text: t("Ask first") })]),
					iconButton("trash", t("Delete"), async () => {
						config.quickActions = config.quickActions.filter((each) => each.id !== action.id);
						await save();
					}),
				]),
				params,
			]);
		}),
		button(
			t("Add action"),
			async () => {
				const name = await ask(t("Add action"), t("Name"), "", "Restart");
				if (!name) return;
				config.quickActions.push({
					id: newId("qa"),
					name,
					pipelineId: pipeline.id,
					params: {},
					confirm: false,
					color: "default",
					order: actions.length,
				});
				await save();
			},
			"small",
			"plus",
		),
	]);
}

function pipelineDetail(pipeline) {
	const name = el("input", { class: "k-input", value: pipeline.name, "aria-label": t("Name") });
	name.addEventListener("change", async () => {
		pipeline.name = name.value.trim() || pipeline.name;
		await save();
	});
	const rows = pipeline.parameters.map((param) => {
		const value = paramInput(param, param.defaultValue ?? "", async (next) => {
			param.defaultValue = next;
			config = await kalem.call("saveConfig", config);
		});
		return el("tr", {}, [
			el("td", {}, [
				el("div", { class: "jk-param-name", text: param.name }),
				param.description ? el("div", { class: "k-muted k-small", text: param.description }) : null,
			]),
			el("td", {}, [el("span", { class: "k-badge", text: param.type })]),
			el("td", {}, [value]),
		]);
	});
	const changed =
		JSON.stringify(pipeline.parameters) !== JSON.stringify(pipeline.originalParameters);
	const used = config.targets.filter((target) => target.pipelineId === pipeline.id).length;
	return el("div", { class: "jk-detail" }, [
		el("header", { class: "jk-detail-head" }, [
			el("div", { class: "jk-detail-title" }, [icon("pipeline"), name]),
			el("span", { class: "k-spacer" }),
			button(t("Refresh from Jenkins"), () => refreshPipeline(pipeline), "small", "refresh"),
			changed
				? button(
						t("Back to Jenkins' own"),
						async () => {
							pipeline.parameters = structuredClone(pipeline.originalParameters);
							await save();
						},
						"small ghost",
						"history",
					)
				: null,
			iconButton("trash", t("Delete"), async () => {
				if (
					!(await confirmBox(
						t("Delete {0}?", pipeline.name),
						used ? t("{0} targets", used) : pipeline.name,
					))
				)
					return;
				config.pipelines = config.pipelines.filter((each) => each.id !== pipeline.id);
				config.targets = config.targets.filter((each) => each.pipelineId !== pipeline.id);
				config.quickActions = config.quickActions.filter((each) => each.pipelineId !== pipeline.id);
				selectedPipeline = null;
				await save();
			}),
		]),
		el("p", { class: "k-mono k-small k-muted", text: jobLabel(pipeline.jobPath) }),
		pipeline.description ? el("p", { class: "jk-text", text: pipeline.description }) : null,
		el("h3", { class: "k-section-title", text: t("Parameters") }),
		el("table", { class: "k-table jk-params" }, [
			el("thead", {}, [
				el("tr", {}, [
					el("th", { text: t("Name") }),
					el("th", { text: t("Type") }),
					el("th", { text: t("Default") }),
				]),
			]),
			el("tbody", {}, rows),
		]),
		el("h3", { class: "k-section-title", text: t("Quick actions") }),
		quickActionsEditor(pipeline),
	]);
}

function pipelinesView() {
	const current = pipelineOf(selectedPipeline) ?? config.pipelines[0];
	const side = el("aside", { class: "k-sidebar jk-side" }, [
		el("div", { class: "jk-side-head" }, [
			el("span", { class: "k-section-title", text: t("Pipelines") }),
			el("span", { class: "k-spacer" }),
			iconButton("plus", t("Add a pipeline"), () => addPipeline()),
		]),
		el(
			"div",
			{ class: "k-list" },
			config.pipelines.map((pipeline) =>
				el(
					"div",
					{
						class: "k-list-item",
						role: "button",
						tabindex: "0",
						"aria-selected": String(pipeline === current),
						onclick: () => {
							selectedPipeline = pipeline.id;
							render();
						},
					},
					[
						icon("pipeline"),
						el("div", { class: "k-grow" }, [
							el("div", { class: "k-name", text: pipeline.name }),
							el("div", {
								class: "k-small k-muted",
								text: `${pipeline.parameters.length} · ${actionsOf(pipeline.id)
									.map((action) => action.name)
									.join(", ")}`,
							}),
						]),
					],
				),
			),
		),
	]);
	const detail = current
		? pipelineDetail(current)
		: el("div", { class: "k-empty" }, [
				el("span", { class: "k-empty-icon" }, [icon("pipeline")]),
				el("strong", { text: t("No pipelines yet") }),
				el("p", { text: t("Add one from a job's address.") }),
				button(t("Add a pipeline"), () => addPipeline(), "primary", "plus"),
			]);
	return el("div", { class: "k-split jk-body" }, [
		side,
		el("main", { class: "k-scroll jk-main" }, [detail]),
	]);
}

// --- Jobs -------------------------------------------------------------------------------

let jobsLoading = null;
async function loadJobs(folder) {
	const token = Symbol(folder);
	jobsLoading = token;
	jobsState = { ...jobsState, folder, list: null, error: "" };
	render();
	let list = [];
	let error = "";
	try {
		list = await kalem.call("jobs", folder);
	} catch (failure) {
		error = failure.message;
	}
	if (jobsLoading !== token) return;
	jobsLoading = null;
	jobsState = { ...jobsState, list, error };
	render();
}

async function openJob(job) {
	jobsState = { ...jobsState, job, builds: null };
	render();
	jobsState.builds = (await attempt(() => kalem.call("builds", job.jobPath))) ?? [];
	render();
}

async function buildJob(job) {
	const info = await attempt(() => kalem.call("fetchJob", job.jobPath));
	if (!info) return;
	const values = Object.fromEntries(
		info.parameters.map((param) => [param.name, param.defaultValue ?? ""]),
	);
	const go = async () => {
		const started = await attempt(() =>
			kalem.call("runJob", { jobPath: job.jobPath, params: values }),
		);
		if (started) {
			for (const run of started) upsertRun(run);
			renderRuns();
		}
	};
	if (info.parameters.length === 0) return go();
	dialog(
		info.fullName,
		el("table", { class: "k-table jk-params" }, [
			el(
				"tbody",
				{},
				info.parameters.map((param) =>
					el("tr", {}, [
						el("td", {}, [
							el("div", { class: "jk-param-name", text: param.name }),
							param.description
								? el("div", { class: "k-muted k-small", text: param.description })
								: null,
						]),
						el("td", {}, [
							paramInput(param, values[param.name], (next) => (values[param.name] = next)),
						]),
					]),
				),
			),
		]),
		(close) => [
			button(t("Cancel"), close, "ghost"),
			button(
				t("Run"),
				() => {
					close();
					void go();
				},
				"go",
				"play",
			),
		],
		{ wide: true },
	);
}

function jobsView() {
	if (jobsState.list === null && !jobsLoading && !jobsState.error && connection.state === "ok")
		void loadJobs(jobsState.folder);
	const parts = jobsState.folder
		? jobsState.folder
				.split("/job/")
				.filter(Boolean)
				.map((part) => decodeURIComponent(part.replace(/^job\//, "")))
		: [];
	const crumbs = el("nav", { class: "jk-crumbs", "aria-label": t("Folder") }, [
		el("button", { class: "jk-crumb", type: "button", onclick: () => loadJobs("") }, [
			icon("server"),
			el("span", { text: "Jenkins" }),
		]),
		...parts.map((part, index) =>
			el(
				"button",
				{
					class: "jk-crumb",
					type: "button",
					onclick: () =>
						loadJobs(
							parts
								.slice(0, index + 1)
								.map((name) => `job/${encodeURIComponent(name)}`)
								.join("/"),
						),
				},
				[icon("chevron"), el("span", { text: part })],
			),
		),
	]);
	const list =
		jobsState.list === null
			? el("div", { class: "jk-side-empty" }, [el("span", { class: "k-spinner" })])
			: jobsState.error
				? el("div", { class: "k-notice error jk-side-notice" }, [
						icon("alert"),
						el("span", { text: jobsState.error }),
					])
				: el(
						"div",
						{ class: "k-list" },
						jobsState.list.map((job) =>
							el(
								"div",
								{
									class: "k-list-item",
									role: "button",
									tabindex: "0",
									"aria-selected": String(jobsState.job?.url === job.url),
									onclick: () => (job.folder ? loadJobs(job.jobPath) : openJob(job)),
								},
								[
									job.folder
										? icon("folder")
										: el("span", {
												class: `k-dot ${colorKind(job.color)}`.trim(),
												"data-building": String(job.color.endsWith("_anime")),
											}),
									el("div", { class: "k-grow" }, [
										el("div", { class: "k-name", text: job.name }),
										job.folder
											? null
											: el("div", {
													class: "k-small k-muted",
													text: job.lastBuild
														? `#${job.lastBuild.number} · ${ago(job.lastBuild.timestamp, kalem.language)}`
														: t("never built"),
												}),
									]),
									job.folder ? icon("chevron") : null,
								],
							),
						),
					);
	const job = jobsState.job;
	const detail = !job
		? el("div", { class: "k-empty" }, [
				el("span", { class: "k-empty-icon" }, [icon("server")]),
				el("strong", { text: t("Pick a job") }),
				el("p", { text: t("Its builds, console and stages show here.") }),
			])
		: el("div", { class: "jk-detail" }, [
				el("header", { class: "jk-detail-head" }, [
					el("div", { class: "jk-detail-title" }, [
						el("span", { class: `k-dot ${colorKind(job.color)}`.trim() }),
						el("h2", { text: job.name }),
						el("span", { class: "k-muted k-mono k-small", text: jobLabel(job.jobPath) }),
					]),
					el("span", { class: "k-spacer" }),
					button(t("Add as pipeline"), () => addPipeline(job.url), "small ghost", "plus"),
					iconButton("refresh", t("Refresh from Jenkins"), () => openJob(job)),
					button(t("Run"), () => buildJob(job), "small go", "play"),
				]),
				el("h3", { class: "k-section-title", text: t("Builds") }),
				jobsState.builds === null
					? el("span", { class: "k-spinner" })
					: el("table", { class: "k-table jk-builds" }, [
							el(
								"tbody",
								{},
								jobsState.builds.map((build) =>
									el(
										"tr",
										{
											class: "jk-build-row",
											tabindex: "0",
											onclick: () => openConsole(build.url, `${job.name} #${build.number}`),
										},
										[
											el("td", { class: "k-mono", text: `#${build.number}` }),
											el("td", {}, [
												statusBadge(build.building ? "running" : (build.result ?? "NOT_BUILT")),
											]),
											el("td", { class: "k-muted", text: ago(build.timestamp, kalem.language) }),
											el("td", {
												class: "k-muted k-mono",
												text: duration(
													build.building ? Date.now() - build.timestamp : build.duration,
												),
											}),
											el("td", { class: "jk-build-open" }, [icon("terminal")]),
										],
									),
								),
							),
						]),
			]);
	return el("div", { class: "k-split jk-body" }, [
		el("aside", { class: "k-sidebar jk-side" }, [
			el("div", { class: "jk-side-head" }, [
				crumbs,
				el("span", { class: "k-spacer" }),
				iconButton("refresh", t("Refresh from Jenkins"), () => loadJobs(jobsState.folder)),
			]),
			list,
		]),
		el("main", { class: "k-scroll jk-main" }, [detail]),
	]);
}

// --- Runs -------------------------------------------------------------------------------

function runRow(run) {
	const active = !isFinal(run.status);
	const elapsed = run.startedAt
		? (run.durationMs ?? Date.now() - new Date(run.startedAt).getTime())
		: 0;
	const progress =
		run.status === "running" && run.estimatedDurationMs > 0
			? Math.min(0.97, elapsed / run.estimatedDurationMs)
			: null;
	return el("article", { class: "jk-run", "data-status": run.status, "data-id": run.id }, [
		el("div", { class: "jk-run-top" }, [
			statusBadge(run.status),
			el("strong", { class: "jk-run-name", text: run.targetName, title: run.targetName }),
			run.buildNumber
				? el("span", { class: "k-mono k-muted k-small", text: `#${run.buildNumber}` })
				: null,
			el("span", { class: "k-spacer" }),
			run.buildUrl
				? iconButton("terminal", t("Console"), () =>
						openConsole(run.buildUrl, `${run.targetName} #${run.buildNumber}`),
					)
				: null,
			active
				? iconButton("stop", t("Stop"), () => attempt(() => kalem.call("stop", run.id)))
				: null,
		]),
		el("div", { class: "jk-run-meta k-small k-muted" }, [
			el("span", {
				text: [run.actionName, run.pipelineName, run.group].filter(Boolean).join(" · "),
			}),
			el("span", { class: "k-spacer" }),
			el("span", {
				class: "k-mono",
				text: active
					? duration(elapsed)
					: run.durationMs
						? duration(run.durationMs)
						: run.finishedAt
							? ago(run.finishedAt, kalem.language)
							: "",
			}),
		]),
		run.why && run.status === "queued"
			? el("div", { class: "k-small k-muted jk-run-why", text: run.why })
			: null,
		run.error ? el("div", { class: "k-small jk-run-error", text: run.error }) : null,
		progress !== null
			? el("div", { class: "jk-progress" }, [
					el("span", { style: `width:${Math.round(progress * 100)}%` }),
				])
			: run.status === "queued" || run.status === "running"
				? el("div", { class: "jk-progress indeterminate" }, [el("span")])
				: null,
	]);
}

let runsBox = null;
function renderRuns() {
	if (!runsBox) return;
	const list = runsTab === "now" ? runs : history;
	const tabs = el("div", { class: "k-segmented", role: "group" }, [
		el(
			"button",
			{
				type: "button",
				"aria-pressed": String(runsTab === "now"),
				onclick: () => {
					runsTab = "now";
					renderRuns();
				},
			},
			[
				el("span", { text: t("Now") }),
				runs.filter((run) => !isFinal(run.status)).length
					? el("span", {
							class: "k-tab-count",
							text: String(runs.filter((run) => !isFinal(run.status)).length),
						})
					: null,
			],
		),
		el("button", {
			type: "button",
			"aria-pressed": String(runsTab === "history"),
			onclick: () => {
				runsTab = "history";
				renderRuns();
			},
			text: t("History"),
		}),
	]);
	const clear =
		runsTab === "now"
			? iconButton(
					"check",
					t("Clear finished"),
					async () => {
						runs = (await attempt(() => kalem.call("clearFinished"))) ?? runs;
						renderRuns();
					},
					{ disabled: !runs.some((run) => isFinal(run.status)) },
				)
			: iconButton(
					"trash",
					t("Delete"),
					async () => {
						history = (await attempt(() => kalem.call("clearHistory"))) ?? history;
						renderRuns();
					},
					{ disabled: history.length === 0 },
				);
	runsBox.replaceChildren(
		el("div", { class: "jk-runs-head" }, [
			el("span", { class: "k-section-title", text: t("Runs") }),
			el("span", { class: "k-spacer" }),
			tabs,
			clear,
		]),
		list.length
			? el("div", { class: "jk-runs-list k-scroll" }, list.map(runRow))
			: el("div", { class: "k-empty jk-runs-empty" }, [
					el("span", { class: "k-empty-icon" }, [icon("play")]),
					el("strong", { text: t("No builds yet") }),
					el("p", { text: t("Builds you start show here, from the queue to their result.") }),
				]),
	);
}

setInterval(() => {
	if (runs.some((run) => run.status === "running" || run.status === "queued")) renderRuns();
}, 1000);

// --- Import / export --------------------------------------------------------------------

function importExport(tab = "import") {
	let mode = "merge";
	const file = el("input", {
		type: "file",
		accept: ".json,application/json",
		class: "jk-file",
		"aria-label": t("Import"),
	});
	const text = el("textarea", {
		class: "k-textarea k-mono jk-import-text",
		rows: "10",
		spellcheck: "false",
		placeholder: '{ "version": 1, "pipelines": [ … ] }',
		"aria-label": t("Import"),
	});
	file.addEventListener("change", async () => {
		const picked = file.files?.[0];
		if (picked) text.value = await picked.text();
	});
	const modes = el(
		"div",
		{ class: "k-segmented", role: "group" },
		["merge", "replace"].map((each) =>
			el("button", {
				type: "button",
				"aria-pressed": String(mode === each),
				text: each === "merge" ? t("Merge") : t("Replace"),
				onclick: (event) => {
					mode = each;
					for (const other of modes.children)
						other.setAttribute("aria-pressed", String(other === event.currentTarget));
				},
			}),
		),
	);
	const result = el("div");
	const importPane = el("div", { class: "k-stack" }, [
		el("p", {
			class: "k-muted",
			text: t("Choose QuickPipeline's config.json, or paste it below."),
		}),
		el("div", { class: "k-row" }, [file, el("span", { class: "k-spacer" }), modes]),
		text,
		result,
	]);
	const exported = el("pre", { class: "k-code jk-export" });
	const exportPane = el("div", { class: "k-stack" }, [
		el("p", {
			class: "k-muted",
			text: t("The same file QuickPipeline reads: share it or keep it."),
		}),
		exported,
	]);
	void kalem.call("export").then((json) => exported.append(document.createTextNode(json)));
	const panes = { import: importPane, export: exportPane };
	const body = el("div", { class: "jk-io" });
	const tabs = el("div", { class: "k-tabs", role: "tablist" });
	let footer;
	const show = (name) => {
		tab = name;
		tabs.replaceChildren(
			...["import", "export"].map((each) =>
				el("button", {
					class: "k-tab",
					role: "tab",
					type: "button",
					"aria-selected": String(each === name),
					text: each === "import" ? t("Import") : t("Export"),
					onclick: () => show(each),
				}),
			),
		);
		body.replaceChildren(tabs, panes[name]);
		if (footer) {
			footer.importButton.hidden = name !== "import";
			footer.copyButton.hidden = name !== "export";
		}
	};
	const { element } = dialog(
		t("Import / Export"),
		body,
		(close) => {
			const importButton = button(
				t("Import"),
				async () => {
					const answer = await attempt(() => kalem.call("import", { text: text.value, mode }));
					if (!answer) return;
					config = answer.config;
					const { counts, summary } = answer;
					result.replaceChildren(
						el("div", { class: "k-notice" }, [
							icon("check"),
							el("div", {}, [
								el("strong", {
									text: t(
										"Imported {0} pipelines, {1} groups, {2} targets and {3} quick actions.",
										counts.pipelines,
										counts.groups,
										counts.targets,
										counts.actions,
									),
								}),
								summary.baseUrl && summary.baseUrl !== settings.url
									? el("p", {
											text: t(
												"Its Jenkins was {0} (user {1}): set them in Settings › Extensions › Jenkins if they differ.",
												summary.baseUrl,
												summary.username || "—",
											),
										})
									: null,
							]),
						]),
					);
					selected = null;
					view = "targets";
					render();
				},
				"primary",
				"upload",
			);
			const copyButton = button(
				t("Copy"),
				() => {
					const area = el("textarea", { class: "jk-offscreen" });
					area.value = exported.textContent;
					element.append(area);
					area.select();
					document.execCommand("copy");
					area.remove();
					copyButton.querySelector("span").textContent = t("Copied");
				},
				"primary",
				"copy",
			);
			footer = { importButton, copyButton };
			return [button(t("Close"), close, "ghost"), importButton, copyButton];
		},
		{ wide: true },
	);
	show(tab);
}

// --- Frame ------------------------------------------------------------------------------

async function connect() {
	connection = { state: "busy", text: t("Connecting") };
	renderHead();
	if (!settings.url || !settings.hasToken) {
		connection = {
			state: "off",
			text: !settings.url
				? t("Set Jenkins' address (http:// or https://) in Settings › Extensions › Jenkins.")
				: t("Save your Jenkins API token in Settings › Extensions › Jenkins."),
		};
		render();
		return;
	}
	try {
		const info = await kalem.call("test");
		connection = {
			state: "ok",
			text: [info.user, info.version ? `Jenkins ${info.version}` : ""].filter(Boolean).join(" · "),
		};
	} catch (error) {
		connection = { state: "error", text: error.message };
	}
	render();
}

let headBox = null;
function renderHead() {
	if (!headBox) return;
	const views = [
		["targets", t("Targets"), "target"],
		["pipelines", t("Pipelines"), "pipeline"],
		["jobs", t("Jobs"), "server"],
	];
	const state = { ok: "ok", error: "error", off: "warn", busy: "", idle: "" }[connection.state];
	headBox.replaceChildren(
		el(
			"div",
			{ class: "k-tabs jk-views", role: "tablist" },
			views.map(([id, label, iconName]) =>
				el(
					"button",
					{
						class: "k-tab",
						role: "tab",
						type: "button",
						"aria-selected": String(view === id),
						onclick: () => {
							view = id;
							render();
						},
					},
					[icon(iconName), el("span", { text: label })],
				),
			),
		),
		el("span", { class: "k-spacer" }),
		el("span", { class: "jk-connection", "data-state": connection.state, title: connection.text }, [
			connection.state === "busy"
				? el("span", { class: "k-spinner" })
				: el("span", { class: `k-dot ${state}`.trim() }),
			el("span", {
				text:
					connection.state === "ok"
						? `${t("Connected")}${connection.text ? ` · ${connection.text}` : ""}`
						: connection.state === "busy"
							? t("Connecting")
							: t("Not connected"),
			}),
		]),
		iconButton("refresh", t("Refresh from Jenkins"), () => connect()),
		button(t("Import / Export"), () => importExport("import"), "small ghost", "exchange"),
	);
}

function render() {
	if (!headBox) {
		headBox = el("header", { class: "k-toolbar jk-head" });
		runsBox = el("aside", { class: "jk-runs" });
		app.replaceChildren(
			headBox,
			el("div", { class: "jk-frame" }, [el("div", { class: "jk-view" }), runsBox]),
		);
	}
	renderHead();
	const notice =
		connection.state === "off" || connection.state === "error"
			? el(
					"div",
					{ class: `k-notice ${connection.state === "error" ? "error" : "warn"} jk-banner` },
					[icon("alert"), el("span", { text: connection.text })],
				)
			: null;
	const body =
		view === "targets" ? targetsView() : view === "pipelines" ? pipelinesView() : jobsView();
	const scroll = [...app.querySelectorAll(".jk-main, .jk-tree")].map((box) => box.scrollTop);
	app.querySelector(".jk-view").replaceChildren(...[notice, body].filter(Boolean));
	[...app.querySelectorAll(".jk-main, .jk-tree")].forEach((box, index) => {
		box.scrollTop = scroll[index] ?? 0;
	});
	renderRuns();
}

kalem.onMessage((message) => {
	if (message?.type === "run") {
		upsertRun(message.run);
		renderRuns();
		if (view === "targets") render();
	}
});

async function load() {
	const state = await kalem.call("state");
	config = state.config;
	runs = state.runs;
	history = state.history;
	settings = state.settings;
	render();
	await connect();
}

kalem.onSettingsChanged(() => {
	jobsState = { ...jobsState, list: null, error: "" };
	void load();
});

void load();
