import type {
	ConfluenceAccount,
	ConfluencePageSummary,
	ConfluenceSpace,
	KalemBridge,
} from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface ConfluencePaneOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	/** The space listed when the pane opens; empty for all spaces. */
	space(): string;
	/** Remembers the chosen space as the default. */
	setSpace(key: string): void;
	/** The Confluence page id of the active tab, if it is one. */
	activePage(): string | null;
	/** Opens the login dialog. */
	connect(): void;
}

export interface ConfluencePane {
	readonly element: HTMLElement;
	/** Reconnects and lists the pages again. */
	refresh(): Promise<void>;
	/** Marks the active page without listing again. */
	highlightActive(): void;
}

const SEARCH_DELAY = 300;

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** The side pane's Confluence tab: a space, its pages, and a title search over them. */
export function createConfluencePane(options: ConfluencePaneOptions): ConfluencePane {
	const { t, bridge } = options;
	let account: ConfluenceAccount | null = null;
	/** Spaces are listed once per connection. */
	let spacesOf: string | null = null;
	let pages: readonly ConfluencePageSummary[] = [];
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	/** Answers of older requests are dropped. */
	let requestId = 0;

	const title = el("span", { class: "confluence-pane-title" });
	const refreshButton = el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": t.refresh, title: t.refresh },
		children: [icon("refresh")],
	});
	refreshButton.addEventListener("click", () => void refresh());

	const space = el("select", {
		class: "confluence-pane-space",
		attrs: { "aria-label": t.confluencePickSpace, title: t.confluencePickSpace },
	});
	const search = el("input", {
		class: "confluence-pane-search",
		attrs: {
			type: "search",
			placeholder: t.confluenceSearchPlaceholder,
			"aria-label": t.confluenceSearchPlaceholder,
		},
	});
	const message = el("p", { class: "confluence-pane-message" });
	const connectButton = el("button", {
		class: "confluence-primary confluence-pane-connect",
		text: t.confluenceConnect,
		attrs: { type: "button" },
	});
	connectButton.addEventListener("click", () => options.connect());
	const list = el("div", {
		class: "confluence-pane-list",
		attrs: { role: "list", "aria-label": t.confluenceTab },
	});

	const element = el("div", {
		class: "confluence-pane",
		children: [
			el("div", { class: "confluence-pane-toolbar", children: [title, refreshButton] }),
			space,
			search,
			message,
			connectButton,
			list,
		],
	});

	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "medium" });
	const describe = (page: ConfluencePageSummary): string => {
		const date = page.modified === null ? null : new Date(page.modified);
		const when = date === null || Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
		// The space is shown only when the list spans spaces.
		return [space.value === "" ? page.spaceName : "", when]
			.filter((part) => part !== "")
			.join(" · ");
	};

	function showMessage(text: string): void {
		message.textContent = text;
		message.hidden = text === "";
	}

	function showSignedIn(signedIn: boolean): void {
		connectButton.hidden = signedIn;
		space.hidden = !signedIn;
		search.hidden = !signedIn;
		refreshButton.hidden = !signedIn;
	}

	function render(): void {
		const active = options.activePage();
		list.replaceChildren(
			...pages.map((page) => {
				const item = el("button", {
					class: "confluence-page-item",
					attrs: {
						type: "button",
						role: "listitem",
						title: page.title,
						"data-page": page.id,
						...(page.id === active ? { "aria-current": "page" } : {}),
					},
					children: [
						icon("file"),
						el("span", {
							class: "confluence-page-text",
							children: [
								el("span", { class: "confluence-page-title", text: page.title }),
								el("span", { class: "confluence-page-meta", text: describe(page) }),
							],
						}),
					],
				});
				item.addEventListener("click", () => void open(page));
				return item;
			}),
		);
	}

	function highlightActive(): void {
		const active = options.activePage();
		for (const item of list.querySelectorAll<HTMLElement>(".confluence-page-item")) {
			if (item.dataset.page === active) item.setAttribute("aria-current", "page");
			else item.removeAttribute("aria-current");
		}
	}

	async function open(page: ConfluencePageSummary): Promise<void> {
		showMessage(t.confluenceLoading);
		try {
			await bridge.confluenceOpenPage(page.id);
			showMessage("");
			// The tab may become active just after the answer arrives.
			requestAnimationFrame(() => highlightActive());
		} catch (error) {
			showMessage(`${t.confluenceOpenFailed}: ${errorText(error)}`);
		}
	}

	function fillSpaces(spaces: readonly ConfluenceSpace[]): void {
		const chosen = options.space();
		space.replaceChildren(
			el("option", { text: t.confluenceAllSpaces, attrs: { value: "" } }),
			...spaces.map((item) =>
				el("option", { text: `${item.name} (${item.key})`, attrs: { value: item.key } }),
			),
		);
		// A default space that is gone (or not visible to this login) falls back to all spaces.
		space.value = spaces.some((item) => item.key === chosen) ? chosen : "";
	}

	async function listPages(): Promise<void> {
		const id = ++requestId;
		showMessage(t.confluenceLoading);
		try {
			const found = await bridge.confluenceSearch(
				search.value,
				space.value === "" ? null : space.value,
			);
			if (id !== requestId) return;
			pages = found;
			render();
			showMessage(found.length === 0 ? t.confluenceNoPages : "");
		} catch (error) {
			if (id !== requestId) return;
			pages = [];
			render();
			showMessage(format(t.confluenceRequestFailed, errorText(error)));
		}
	}

	async function refresh(): Promise<void> {
		const id = ++requestId;
		account = await bridge.confluenceAccount().catch(() => null);
		if (id !== requestId) return;
		title.textContent = account?.site.replace(/^https?:\/\//, "") ?? "";
		title.title = account?.site ?? "";
		if (account === null) {
			spacesOf = null;
			pages = [];
			render();
			showSignedIn(false);
			showMessage(t.confluenceNotConnected);
			return;
		}
		showSignedIn(true);
		const key = `${account.site}\n${account.username}`;
		if (spacesOf !== key) {
			showMessage(t.confluenceLoading);
			try {
				fillSpaces(await bridge.confluenceSpaces());
				spacesOf = key;
			} catch {
				// Pages can still be listed across all spaces.
				fillSpaces([]);
			}
			if (id !== requestId) return;
		}
		await listPages();
	}

	space.addEventListener("change", () => {
		options.setSpace(space.value);
		void listPages();
	});
	search.addEventListener("input", () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void listPages(), SEARCH_DELAY);
	});
	search.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			clearTimeout(searchTimer);
			void listPages();
		} else if (event.key === "Escape" && search.value !== "") {
			event.stopPropagation();
			search.value = "";
			void listPages();
		}
	});

	showSignedIn(false);
	return { element, refresh, highlightActive };
}
