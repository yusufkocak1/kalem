import type {
	ConfluencePageSummary,
	ConfluenceSpace,
	ConfluenceTreePage,
	KalemBridge,
} from "../shared/bridge.js";
import { proposedTitle, publishPlan } from "../shared/confluence-publish.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

/** The document being published. */
export interface PublishSource {
	readonly tabId: string;
	/** The tab's name: the title when the document has no heading to give. */
	readonly name: string;
	readonly markdown: string;
}

export interface PublishDialogOptions {
	readonly t: Strings;
	readonly bridge: KalemBridge;
	/** The space chosen last; the dialog starts there. */
	space(): string;
	setSpace(key: string): void;
	/** Asks for the Confluence login. */
	connect(): void;
}

const SEARCH_DELAY = 300;

/** The tree's opening mark, with a class of its own. */
function chevron(): Element {
	const mark = icon("chevron");
	mark.classList.add("publish-chevron");
	return mark;
}

function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Where the new page goes: a space's top, or under a page (with the way to it, for showing). */
interface Place {
	readonly parent: string | null;
	readonly path: readonly string[];
}

/**
 * Publishes the open document as a new Confluence page: its title, the
 * space and the page it goes under (browsed as a tree or found by name),
 * and whether it opens in Kalem afterwards. Its local pictures and files
 * go with it as attachments.
 */
export function createPublishDialog(options: PublishDialogOptions): {
	show(source: PublishSource): Promise<void>;
} {
	const { t, bridge } = options;

	const close = el("button", {
		class: "icon-button",
		attrs: { type: "button", "aria-label": t.jiraClose, title: t.jiraClose },
		children: [icon("close")],
	});
	const title = el("input", {
		class: "publish-input",
		attrs: { type: "text", required: "", maxlength: "255", autocomplete: "off" },
	});
	const dropHeading = el("input", { attrs: { type: "checkbox", checked: "" } });
	const dropHeadingRow = el("label", {
		class: "publish-check",
		children: [dropHeading, el("span", { text: t.publishDropHeading })],
	});
	const space = el("select", { class: "publish-input", attrs: { "aria-label": t.publishSpace } });
	const find = el("input", {
		class: "publish-input",
		attrs: { type: "search", placeholder: t.publishFindParent, "aria-label": t.publishFindParent },
	});
	const tree = el("ul", {
		class: "publish-tree",
		attrs: { role: "tree", "aria-label": t.publishLocation },
	});
	const where = el("p", { class: "publish-where" });
	const files = el("p", { class: "publish-files" });
	const open = el("input", { attrs: { type: "checkbox", checked: "" } });
	const status = el("p", { class: "publish-status", attrs: { role: "status" } });
	const cancel = el("button", {
		class: "jira-button",
		text: t.cancel,
		attrs: { type: "button" },
	});
	const submit = el("button", {
		class: "jira-button primary publish-submit",
		children: [icon("confluence"), t.publishSubmit],
		attrs: { type: "submit" },
	});
	const field = (label: string, ...controls: HTMLElement[]): HTMLElement =>
		el("div", {
			class: "publish-field",
			children: [el("span", { class: "publish-label", text: label }), ...controls],
		});
	const form = el("form", {
		class: "publish-form",
		attrs: { novalidate: "" },
		children: [
			field(t.publishTitle, title, dropHeadingRow),
			field(t.publishSpace, space),
			field(t.publishLocation, find, tree, where),
			files,
			el("label", {
				class: "publish-check",
				children: [open, el("span", { text: t.publishOpen })],
			}),
			status,
			el("div", { class: "publish-actions", children: [cancel, submit] }),
		],
	});
	const body = el("div", { class: "publish-body", children: [form] });
	const dialog = el("dialog", {
		class: "publish-dialog",
		attrs: { "aria-label": t.publishTitleBar },
		children: [
			el("div", {
				class: "publish-header",
				children: [
					icon("confluence"),
					el("h2", { text: t.publishTitleBar }),
					el("span", { class: "publish-spacer" }),
					close,
				],
			}),
			body,
		],
	});
	document.body.append(dialog);
	close.addEventListener("click", () => dialog.close());
	cancel.addEventListener("click", () => dialog.close());

	let source: PublishSource | null = null;
	let heading: ReturnType<typeof proposedTitle> | null = null;
	let place: Place = { parent: null, path: [] };
	let spaces: readonly ConfluenceSpace[] = [];
	let shownId = 0;

	const say = (text: string, kind: "info" | "error" = "info"): void => {
		status.textContent = text;
		status.dataset.kind = kind;
	};

	const spaceName = (): string =>
		spaces.find((each) => each.key === space.value)?.name ?? space.value;

	function drawWhere(): void {
		where.textContent = format(t.publishWhere, [spaceName(), ...place.path].join(" › "));
	}

	function choose(next: Place): void {
		place = next;
		for (const item of tree.querySelectorAll<HTMLElement>(".publish-node-label")) {
			const selected = item.dataset.page === (next.parent ?? "");
			item.setAttribute("aria-selected", String(selected));
		}
		drawWhere();
	}

	/** A page of the tree: it can be chosen, and opened to show the pages under it. */
	function node(page: ConfluenceTreePage, path: readonly string[]): HTMLElement {
		const children = el("ul", { class: "publish-tree", attrs: { role: "group" } });
		children.hidden = true;
		const toggle = el("button", {
			class: "publish-toggle",
			attrs: {
				type: "button",
				"aria-expanded": "false",
				"aria-label": page.title,
				tabindex: "-1",
			},
			children: [chevron()],
		});
		if (page.hasChildren === false) toggle.classList.add("publish-toggle-none");
		const label = el("button", {
			class: "publish-node-label",
			text: page.title,
			attrs: {
				type: "button",
				role: "treeitem",
				"data-page": page.id,
				"aria-selected": String(place.parent === page.id),
			},
		});
		const here = [...path, page.title];
		label.addEventListener("click", () => choose({ parent: page.id, path: here }));
		let loaded = false;
		toggle.addEventListener("click", async () => {
			const opening = toggle.getAttribute("aria-expanded") !== "true";
			toggle.setAttribute("aria-expanded", String(opening));
			children.hidden = !opening;
			if (!opening || loaded) return;
			loaded = true;
			children.replaceChildren(el("li", { class: "publish-note", text: t.confluenceLoading }));
			try {
				const pages = await bridge.confluenceTree({ page: page.id });
				if (pages.length === 0) toggle.classList.add("publish-toggle-none");
				children.replaceChildren(...pages.map((child) => node(child, here)));
			} catch (error) {
				loaded = false;
				children.replaceChildren(
					el("li", { class: "publish-note publish-error", text: errorText(error) }),
				);
			}
		});
		return el("li", {
			class: "publish-node",
			children: [el("div", { class: "publish-node-row", children: [toggle, label] }), children],
		});
	}

	/** The top of the space, then its top-level pages. */
	async function loadTree(): Promise<void> {
		const id = ++shownId;
		const top = el("button", {
			class: "publish-node-label publish-top",
			text: format(t.publishTop, spaceName()),
			attrs: { type: "button", role: "treeitem", "data-page": "", "aria-selected": "true" },
		});
		top.addEventListener("click", () => choose({ parent: null, path: [] }));
		tree.replaceChildren(
			el("li", { class: "publish-node", children: [top] }),
			el("li", { class: "publish-note", text: t.confluenceLoading }),
		);
		choose({ parent: null, path: [] });
		try {
			const pages = await bridge.confluenceTree({ space: space.value });
			if (id !== shownId) return;
			tree.lastElementChild?.remove();
			tree.append(...pages.map((page) => node(page, [])));
		} catch (error) {
			if (id !== shownId) return;
			tree.lastElementChild?.replaceWith(
				el("li", { class: "publish-note publish-error", text: errorText(error) }),
			);
		}
	}

	/** Pages of the space found by their title; one is chosen as the parent. */
	async function search(query: string): Promise<void> {
		const id = ++shownId;
		tree.replaceChildren(el("li", { class: "publish-note", text: t.confluenceLoading }));
		let found: readonly ConfluencePageSummary[];
		try {
			found = await bridge.confluenceSearch(query, space.value);
		} catch (error) {
			if (id !== shownId) return;
			tree.replaceChildren(
				el("li", { class: "publish-note publish-error", text: errorText(error) }),
			);
			return;
		}
		if (id !== shownId) return;
		tree.replaceChildren(
			...(found.length === 0
				? [el("li", { class: "publish-note", text: t.publishNoPages })]
				: found.map((page) => {
						const label = el("button", {
							class: "publish-node-label",
							text: page.title,
							attrs: {
								type: "button",
								role: "treeitem",
								"data-page": page.id,
								"aria-selected": String(place.parent === page.id),
							},
						});
						label.addEventListener("click", () => choose({ parent: page.id, path: [page.title] }));
						return el("li", { class: "publish-node publish-found", children: [label] });
					})),
		);
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	find.addEventListener("input", () => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const query = find.value.trim();
			void (query === "" ? loadTree() : search(query));
		}, SEARCH_DELAY);
	});
	space.addEventListener("change", () => {
		find.value = "";
		void loadTree();
	});

	function drawFiles(): void {
		if (source === null) return;
		const count = publishPlan(source.markdown).files.length;
		files.textContent = count === 0 ? "" : format(t.publishFiles, count);
	}

	title.addEventListener("input", () => {
		// The heading is left out only while it is the title.
		dropHeadingRow.hidden = heading?.fromHeading !== true || title.value.trim() !== heading.title;
	});

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void publish();
	});

	async function publish(): Promise<void> {
		if (source === null) return;
		const name = title.value.trim();
		if (name === "") {
			title.focus();
			say(t.publishNeedTitle, "error");
			return;
		}
		if (space.value === "") {
			say(t.publishNeedSpace, "error");
			return;
		}
		const markdown =
			heading?.fromHeading === true && !dropHeadingRow.hidden && dropHeading.checked
				? heading.rest
				: source.markdown;
		submit.disabled = true;
		say(t.publishSending);
		try {
			const published = await bridge.confluencePublish(source.tabId, {
				space: space.value,
				parent: place.parent,
				title: name,
				markdown,
				open: open.checked,
			});
			options.setSpace(space.value);
			showDone(published.title, published.url, published.attached, published.missing);
		} catch (error) {
			say(format(t.publishFailed, errorText(error)), "error");
		} finally {
			submit.disabled = false;
		}
	}

	function showDone(name: string, url: string, attached: number, missing: readonly string[]): void {
		const browser = el("button", {
			class: "jira-button primary",
			children: [icon("open"), t.linkOpenBrowser],
			attrs: { type: "button" },
		});
		browser.addEventListener("click", () => void bridge.openLink(url));
		const done = el("button", {
			class: "jira-button",
			text: t.publishDone,
			attrs: { type: "button" },
		});
		done.addEventListener("click", () => dialog.close());
		body.replaceChildren(
			el("div", {
				class: "publish-done",
				children: [
					el("p", { class: "publish-done-title", text: format(t.publishPublished, name) }),
					el("p", {
						class: "publish-where",
						text: format(t.publishWhere, [spaceName(), ...place.path, name].join(" › ")),
					}),
					...(attached === 0
						? []
						: [el("p", { class: "publish-files", text: format(t.publishAttached, attached) })]),
					...(missing.length === 0
						? []
						: [
								el("p", {
									class: "publish-status",
									attrs: { "data-kind": "error" },
									text: format(t.publishMissing, missing.join(", ")),
								}),
							]),
					el("div", { class: "publish-actions", children: [done, browser] }),
				],
			}),
		);
		browser.focus();
	}

	function showConnect(): void {
		const connect = el("button", {
			class: "jira-button primary",
			text: t.confluenceConnect,
			attrs: { type: "button" },
		});
		connect.addEventListener("click", () => {
			dialog.close();
			options.connect();
		});
		body.replaceChildren(
			el("div", {
				class: "publish-done",
				children: [
					el("p", { text: t.publishConnectFirst }),
					el("div", { class: "publish-actions", children: [connect] }),
				],
			}),
		);
	}

	return {
		async show(next) {
			source = next;
			body.replaceChildren(form);
			say("");
			if (!dialog.open) dialog.showModal();
			if ((await bridge.confluenceAccount().catch(() => null)) === null) {
				showConnect();
				return;
			}
			heading = proposedTitle(next.markdown, next.name);
			title.value = heading.title;
			dropHeading.checked = true;
			dropHeadingRow.hidden = !heading.fromHeading;
			find.value = "";
			drawFiles();
			title.focus();
			title.select();
			space.replaceChildren(el("option", { text: t.confluenceLoading, attrs: { value: "" } }));
			try {
				spaces = await bridge.confluenceSpaces();
			} catch (error) {
				say(format(t.publishFailed, errorText(error)), "error");
				return;
			}
			space.replaceChildren(
				...spaces.map((each) =>
					el("option", { text: `${each.name} (${each.key})`, attrs: { value: each.key } }),
				),
			);
			const chosen = options.space();
			space.value = spaces.some((each) => each.key === chosen) ? chosen : (spaces[0]?.key ?? "");
			await loadTree();
		},
	};
}
