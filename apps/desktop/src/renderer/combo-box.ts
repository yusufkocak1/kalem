import { el } from "./dom.js";

export interface ComboOption {
	readonly value: string;
	readonly name: string;
}

export interface ComboBoxOptions {
	readonly options: readonly ComboOption[];
	/** The chosen option's value; `""` for none. */
	readonly value: string;
	readonly placeholder: string;
	/** Shown in the list when nothing matches what is typed. */
	readonly empty: string;
	readonly lang: string;
	/** The input's class, so it looks like the form's other fields. */
	readonly inputClass: string;
	readonly onChange?: (value: string) => void;
}

export interface ComboBox {
	readonly element: HTMLElement;
	/** The text box: it takes the focus, and `data-*` set on it. */
	readonly input: HTMLInputElement;
	readonly value: string;
}

let nextId = 0;

/**
 * A list to choose from by typing: every letter narrows it (names that
 * start with what is typed first, then names with a word that does, then
 * names that contain it), unlike a `<select>`, which only jumps to the
 * first name starting with the last letter typed. `↑`/`↓` move, `Enter`
 * or a click chooses, `Esc` closes. Leaving the box with text that is not
 * a name puts back the name chosen before; an emptied box chooses nothing.
 */
export function createComboBox(options: ComboBoxOptions): ComboBox {
	const id = `combo-${++nextId}`;
	const fold = (text: string): string =>
		text.toLocaleLowerCase(options.lang).normalize("NFD").replace(/\p{M}/gu, "");
	let value = options.value;
	const nameOf = (chosen: string): string =>
		options.options.find((option) => option.value === chosen)?.name ?? "";

	const input = el("input", {
		class: `${options.inputClass} combo-input`,
		attrs: {
			type: "text",
			role: "combobox",
			"aria-autocomplete": "list",
			"aria-expanded": "false",
			"aria-controls": id,
			autocomplete: "off",
			spellcheck: "false",
			placeholder: options.placeholder,
		},
	});
	input.value = nameOf(value);
	const list = el("ul", { class: "combo-list", attrs: { id, role: "listbox", hidden: "" } });
	const element = el("div", { class: "combo", children: [input, list] });

	let shown: ComboOption[] = [];
	let active = -1;

	function matches(query: string): ComboOption[] {
		const q = fold(query.trim());
		if (q === "") return [...options.options];
		const ranked: { option: ComboOption; rank: number }[] = [];
		for (const option of options.options) {
			const name = fold(option.name);
			const rank = name.startsWith(q)
				? 0
				: name.split(/[\s\-_/().,]+/).some((word) => word.startsWith(q))
					? 1
					: name.includes(q)
						? 2
						: -1;
			if (rank >= 0) ranked.push({ option, rank });
		}
		return ranked.sort((a, b) => a.rank - b.rank).map((item) => item.option);
	}

	function render(): void {
		list.replaceChildren(
			...(shown.length === 0
				? [el("li", { class: "combo-empty", text: options.empty })]
				: shown.map((option, index) => {
						const item = el("li", {
							class: "combo-option",
							text: option.name,
							attrs: {
								id: `${id}-${index}`,
								role: "option",
								"aria-selected": String(index === active),
							},
						});
						if (option.value === value) item.dataset.chosen = "";
						// Choosing must not blur the box first.
						item.addEventListener("mousedown", (event) => event.preventDefault());
						item.addEventListener("click", () => choose(option));
						return item;
					})),
		);
		if (active >= 0) {
			input.setAttribute("aria-activedescendant", `${id}-${active}`);
			list.children[active]?.scrollIntoView({ block: "nearest" });
		} else input.removeAttribute("aria-activedescendant");
	}

	function open(query: string): void {
		shown = matches(query);
		// What is typed picks the best match; an untouched box shows the chosen one.
		active =
			query === nameOf(value) && value !== ""
				? shown.findIndex((option) => option.value === value)
				: shown.length > 0
					? 0
					: -1;
		list.hidden = false;
		input.setAttribute("aria-expanded", "true");
		render();
	}

	function close(): void {
		list.hidden = true;
		input.setAttribute("aria-expanded", "false");
		input.removeAttribute("aria-activedescendant");
		active = -1;
	}

	function choose(option: ComboOption | null): void {
		const next = option?.value ?? "";
		input.value = option?.name ?? "";
		close();
		if (next !== value) {
			value = next;
			options.onChange?.(value);
		}
	}

	input.addEventListener("focus", () => {
		input.select();
		open(input.value);
	});
	input.addEventListener("click", () => {
		if (list.hidden) open(input.value);
	});
	input.addEventListener("input", () => open(input.value));
	input.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (list.hidden) {
				open(input.value);
				return;
			}
			if (shown.length === 0) return;
			const step = event.key === "ArrowDown" ? 1 : -1;
			active = (active + step + shown.length) % shown.length;
			render();
		} else if (event.key === "Enter") {
			if (list.hidden) return;
			event.preventDefault();
			const option = shown[active];
			if (option !== undefined) choose(option);
		} else if (event.key === "Escape") {
			if (list.hidden) return;
			event.preventDefault();
			event.stopPropagation();
			input.value = nameOf(value);
			close();
		} else if (event.key === "Tab" && !list.hidden) {
			// Tab takes the highlighted name when something was typed, as the menus of most forms do.
			const option = shown[active];
			if (option !== undefined && fold(input.value) !== fold(nameOf(value))) choose(option);
		}
	});
	input.addEventListener("blur", () => {
		const text = fold(input.value.trim());
		if (text === "") choose(null);
		else {
			const exact = options.options.find((option) => fold(option.name) === text);
			if (exact !== undefined) choose(exact);
			else {
				input.value = nameOf(value);
				close();
			}
		}
	});

	return {
		element,
		input,
		get value() {
			return value;
		},
	};
}
