import type { PaletteCommand } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { fileType } from "./file-types.js";
import type { IconName } from "./icons.js";
import { icon, iconNames } from "./icons.js";
import type { QuickOpenItem } from "./quick-open.js";
import { rankItems } from "./quick-open.js";
import { splitPath } from "./start-page.js";

export interface CommandPaletteOptions {
	readonly t: Strings;
	readonly lang: string;
	commands(): Promise<readonly PaletteCommand[]>;
	run(id: string): void;
	/** The open folders' files; opened by a pick. */
	files?(): Promise<readonly QuickOpenItem[]>;
	openFile?(path: string): void;
	/** The active document's headings, in order; `goToHeading` moves the caret to one. */
	headings?(): readonly { readonly text: string; readonly level: number }[];
	goToHeading?(index: number): void;
	/** Puts the question to the assistant. */
	ask?(question: string): void;
}

/** What is searched: everything, or one kind only, by the first character typed. */
export type PaletteScope = "all" | "commands" | "headings" | "ask";

const PREFIXES: Readonly<Record<string, PaletteScope>> = {
	">": "commands",
	"#": "headings",
	"?": "ask",
};

/** A search's kind from its first character (`>`, `#`, `?`), and the rest of it. */
export function parseQuery(raw: string): { scope: PaletteScope; text: string } {
	const scope = PREFIXES[raw.charAt(0)];
	return scope === undefined
		? { scope: "all", text: raw.trim() }
		: { scope, text: raw.slice(1).trim() };
}

/** How often and how lately a command was run: what is used comes first. */
export interface Usage {
	readonly count: number;
	/** When last, in ms. */
	readonly last: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Uses, each worth less the older it is: a week halves it. */
export function frecency(usage: Usage | undefined, now: number): number {
	if (usage === undefined) return 0;
	return usage.count * 0.5 ** ((now - usage.last) / (7 * DAY));
}

/**
 * What a command is known by across runs: its app command or its document,
 * else its menu and name. The menu path (its id) moves with the menu.
 */
export function usageKey(command: PaletteCommand): string {
	if (command.path !== null) return `path:${command.path}`;
	if (command.action !== null) return `action:${command.action}`;
	return `menu:${command.group} › ${command.label}`;
}

const MAX_RESULTS = 60;

/**
 * The icon of an action whose name is not an icon's own: most app commands
 * are (`bold`, `bullet-list` → `bulletList`); these are the rest.
 */
const ACTION_ICONS: Readonly<Record<string, IconName>> = {
	"save-as": "save",
	"save-as-package": "archive",
	"close-tab": "close",
	"paste-plain": "paste",
	"attach-file": "attach",
	"inline-code": "code",
	"heading-1": "navigation",
	"heading-2": "navigation",
	"heading-3": "navigation",
	"heading-4": "navigation",
	"heading-5": "navigation",
	"heading-6": "navigation",
	"zoom-reset": "zoomIn",
	"export-html": "code",
	"export-docx": "word",
	"export-confluence": "confluence",
	"export-confluence-wiki": "confluence",
	"publish-confluence": "confluence",
	"confluence-open": "confluence",
	"confluence-changes": "diff",
	"confluence-attachments": "attachments",
	"note-new": "noteNew",
	"note-next": "noteNext",
	"note-previous": "notePrevious",
	"notes-toggle": "note",
	"quick-open": "find",
	"search-folder": "find",
	"version-history": "clock",
	"jira-open": "target",
	"move-tab": "fullWidth",
	"case-upper": "changeCase",
	"case-lower": "changeCase",
	"case-title": "changeCase",
	"case-sentence": "changeCase",
	"case-toggle": "changeCase",
	"case-cycle": "changeCase",
	"collapse-spaces": "changeCase",
	"format-code": "braces",
	"format-all-code": "bracesAll",
	"new-from-template": "new",
	"command-palette": "find",
	"network-log": "terminal",
	typography: "lineSpacing",
	"assistant-prompt": "assistant",
	"item:new": "new",
	"item:new-window": "plus",
	"item:quick-note": "noteNew",
	"item:open": "open",
	"item:open-folder": "folderOpen",
	"item:show-in-folder": "folderOpen",
	"item:import-word": "word",
	"item:import-confluence": "confluence",
	"item:export-pdf": "pdf",
	"item:print": "pdf",
	"item:clear-recent": "trash",
	"role:cut": "cut",
	"role:copy": "copy",
	"role:paste": "paste",
	"role:close": "close",
	"role:quit": "close",
	"role:togglefullscreen": "fullWidth",
	"role:toggleDevTools": "terminal",
};

/** The icon a palette entry is drawn with; `null` when nothing names one. */
export function paletteIcon(
	command: PaletteCommand,
): { name: IconName; tone: string | null } | null {
	if (command.path !== null) {
		const type = fileType(command.path);
		return { name: type.icon, tone: type.tone };
	}
	const action = command.action;
	if (action === null) return null;
	const named = ACTION_ICONS[action];
	if (named !== undefined) return { name: named, tone: null };
	const camel = action.replace(/-([a-z0-9])/g, (_, letter: string) =>
		letter.toLocaleUpperCase("en"),
	);
	return iconNames.has(camel) ? { name: camel as IconName, tone: null } : null;
}

/**
 * Every word typed must be in the command's name or its menus. Names that
 * start with what was typed come first, then names that contain it, then
 * the ones only their menus matched; the more used, then the menu's order
 * break ties.
 */
export function rankCommands(
	commands: readonly PaletteCommand[],
	query: string,
	lang: string,
	/** The more used first, among those that match as well; the menu's order after. */
	used: (command: PaletteCommand) => number = () => 0,
): PaletteCommand[] {
	const lower = (text: string): string => text.toLocaleLowerCase(lang);
	const terms = lower(query)
		.split(/\s+/)
		.filter((term) => term !== "");
	const whole = terms.join(" ");
	const score = (command: PaletteCommand): number => {
		if (whole === "") return 0;
		const label = lower(command.path === null ? command.label : splitPath(command.path).name);
		if (label.startsWith(whole)) return 0;
		if (label.split(/\s+/).some((word) => word.startsWith(whole))) return 1;
		if (label.includes(whole)) return 2;
		return 3;
	};
	return commands
		.map((command, order) => ({ command, order }))
		.filter(({ command }) => {
			const text = lower(`${command.label} ${command.group}`);
			// A recent document is shown by its name, and found by any part of its path.
			return terms.every((term) => text.includes(term));
		})
		.map((entry) => ({ ...entry, score: score(entry.command), used: used(entry.command) }))
		.sort((a, b) => a.score - b.score || b.used - a.used || a.order - b.order)
		.slice(0, MAX_RESULTS)
		.map(({ command }) => command);
}

/** One row of the box. */
type Entry =
	| { readonly kind: "command"; readonly command: PaletteCommand }
	| { readonly kind: "file"; readonly item: QuickOpenItem }
	| {
			readonly kind: "heading";
			readonly text: string;
			readonly level: number;
			readonly index: number;
	  }
	| { readonly kind: "ask"; readonly question: string };

interface Section {
	readonly title: string | null;
	readonly entries: readonly Entry[];
}

/** How many of each kind the box shows when it searches everything. */
const PER_SECTION = 6;
const USAGE_KEY = "kalem.palette.usage";

function readUsage(): Record<string, Usage> {
	try {
		const kept = JSON.parse(localStorage.getItem(USAGE_KEY) ?? "{}") as unknown;
		return typeof kept === "object" && kept !== null ? (kept as Record<string, Usage>) : {};
	} catch {
		return {};
	}
}

/**
 * One box for everything (F1): the menu's commands, the open folders'
 * files, the document's headings, and a question to the assistant. Typed
 * first, `>` searches the commands only, `#` the headings, `?` asks the
 * assistant. With nothing typed, the commands used most and last come first.
 */
export function createCommandPalette(options: CommandPaletteOptions): {
	/** Opens it, the search starting as `query`; in `scope`, its prefix left out. */
	show(query?: string, scope?: PaletteScope): Promise<void>;
} {
	const { t } = options;
	const prompt = el("span", { class: "palette-prompt", attrs: { "aria-hidden": "true" } });
	const input = el("input", {
		class: "palette-input",
		attrs: {
			type: "text",
			placeholder: t.palettePlaceholder,
			"aria-label": t.paletteLabel,
			"aria-controls": "command-palette-list",
		},
	});
	const list = el("ul", {
		class: "palette-list",
		attrs: { role: "listbox", id: "command-palette-list", "aria-label": t.paletteLabel },
	});
	const empty = el("p", { class: "palette-empty" });
	const hints = el("p", { class: "palette-hints", text: t.paletteHints });
	const dialog = el("dialog", {
		class: "command-palette",
		attrs: { "aria-label": t.paletteLabel },
		children: [
			el("label", { class: "palette-field", children: [prompt, input] }),
			empty,
			list,
			hints,
		],
	});
	document.body.append(dialog);

	let commands: readonly PaletteCommand[] = [];
	let files: readonly QuickOpenItem[] = [];
	let scope: PaletteScope = "all";
	let shown: Entry[] = [];
	let selected = 0;
	let usage = readUsage();

	const used = (command: PaletteCommand): number => frecency(usage[usageKey(command)], Date.now());

	function remember(command: PaletteCommand): void {
		const key = usageKey(command);
		usage = { ...usage, [key]: { count: (usage[key]?.count ?? 0) + 1, last: Date.now() } };
		try {
			localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
		} catch {
			// Storage may be unavailable: the order is then the menu's.
		}
	}

	function headings(text: string): Entry[] {
		const lower = (value: string): string => value.toLocaleLowerCase(options.lang);
		const terms = lower(text)
			.split(/\s+/)
			.filter((term) => term !== "");
		return (options.headings?.() ?? [])
			.map((heading, index) => ({ kind: "heading" as const, ...heading, index }))
			.filter((heading) => heading.text.trim() !== "")
			.filter((heading) => terms.every((term) => lower(heading.text).includes(term)));
	}

	function sections(): Section[] {
		const text = input.value.trim();
		const ask: Entry[] =
			options.ask !== undefined && text !== "" ? [{ kind: "ask", question: text }] : [];
		if (scope === "ask") return [{ title: null, entries: ask }];
		if (scope === "headings")
			return [{ title: null, entries: headings(text).slice(0, MAX_RESULTS) }];
		const ranked = rankCommands(commands, text, options.lang, used);
		if (scope === "commands")
			return [{ title: null, entries: ranked.map((command) => ({ kind: "command", command })) }];
		if (text === "") {
			// The commands used most and last, then the menu's.
			const recent = commands
				.filter((command) => used(command) > 0)
				.sort((a, b) => used(b) - used(a))
				.slice(0, PER_SECTION);
			const rest = commands.filter((command) => !recent.includes(command)).slice(0, MAX_RESULTS);
			return [
				{
					title: t.paletteRecent,
					entries: recent.map((command) => ({ kind: "command", command })),
				},
				{
					title: t.paletteCommands,
					entries: rest.map((command) => ({ kind: "command", command })),
				},
			];
		}
		// Recent documents are files: with the folders' files, each once.
		const documents = ranked.filter((command) => command.path !== null);
		const listed = new Set(documents.map((command) => command.path));
		const found = rankItems(files, text, options.lang).filter((item) => !listed.has(item.path));
		const fileEntries: Entry[] = [
			...documents.map((command): Entry => ({ kind: "command", command })),
			...found.map((item): Entry => ({ kind: "file", item })),
		];
		return [
			{
				title: t.paletteCommands,
				entries: ranked
					.filter((command) => command.path === null)
					.slice(0, PER_SECTION)
					.map((command) => ({ kind: "command", command })),
			},
			{ title: t.paletteFiles, entries: fileEntries.slice(0, PER_SECTION) },
			{ title: t.paletteHeadings, entries: headings(text).slice(0, PER_SECTION) },
			{ title: null, entries: ask },
		];
	}

	function render(): void {
		prompt.textContent =
			scope === "commands" ? ">" : scope === "headings" ? "#" : scope === "ask" ? "?" : "";
		prompt.dataset.scope = scope;
		const parts = sections().filter((section) => section.entries.length > 0);
		shown = parts.flatMap((section) => section.entries);
		selected = Math.min(selected, Math.max(0, shown.length - 1));
		empty.textContent =
			shown.length === 0 ? (scope === "ask" ? t.paletteAskEmpty : t.paletteEmpty) : "";
		empty.hidden = shown.length > 0;
		let index = 0;
		list.replaceChildren(
			...parts.flatMap((section) => [
				...(section.title === null || parts.length < 2
					? []
					: [
							el("li", {
								class: "palette-section",
								text: section.title,
								attrs: { role: "presentation" },
							}),
						]),
				...section.entries.map((entry) => option(entry, index++)),
			]),
		);
		input.setAttribute("aria-activedescendant", shown.length > 0 ? `palette-${selected}` : "");
		list.querySelector(`#palette-${selected}`)?.scrollIntoView({ block: "nearest" });
	}

	function option(entry: Entry, index: number): HTMLElement {
		const item = el("li", {
			class: `palette-item palette-${entry.kind}`,
			attrs: {
				role: "option",
				id: `palette-${index}`,
				"aria-selected": String(index === selected),
			},
			children: optionContent(entry),
		});
		if (entry.kind === "command") item.dataset.commandId = entry.command.id;
		item.addEventListener("mousedown", (event) => event.preventDefault());
		item.addEventListener("click", () => choose(index));
		return item;
	}

	function optionContent(entry: Entry): HTMLElement[] {
		const iconSlot = (name: IconName | null, tone: string | null = null): HTMLElement =>
			el("span", {
				class: `palette-icon${tone === null ? "" : ` files-icon tone-${tone}`}`,
				attrs: { "aria-hidden": "true" },
				children: name === null ? [] : [icon(name)],
			});
		const blank = (): HTMLElement =>
			el("span", { class: "palette-check", attrs: { "aria-hidden": "true" } });
		if (entry.kind === "file") {
			const type = fileType(entry.item.path);
			const folder = entry.item.relative.slice(
				0,
				Math.max(0, entry.item.relative.length - entry.item.name.length - 1),
			);
			return [
				blank(),
				iconSlot(type.icon, type.tone),
				el("span", {
					class: "palette-name",
					text: entry.item.name,
					attrs: { title: entry.item.path },
				}),
				el("span", { class: "palette-group", text: folder }),
			];
		}
		if (entry.kind === "heading") {
			return [
				blank(),
				iconSlot("navigation"),
				el("span", { class: "palette-name", text: entry.text }),
				el("span", { class: "palette-group", text: `H${entry.level}` }),
			];
		}
		if (entry.kind === "ask") {
			return [
				blank(),
				iconSlot("assistant"),
				el("span", { class: "palette-name", text: format(t.paletteAsk, entry.question) }),
			];
		}
		const command = entry.command;
		const found = paletteIcon(command);
		const text: HTMLElement[] =
			command.path === null
				? [
						el("span", { class: "palette-name", text: command.label }),
						el("span", { class: "palette-group", text: command.group }),
					]
				: [
						el("span", {
							class: "palette-name",
							text: splitPath(command.path).name,
							attrs: { title: command.path },
						}),
						el("span", {
							class: "palette-group",
							text: `${splitPath(command.path).folder} · ${command.group}`,
						}),
					];
		return [
			el("span", {
				class: "palette-check",
				attrs: { "aria-hidden": "true" },
				children: command.checked === true ? [icon("check")] : [],
			}),
			iconSlot(found?.name ?? null, found?.tone ?? null),
			...text,
			...(command.accelerator === ""
				? []
				: [el("kbd", { class: "palette-key", text: command.accelerator })]),
		];
	}

	function choose(index: number): void {
		const entry = shown[index];
		if (entry === undefined) return;
		dialog.close();
		if (entry.kind === "command") {
			remember(entry.command);
			options.run(entry.command.id);
		} else if (entry.kind === "file") options.openFile?.(entry.item.path);
		else if (entry.kind === "heading") options.goToHeading?.(entry.index);
		else options.ask?.(entry.question);
	}

	input.addEventListener("input", () => {
		// A prefix typed first picks what is searched; it is shown before the box, not in it.
		if (scope === "all") {
			const parsed = parseQuery(input.value);
			if (parsed.scope !== "all") {
				scope = parsed.scope;
				input.value = input.value.slice(1).trimStart();
			}
		}
		selected = 0;
		render();
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "Backspace" && input.value === "" && scope !== "all") {
			event.preventDefault();
			scope = "all";
			render();
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			selected = (selected + step + shown.length) % Math.max(1, shown.length);
			render();
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(selected);
		}
	});
	// A click on the backdrop lands on the dialog element itself.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});

	return {
		async show(query = "", startScope: PaletteScope = "all") {
			commands = await options.commands();
			usage = readUsage();
			const parsed = startScope === "all" ? parseQuery(query) : { scope: startScope, text: query };
			scope = parsed.scope;
			input.value = parsed.scope === "all" ? query : parsed.text;
			selected = 0;
			render();
			if (!dialog.open) dialog.showModal();
			input.focus();
			// The files come when the folders are read; the box is open already.
			if (options.files !== undefined) {
				void options.files().then((found) => {
					files = found;
					if (dialog.open) render();
				});
			}
		},
	};
}
