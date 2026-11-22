/**
 * The hidden debug mode's network log, as a browser's Network tab: a
 * drawer over the bottom of the window with the app's requests, a filter,
 * and for the selected one its headers, what was sent and what came back.
 * The rows come from the main process (`network-log.ts`), which recorded
 * them with their credentials masked.
 */
import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type {
	NetworkBody,
	NetworkEntry,
	NetworkEvent,
	NetworkHeader,
	NetworkSource,
	NetworkSummary,
} from "../shared/network.js";
import {
	curlCommand,
	formatBytes,
	formatDuration,
	MAX_BODY_BYTES,
	matchesFilter,
	NETWORK_SOURCES,
	prettyBody,
	shortName,
} from "../shared/network.js";
import { el } from "./dom.js";

export interface NetworkPanelOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	readonly lang: string;
	/** The panel's button that turns debug mode off. */
	turnOff(): void;
	errorText(error: unknown): string;
	/** Says what went wrong, as the window's other notices do. */
	notify(text: string): void;
}

export interface NetworkPanel {
	show(): void;
	hide(): void;
	toggle(): void;
}

type DetailTab = "headers" | "request" | "response";

const HEIGHT_KEY = "kalem.network.height";
const MIN_HEIGHT = 140;

const SOURCE_LABELS: Readonly<Record<NetworkSource, keyof Strings>> = {
	jira: "networkSourceJira",
	confluence: "networkSourceConfluence",
	assistant: "networkSourceAssistant",
	mcp: "networkSourceMcp",
	updates: "networkSourceUpdates",
};

function readHeight(): number | null {
	try {
		const kept = Number(localStorage.getItem(HEIGHT_KEY));
		return Number.isFinite(kept) && kept >= MIN_HEIGHT ? kept : null;
	} catch {
		return null;
	}
}

function keepHeight(height: number): void {
	try {
		localStorage.setItem(HEIGHT_KEY, String(Math.round(height)));
	} catch {
		// Not kept: the next window starts at the default height.
	}
}

function host(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return "";
	}
}

function button(text: string, className: string, title?: string): HTMLButtonElement {
	return el("button", {
		class: className,
		text,
		attrs: { type: "button", ...(title === undefined ? {} : { title, "aria-label": title }) },
	});
}

export function createNetworkPanel(options: NetworkPanelOptions): NetworkPanel {
	const { t, bridge } = options;
	const rows = new Map<number, { summary: NetworkSummary; row: HTMLTableRowElement }>();
	let shown = false;
	let recording = true;
	let source: NetworkSource | "all" = "all";
	let filter = "";
	let selected: number | null = null;
	let tab: DetailTab = "headers";
	let detail: NetworkEntry | null = null;
	let detailTimer: ReturnType<typeof setTimeout> | null = null;
	let footerFrame = 0;

	// --- Toolbar -----------------------------------------------------------

	const recordButton = button("", "network-tool network-record");
	const clearButton = button(t.networkClear, "network-tool");
	const filterInput = el("input", {
		class: "network-filter",
		attrs: { type: "search", placeholder: t.networkFilter, "aria-label": t.networkFilter },
	});
	const sourceButtons = new Map<NetworkSource | "all", HTMLButtonElement>();
	const sources = el("div", { class: "network-sources", attrs: { role: "group" } });
	for (const id of ["all", ...NETWORK_SOURCES] as const) {
		const label = id === "all" ? t.networkAll : t[SOURCE_LABELS[id]];
		const choice = button(label, "network-source");
		choice.setAttribute("aria-pressed", String(id === "all"));
		choice.addEventListener("click", () => {
			source = id;
			for (const [key, other] of sourceButtons) {
				other.setAttribute("aria-pressed", String(key === id));
			}
			applyFilter();
		});
		sourceButtons.set(id, choice);
		sources.append(choice);
	}
	const exportButton = button(t.networkExport, "network-tool");
	const offButton = button(t.debugModeOff, "network-tool");
	const closeButton = button("×", "network-tool network-close", t.networkClose);

	const toolbar = el("div", {
		class: "network-toolbar",
		children: [
			el("strong", { class: "network-title", text: t.networkTitle }),
			recordButton,
			clearButton,
			filterInput,
			sources,
			el("span", { class: "network-spacer" }),
			exportButton,
			offButton,
			closeButton,
		],
	});

	// --- The list ----------------------------------------------------------

	const head = el("tr", {
		children: [
			t.networkStatus,
			t.networkMethod,
			t.networkName,
			t.networkSource,
			t.networkTime,
			t.networkSize,
		].map((text) => el("th", { text, attrs: { scope: "col" } })),
	});
	const tbody = el("tbody");
	const table = el("table", {
		class: "network-table",
		children: [el("thead", { children: [head] }), tbody],
	});
	const empty = el("p", { class: "network-empty", text: t.networkEmpty });
	const list = el("div", {
		class: "network-list",
		attrs: { tabindex: "0", "aria-label": t.networkTitle },
		children: [table, empty],
	});

	// --- The details -------------------------------------------------------

	const tabButtons = new Map<DetailTab, HTMLButtonElement>();
	const tabs = el("div", { class: "network-tabs", attrs: { role: "tablist" } });
	for (const [id, label] of [
		["headers", t.networkHeaders],
		["request", t.networkRequest],
		["response", t.networkResponse],
	] as const) {
		const choice = el("button", {
			class: "network-tab",
			text: label,
			attrs: { type: "button", role: "tab", "aria-selected": String(id === tab) },
		});
		choice.addEventListener("click", () => {
			tab = id;
			for (const [key, other] of tabButtons)
				other.setAttribute("aria-selected", String(key === id));
			renderDetail(false);
		});
		tabButtons.set(id, choice);
		tabs.append(choice);
	}
	const curlButton = button(t.networkCopyCurl, "network-tool");
	const closeDetailButton = button("×", "network-tool network-close", t.networkCloseDetail);
	const detailBody = el("div", { class: "network-detail-body", attrs: { role: "tabpanel" } });
	const detailPane = el("div", {
		class: "network-detail",
		attrs: { hidden: "" },
		children: [
			el("div", {
				class: "network-detail-head",
				children: [tabs, el("span", { class: "network-spacer" }), curlButton, closeDetailButton],
			}),
			detailBody,
		],
	});

	const footerText = el("span", { class: "network-count" });
	const footerState = el("span", { class: "network-paused", text: t.networkPaused });
	const footer = el("div", {
		class: "network-footer",
		children: [
			footerText,
			footerState,
			el("span", { class: "network-spacer" }),
			el("span", { class: "network-masked", text: t.networkMasked }),
		],
	});

	const resizer = el("div", {
		class: "network-resize",
		attrs: {
			role: "separator",
			tabindex: "0",
			"aria-orientation": "horizontal",
			"aria-label": t.networkResize,
		},
	});

	const panel = el("section", {
		class: "network-panel",
		attrs: { hidden: "", "aria-label": t.networkLog },
		children: [
			resizer,
			toolbar,
			el("div", { class: "network-body", children: [list, detailPane] }),
			footer,
		],
	});
	document.body.append(panel);

	// --- Rows --------------------------------------------------------------

	function statusText(summary: NetworkSummary): string {
		if (summary.status !== null) return String(summary.status);
		if (summary.state === "failed") return t.networkFailed;
		if (summary.state === "aborted") return t.networkAborted;
		return t.networkPending;
	}

	function statusKind(summary: NetworkSummary): string {
		if (summary.state === "failed" || summary.state === "aborted") return "is-error";
		if (summary.status === null) return "is-pending";
		if (summary.status >= 400) return "is-error";
		if (summary.status >= 300) return "is-redirect";
		return "is-ok";
	}

	function fillRow(row: HTMLTableRowElement, summary: NetworkSummary): void {
		const time =
			summary.state === "pending"
				? `${formatDuration(summary.waiting)}…`
				: formatDuration(summary.duration);
		row.className = `network-row ${statusKind(summary)}`;
		row.title = summary.error === undefined ? summary.url : `${summary.url}\n${summary.error}`;
		row.replaceChildren(
			el("td", { class: "network-status", text: statusText(summary) }),
			el("td", { class: "network-method", text: summary.method }),
			el("td", {
				class: "network-name",
				children: [
					el("span", { text: shortName(summary.url) }),
					el("span", { class: "network-host", text: host(summary.url) }),
				],
			}),
			el("td", { text: t[SOURCE_LABELS[summary.source]] }),
			el("td", { class: "network-number", text: time }),
			el("td", { class: "network-number", text: formatBytes(summary.size) }),
		);
		row.setAttribute("aria-selected", String(summary.id === selected));
	}

	function visible(summary: NetworkSummary): boolean {
		return (source === "all" || summary.source === source) && matchesFilter(summary, filter);
	}

	function upsert(summary: NetworkSummary): void {
		const known = rows.get(summary.id);
		if (known !== undefined) {
			known.summary = summary;
			fillRow(known.row, summary);
			known.row.hidden = !visible(summary);
			return;
		}
		const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
		const row = el("tr");
		row.dataset.id = String(summary.id);
		fillRow(row, summary);
		row.hidden = !visible(summary);
		tbody.append(row);
		rows.set(summary.id, { summary, row });
		if (atBottom) list.scrollTop = list.scrollHeight;
	}

	/** Rows older than `first` were dropped by the main process to keep the log small. */
	function dropBefore(first: number): void {
		for (const [id, { row }] of rows) {
			if (id >= first) break;
			row.remove();
			rows.delete(id);
		}
	}

	function applyFilter(): void {
		for (const { summary, row } of rows.values()) row.hidden = !visible(summary);
		updateFooter();
	}

	function updateFooter(): void {
		cancelAnimationFrame(footerFrame);
		footerFrame = requestAnimationFrame(() => {
			let shownCount = 0;
			let received = 0;
			for (const { summary, row } of rows.values()) {
				if (!row.hidden) shownCount += 1;
				received += summary.size ?? 0;
			}
			const size = formatBytes(received);
			footerText.textContent =
				shownCount === rows.size
					? format(t.networkSummary, rows.size, size)
					: format(t.networkFiltered, shownCount, rows.size, size);
			empty.hidden = shownCount > 0;
			empty.textContent = rows.size === 0 ? t.networkEmpty : t.networkNoMatch;
			table.hidden = shownCount === 0;
		});
	}

	function setRecording(on: boolean): void {
		recording = on;
		recordButton.textContent = on ? `● ${t.networkPause}` : `○ ${t.networkResume}`;
		recordButton.setAttribute("aria-pressed", String(on));
		footerState.hidden = on;
	}

	async function load(): Promise<void> {
		const state = await bridge.networkLog();
		setRecording(state.recording);
		tbody.replaceChildren();
		rows.clear();
		for (const summary of state.entries) upsert(summary);
		if (selected !== null && !rows.has(selected)) select(null);
		list.scrollTop = list.scrollHeight;
		updateFooter();
	}

	// --- Details -----------------------------------------------------------

	function select(id: number | null): void {
		if (selected !== null) rows.get(selected)?.row.setAttribute("aria-selected", "false");
		selected = id;
		detail = null;
		detailPane.hidden = id === null;
		panel.classList.toggle("has-detail", id !== null);
		if (id === null) return;
		const row = rows.get(id)?.row;
		row?.setAttribute("aria-selected", "true");
		row?.scrollIntoView({ block: "nearest" });
		void fetchDetail(true);
	}

	async function fetchDetail(scrollTop: boolean): Promise<void> {
		const id = selected;
		if (id === null) return;
		const entry = await bridge.networkEntry(id).catch(() => null);
		if (selected !== id) return;
		detail = entry;
		renderDetail(!scrollTop);
	}

	/** An answer still coming changes the selected row: its details are read again, now and then. */
	function refreshDetail(): void {
		if (detailTimer !== null) return;
		detailTimer = setTimeout(() => {
			detailTimer = null;
			void fetchDetail(false);
		}, 250);
	}

	function headerList(headers: readonly NetworkHeader[]): HTMLElement {
		if (headers.length === 0) return el("p", { class: "network-note", text: t.networkNoHeaders });
		return el("dl", {
			class: "network-headers",
			children: headers.flatMap((header) => [
				el("dt", { text: header.name }),
				el("dd", { text: header.value }),
			]),
		});
	}

	function section(title: string, content: HTMLElement): HTMLElement {
		return el("section", {
			class: "network-section",
			children: [el("h3", { text: title }), content],
		});
	}

	function headersView(entry: NetworkEntry): HTMLElement[] {
		const general: NetworkHeader[] = [
			{ name: t.networkUrl, value: entry.url },
			...(entry.finalUrl === undefined ? [] : [{ name: t.networkFinalUrl, value: entry.finalUrl }]),
			{ name: t.networkMethod, value: entry.method },
			{
				name: t.networkStatus,
				value: entry.status === null ? statusText(entry) : `${entry.status} ${entry.statusText}`,
			},
			{ name: t.networkSource, value: t[SOURCE_LABELS[entry.source]] },
			{
				name: t.networkStarted,
				value: new Date(entry.started).toLocaleTimeString(options.lang, {
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
					fractionalSecondDigits: 3,
				}),
			},
			{ name: t.networkWaiting, value: formatDuration(entry.waiting) },
			{ name: t.networkDuration, value: formatDuration(entry.duration) },
			{ name: t.networkSize, value: formatBytes(entry.size) },
			...(entry.error === undefined ? [] : [{ name: t.networkError, value: entry.error }]),
		];
		return [
			section(t.networkGeneral, headerList(general)),
			section(t.networkResponseHeaders, headerList(entry.responseHeaders)),
			section(t.networkRequestHeaders, headerList(entry.requestHeaders)),
		];
	}

	function copyButton(text: string): HTMLButtonElement {
		const copy = button(t.networkCopyBody, "network-tool");
		copy.addEventListener("click", () => {
			void navigator.clipboard.writeText(text).then(() => flash(copy, t.networkCopyBody));
		});
		return copy;
	}

	function bodyView(body: NetworkBody | null, mimeType: string, none: string): HTMLElement[] {
		if (body === null) return [el("p", { class: "network-note", text: none })];
		if (body.text === null) {
			return [
				el("p", {
					class: "network-note",
					text: format(t.networkNotKept, body.kind ?? mimeType, formatBytes(body.size)),
				}),
			];
		}
		const text = prettyBody(body.text, mimeType);
		return [
			el("div", {
				class: "network-body-head",
				children: [
					el("span", {
						class: "network-note",
						text: body.truncated ? format(t.networkTruncated, formatBytes(MAX_BODY_BYTES)) : "",
					}),
					el("span", { class: "network-spacer" }),
					copyButton(text),
				],
			}),
			el("pre", { class: "network-pre", text }),
		];
	}

	function renderDetail(keepScroll: boolean): void {
		const scroll = keepScroll ? detailBody.scrollTop : 0;
		curlButton.disabled = detail === null;
		if (detail === null) {
			detailBody.replaceChildren(
				el("p", {
					class: "network-note",
					text: selected === null ? t.networkSelect : t.networkGone,
				}),
			);
			return;
		}
		const entry = detail;
		const requestType =
			entry.requestHeaders.find((header) => header.name === "content-type")?.value ?? "";
		detailBody.replaceChildren(
			...(tab === "headers"
				? headersView(entry)
				: tab === "request"
					? bodyView(entry.requestBody, requestType, t.networkNoBody)
					: bodyView(
							entry.responseBody,
							entry.mimeType,
							entry.state === "pending" ? t.networkNoResponse : t.networkNoBody,
						)),
		);
		detailBody.scrollTop = scroll;
	}

	function flash(target: HTMLButtonElement, label: string): void {
		target.textContent = t.networkCopied;
		setTimeout(() => {
			target.textContent = label;
		}, 1200);
	}

	// --- Events ------------------------------------------------------------

	recordButton.addEventListener("click", () => {
		void bridge.networkRecord(!recording);
	});
	clearButton.addEventListener("click", () => {
		void bridge.networkClear();
	});
	filterInput.addEventListener("input", () => {
		filter = filterInput.value;
		applyFilter();
	});
	exportButton.addEventListener("click", () => {
		void bridge.networkExport().then(
			(saved) => {
				if (saved) flash(exportButton, t.networkExport);
			},
			(error: unknown) => options.notify(options.errorText(error)),
		);
	});
	offButton.addEventListener("click", () => options.turnOff());
	closeButton.addEventListener("click", () => hide());
	closeDetailButton.addEventListener("click", () => select(null));
	curlButton.addEventListener("click", () => {
		if (detail === null) return;
		void navigator.clipboard
			.writeText(curlCommand(detail))
			.then(() => flash(curlButton, t.networkCopyCurl));
	});

	tbody.addEventListener("click", (event) => {
		const row = (event.target as Element).closest("tr");
		const id = Number(row?.dataset.id);
		if (Number.isFinite(id)) select(id);
	});

	list.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const shownRows = [...rows.values()].filter(({ row }) => !row.hidden);
		if (shownRows.length === 0) return;
		const at = shownRows.findIndex(({ summary }) => summary.id === selected);
		const next =
			at === -1
				? event.key === "ArrowDown"
					? 0
					: shownRows.length - 1
				: Math.min(shownRows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
		select(shownRows[next]?.summary.id ?? null);
	});

	panel.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		if (selected !== null) select(null);
		else hide();
	});

	// Dragging the top edge, or its arrow keys, sets the height.
	const setHeight = (height: number): void => {
		const max = Math.max(MIN_HEIGHT, window.innerHeight - 80);
		const clamped = Math.round(Math.min(max, Math.max(MIN_HEIGHT, height)));
		panel.style.height = `${clamped}px`;
		resizer.setAttribute("aria-valuenow", String(clamped));
	};
	setHeight(readHeight() ?? Math.round(window.innerHeight * 0.4));
	resizer.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		resizer.setPointerCapture(event.pointerId);
		const move = (moved: PointerEvent): void => setHeight(window.innerHeight - moved.clientY);
		const end = (): void => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", end);
			keepHeight(panel.getBoundingClientRect().height);
		};
		// On the window: the drag follows the pointer even when the capture is not given.
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
	});
	resizer.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		event.preventDefault();
		const height = panel.getBoundingClientRect().height;
		setHeight(height + (event.key === "ArrowUp" ? 24 : -24));
		keepHeight(panel.getBoundingClientRect().height);
	});

	bridge.onNetworkEvent((event: NetworkEvent) => {
		if (!shown) return;
		if (event.type === "state") {
			setRecording(event.state.recording);
			tbody.replaceChildren();
			rows.clear();
			for (const summary of event.state.entries) upsert(summary);
			if (selected !== null && !rows.has(selected)) select(null);
			updateFooter();
			return;
		}
		dropBefore(event.first);
		upsert(event.entry);
		if (event.entry.id === selected) refreshDetail();
		updateFooter();
	});

	// --- Showing -----------------------------------------------------------

	function show(): void {
		if (shown) {
			list.focus();
			return;
		}
		shown = true;
		panel.hidden = false;
		renderDetail(false);
		void load().then(() => list.focus());
	}

	function hide(): void {
		if (!shown) return;
		shown = false;
		panel.hidden = true;
		select(null);
	}

	return {
		show,
		hide,
		toggle: () => (shown ? hide() : show()),
	};
}
