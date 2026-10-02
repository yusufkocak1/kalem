import { el } from "./dom.js";
import { icon } from "./icons.js";

export type NoticeKind = "info" | "warning" | "error";

export interface NoticeAction {
	readonly label: string;
	run(): void;
}

export interface Notice {
	/** A notice with the same id replaces the previous one. */
	readonly id: string;
	readonly text: string;
	readonly kind?: NoticeKind;
	readonly actions?: readonly NoticeAction[];
}

export interface Notices {
	show(notice: Notice): void;
	dismiss(id: string): void;
	clear(): void;
}

export function createNotices(container: HTMLElement, dismissLabel: string): Notices {
	const open = new Map<string, HTMLElement>();

	function dismiss(id: string): void {
		open.get(id)?.remove();
		open.delete(id);
	}

	return {
		show(notice) {
			dismiss(notice.id);
			const kind = notice.kind ?? "info";

			const actions = (notice.actions ?? []).map((action) => {
				const button = el("button", {
					class: "notice-action",
					text: action.label,
					attrs: { type: "button" },
				});
				button.addEventListener("click", () => {
					dismiss(notice.id);
					action.run();
				});
				return button;
			});

			const close = el("button", {
				class: "notice-close",
				attrs: { type: "button", "aria-label": dismissLabel, title: dismissLabel },
				children: [icon("close")],
			});
			close.addEventListener("click", () => dismiss(notice.id));

			const row = el("div", {
				class: "notice",
				attrs: {
					role: kind === "error" ? "alert" : "status",
					"data-kind": kind,
					"data-notice": notice.id,
				},
				children: [el("span", { class: "notice-text", text: notice.text }), ...actions, close],
			});
			open.set(notice.id, row);
			container.append(row);
		},

		dismiss,

		clear() {
			for (const id of [...open.keys()]) dismiss(id);
		},
	};
}
