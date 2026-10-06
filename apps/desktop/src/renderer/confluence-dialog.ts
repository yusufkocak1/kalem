import type { ConfluenceAccount, ConfluencePageSummary, KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";

export interface ConfluenceDialogOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
}

const SEARCH_DELAY = 250;

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Connects to Confluence, then lists its pages; choosing one opens it in a tab. */
export function createConfluenceDialog(options: ConfluenceDialogOptions): {
	show(): Promise<void>;
} {
	const { t, bridge } = options;

	// --- Login --------------------------------------------------------------
	const field = (label: string, input: HTMLInputElement): HTMLLabelElement =>
		el("label", { class: "confluence-field", children: [el("span", { text: label }), input] });
	const site = el("input", {
		attrs: { type: "url", placeholder: "https://acme.atlassian.net", autocomplete: "url" },
	});
	const username = el("input", { attrs: { type: "text", autocomplete: "username" } });
	const token = el("input", { attrs: { type: "password", autocomplete: "current-password" } });
	const loginError = el("p", { class: "confluence-error", attrs: { role: "alert" } });
	const connect = el("button", {
		class: "confluence-primary",
		text: t.confluenceConnect,
		attrs: { type: "submit" },
	});
	const loginForm = el("form", {
		class: "confluence-login",
		children: [
			el("h2", { text: t.confluenceConnectTitle }),
			field(t.confluenceSite, site),
			field(t.confluenceUsername, username),
			field(t.confluenceToken, token),
			el("p", { class: "confluence-hint", text: t.confluenceLoginHint }),
			loginError,
			el("div", { class: "confluence-actions", children: [connect] }),
		],
	});

	// --- Browser ------------------------------------------------------------
	const siteLabel = el("span", { class: "confluence-site" });
	const disconnect = el("button", {
		class: "confluence-link",
		text: t.confluenceDisconnect,
		attrs: { type: "button" },
	});
	const query = el("input", {
		class: "quick-open-input",
		attrs: {
			type: "search",
			placeholder: t.confluenceSearchPlaceholder,
			"aria-label": t.confluenceSearchPlaceholder,
		},
	});
	const space = el("select", {
		class: "confluence-space",
		attrs: { "aria-label": t.confluenceAllSpaces },
	});
	const empty = el("p", { class: "quick-open-empty" });
	const list = el("ul", { class: "quick-open-list", attrs: { role: "listbox" } });
	const browser = el("div", {
		class: "confluence-browser",
		children: [
			el("div", { class: "confluence-header", children: [siteLabel, disconnect] }),
			el("div", { class: "confluence-filters", children: [query, space] }),
			empty,
			list,
		],
	});

	const dialog = el("dialog", {
		class: "confluence-dialog",
		attrs: { "aria-label": "Confluence" },
		children: [loginForm, browser],
	});
	document.body.append(dialog);

	let pages: readonly ConfluencePageSummary[] = [];
	let selected = 0;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	/** Answers of older searches are dropped. */
	let searchId = 0;

	const dateFormat = new Intl.DateTimeFormat(options.lang, { dateStyle: "medium" });
	const describe = (page: ConfluencePageSummary): string => {
		const date = page.modified === null ? null : new Date(page.modified);
		const when = date === null || Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
		return [page.spaceName, when].filter((part) => part !== "").join(" · ");
	};

	function showMessage(text: string): void {
		empty.textContent = text;
		empty.hidden = text === "";
	}

	function render(): void {
		selected = Math.min(selected, Math.max(0, pages.length - 1));
		list.replaceChildren(
			...pages.map((page, i) => {
				const option = el("li", {
					class: "quick-open-item",
					attrs: { role: "option", "aria-selected": String(i === selected), "data-page": page.id },
					children: [
						el("span", { class: "quick-open-name", text: page.title }),
						el("span", { class: "quick-open-path", text: describe(page) }),
					],
				});
				option.addEventListener("mousedown", (event) => event.preventDefault());
				option.addEventListener("click", () => void choose(i));
				return option;
			}),
		);
		list.children[selected]?.scrollIntoView({ block: "nearest" });
	}

	async function search(): Promise<void> {
		const id = ++searchId;
		showMessage(t.confluenceLoading);
		try {
			const found = await bridge.confluenceSearch(
				query.value,
				space.value === "" ? null : space.value,
			);
			if (id !== searchId) return;
			pages = found;
			selected = 0;
			render();
			showMessage(found.length === 0 ? t.confluenceNoPages : "");
		} catch (error) {
			if (id !== searchId) return;
			pages = [];
			render();
			showMessage(format(t.confluenceRequestFailed, errorText(error)));
		}
	}

	async function choose(index: number): Promise<void> {
		const page = pages[index];
		if (page === undefined) return;
		showMessage(t.confluenceLoading);
		try {
			await bridge.confluenceOpenPage(page.id);
			dialog.close();
		} catch (error) {
			showMessage(`${t.confluenceOpenFailed}: ${errorText(error)}`);
		}
	}

	async function showBrowser(account: ConfluenceAccount): Promise<void> {
		loginForm.hidden = true;
		browser.hidden = false;
		siteLabel.textContent =
			account.username === "" ? account.site : `${account.username} · ${account.site}`;
		query.value = "";
		pages = [];
		render();
		query.focus();
		space.replaceChildren(el("option", { text: t.confluenceAllSpaces, attrs: { value: "" } }));
		void bridge
			.confluenceSpaces()
			.then((spaces) => {
				space.append(
					...spaces.map((item) =>
						el("option", { text: `${item.name} (${item.key})`, attrs: { value: item.key } }),
					),
				);
			})
			.catch(() => {});
		await search();
	}

	function showLogin(account: ConfluenceAccount | null): void {
		browser.hidden = true;
		loginForm.hidden = false;
		loginError.textContent = "";
		token.value = "";
		if (account !== null) {
			site.value = account.site;
			username.value = account.username;
		}
		(site.value === "" ? site : token).focus();
	}

	loginForm.addEventListener("submit", (event) => {
		event.preventDefault();
		connect.disabled = true;
		connect.textContent = t.confluenceConnecting;
		loginError.textContent = "";
		bridge
			.confluenceConnect({ site: site.value, username: username.value, token: token.value })
			.then((account) => {
				token.value = "";
				return showBrowser(account);
			})
			.catch((error: unknown) => {
				loginError.textContent = format(t.confluenceConnectFailed, errorText(error));
			})
			.finally(() => {
				connect.disabled = false;
				connect.textContent = t.confluenceConnect;
			});
	});

	disconnect.addEventListener("click", () => {
		void bridge.confluenceDisconnect().then(() => showLogin(null));
	});

	query.addEventListener("input", () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void search(), SEARCH_DELAY);
	});
	space.addEventListener("change", () => void search());
	query.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			selected = (selected + step + pages.length) % Math.max(1, pages.length);
			render();
		} else if (event.key === "Enter") {
			event.preventDefault();
			void choose(selected);
		}
	});
	// A click on the backdrop lands on the dialog element itself.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) dialog.close();
	});

	return {
		async show() {
			const account = await bridge.confluenceAccount().catch(() => null);
			if (!dialog.open) dialog.showModal();
			if (account === null) showLogin(null);
			else await showBrowser(account);
		},
	};
}
