import { el, icon } from "./dom.js";
import { translator } from "./i18n.js";
import {
	appendText,
	countLevels,
	entryMatches,
	LEVELS,
	parseText,
	searchPattern,
	splitMatches,
} from "./parse.js";

const kalem = window.kalem;
const t = translator(kalem.language);
const app = document.getElementById("app");

const CAP_STEP = 2000;
const PREVIEW_LINES = 3;

let settings = { pollMs: 1000, maxLines: 20000 };
let files = [];
let recent = [];
const logs = new Map();
let active = null;
let query = "";
let regex = false;
let caseSensitive = false;
let onlyMatching = true;
let wrap = false;
let follow = true;
const hidden = new Set();
let cap = CAP_STEP;
let pattern = null;
let patternError = "";

const button = (text, onclick, kind = "", iconName = null, extra = {}) =>
	el("button", { class: `k-button ${kind}`.trim(), type: "button", onclick, ...extra }, [
		iconName ? icon(iconName) : null,
		text ? el("span", { text }) : null,
	]);

const toggle = (iconName, title, on, onclick, text = "") =>
	el(
		"button",
		{
			class: `k-button small ghost lv-toggle${text ? "" : " icon"}`,
			type: "button",
			title,
			"aria-label": title,
			"aria-pressed": String(on),
			onclick,
		},
		[icon(iconName), text ? el("span", { text }) : null],
	);

const formatSize = (bytes) =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(1)} KB`
			: `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function logOf(path) {
	let log = logs.get(path);
	if (!log) {
		log = {
			path,
			entries: [],
			start: 0,
			end: 0,
			size: 0,
			loaded: false,
			busy: false,
			notice: "",
			unseen: 0,
		};
		logs.set(path, log);
	}
	return log;
}

const keep = () => Math.max(1000, Number(settings.maxLines) || 20000);

async function load(log) {
	log.busy = true;
	try {
		const range = await kalem.call("tail", log.path);
		log.entries = parseText(range.text);
		log.start = range.start;
		log.end = range.end;
		log.size = range.size;
		log.loaded = true;
		log.notice = "";
	} catch (error) {
		log.notice = error.message;
	} finally {
		log.busy = false;
	}
}

async function poll(log) {
	if (log.busy || !log.loaded) return;
	log.busy = true;
	try {
		const answer = await kalem.call("poll", { path: log.path, offset: log.end });
		if (answer.missing) {
			log.notice = t("The file is not there any more; waiting for it to come back.");
			log.end = 0;
			if (log.path === active) renderStatus();
			return;
		}
		if (answer.rotated) {
			log.entries = parseText(answer.text);
			log.start = answer.start;
			log.end = answer.end;
			log.size = answer.size;
			log.notice = t("The file was rotated or truncated; reading it from its new end.");
			if (log.path === active) renderLog();
			return;
		}
		if (log.notice && !answer.rotated && answer.text !== "") log.notice = "";
		log.size = answer.size;
		if (answer.text === "") return;
		const before = log.entries.length;
		const previous = log.entries.at(-1);
		const added = appendText(log.entries, answer.text, keep());
		log.end = answer.end;
		const fresh = added === 0 ? [] : log.entries.slice(-added);
		if (log.path === active) appendRows(previous, fresh, before + added > keep());
		else
			log.unseen += fresh.filter(
				(entry) => entry.level === "error" || entry.level === "fatal",
			).length;
		if (log.path !== active) renderTabs();
	} catch (error) {
		log.notice = error.message;
	} finally {
		log.busy = false;
	}
}

async function loadEarlier() {
	const log = logOf(active);
	if (log.start === 0 || log.busy) return;
	log.busy = true;
	try {
		const range = await kalem.call("before", { path: log.path, end: log.start });
		log.entries = [...parseText(range.text), ...log.entries];
		log.start = range.start;
		cap += CAP_STEP;
	} catch (error) {
		log.notice = error.message;
	} finally {
		log.busy = false;
	}
	renderLog(false);
}

let timer = 0;
function schedule() {
	clearInterval(timer);
	timer = setInterval(
		() => {
			for (const file of files) void poll(logOf(file.path));
		},
		Math.max(250, Number(settings.pollMs) || 1000),
	);
}

// --- Rows -------------------------------------------------------------------------------

const visible = (entry) =>
	!hidden.has(entry.level ?? "none") && (!onlyMatching || entryMatches(entry, pattern));

function highlighted(line) {
	const element = el("span", { class: "lv-text" });
	for (const part of splitMatches(line, patternError ? null : pattern)) {
		element.append(part.hit ? el("mark", { text: part.text }) : document.createTextNode(part.text));
	}
	return element;
}

const rowOf = new WeakMap();

function row(entry) {
	const element = el("div", { class: "lv-entry", "data-level": entry.level ?? "none" }, [
		el("span", { class: "lv-level", text: entry.level ? t(entry.level) : "" }),
		el("div", { class: "lv-body" }, [highlighted(entry.line)]),
	]);
	if (entry.more.length > 0) {
		const body = element.lastChild;
		const drawMore = () => {
			for (const node of body.querySelectorAll(".lv-more, .lv-expand")) node.remove();
			const lines = entry.open ? entry.more : entry.more.slice(0, PREVIEW_LINES);
			body.append(
				el(
					"div",
					{ class: "lv-more" },
					lines.map((line) => el("div", {}, [highlighted(line)])),
				),
			);
			if (entry.more.length > PREVIEW_LINES) {
				body.append(
					el(
						"button",
						{
							class: "lv-expand",
							type: "button",
							onclick: () => {
								entry.open = !entry.open;
								drawMore();
							},
						},
						[
							icon(entry.open ? "down" : "chevron"),
							el("span", {
								text: entry.open
									? t("Show less")
									: t("{0} more lines", entry.more.length - PREVIEW_LINES),
							}),
						],
					),
				);
			}
		};
		drawMore();
	}
	rowOf.set(entry, element);
	return element;
}

let linesBox = null;
let moreBox = null;

function appendRows(previous, fresh, redraw) {
	if (redraw || !linesBox) {
		renderLog();
		return;
	}
	const old = previous ? rowOf.get(previous) : undefined;
	if (old?.isConnected) old.replaceWith(row(previous));
	const rows = fresh.filter(visible).map(row);
	linesBox.append(...rows);
	while (linesBox.childElementCount > cap) linesBox.firstElementChild.remove();
	renderBar();
	renderStatus();
	if (follow) linesBox.parentElement.scrollTop = linesBox.parentElement.scrollHeight;
}

// --- Frame ------------------------------------------------------------------------------

let tabsBox = null;
let barBox = null;
let viewBox = null;
let statusBox = null;

function renderTabs() {
	tabsBox.replaceChildren(
		el(
			"div",
			{ class: "k-tabs lv-tabs", role: "tablist", "aria-label": t("Logs") },
			files.map((file) => {
				const log = logOf(file.path);
				return el(
					"div",
					{ class: "lv-tab", "aria-selected": String(file.path === active), title: file.path },
					[
						el(
							"button",
							{
								class: "k-tab",
								type: "button",
								role: "tab",
								"aria-selected": String(file.path === active),
								onclick: () => select(file.path),
							},
							[
								icon("file"),
								el("span", { text: file.name }),
								log.unseen > 0
									? el("span", {
											class: "lv-unseen",
											text: String(log.unseen),
											title: t("{0} new", log.unseen),
										})
									: null,
							],
						),
						el(
							"button",
							{
								class: "lv-tab-close",
								type: "button",
								title: t("Close"),
								"aria-label": `${t("Close")} ${file.name}`,
								onclick: () => close(file.path),
							},
							[icon("close")],
						),
					],
				);
			}),
		),
		el(
			"button",
			{
				class: "k-button icon small ghost",
				type: "button",
				title: t("Open a Log File…"),
				"aria-label": t("Open a Log File…"),
				onclick: () => pick(),
			},
			[icon("plus")],
		),
	);
}

function renderBar() {
	if (!active) {
		barBox.hidden = true;
		return;
	}
	barBox.hidden = false;
	const log = logOf(active);
	const counts = countLevels(log.entries);
	const focused = document.activeElement?.classList.contains("lv-query");
	const input = el("input", {
		class: `k-input lv-query${patternError ? " invalid" : ""}`,
		value: query,
		placeholder: t("Search the log"),
		spellcheck: "false",
		"aria-label": t("Search"),
		title: patternError,
	});
	let debounce = 0;
	input.addEventListener("input", () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => {
			query = input.value;
			compile();
			renderLog();
		}, 150);
	});
	const levels = [...LEVELS, "none"].filter((level) => counts[level] > 0 || hidden.has(level));
	barBox.replaceChildren(
		el("label", { class: "k-search lv-search" }, [icon("search"), input]),
		toggle("regex", t("Regular expression"), regex, () => {
			regex = !regex;
			compile();
			renderLog();
		}),
		toggle("case", t("Match case"), caseSensitive, () => {
			caseSensitive = !caseSensitive;
			compile();
			renderLog();
		}),
		toggle("filter", t("Only matching"), onlyMatching, () => {
			onlyMatching = !onlyMatching;
			renderLog();
		}),
		el(
			"div",
			{ class: "lv-levels", role: "group" },
			levels.map((level) =>
				el(
					"button",
					{
						class: "lv-level-chip",
						type: "button",
						"data-level": level,
						"aria-pressed": String(!hidden.has(level)),
						onclick: () => {
							if (hidden.has(level)) hidden.delete(level);
							else hidden.add(level);
							renderLog();
						},
					},
					[
						el("span", { class: "lv-swatch" }),
						el("span", { text: t(level) }),
						el("span", { class: "lv-count", text: String(counts[level]) }),
					],
				),
			),
		),
		el("span", { class: "k-spacer" }),
		toggle(
			follow ? "pause" : "play",
			follow ? t("Following") : t("Follow"),
			follow,
			() => {
				follow = !follow;
				if (follow) scrollToEnd();
				renderBar();
				renderStatus();
			},
			follow ? t("Following") : t("Paused"),
		),
		toggle("wrap", t("Wrap lines"), wrap, () => {
			wrap = !wrap;
			viewBox.classList.toggle("wrap", wrap);
			renderBar();
		}),
		toggle("eraser", t("Clear the view"), false, () => {
			log.entries = [];
			log.start = log.end;
			renderLog();
		}),
	);
	if (focused) {
		const again = barBox.querySelector(".lv-query");
		again.focus();
		again.setSelectionRange(again.value.length, again.value.length);
	}
}

function compile() {
	try {
		pattern = searchPattern(query, { regex, caseSensitive });
		patternError = "";
	} catch (error) {
		pattern = null;
		patternError = t("Not a valid pattern: {0}", error.message);
	}
}

function scrollToEnd() {
	const scroller = viewBox.querySelector(".lv-scroll");
	if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function renderLog(toEnd = follow) {
	renderBar();
	if (!active) {
		viewBox.replaceChildren(emptyState());
		renderStatus();
		return;
	}
	const log = logOf(active);
	const matching = log.entries.filter(visible);
	const shown = matching.slice(-cap);
	linesBox = el("div", { class: "lv-lines", role: "log", "aria-live": "off" }, shown.map(row));
	moreBox = el("div", { class: "lv-top" }, [
		log.start > 0
			? button(t("Load earlier"), () => loadEarlier(), "small ghost", "history")
			: el("span", { class: "k-muted k-small", text: t("Start of the file") }),
		matching.length > shown.length
			? el("span", { class: "k-muted k-small" }, [
					document.createTextNode(`${t("Showing the last {0}.", shown.length)} `),
					button(
						t("Show more"),
						() => {
							cap += CAP_STEP;
							renderLog(false);
						},
						"small ghost",
					),
				])
			: null,
	]);
	const notice = log.notice
		? el("div", { class: "k-notice warn lv-notice" }, [
				icon("alert"),
				el("span", { text: log.notice }),
			])
		: null;
	const scroller = el("div", { class: "lv-scroll" }, [
		moreBox,
		linesBox,
		shown.length === 0 && log.loaded
			? el("p", { class: "lv-none", text: t("No entries match.") })
			: null,
	]);
	scroller.addEventListener("scroll", () => {
		const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
		if (atEnd !== follow) {
			follow = atEnd;
			renderBar();
			renderStatus();
		}
	});
	const jump = el(
		"button",
		{
			class: "k-button small primary lv-jump",
			type: "button",
			onclick: () => {
				follow = true;
				scrollToEnd();
				renderBar();
				renderStatus();
			},
		},
		[icon("bottom"), el("span", { text: t("Jump to the end") })],
	);
	viewBox.replaceChildren(...[notice, scroller, jump].filter(Boolean));
	viewBox.classList.toggle("wrap", wrap);
	if (toEnd) scroller.scrollTop = scroller.scrollHeight;
	renderStatus();
}

function renderStatus() {
	if (!active) {
		statusBox.hidden = true;
		return;
	}
	statusBox.hidden = false;
	const log = logOf(active);
	const matching = log.entries.filter(visible).length;
	viewBox.dataset.follow = String(follow);
	statusBox.replaceChildren(
		el("span", { class: "lv-path k-mono", text: active, title: active }),
		el("span", { class: "k-spacer" }),
		el("span", {
			text:
				matching === log.entries.length
					? t("{0} entries", log.entries.length)
					: t("{0} of {1} entries", matching, log.entries.length),
		}),
		el("span", { text: formatSize(log.size) }),
		el("span", { class: "lv-state", "data-follow": String(follow) }, [
			el("span", { class: `k-dot ${follow ? "ok" : ""}`.trim() }),
			el("span", { text: follow ? t("Following") : t("Paused") }),
		]),
	);
}

function emptyState() {
	const path = el("input", {
		class: "k-input k-mono",
		placeholder: t("Path, e.g. logs/app.log"),
		spellcheck: "false",
		"aria-label": t("Log file path"),
	});
	const form = el("form", { class: "k-group lv-path-form" }, [
		path,
		button(t("Open"), null, "", null, { type: "submit" }),
	]);
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (path.value.trim()) await open(path.value.trim());
	});
	return el("div", { class: "k-empty lv-empty" }, [
		el("span", { class: "k-empty-icon" }, [icon("file")]),
		el("strong", { text: t("Open a log file") }),
		el("p", {
			text: t(
				"Follow application, server and build logs as they grow. Errors are coloured and counted, stack traces stay with their line.",
			),
		}),
		button(t("Open a Log File…"), () => pick(), "primary", "plus"),
		form,
		recent.length
			? el("div", { class: "lv-recent" }, [
					el("span", { class: "k-section-title", text: t("Recent") }),
					...recent.map((each) =>
						el("div", { class: "lv-recent-item" }, [
							el(
								"button",
								{ class: "lv-recent-open", type: "button", title: each, onclick: () => open(each) },
								[icon("file"), el("span", { class: "k-mono", text: each })],
							),
							el(
								"button",
								{
									class: "k-button icon small ghost",
									type: "button",
									title: t("Forget"),
									"aria-label": t("Forget"),
									onclick: async () => {
										recent = await kalem.call("forget", each);
										renderLog();
									},
								},
								[icon("close")],
							),
						]),
					),
				])
			: null,
	]);
}

function toast(text) {
	const note = el("div", { class: "lv-toast", role: "status", text });
	document.body.append(note);
	setTimeout(() => note.remove(), 4000);
}

async function select(path) {
	active = path;
	cap = CAP_STEP;
	const log = logOf(path);
	log.unseen = 0;
	follow = true;
	renderTabs();
	if (!log.loaded) {
		renderLog();
		await load(log);
	}
	renderLog();
}

async function opened(answer) {
	if (!answer) return;
	files = answer.files;
	await select(answer.path);
	const state = await kalem.call("state");
	recent = state.recent;
}

async function open(path) {
	try {
		await opened(await kalem.call("add", path));
	} catch (error) {
		toast(error.message);
	}
}

async function pick() {
	try {
		await opened(await kalem.call("pick"));
	} catch (error) {
		toast(error.message);
	}
}

async function close(path) {
	files = await kalem.call("remove", path);
	logs.delete(path);
	if (active === path) active = files.at(-1)?.path ?? null;
	renderTabs();
	if (active) await select(active);
	else renderLog();
}

kalem.onMessage((message) => {
	if (message?.type === "opened") void opened(message);
});

kalem.onSettingsChanged(async () => {
	settings = (await kalem.call("state")).settings;
	schedule();
});

async function start() {
	tabsBox = el("header", { class: "k-toolbar lv-head" });
	barBox = el("div", { class: "k-toolbar lv-bar" });
	viewBox = el("main", { class: "lv-view" });
	statusBox = el("footer", { class: "k-statusline lv-status" });
	app.replaceChildren(tabsBox, barBox, viewBox, statusBox);
	const state = await kalem.call("state");
	files = state.files;
	recent = state.recent;
	settings = { ...settings, ...state.settings };
	active = files[0]?.path ?? null;
	renderTabs();
	if (active) await select(active);
	else renderLog();
	schedule();
}

void start();
