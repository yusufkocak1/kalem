import type { Settings } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { BuiltInToolGroup } from "../shared/tool-groups.js";
import { BUILT_IN_GROUPS, groupPolicyKey, toolGroupOf } from "../shared/tool-groups.js";
import type { ToolPolicy, ToolRisk } from "../shared/tool-protocol.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface ToolEntry {
	readonly name: string;
	readonly description: string;
	readonly risk?: ToolRisk;
	readonly group?: string;
	readonly groupName?: string;
}

export interface ToolSettingsOptions {
	readonly t: Strings;
	settings(): Settings;
	update(patch: Partial<Settings>): void;
	/** Kalem's tools, as the main process lists them. */
	catalog(): Promise<readonly ToolEntry[]>;
}

interface Group {
	readonly id: string;
	readonly label: string;
	readonly icon: IconName;
	readonly extension: boolean;
	readonly tools: readonly ToolEntry[];
}

const GROUP_ICONS: Readonly<Record<BuiltInToolGroup, IconName>> = {
	jira: "ticket",
	confluence: "confluence",
	document: "file",
	app: "settings",
};

/**
 * Kalem's tools in Settings, a group for what they work on and one for
 * each extension that gives some. A group turns off as a whole with its
 * switch; each tool has a choice of how it runs — as its kind runs by
 * default, asked about before every call, run without asking, or turned
 * off. Every change is kept at once.
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
	const noMatch = el("p", { class: "tool-settings-empty", attrs: { hidden: "" } });
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
			el("div", {
				class: "tool-settings-search",
				children: [icon("find"), filter],
			}),
			list,
			noMatch,
			reset,
		],
	});
	let tools: readonly ToolEntry[] | null = null;
	const selects = new Map<string, HTMLSelectElement>();
	const sections = new Map<string, HTMLElement>();

	const policies = (): Readonly<Record<string, ToolPolicy>> =>
		options.settings().assistantToolPolicies;

	const builtInLabel = (group: BuiltInToolGroup): string =>
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
			: risk === "external" || risk === "command"
				? t.toolPolicyDefaultExternal
				: t.toolPolicyDefaultChange;

	const riskLabel = (risk: ToolRisk): string =>
		({
			read: t.toolRiskRead,
			ui: t.toolRiskUi,
			document: t.toolRiskDocument,
			external: t.toolRiskExternal,
			command: t.toolRiskCommand,
		})[risk];

	function groupsOf(found: readonly ToolEntry[]): Group[] {
		const byId = new Map<string, ToolEntry[]>();
		const names = new Map<string, string>();
		for (const tool of found) {
			const id = tool.group ?? toolGroupOf(tool.name);
			byId.set(id, [...(byId.get(id) ?? []), tool]);
			if (tool.groupName !== undefined) names.set(id, tool.groupName);
		}
		const builtIn = BUILT_IN_GROUPS.flatMap((id) => {
			const own = byId.get(id);
			return own === undefined
				? []
				: [{ id, label: builtInLabel(id), icon: GROUP_ICONS[id], extension: false, tools: own }];
		});
		const extensions = [...byId]
			.filter(([id]) => id.startsWith("extension:"))
			.map(([id, own]) => ({
				id,
				label: names.get(id) ?? id.slice("extension:".length),
				icon: "extension" as const,
				extension: true,
				tools: own,
			}))
			.sort((a, b) => a.label.localeCompare(b.label, document.documentElement.lang || undefined));
		return [...builtIn, ...extensions];
	}

	function set(patch: Record<string, ToolPolicy | "">): void {
		const next = { ...policies() };
		for (const [key, policy] of Object.entries(patch)) {
			if (policy === "") delete next[key];
			else next[key] = policy;
		}
		options.update({ assistantToolPolicies: next });
	}

	const groupOff = (group: string): boolean => policies()[groupPolicyKey(group)] === "off";

	/** A row warns when a write to a server runs without asking, and dims when off. */
	function markRow(name: string, off: boolean): void {
		const select = selects.get(name);
		const row = select?.closest<HTMLElement>(".tool-setting");
		if (select === undefined || row === undefined || row === null) return;
		select.disabled = off;
		row.dataset.policy = off ? "off" : select.value;
		const warn = row.querySelector<HTMLElement>(".tool-setting-warning");
		if (warn !== null)
			warn.hidden = off || !(select.value === "auto" && row.dataset.risk === "external");
	}

	/** A group's switch, its count of tools on, and its rows as its switch has them. */
	function markGroup(group: string): void {
		const section = sections.get(group);
		if (section === undefined) return;
		const off = groupOff(group);
		section.dataset.state = off ? "off" : "on";
		const toggle = section.querySelector<HTMLInputElement>(".tool-group-switch input");
		if (toggle !== null) toggle.checked = !off;
		const names = [...section.querySelectorAll<HTMLSelectElement>("select[data-tool]")].map(
			(select) => select.dataset.tool ?? "",
		);
		for (const name of names) markRow(name, off);
		const on = off ? 0 : names.filter((name) => selects.get(name)?.value !== "off").length;
		const count = section.querySelector<HTMLElement>(".tool-group-count");
		if (count !== null)
			count.textContent = off ? t.toolGroupOff : format(t.toolGroupOn, on, names.length);
	}

	function row(tool: ToolEntry, group: string): HTMLElement {
		const select = el("select", {
			attrs: { "data-tool": tool.name, "aria-label": tool.name },
			children: [
				el("option", { text: defaultLabel(tool.risk), attrs: { value: "" } }),
				el("option", { text: t.toolPolicyAsk, attrs: { value: "ask" } }),
				el("option", { text: t.toolPolicyAuto, attrs: { value: "auto" } }),
				el("option", { text: t.toolPolicyOff, attrs: { value: "off" } }),
			],
		});
		const own = policies();
		select.value = Object.hasOwn(own, tool.name) ? (own[tool.name] ?? "") : "";
		select.addEventListener("change", () => {
			set({ [tool.name]: select.value as ToolPolicy | "" });
			markGroup(group);
		});
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
						el("span", {
							class: "tool-setting-line",
							children: [
								el("code", { class: "tool-setting-name", text: tool.name }),
								...(tool.risk === undefined
									? []
									: [
											el("span", {
												class: "tool-risk",
												text: riskLabel(tool.risk),
												attrs: { "data-risk": tool.risk },
											}),
										]),
							],
						}),
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
	}

	function section(group: Group): HTMLElement {
		const toggle = el("input", {
			attrs: {
				type: "checkbox",
				role: "switch",
				"aria-label": format(t.toolGroupSwitch, group.label),
			},
		});
		toggle.addEventListener("change", () => {
			set({ [groupPolicyKey(group.id)]: toggle.checked ? "" : "off" });
			markGroup(group.id);
		});
		// The switch is in the heading's row: a click on it does not fold the group.
		const switchLabel = el("label", {
			class: "tool-group-switch",
			attrs: { title: format(t.toolGroupSwitch, group.label) },
			children: [toggle, el("span", { class: "tool-group-switch-track" })],
		});
		switchLabel.addEventListener("click", (event) => event.stopPropagation());
		const element = el("section", {
			class: `tool-settings-group${group.extension ? " is-extension" : ""}`,
			attrs: { "data-group": group.id },
			children: [
				el("h5", {
					// Its count changes; what is kept of its folding stays with the group.
					attrs: { "data-fold-name": group.label },
					children: [
						el("span", { class: "tool-group-icon", children: [icon(group.icon)] }),
						el("span", {
							class: "tool-group-name",
							children: [
								el("span", { class: "tool-group-title", text: group.label }),
								...(group.extension
									? [el("span", { class: "tool-group-tag", text: t.toolSettingsExtension })]
									: []),
							],
						}),
						el("span", { class: "tool-group-count" }),
						switchLabel,
					],
				}),
				el("div", {
					class: "tool-group-body",
					children: [
						el("p", { class: "tool-group-off-note", text: t.toolGroupAllOff }),
						...group.tools.map((tool) => row(tool, group.id)),
					],
				}),
			],
		});
		sections.set(group.id, element);
		return element;
	}

	function draw(): void {
		if (tools === null) {
			list.replaceChildren(el("p", { class: "confluence-hint", text: t.toolSettingsLoading }));
			return;
		}
		selects.clear();
		sections.clear();
		list.replaceChildren(...groupsOf(tools).map(section));
		for (const group of sections.keys()) markGroup(group);
		applyFilter();
	}

	function applyFilter(): void {
		const query = filter.value.trim().toLocaleLowerCase("tr");
		// A tool looked for is shown, in a folded group too.
		element.toggleAttribute("data-filtering", query !== "");
		let total = 0;
		for (const group of list.querySelectorAll<HTMLElement>(".tool-settings-group")) {
			const title = (group.querySelector(".tool-group-title")?.textContent ?? "").toLocaleLowerCase(
				"tr",
			);
			const wholeGroup = query !== "" && title.includes(query);
			let shown = 0;
			for (const item of group.querySelectorAll<HTMLElement>(".tool-setting")) {
				const match = query === "" || wholeGroup || (item.dataset.search ?? "").includes(query);
				item.hidden = !match;
				if (match) shown++;
			}
			group.hidden = shown === 0;
			total += shown;
		}
		noMatch.hidden = tools === null || total > 0 || query === "";
		noMatch.textContent = format(t.toolSettingsNoMatch, filter.value.trim());
	}

	filter.addEventListener("input", applyFilter);
	reset.addEventListener("click", () => {
		options.update({ assistantToolPolicies: {} });
		draw();
	});

	let loading = false;
	const signature = (found: readonly ToolEntry[]): string =>
		found.map((tool) => `${tool.group ?? ""}/${tool.name}`).join("\n");

	function load(): void {
		if (loading) return;
		loading = true;
		void options
			.catalog()
			.catch(() => [] as readonly ToolEntry[])
			.then((found) => {
				loading = false;
				// An extension started or stopped since: its tools come or go.
				if (tools !== null && signature(found) === signature(tools)) return;
				tools = found;
				draw();
			});
	}

	function refresh(): void {
		if (tools === null) {
			draw();
			load();
			return;
		}
		// Settings changed elsewhere: the choices follow.
		const own = policies();
		for (const [name, select] of selects) {
			select.value = Object.hasOwn(own, name) ? (own[name] ?? "") : "";
		}
		for (const group of sections.keys()) markGroup(group);
		load();
	}

	// Shown again: an extension may have been installed, started or stopped meanwhile.
	new IntersectionObserver((entries) => {
		if (tools !== null && entries.some((entry) => entry.isIntersecting)) load();
	}).observe(element);

	return { element, refresh };
}
