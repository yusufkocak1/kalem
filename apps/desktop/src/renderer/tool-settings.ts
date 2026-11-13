import type { Settings } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import type { ToolPolicy, ToolRisk } from "../shared/tool-protocol.js";
import { el } from "./dom.js";

export interface ToolEntry {
	readonly name: string;
	readonly description: string;
	readonly risk?: ToolRisk;
}

export interface ToolSettingsOptions {
	readonly t: Strings;
	settings(): Settings;
	update(patch: Partial<Settings>): void;
	/** Kalem's tools, as the main process lists them. */
	catalog(): Promise<readonly ToolEntry[]>;
}

type Group = "jira" | "confluence" | "document" | "app";

const groupOf = (name: string): Group =>
	name.startsWith("jira_")
		? "jira"
		: name.startsWith("confluence_")
			? "confluence"
			: /^(?:document_|propose_edit|read_file|list_files|search$)/.test(name)
				? "document"
				: "app";

const GROUPS: readonly Group[] = ["jira", "confluence", "document", "app"];

/**
 * Kalem's tools in Settings, by what they work on: each with what it does
 * and a choice of how it runs — as its kind runs by default, asked about
 * before every call, run without asking, or turned off. Every change is
 * kept at once.
 */
export function createToolSettings(options: ToolSettingsOptions): {
	readonly element: HTMLElement;
	refresh(): void;
} {
	const { t } = options;
	const filter = el("input", {
		class: "tool-settings-filter",
		attrs: {
			type: "search",
			placeholder: t.toolSettingsFilter,
			"aria-label": t.toolSettingsFilter,
		},
	});
	const list = el("div", { class: "tool-settings-list" });
	const reset = el("button", {
		class: "jira-button",
		text: t.toolSettingsReset,
		attrs: { type: "button" },
	});
	const element = el("div", {
		class: "settings-block tool-settings",
		attrs: { "data-block": "tools" },
		children: [
			el("h4", { text: t.toolSettingsTitle }),
			el("p", { class: "confluence-hint", text: t.toolSettingsHint }),
			filter,
			list,
			reset,
		],
	});
	let tools: readonly ToolEntry[] | null = null;
	const selects = new Map<string, HTMLSelectElement>();

	const groupLabel = (group: Group): string =>
		group === "jira"
			? t.toolSettingsJira
			: group === "confluence"
				? t.toolSettingsConfluence
				: group === "document"
					? t.toolSettingsDocument
					: t.toolSettingsApp;

	const defaultLabel = (risk: ToolRisk | undefined): string =>
		risk === "read"
			? t.toolPolicyDefaultRead
			: risk === "external"
				? t.toolPolicyDefaultExternal
				: t.toolPolicyDefaultChange;

	function set(name: string, policy: ToolPolicy | ""): void {
		const policies = { ...options.settings().assistantToolPolicies };
		if (policy === "") delete policies[name];
		else policies[name] = policy;
		options.update({ assistantToolPolicies: policies });
		mark(name);
	}

	/** A row shows a warning when a write to a server runs without asking, and dims when off. */
	function mark(name: string): void {
		const select = selects.get(name);
		const row = select?.closest<HTMLElement>(".tool-setting");
		if (select === undefined || row === undefined || row === null) return;
		row.dataset.policy = select.value;
		const warn = row.querySelector<HTMLElement>(".tool-setting-warning");
		if (warn !== null) warn.hidden = !(select.value === "auto" && row.dataset.risk === "external");
	}

	function draw(): void {
		if (tools === null) {
			list.replaceChildren(el("p", { class: "confluence-hint", text: t.toolSettingsLoading }));
			return;
		}
		selects.clear();
		const policies = options.settings().assistantToolPolicies;
		list.replaceChildren(
			...GROUPS.flatMap((group) => {
				const own = (tools ?? []).filter((tool) => groupOf(tool.name) === group);
				if (own.length === 0) return [];
				return [
					el("section", {
						class: "tool-settings-group",
						attrs: { "data-group": group },
						children: [
							el("h5", { text: groupLabel(group) }),
							...own.map((tool) => {
								const select = el("select", {
									attrs: { "data-tool": tool.name, "aria-label": tool.name },
									children: [
										el("option", { text: defaultLabel(tool.risk), attrs: { value: "" } }),
										el("option", { text: t.toolPolicyAsk, attrs: { value: "ask" } }),
										el("option", { text: t.toolPolicyAuto, attrs: { value: "auto" } }),
										el("option", { text: t.toolPolicyOff, attrs: { value: "off" } }),
									],
								});
								select.value = Object.hasOwn(policies, tool.name)
									? (policies[tool.name] ?? "")
									: "";
								select.addEventListener("change", () =>
									set(tool.name, select.value as ToolPolicy | ""),
								);
								selects.set(tool.name, select);
								return el("div", {
									class: "tool-setting",
									attrs: {
										"data-risk": tool.risk ?? "",
										"data-search": `${tool.name} ${tool.description}`.toLocaleLowerCase("tr"),
									},
									children: [
										el("span", {
											class: "tool-setting-text",
											children: [
												el("code", { class: "tool-setting-name", text: tool.name }),
												el("span", { class: "tool-setting-description", text: tool.description }),
												el("span", {
													class: "tool-setting-warning",
													text: t.toolPolicyAutoWarning,
													attrs: { hidden: "" },
												}),
											],
										}),
										select,
									],
								});
							}),
						],
					}),
				];
			}),
		);
		for (const name of selects.keys()) mark(name);
		applyFilter();
	}

	function applyFilter(): void {
		const query = filter.value.trim().toLocaleLowerCase("tr");
		for (const section of list.querySelectorAll<HTMLElement>(".tool-settings-group")) {
			let shown = 0;
			for (const row of section.querySelectorAll<HTMLElement>(".tool-setting")) {
				const match = query === "" || (row.dataset.search ?? "").includes(query);
				row.hidden = !match;
				if (match) shown++;
			}
			section.hidden = shown === 0;
		}
	}

	filter.addEventListener("input", applyFilter);
	reset.addEventListener("click", () => {
		options.update({ assistantToolPolicies: {} });
		draw();
	});

	let loading = false;
	function refresh(): void {
		if (tools !== null) {
			// Settings changed elsewhere: the choices follow.
			const policies = options.settings().assistantToolPolicies;
			for (const [name, select] of selects) {
				select.value = Object.hasOwn(policies, name) ? (policies[name] ?? "") : "";
				mark(name);
			}
			return;
		}
		if (loading) return;
		loading = true;
		draw();
		void options
			.catalog()
			.catch(() => [] as readonly ToolEntry[])
			.then((found) => {
				tools = found;
				draw();
			});
	}

	return { element, refresh };
}
