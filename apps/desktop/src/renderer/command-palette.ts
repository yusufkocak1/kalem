import type { PaletteCommand } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface CommandPaletteOptions {
	readonly t: Strings;
	readonly lang: string;
	commands(): Promise<readonly PaletteCommand[]>;
	run(id: string): void;
}

const MAX_RESULTS = 60;

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
		const label = lower(command.label);
		if (label.startsWith(whole)) return 0;
		if (label.split(/\s+/).some((word) => word.startsWith(whole))) return 1;
		if (label.includes(whole)) return 2;
		return 3;
	};
	return commands
		.map((command, order) => ({ command, order }))
		.filter(({ command }) => {
			const text = lower(`${command.label} ${command.group}`);
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
		class: "quick-open-input",
		attrs: {
			type: "text",
			placeholder: t.palettePlaceholder,
			"aria-label": t.paletteLabel,
			"aria-controls": "command-palette-list",
		},
	});
	const list = el("ul", {
		class: "quick-open-list palette-list",
		attrs: { role: "listbox", id: "command-palette-list", "aria-label": t.paletteLabel },
	});
	const empty = el("p", { class: "quick-open-empty" });
	const dialog = el("dialog", {
		class: "quick-open command-palette",
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
					class: "quick-open-item palette-item",
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
						el("span", { class: "quick-open-name", text: command.label }),
						el("span", { class: "quick-open-path", text: command.group }),
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
