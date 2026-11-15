import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { McpPreset } from "../shared/mcp-presets.js";
import { MCP_PRESETS, presetServer } from "../shared/mcp-presets.js";
import { runtimeOf } from "../shared/mcp-runtimes.js";
import type { McpServer, McpToolList } from "../shared/mcp-servers.js";
import {
	newMcpServer,
	PROJECT,
	RESERVED_SERVER,
	serverName,
	toggleTool,
} from "../shared/mcp-servers.js";
import { el } from "./dom.js";
import type { IconName } from "./icons.js";
import { icon } from "./icons.js";

export interface McpSectionOptions {
	readonly t: Strings;
	/** The assistant's servers as they are now. */
	servers(): readonly McpServer[];
	/** Keeps the servers; `redraw` when the section's shape changes. */
	change(servers: readonly McpServer[], redraw: boolean): void;
	/** A server was renamed (`to`) or removed (`null`): the modes that use it follow. */
	renamed(from: string, to: string | null): void;
	/** The names of the modes that use a server. */
	usedIn(name: string): readonly string[];
	/** Starts a server and asks it which tools it has. */
	listTools(server: McpServer): Promise<McpToolList>;
	/** Where a command is on this computer; `null` when it is not found. */
	findCommand(command: string): Promise<string | null>;
}

/**
 * The tools each server gave, by how it is reached: kept while Settings is
 * open, so a redraw shows them again.
 */
const listed = new Map<string, McpToolList>();
const reachKey = (server: McpServer): string =>
	JSON.stringify(
		server.transport === "http"
			? [server.transport, server.url, server.headers]
			: [server.transport, server.command, server.args, server.env],
	);

/** Where each command was found, while Settings is open: a redraw does not look again. */
const found = new Map<string, Promise<string | null>>();

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
 * The assistant's MCP servers in Settings, set up once for every mode: each
 * a program or an address, the tools it may use, what it is for (the model
 * is told, and reaches for it on its own), and the modes that use it.
 * Every change is kept at once.
 */
export function createMcpSection(options: McpSectionOptions): HTMLElement {
	const { t } = options;
	const addPreset = (preset: McpPreset): void =>
		options.change([...options.servers(), presetServer(preset, options.servers())], true);

	function serverCard(server: McpServer, index: number): HTMLElement {
		// Each change builds on the servers as they are now: fields typed one after another keep each other.
		const set = (next: Partial<McpServer>, redraw = false): void =>
			options.change(
				options.servers().map((each, i) => (i === index ? { ...each, ...next } : each)),
				redraw,
			);
		const http = server.transport === "http";
		let check = commandCheck(server.command);
		// The command typed is looked for once it is left.
		const commandField = (): HTMLElement => {
			const field = input(t.mcpCommand, server.command, (value) => set({ command: value.trim() }), {
				placeholder: "npx",
			});
			field.querySelector("input")?.addEventListener("change", () => {
				const next = commandCheck(options.servers()[index]?.command ?? "");
				check.replaceWith(next);
				check = next;
			});
			return field;
		};
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
					commandField(),
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
			const from = options.servers()[index]?.name;
			set({ name: value }, true);
			if (from !== undefined && from !== value) options.renamed(from, value);
		});
		const remove = el("button", {
			class: "mode-icon-button",
			attrs: { type: "button", "aria-label": t.mcpRemove, title: t.mcpRemove },
			children: [mark("close", "mode-icon")],
		});
		remove.addEventListener("click", () => {
			const gone = options.servers()[index]?.name;
			options.change(
				options.servers().filter((_, i) => i !== index),
				true,
			);
			if (gone !== undefined) options.renamed(gone, null);
		});
		const used = options.usedIn(server.name);
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
				el("p", {
					class: "mode-section-hint mcp-used-in",
					text: used.length === 0 ? t.mcpUsedNowhere : format(t.mcpUsedIn, used.join(", ")),
				}),
				...(http ? [] : [check]),
				...fields,
				toolsField(index, set),
				input(
					t.mcpPurpose,
					server.purpose,
					(value) => set({ purpose: value.trim() }),
					{ rows: "3", maxlength: "2000", placeholder: t.mcpPurposeHint },
					true,
				),
				...cardGuide(server),
			],
		});
	}

	/**
	 * The tools a server may use: typed by name, or listed from the server
	 * itself and each turned on or off. All on is kept as “all of them”, so
	 * tools the server adds later are on too.
	 */
	function toolsField(index: number, set: (next: Partial<McpServer>) => void): HTMLElement {
		const now = (): McpServer | undefined => options.servers()[index];
		const typed = el("input", {
			class: "publish-input",
			attrs: { type: "text", "aria-label": t.mcpTools, placeholder: t.mcpToolsAll },
		});
		typed.value = now()?.tools.join(", ") ?? "";
		typed.addEventListener("input", () => {
			set({
				tools: typed.value
					.split(",")
					.map((tool) => tool.trim())
					.filter(Boolean),
			});
			drawList();
		});
		const fetchButton = el("button", {
			class: "assistant-link mcp-tools-fetch",
			text: t.mcpToolsFetch,
			attrs: { type: "button" },
		});
		const status = el("span", { class: "mcp-tools-status", attrs: { role: "status" } });
		const list = el("div", { class: "mcp-tools-list" });

		const choose = (tools: string[]): void => {
			set({ tools });
			typed.value = tools.join(", ");
			drawList();
		};

		function drawList(): void {
			const server = now();
			const answer = server === undefined ? undefined : listed.get(reachKey(server));
			status.textContent = "";
			status.removeAttribute("data-error");
			if (server === undefined || answer === undefined) {
				list.replaceChildren();
				return;
			}
			if (!answer.ok) {
				status.textContent = format(t.mcpToolsFailed, answer.error);
				status.setAttribute("data-error", "");
				list.replaceChildren();
				return;
			}
			if (answer.tools.length === 0) {
				status.textContent = t.mcpToolsNone;
				list.replaceChildren();
				return;
			}
			const names = answer.tools.map((tool) => tool.name);
			const isOn = (name: string): boolean =>
				server.tools.length === 0 || server.tools.includes(name);
			const missing = server.tools.filter((name) => !names.includes(name));
			const onCount = names.filter(isOn).length;
			const allOn = el("button", {
				class: "assistant-link",
				text: t.mcpToolsAllOn,
				attrs: { type: "button" },
			});
			allOn.disabled = server.tools.length === 0;
			allOn.addEventListener("click", () => choose([]));
			const row = (name: string, description: string, gone: boolean): HTMLElement =>
				el("div", {
					class: "mcp-tool",
					attrs: { "data-tool": name, ...(isOn(name) ? {} : { "data-off": "" }) },
					children: [
						switchOf(isOn(name), name, (on) => {
							const next = toggleTool(now()?.tools ?? [], names, name, on);
							if (next === null) {
								drawList();
								status.textContent = t.mcpToolsKeepOne;
								return;
							}
							choose(next);
						}),
						el("span", {
							class: "mcp-tool-text",
							children: [
								el("code", { class: "mcp-tool-name", text: name }),
								el("span", {
									class: "mcp-tool-description",
									text: gone ? t.mcpToolsMissing : description,
								}),
							],
						}),
					],
				});
			list.replaceChildren(
				el("div", {
					class: "mcp-tools-head",
					children: [
						el("span", {
							class: "mode-label",
							text: format(t.mcpToolsCount, String(onCount), String(names.length)),
						}),
						allOn,
					],
				}),
				...answer.tools.map((tool) => row(tool.name, tool.description, false)),
				...missing.map((name) => row(name, "", true)),
			);
		}

		fetchButton.addEventListener("click", () => {
			const server = now();
			if (server === undefined) return;
			fetchButton.disabled = true;
			status.removeAttribute("data-error");
			status.textContent = t.mcpToolsFetching;
			void options
				.listTools(server)
				.catch((error: unknown) => ({
					ok: false as const,
					error: error instanceof Error ? error.message : String(error),
				}))
				.then((answer) => {
					listed.set(reachKey(server), answer);
					fetchButton.disabled = false;
					drawList();
				});
		});
		drawList();
		return el("div", {
			class: "mode-field mcp-tools",
			children: [
				el("span", {
					class: "mcp-tools-label",
					children: [el("span", { class: "mode-label", text: t.mcpTools }), fetchButton],
				}),
				typed,
				status,
				list,
			],
		});
	}

	/**
	 * A warning when a server's command is not on this computer: what the
	 * program is, how to install it, and a button to look again.
	 */
	function commandCheck(command: string): HTMLElement {
		const box = el("div", { class: "mcp-missing", attrs: { hidden: "", role: "status" } });
		const name = command.trim();
		if (name === "") return box;
		let looking = found.get(name);
		if (looking === undefined) {
			looking = options.findCommand(name).catch(() => null);
			found.set(name, looking);
		}
		void looking.then((path) => {
			if (path !== null) return;
			const runtime = runtimeOf(name);
			const again = el("button", {
				class: "assistant-link mcp-missing-again",
				text: t.mcpMissingAgain,
				attrs: { type: "button" },
			});
			again.addEventListener("click", () => {
				found.delete(name);
				box.replaceWith(commandCheck(command));
			});
			const steps = (runtime?.install ?? []).map((step) => {
				const copy = el("button", {
					class: "assistant-link mcp-sample-copy",
					text: t.copy,
					attrs: { type: "button" },
				});
				copy.addEventListener("click", () => {
					void navigator.clipboard.writeText(step.command).then(() => {
						copy.textContent = t.assistantCopied;
						setTimeout(() => {
							copy.textContent = t.copy;
						}, 1500);
					});
				});
				return el("div", {
					class: "mcp-sample",
					children: [
						el("div", {
							class: "mcp-sample-head",
							children: [el("span", { class: "mode-label", text: step.system }), copy],
						}),
						el("pre", { class: "mcp-sample-text", text: step.command }),
					],
				});
			});
			box.replaceChildren(
				el("p", {
					class: "mcp-missing-title",
					children: [mark("noteAttention", "mode-icon"), format(t.mcpMissing, name)],
				}),
				el("p", {
					class: "mcp-missing-text",
					text: runtime === null ? t.mcpMissingOther : t[runtime.about],
				}),
				...(runtime === null
					? []
					: [
							el("span", {
								class: "mode-label",
								text: format(t.mcpMissingInstall, runtime.label),
							}),
							...steps,
							el("p", {
								class: "mcp-missing-text",
								text: format(t.mcpMissingLink, runtime.link),
							}),
						]),
				el("p", {
					class: "mcp-missing-text",
					children: [t.mcpMissingRestart, " ", again],
				}),
			);
			box.setAttribute("data-runtime", runtime?.id ?? "");
			box.hidden = false;
		});
		return box;
	}

	/** A server added from a ready-made one keeps its guide at hand. */
	function cardGuide(server: McpServer): HTMLElement[] {
		const preset = MCP_PRESETS.find((each) => each.id === server.preset);
		if (preset === undefined) return [];
		return [
			el("details", {
				class: "mcp-card-guide",
				children: [
					el("summary", { class: "mcp-guide-summary", text: t.mcpGuideOpen }),
					guide(preset, false),
				],
			}),
		];
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

	/**
	 * How to set a ready-made server up: what it is, the steps, and the files
	 * and commands to copy; with `offerAdd`, a button that adds it.
	 */
	function guide(preset: McpPreset, offerAdd: boolean): HTMLElement {
		const [intro = "", ...steps] = t[preset.guide].split("\n");
		const samples = (preset.samples ?? []).map((sample) => {
			const copy = el("button", {
				class: "assistant-link mcp-sample-copy",
				text: t.copy,
				attrs: { type: "button" },
			});
			copy.addEventListener("click", () => {
				void navigator.clipboard.writeText(sample.text).then(() => {
					copy.textContent = t.assistantCopied;
					setTimeout(() => {
						copy.textContent = t.copy;
					}, 1500);
				});
			});
			return el("div", {
				class: "mcp-sample",
				children: [
					el("div", {
						class: "mcp-sample-head",
						children: [el("span", { class: "mode-label", text: t[sample.title] }), copy],
					}),
					el("pre", { class: "mcp-sample-text", text: sample.text }),
				],
			});
		});
		const children: HTMLElement[] = [
			el("p", { class: "mcp-guide-intro", text: intro }),
			el("span", { class: "mode-label", text: t.mcpGuideSteps }),
			el("ol", {
				class: "mcp-guide-steps",
				children: steps.map((step) => el("li", { text: step })),
			}),
			...samples,
		];
		if (offerAdd) {
			const add = el("button", {
				class: "jira-button mcp-guide-add",
				attrs: { type: "button" },
				text: t.mcpGuideAdd,
			});
			add.addEventListener("click", () => addPreset(preset));
			children.push(add);
		}
		return el("div", {
			class: "mcp-guide",
			attrs: { "data-guide": preset.id },
			children,
		});
	}

	/** Servers to start from, filled in as they are commonly run, each with how to set it up. */
	function presets(): HTMLElement {
		let open: { id: string; panel: HTMLElement } | null = null;
		const list = el("div", { class: "mcp-preset-list" });
		const cards = MCP_PRESETS.map((preset) => {
			const add = el("button", {
				class: "mcp-preset-add",
				attrs: { type: "button", "aria-label": `${t.mcpPresetAdd}: ${preset.label}` },
				children: [mark("plus", "mode-icon"), t.mcpPresetAdd],
			});
			add.addEventListener("click", () => addPreset(preset));
			const help = el("button", {
				class: "assistant-link mcp-preset-help",
				text: t.mcpGuideOpen,
				attrs: { type: "button", "aria-expanded": "false" },
			});
			const card = el("div", {
				class: "mcp-preset",
				attrs: { "data-preset": preset.id },
				children: [
					el("span", {
						class: "mcp-preset-head",
						children: [
							el("span", { class: "mcp-preset-name", text: preset.label }),
							el("code", {
								class: "mcp-preset-kind",
								text: preset.server.transport === "http" ? "HTTP" : preset.server.command,
							}),
						],
					}),
					el("span", { class: "mcp-preset-text", text: t[preset.description] }),
					el("span", { class: "mcp-preset-actions", children: [add, help] }),
				],
			});
			// The guide opens under its card, across the list; one at a time.
			help.addEventListener("click", () => {
				const wasOpen = open?.id === preset.id;
				open?.panel.remove();
				for (const each of list.querySelectorAll(".mcp-preset-help")) {
					each.setAttribute("aria-expanded", "false");
				}
				open = null;
				if (wasOpen) return;
				const panel = el("div", {
					class: "mcp-guide-panel",
					children: [
						el("h5", {
							class: "mcp-guide-title",
							text: format(t.mcpGuideTitle, preset.label),
						}),
						guide(preset, true),
					],
				});
				card.after(panel);
				help.setAttribute("aria-expanded", "true");
				open = { id: preset.id, panel };
				panel.scrollIntoView({ block: "nearest" });
			});
			return card;
		});
		list.replaceChildren(...cards);
		return el("details", {
			class: "mcp-presets",
			children: [
				el("summary", { class: "mcp-presets-summary", text: t.mcpPresets }),
				el("p", { class: "mode-section-hint", text: t.mcpPresetsHint }),
				list,
			],
		});
	}
}

export interface McpChoiceOptions {
	readonly t: Strings;
	/** The assistant's servers. */
	servers(): readonly McpServer[];
	/** The names of the servers the mode uses. */
	chosen(): readonly string[];
	/** Keeps the names the mode uses. */
	change(names: readonly string[]): void;
}

/**
 * Which of the assistant's MCP servers a mode uses, in Settings: a switch
 * for each. The servers themselves are set up once, under the assistant.
 */
export function createMcpChoice(options: McpChoiceOptions): HTMLElement {
	const { t } = options;
	const list = el("div", { class: "mcp-choice-list" });
	function draw(): void {
		const servers = options.servers();
		const chosen = options.chosen();
		if (servers.length === 0) {
			list.replaceChildren(el("p", { class: "confluence-hint", text: t.mcpChoiceNone }));
			return;
		}
		list.replaceChildren(
			...servers.map((server) => {
				const on = chosen.includes(server.name);
				// `${project}` is shown as what it stands for.
				const note = [
					server.enabled ? "" : t.mcpChoiceOff,
					server.purpose.split(PROJECT).join(t.mcpProjectWord),
				].filter((part) => part !== "");
				return el("div", {
					class: "mcp-tool mcp-choice",
					attrs: {
						"data-server": server.name,
						...(on && server.enabled ? {} : { "data-off": "" }),
					},
					children: [
						switchOf(on, server.name, (wanted) => {
							// The order is the assistant's, and names no longer there are let go.
							const names = new Set(options.chosen());
							if (wanted) names.add(server.name);
							else names.delete(server.name);
							options.change(
								options
									.servers()
									.map((each) => each.name)
									.filter((name) => names.has(name)),
							);
							draw();
						}),
						el("span", {
							class: "mcp-tool-text",
							children: [
								el("code", { class: "mcp-tool-name", text: server.name }),
								el("span", { class: "mcp-tool-description", text: note.join(" — ") }),
							],
						}),
					],
				});
			}),
		);
	}
	draw();
	return el("div", {
		class: "mode-section mode-mcp",
		children: [
			el("h4", { text: t.mcpChoiceTitle }),
			el("p", { class: "mode-section-hint", text: t.mcpChoiceHint }),
			list,
		],
	});
}
