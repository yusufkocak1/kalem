import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface TabStripOptions {
	readonly label: string;
	readonly newTabLabel: string;
	readonly closeLabel: string;
	onSelect(id: string): void;
	onClose(id: string): void;
	onNew(): void;
}

export interface TabInfo {
	readonly title: string;
	readonly dirty: boolean;
	/** Full path of the document, shown as a tooltip. */
	readonly path: string | null;
}

export interface TabStrip {
	readonly element: HTMLElement;
	add(id: string): void;
	remove(id: string): void;
	update(id: string, info: TabInfo): void;
	select(id: string): void;
	/** Tab ids in display order. */
	order(): string[];
}

/** The row of open documents. Tabs are identified by `data-document`. */
export function createTabStrip(options: TabStripOptions): TabStrip {
	const tabs = new Map<string, { tab: HTMLElement; title: HTMLElement }>();

	const list = el("div", {
		class: "doc-tabs",
		attrs: { role: "tablist", "aria-label": options.label },
	});
	const newTab = el("button", {
		class: "doc-tab-new",
		attrs: {
			type: "button",
			"aria-label": options.newTabLabel,
			title: options.newTabLabel,
			"data-command": "new-tab",
		},
		children: [icon("plus")],
	});
	newTab.addEventListener("click", () => options.onNew());

	// Arrow keys move between tabs; the list is a single Tab stop.
	list.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
		const ids = [...tabs.keys()];
		const current = ids.findIndex((id) => tabs.get(id)?.tab === document.activeElement);
		if (current < 0) return;
		event.preventDefault();
		const step = event.key === "ArrowRight" ? 1 : -1;
		const target = ids[(current + step + ids.length) % ids.length];
		if (target === undefined) return;
		options.onSelect(target);
		tabs.get(target)?.tab.focus();
	});

	return {
		element: el("div", { class: "tabstrip", children: [list, newTab] }),

		add(id) {
			const title = el("span", { class: "doc-tab-title" });
			const close = el("button", {
				class: "doc-tab-close",
				attrs: { type: "button", "aria-label": options.closeLabel, title: options.closeLabel },
				children: [icon("close")],
			});
			close.addEventListener("click", (event) => {
				event.stopPropagation();
				options.onClose(id);
			});

			const tab = el("div", {
				class: "doc-tab",
				attrs: { role: "tab", "data-document": id, "aria-selected": "false", tabindex: "-1" },
				children: [title, close],
			});
			tab.addEventListener("click", () => options.onSelect(id));
			tab.addEventListener("keydown", (event) => {
				if (event.target !== tab || (event.key !== "Enter" && event.key !== " ")) return;
				event.preventDefault();
				options.onSelect(id);
			});
			// Middle click closes, as in browsers.
			tab.addEventListener("auxclick", (event) => {
				if (event.button === 1) options.onClose(id);
			});

			tabs.set(id, { tab, title });
			list.append(tab);
		},

		remove(id) {
			tabs.get(id)?.tab.remove();
			tabs.delete(id);
		},

		update(id, info) {
			const entry = tabs.get(id);
			if (entry === undefined) return;
			entry.title.textContent = info.title;
			entry.tab.title = info.path ?? info.title;
			entry.tab.toggleAttribute("data-dirty", info.dirty);
		},

		select(id) {
			for (const [tabId, { tab }] of tabs) {
				const active = tabId === id;
				tab.setAttribute("aria-selected", String(active));
				tab.tabIndex = active ? 0 : -1;
				if (active) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
			}
		},

		order: () => [...tabs.keys()],
	};
}
