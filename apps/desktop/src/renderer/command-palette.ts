import type { PaletteCommand } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import { fileType } from "./file-types.js";
import type { IconName } from "./icons.js";
import { icon, iconNames } from "./icons.js";
import { splitPath } from "./start-page.js";

export interface CommandPaletteOptions {
	readonly t: Strings;
	readonly lang: string;
	commands(): Promise<readonly PaletteCommand[]>;
	run(id: string): void;
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
 * the ones only their menus matched; the menu's order breaks ties.
 */
export function rankCommands(
	commands: readonly PaletteCommand[],
	query: string,
	lang: string,
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
		.map((entry) => ({ ...entry, score: score(entry.command) }))
		.sort((a, b) => a.score - b.score || a.order - b.order)
		.slice(0, MAX_RESULTS)
		.map(({ command }) => command);
}

/** The menu's commands, searched by name and run from the keyboard (F1). */
export function createCommandPalette(options: CommandPaletteOptions): {
	/** Opens it, the search starting as `query`. */
	show(query?: string): Promise<void>;
} {
	const { t } = options;
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
	const dialog = el("dialog", {
		class: "command-palette",
		attrs: { "aria-label": t.paletteLabel },
		children: [
			el("label", {
				class: "palette-field",
				children: [el("span", { class: "palette-prompt", text: ">" }), input],
			}),
			empty,
			list,
		],
	});
	document.body.append(dialog);

	let commands: readonly PaletteCommand[] = [];
	let shown: PaletteCommand[] = [];
	let selected = 0;

	function render(): void {
		shown = rankCommands(commands, input.value.replace(/^>\s*/, ""), options.lang);
		selected = Math.min(selected, Math.max(0, shown.length - 1));
		empty.textContent = shown.length === 0 ? t.paletteEmpty : "";
		empty.hidden = shown.length > 0;
		list.replaceChildren(
			...shown.map((command, index) => {
				const option = el("li", {
					class: "palette-item",
					attrs: {
						role: "option",
						id: `palette-${index}`,
						"aria-selected": String(index === selected),
						"data-command-id": command.id,
					},
					children: [
						el("span", {
							class: "palette-check",
							attrs: { "aria-hidden": "true" },
							children: command.checked === true ? [icon("check")] : [],
						}),
						paletteIconElement(command),
						...entryText(command),
						...(command.accelerator === ""
							? []
							: [el("kbd", { class: "palette-key", text: command.accelerator })]),
					],
				});
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => choose(index));
				return option;
			}),
		);
		input.setAttribute("aria-activedescendant", shown.length > 0 ? `palette-${selected}` : "");
		list.children[selected]?.scrollIntoView({ block: "nearest" });
	}

	function paletteIconElement(command: PaletteCommand): HTMLElement {
		const found = paletteIcon(command);
		return el("span", {
			class: `palette-icon${found?.tone === null || found === null ? "" : ` files-icon tone-${found.tone}`}`,
			attrs: { "aria-hidden": "true" },
			children: found === null ? [] : [icon(found.name)],
		});
	}

	/** A command: its name and menus. A recent document: its name, then its folder and the menu. */
	function entryText(command: PaletteCommand): HTMLElement[] {
		if (command.path === null)
			return [
				el("span", { class: "palette-name", text: command.label }),
				el("span", { class: "palette-group", text: command.group }),
			];
		const { name, folder } = splitPath(command.path);
		return [
			el("span", { class: "palette-name", text: name, attrs: { title: command.path } }),
			el("span", { class: "palette-group", text: `${folder} · ${command.group}` }),
		];
	}

	function choose(index: number): void {
		const command = shown[index];
		if (command === undefined) return;
		dialog.close();
		options.run(command.id);
	}

	input.addEventListener("input", () => {
		selected = 0;
		render();
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
		async show(query = "") {
			commands = await options.commands();
			input.value = query;
			selected = 0;
			render();
			if (!dialog.open) dialog.showModal();
			input.focus();
		},
	};
}
