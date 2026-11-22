import { el } from "./dom.js";

/** The side of its button a tip opens on: away from the window's edge it is at. */
export type TipSide = "right" | "left" | "top";

let shared: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function tipElement(): HTMLElement {
	if (shared === null) {
		shared = el("div", { class: "app-tip", attrs: { role: "presentation", hidden: "" } });
		document.body.append(shared);
	}
	return shared;
}

function hide(): void {
	clearTimeout(timer);
	if (shared !== null) shared.hidden = true;
}

function show(button: HTMLElement, text: string, side: TipSide): void {
	const tip = tipElement();
	tip.textContent = text;
	tip.dataset.side = side;
	tip.hidden = false;
	const box = button.getBoundingClientRect();
	const width = tip.offsetWidth;
	const height = tip.offsetHeight;
	const gap = 8;
	let left: number;
	let top: number;
	if (side === "top") {
		left = box.left + box.width / 2 - width / 2;
		top = box.top - height - gap;
	} else {
		left = side === "right" ? box.right + gap : box.left - width - gap;
		top = box.top + box.height / 2 - height / 2;
	}
	tip.style.left = `${Math.max(4, Math.min(left, window.innerWidth - width - 4))}px`;
	tip.style.top = `${Math.max(4, Math.min(top, window.innerHeight - height - 4))}px`;
}

/**
 * A button's name shown beside it at once, rather than the system's slow
 * tooltip: for the icon-only buttons on the window's edges. `text` is read
 * each time, so a shortcut or a count can change.
 */
export function attachTip(button: HTMLElement, text: () => string, side: TipSide): void {
	button.removeAttribute("title");
	button.addEventListener("pointerenter", () => {
		clearTimeout(timer);
		timer = setTimeout(() => show(button, text(), side), 250);
	});
	button.addEventListener("pointerleave", hide);
	button.addEventListener("pointerdown", hide);
	button.addEventListener("focus", () => {
		if (button.matches(":focus-visible")) show(button, text(), side);
	});
	button.addEventListener("blur", hide);
}

window.addEventListener("blur", hide);
