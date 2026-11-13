import type { Strings } from "../shared/i18n.js";
import { MCP_PRESETS, presetServer } from "../shared/mcp-presets.js";
import type { McpServer } from "../shared/mcp-servers.js";
import { newMcpServer, RESERVED_SERVER, serverName } from "../shared/mcp-servers.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface McpSectionOptions {
	readonly t: Strings;
	/** The mode's servers as they are now. */
	servers(): readonly McpServer[];
	/** Keeps the servers; `redraw` when the section's shape changes. */
	change(servers: readonly McpServer[], redraw: boolean): void;
}

function mark(name: IconName, className: string): Element {
	const svg = icon(name);
	svg.classList.add(className);
	return svg;
}

/** `KEY=value` lines as pairs, and back. */
const parsePairs = (text: string, separator: "=" | ":"): Record<string, string> =>
	Object.fromEntries(
		text
			.split("\n")
			.map((line) => {
				const at = line.indexOf(separator);
				return at <= 0 ? null : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
			})
			.filter((pair): pair is [string, string] => pair !== null && pair[0] !== ""),
	);
const writePairs = (pairs: Readonly<Record<string, string>>, separator: "=" | ": "): string =>
	Object.entries(pairs)
		.map(([key, value]) => `${key}${separator}${value}`)
		.join("\n");

function input(
	label: string,
	value: string,
	onInput: (value: string) => void,
	attrs: Record<string, string> = {},
	multiline = false,
): HTMLElement {
	const control = multiline
		? el("textarea", {
				class: "publish-input",
				attrs: { rows: "4", "aria-label": label, ...attrs },
			})
		: el("input", {
				class: "publish-input",
				attrs: { type: "text", "aria-label": label, ...attrs },
			});
	control.value = value;
	control.addEventListener("input", () => onInput(control.value));
	return el("label", {
		class: "mode-field",
		children: [el("span", { class: "mode-label", text: label }), control],
	});
}

function switchOf(on: boolean, label: string, onChange: (on: boolean) => void): HTMLElement {
	const box = el("input", {
		class: "mode-switch-input",
		attrs: { type: "checkbox", role: "switch", "aria-label": label },
	});
	box.checked = on;
	box.addEventListener("change", () => onChange(box.checked));
	return el("span", {
		class: "mode-switch",
		children: [box, el("span", { class: "mode-switch-track", attrs: { "aria-hidden": "true" } })],
	});
}

function pills<T extends string>(
	label: string,
	values: readonly T[],
	current: T,
	name: (value: T) => string,
	onChange: (value: T) => void,
): HTMLElement {
	return el("div", {
		class: "mode-field",
		children: [
			el("span", { class: "mode-label", text: label }),
			el("div", {
				class: "mode-pills",
				attrs: { role: "radiogroup", "aria-label": label },
				children: values.map((value) => {
					const pill = el("button", {
						class: "mode-pill",
						text: name(value),
						attrs: { type: "button", role: "radio", "aria-checked": String(value === current) },
					});
					pill.addEventListener("click", () => onChange(value));
					return pill;
				}),
			}),
		],
	});
}

/**
 * A mode's MCP servers in Settings, for Kalem's modes and the user's alike:
 * each a program or an address, the tools it may use, and what it is for
 * (the model is told, and reaches for it on its own). Every change is kept
 * at once.
 */
export function createMcpSection(options: McpSectionOptions): HTMLElement {
	const { t } = options;

	function serverCard(server: McpServer, index: number): HTMLElement {
		// Each change builds on the servers as they are now: fields typed one after another keep each other.
		const set = (next: Partial<McpServer>, redraw = false): void =>
			options.change(
				options.servers().map((each, i) => (i === index ? { ...each, ...next } : each)),
				redraw,
			);
		const http = server.transport === "http";
		const fields: HTMLElement[] = http
			? [
					input(t.mcpUrl, server.url, (value) => set({ url: value.trim() }), {
						placeholder: "https://mcp.example.com/mcp",
					}),
					input(
						t.mcpHeaders,
						writePairs(server.headers, ": "),
						(value) => set({ headers: parsePairs(value, ":") }),
						{ placeholder: "Authorization: Bearer …" },
						true,
					),
				]
			: [
					input(t.mcpCommand, server.command, (value) => set({ command: value.trim() }), {
						placeholder: "npx",
					}),
					input(
						t.mcpArgs,
						server.args.join("\n"),
						(value) =>
							set({
								args: value
									.split("\n")
									.map((arg) => arg.trim())
									.filter(Boolean),
							}),
						{ placeholder: "-y\n@modelcontextprotocol/server-filesystem\nC:\\\\projects" },
						true,
					),
					input(
						t.mcpEnv,
						writePairs(server.env, "="),
						(value) => set({ env: parsePairs(value, "=") }),
						{ placeholder: "API_KEY=…" },
						true,
					),
				];
		const name = el("input", {
			class: "publish-input mcp-name",
			attrs: { type: "text", "aria-label": t.mcpName, maxlength: "40" },
		});
		name.value = server.name;
		name.addEventListener("change", () => {
			const value = serverName(name.value);
			const taken = options.servers().some((each, i) => i !== index && each.name === value);
			if (value === "" || value.toLocaleLowerCase("en") === RESERVED_SERVER || taken) {
				name.value = server.name;
				return;
			}
			set({ name: value }, true);
		});
		const remove = el("button", {
			class: "mode-icon-button",
			attrs: { type: "button", "aria-label": t.mcpRemove, title: t.mcpRemove },
			children: [mark("close", "mode-icon")],
		});
		remove.addEventListener("click", () =>
			options.change(
				options.servers().filter((_, i) => i !== index),
				true,
			),
		);
		return el("div", {
			class: "mcp-card",
			attrs: { "data-server": server.name, ...(server.enabled ? {} : { "data-off": "" }) },
			children: [
				el("div", {
					class: "mcp-card-head",
					children: [
						switchOf(server.enabled, server.name, (enabled) => set({ enabled }, true)),
						name,
						pills(
							t.mcpTransport,
							["stdio", "http"] as const,
							server.transport,
							(value) => (value === "stdio" ? t.mcpStdio : t.mcpHttp),
							(transport) => set({ transport }, true),
						),
						remove,
					],
				}),
				...fields,
				input(
					t.mcpTools,
					server.tools.join(", "),
					(value) =>
						set({
							tools: value
								.split(",")
								.map((tool) => tool.trim())
								.filter(Boolean),
						}),
					{ placeholder: t.mcpToolsAll },
				),
				input(
					t.mcpPurpose,
					server.purpose,
					(value) => set({ purpose: value.trim() }),
					{ rows: "3", maxlength: "2000", placeholder: t.mcpPurposeHint },
					true,
				),
			],
		});
	}

	const add = el("button", {
		class: "mode-add",
		attrs: { type: "button" },
		children: [mark("plus", "mode-icon"), t.mcpAdd],
	});
	add.addEventListener("click", () =>
		options.change([...options.servers(), newMcpServer(options.servers())], true),
	);
	return el("div", {
		class: "mode-section mode-mcp",
		children: [
			el("h4", { text: t.mcpTitle }),
			el("p", { class: "mode-section-hint", text: t.mcpHint }),
			el("div", { class: "mcp-list", children: options.servers().map(serverCard) }),
			add,
			presets(),
		],
	});

	/** Servers to start from, filled in as they are commonly run: one click adds one. */
	function presets(): HTMLElement {
		return el("details", {
			class: "mcp-presets",
			children: [
				el("summary", { class: "mcp-presets-summary", text: t.mcpPresets }),
				el("p", { class: "mode-section-hint", text: t.mcpPresetsHint }),
				el("div", {
					class: "mcp-preset-list",
					children: MCP_PRESETS.map((preset) => {
						const button = el("button", {
							class: "mcp-preset",
							attrs: { type: "button", "data-preset": preset.id },
							children: [
								el("span", {
									class: "mcp-preset-head",
									children: [
										mark("plus", "mode-icon"),
										el("span", { class: "mcp-preset-name", text: preset.label }),
										el("code", {
											class: "mcp-preset-kind",
											text: preset.server.transport === "http" ? "HTTP" : preset.server.command,
										}),
									],
								}),
								el("span", { class: "mcp-preset-text", text: t[preset.description] }),
							],
						});
						button.addEventListener("click", () =>
							options.change([...options.servers(), presetServer(preset, options.servers())], true),
						);
						return button;
					}),
				}),
			],
		});
	}
}
