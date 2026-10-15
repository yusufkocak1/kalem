import { DIAGRAM_SUFFIX } from "../shared/diagram.js";
import { el } from "./dom.js";

/** A diagram image in the document: its file name ends in `.diagram.png`. */
export function isDiagramImage(target: EventTarget | null): target is HTMLImageElement {
	if (!(target instanceof HTMLImageElement)) return false;
	const src = (target.getAttribute("src") ?? "").replace(/[?#].*$/, "");
	// kalem-locale-ok: file extensions are ASCII
	return src.toLowerCase().endsWith(DIAGRAM_SUFFIX);
}

/** An "Edit Diagram" button over the diagram image under the pointer. */
export function createDiagramButton(options: {
	readonly host: HTMLElement;
	readonly label: string;
	edit(image: HTMLImageElement): void;
}): { hide(): void } {
	const button = el("button", {
		class: "diagram-edit-button",
		text: `✎ ${options.label}`,
		attrs: { type: "button", hidden: "" },
	});
	document.body.append(button);
	let image: HTMLImageElement | null = null;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function hide(): void {
		clearTimeout(hideTimer);
		button.hidden = true;
		image = null;
	}

	function show(target: HTMLImageElement): void {
		clearTimeout(hideTimer);
		image = target;
		button.hidden = false;
		const box = target.getBoundingClientRect();
		button.style.top = `${Math.max(4, box.top + 8)}px`;
		button.style.left = `${Math.max(4, box.right - button.offsetWidth - 8)}px`;
	}

	const later = (): void => {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(hide, 200);
	};

	options.host.addEventListener("mouseover", (event) => {
		if (isDiagramImage(event.target)) show(event.target);
	});
	options.host.addEventListener("mouseout", (event) => {
		if (isDiagramImage(event.target) && event.relatedTarget !== button) later();
	});
	button.addEventListener("mouseenter", () => clearTimeout(hideTimer));
	button.addEventListener("mouseleave", later);
	button.addEventListener("click", () => {
		const target = image;
		hide();
		if (target !== null) options.edit(target);
	});
	// Scrolling keeps the button on its image.
	options.host.addEventListener(
		"scroll",
		() => {
			if (image === null || button.hidden) return;
			if (image.isConnected) show(image);
			else hide();
		},
		true,
	);
	options.host.addEventListener("keydown", hide);
	return { hide };
}
