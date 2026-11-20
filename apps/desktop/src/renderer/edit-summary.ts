/**
 * The assistant's changes still waiting in the document, listed above the
 * chat's question box as a code editor lists an agent's edits: how many and
 * their lines (+ and −), Accept and Reject for all of them, and each change
 * on a line of its own, which shows it in the document when clicked. It
 * follows the review in the document (`edit-review.ts`): what is decided
 * there leaves the list, and it goes when nothing is left.
 */
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import { el } from "./dom.js";
import type { ReviewSummary } from "./edit-review.js";

export interface EditSummaryActions {
	acceptAll(): void;
	rejectAll(): void;
	select(index: number): void;
}

export interface EditSummary {
	readonly element: HTMLElement;
	/** Shows the changes waiting in the active document; none hides it. */
	update(summary: ReviewSummary | null, actions: EditSummaryActions | null): void;
}

const counts = (added: number, removed: number): HTMLElement =>
	el("span", {
		class: "edit-summary-counts",
		children: [
			el("span", { class: "edit-summary-added", text: `+${added}` }),
			el("span", { class: "edit-summary-removed", text: `−${removed}` }),
		],
	});

export function createEditSummary(t: Strings): EditSummary {
	let actions: EditSummaryActions | null = null;
	let open = true;

	const chevron = el("button", {
		class: "edit-summary-toggle",
		attrs: { type: "button", "aria-expanded": "true", title: t.editSummaryToggle },
	});
	const title = el("span", { class: "edit-summary-title" });
	const total = el("span", { class: "edit-summary-total" });
	chevron.append(title, total);
	const accept = el("button", {
		class: "edit-summary-accept",
		text: t.editReviewAcceptAll,
		attrs: { type: "button", title: t.editReviewAcceptAll },
	});
	const reject = el("button", {
		class: "edit-summary-reject",
		text: t.editReviewRejectAll,
		attrs: { type: "button", title: t.editReviewRejectAll },
	});
	const list = el("ul", { class: "edit-summary-list", attrs: { "aria-label": t.editReviewTitle } });
	const element = el("section", {
		class: "edit-summary",
		attrs: { hidden: "", "aria-label": t.editReviewTitle },
		children: [
			el("div", { class: "edit-summary-head", children: [chevron, accept, reject] }),
			list,
		],
	});

	chevron.addEventListener("click", () => {
		open = !open;
		chevron.setAttribute("aria-expanded", String(open));
		list.hidden = !open;
	});
	accept.addEventListener("click", () => actions?.acceptAll());
	reject.addEventListener("click", () => actions?.rejectAll());

	return {
		element,
		update(summary, next) {
			actions = next;
			element.hidden = summary === null || summary.items.length === 0;
			if (summary === null) {
				list.replaceChildren();
				return;
			}
			const { items } = summary;
			title.textContent = format(t.editSummaryCount, items.length);
			const added = items.reduce((sum, item) => sum + item.added, 0);
			const removed = items.reduce((sum, item) => sum + item.removed, 0);
			total.replaceChildren(counts(added, removed));
			list.hidden = !open;
			list.replaceChildren(
				...items.map((item, index) => {
					const row = el("button", {
						class: "edit-summary-item",
						attrs: { type: "button", title: t.editSummaryShow },
						children: [
							el("span", {
								class: `edit-summary-mark${item.deletion ? " deleted" : ""}`,
								attrs: { "aria-hidden": "true" },
							}),
							el("span", {
								class: `edit-summary-label${item.deletion ? " deleted" : ""}`,
								text: item.label === "" ? t.editSummaryEmpty : item.label,
							}),
							counts(item.added, item.removed),
						],
					});
					if (index === summary.current) row.setAttribute("aria-current", "true");
					row.addEventListener("click", () => actions?.select(index));
					return el("li", { children: [row] });
				}),
			);
		},
	};
}
