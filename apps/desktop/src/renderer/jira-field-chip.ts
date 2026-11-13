import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { parsePersonName } from "../shared/jira-comments.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";
import { personMark } from "./jira-comment-view.js";

export interface ChipOption {
	readonly id: string;
	readonly name: string;
}

export interface FieldChipOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly label: string;
	readonly value: ChipOption | null;
	readonly emptyLabel: string;
	readonly person?: boolean;
	readonly remoteSearch?: boolean;
	load(query: string): Promise<readonly ChipOption[]>;
	save(option: ChipOption | null): Promise<void>;
	onSaved?(): void;
	onError(message: string): void;
}

const fold = (text: string, lang: string): string =>
	text.toLocaleLowerCase(lang).normalize("NFD").replace(/\p{M}/gu, "");

export function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export interface Popup {
	readonly element: HTMLElement;
	open(): void;
	close(): void;
	readonly isOpen: boolean;
}

export function createPopupList(options: {
	readonly t: Strings;
	readonly lang: string;
	readonly searchable: boolean;
	readonly remoteSearch: boolean;
	readonly anchor: HTMLElement;
	readonly className?: string;
	load(query: string): Promise<readonly ChipOption[]>;
	query?(): string;
	selected(): string | null;
	extra?: ChipOption;
	choose(option: ChipOption | null): void;
	renderMark?(option: ChipOption): Node | null;
	displayName?(option: ChipOption): string;
}): Popup {
	const { t } = options;
	const search = el("input", {
		class: "jira-picker-search",
		attrs: { type: "search", placeholder: t.jiraPickerSearch, "aria-label": t.jiraPickerSearch },
	});
	const list = el("ul", { class: "jira-picker-list", attrs: { role: "listbox" } });
	const status = el("p", { class: "jira-picker-status" });
	const element = el("div", {
		class: `jira-picker ${options.className ?? ""}`.trim(),
		children: options.searchable ? [search, status, list] : [status, list],
	});
	element.hidden = true;
	let loaded: readonly ChipOption[] = [];
	let requestId = 0;
	let active = -1;

	const items = (): HTMLLIElement[] => [...list.querySelectorAll<HTMLLIElement>("li")];
	const highlight = (index: number): void => {
		const all = items();
		active = Math.max(0, Math.min(index, all.length - 1));
		all.forEach((item, at) => {
			item.classList.toggle("active", at === active);
		});
		all[active]?.scrollIntoView({ block: "nearest" });
	};

	function draw(query: string): void {
		const wanted = fold(query.trim(), options.lang);
		const shown =
			options.remoteSearch || wanted === ""
				? loaded
				: loaded.filter((option) => fold(option.name, options.lang).includes(wanted));
		const entries: (ChipOption | null)[] = [...shown];
		if (options.extra !== undefined && wanted === "") entries.push(null);
		list.replaceChildren(
			...entries.map((option) => {
				const id = option?.id ?? null;
				const chosen = id === options.selected();
				const mark = option === null ? null : (options.renderMark?.(option) ?? null);
				const item = el("li", {
					class: option === null ? "jira-picker-item muted" : "jira-picker-item",
					attrs: { role: "option", "aria-selected": String(chosen) },
					children: [
						...(mark === null ? [] : [mark]),
						el("span", {
							class: "jira-picker-name",
							text:
								option === null
									? (options.extra?.name ?? "")
									: (options.displayName?.(option) ?? option.name),
							attrs: { title: option?.name ?? "" },
						}),
						...(chosen ? [icon("check")] : []),
					],
				});
				item.addEventListener("mousedown", (event) => event.preventDefault());
				item.addEventListener("click", () => options.choose(option));
				return item;
			}),
		);
		status.textContent = entries.length === 0 ? t.jiraPickerEmpty : "";
		status.hidden = entries.length > 0;
		const selectedAt = entries.findIndex((option) => (option?.id ?? null) === options.selected());
		highlight(selectedAt < 0 ? 0 : selectedAt);
	}

	async function load(query: string): Promise<void> {
		const id = ++requestId;
		status.hidden = false;
		status.textContent = t.confluenceLoading;
		try {
			const found = await options.load(query);
			if (id !== requestId) return;
			loaded = found;
			draw(search.value);
		} catch (error) {
			if (id !== requestId) return;
			list.replaceChildren();
			status.textContent = format(t.jiraRequestFailed, errorMessage(error));
		}
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	search.addEventListener("input", () => {
		if (!options.remoteSearch) {
			draw(search.value);
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => void load(search.value), 250);
	});

	const onKey = (event: KeyboardEvent): void => {
		if (element.hidden) return;
		if (event.key === "ArrowDown") highlight(active + 1);
		else if (event.key === "ArrowUp") highlight(active - 1);
		else if (event.key === "Enter") items()[active]?.click();
		else if (event.key === "Escape") {
			popup.close();
			options.anchor.focus();
			event.stopPropagation();
		} else return;
		event.preventDefault();
	};
	element.addEventListener("keydown", onKey);
	options.anchor.addEventListener("keydown", (event) => {
		if (!element.hidden) onKey(event);
	});

	const outside = (event: MouseEvent): void => {
		if (!element.isConnected) {
			document.removeEventListener("mousedown", outside, true);
			return;
		}
		const target = event.target;
		if (target instanceof Node && (element.contains(target) || options.anchor.contains(target))) {
			return;
		}
		popup.close();
	};

	const popup: Popup = {
		element,
		get isOpen() {
			return !element.hidden;
		},
		open() {
			element.hidden = false;
			options.anchor.setAttribute("aria-expanded", "true");
			search.value = "";
			document.addEventListener("mousedown", outside, true);
			void load(options.query?.() ?? "");
			if (options.searchable) search.focus();
		},
		close() {
			element.hidden = true;
			options.anchor.setAttribute("aria-expanded", "false");
			document.removeEventListener("mousedown", outside, true);
		},
	};
	return popup;
}

export function createFieldChip(options: FieldChipOptions): HTMLElement {
	let value = options.value;
	let saving = false;
	const text = el("span", { class: "jira-field-chip-text" });
	const mark = el("span", { class: "jira-field-chip-mark" });
	const button = el("button", {
		class: "jira-field-chip",
		attrs: {
			type: "button",
			"aria-haspopup": "listbox",
			"aria-expanded": "false",
			"aria-label": options.label,
		},
		children: [mark, text, icon("chevron")],
	});
	const shown = (option: ChipOption): string =>
		options.person === true ? parsePersonName(option.name).name : option.name;
	const draw = (): void => {
		text.textContent = value === null ? options.emptyLabel : shown(value);
		button.classList.toggle("empty", value === null);
		mark.replaceChildren(
			...(options.person === true && value !== null ? [personMark(shown(value))] : []),
		);
		button.title = value?.name ?? options.emptyLabel;
	};
	const wrap = el("span", { class: "jira-field-chip-wrap", children: [button] });
	const popup = createPopupList({
		t: options.t,
		lang: options.lang,
		searchable: true,
		remoteSearch: options.remoteSearch === true,
		anchor: button,
		load: options.load,
		selected: () => value?.id ?? null,
		extra: { id: "", name: options.emptyLabel },
		...(options.person === true
			? { renderMark: (option: ChipOption) => personMark(shown(option)), displayName: shown }
			: {}),
		choose: (option) => {
			popup.close();
			button.focus();
			if ((option?.id ?? null) === (value?.id ?? null) || saving) return;
			const before = value;
			value = option;
			saving = true;
			button.classList.add("saving");
			button.setAttribute("aria-busy", "true");
			draw();
			options
				.save(option)
				.then(() => options.onSaved?.())
				.catch((error: unknown) => {
					value = before;
					draw();
					options.onError(errorMessage(error));
				})
				.finally(() => {
					saving = false;
					button.classList.remove("saving");
					button.removeAttribute("aria-busy");
				});
		},
	});
	wrap.append(popup.element);
	button.addEventListener("click", () => {
		if (saving) return;
		if (popup.isOpen) popup.close();
		else popup.open();
	});
	draw();
	return wrap;
}
