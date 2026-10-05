import { parse } from "@kalem-editor/core";
import { renderToDOM } from "@kalem-editor/viewer";
import type { Version } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { extractTableStyles } from "../shared/table-style.js";
import { el } from "./dom.js";

export interface VersionHistoryOptions {
	readonly t: Strings;
	readonly lang: string;
}

export interface VersionSource {
	/** `false` for a document that was never saved. */
	readonly saved: boolean;
	list(): Promise<readonly Version[]>;
	read(id: string): Promise<string>;
	/** Puts the text in the editor; resolves to whether it was applied. */
	restore(text: string, label: string): boolean;
}

/** Lists a document's saved versions with a preview; one can be put back into the editor. */
export function createVersionHistory(options: VersionHistoryOptions): {
	show(source: VersionSource): Promise<void>;
} {
	const { t } = options;
	const dateFormat = new Intl.DateTimeFormat(options.lang, {
		dateStyle: "medium",
		timeStyle: "medium",
	});

	const list = el("ul", {
		class: "versions-list",
		attrs: { role: "listbox", "aria-label": t.versionHistoryTitle },
	});
	const preview = el("div", { class: "versions-preview kalem-theme" });
	const message = el("p", { class: "versions-message" });
	const restore = el("button", {
		class: "dialog-button primary",
		text: t.restoreVersion,
		attrs: { type: "button" },
	});
	const close = el("button", { class: "dialog-button", text: t.close, attrs: { type: "button" } });
	const dialog = el("dialog", {
		class: "versions",
		attrs: { "aria-label": t.versionHistoryTitle },
		children: [
			el("h2", { class: "versions-title", text: t.versionHistoryTitle }),
			message,
			el("div", { class: "versions-body", children: [list, preview] }),
			el("div", { class: "versions-actions", children: [close, restore] }),
		],
	});
	document.body.append(dialog);
	close.addEventListener("click", () => dialog.close());

	let source: VersionSource | null = null;
	let selected: { id: string; label: string; text: string } | null = null;
	let token = 0;

	async function select(version: Version, item: HTMLElement): Promise<void> {
		const current = ++token;
		for (const other of list.children) other.setAttribute("aria-selected", String(other === item));
		restore.disabled = true;
		const text = (await source?.read(version.id)) ?? "";
		if (current !== token) return;
		selected = { id: version.id, label: dateFormat.format(version.time), text };
		renderToDOM(parse(extractTableStyles(text).markdown), preview);
		restore.disabled = false;
	}

	restore.addEventListener("click", () => {
		if (source === null || selected === null) return;
		if (source.restore(selected.text, selected.label)) dialog.close();
	});

	list.addEventListener("keydown", (event) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const items = [...list.children] as HTMLElement[];
		const index = items.findIndex((item) => item.getAttribute("aria-selected") === "true");
		const next =
			items[Math.min(items.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
		next?.click();
		next?.focus();
	});

	return {
		async show(next) {
			source = next;
			selected = null;
			token++;
			list.replaceChildren();
			preview.replaceChildren();
			restore.disabled = true;

			const versions = next.saved ? await next.list() : [];
			message.textContent = !next.saved
				? t.versionsUnsaved
				: versions.length === 0
					? t.versionsEmpty
					: "";
			message.hidden = message.textContent === "";
			for (const version of versions) {
				const item = el("li", {
					class: "versions-item",
					text: dateFormat.format(version.time),
					attrs: { role: "option", tabindex: "0", "data-id": version.id, "aria-selected": "false" },
				});
				item.addEventListener("click", () => void select(version, item));
				list.append(item);
			}
			if (!dialog.open) dialog.showModal();
			const first = list.firstElementChild as HTMLElement | null;
			if (first !== null) {
				first.focus();
				await select(versions[0] as Version, first);
			} else {
				close.focus();
			}
		},
	};
}
