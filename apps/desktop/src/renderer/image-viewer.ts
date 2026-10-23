import type { Strings } from "../shared/i18n.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface ImageViewer {
	/** Shows `image` over the window; the arrows go through `images`, the document's pictures in order. */
	open(image: HTMLImageElement, images: readonly HTMLImageElement[]): void;
}

export interface ImageViewerOptions {
	readonly t: Strings;
	/** Whether the document can be changed: the description is edited only then. */
	readOnly(): boolean;
	/** Opens the picture's description (alt text) for editing in the document. */
	editAlt(image: HTMLImageElement): void;
}

/** A picture's name: its description, else its file name. */
function caption(image: HTMLImageElement): string {
	const alt = image.getAttribute("alt")?.trim() ?? "";
	if (alt !== "") return alt;
	const src = image.getAttribute("src") ?? "";
	if (src.startsWith("data:")) return "";
	const file = src.split(/[?#]/)[0]?.split("/").pop() ?? "";
	try {
		return decodeURIComponent(file);
	} catch {
		return file;
	}
}

function barButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
	return el("button", {
		class: "image-viewer-button",
		attrs: { type: "button", title: label, "aria-label": label },
		children: [icon(name)],
	});
}

/** The document's pictures, one at a time, as large as the window allows; a click shows the actual size. */
export function createImageViewer(options: ImageViewerOptions): ImageViewer {
	const { t } = options;
	let images: readonly HTMLImageElement[] = [];
	let index = 0;

	const picture = el("img", {
		class: "image-viewer-image",
		attrs: { alt: "", draggable: "false" },
	});
	const stage = el("div", { class: "image-viewer-stage", children: [picture] });
	const title = el("span", { class: "image-viewer-caption" });
	const count = el("span", { class: "image-viewer-count" });
	const sizeButton = barButton("focus", t.imageViewerActualSize);
	const altButton = el("button", {
		class: "image-viewer-text-button",
		attrs: { type: "button" },
		text: t.imageViewerEditAlt,
	});
	const closeButton = barButton("close", t.imageViewerClose);
	const previous = el("button", {
		class: "image-viewer-nav image-viewer-previous",
		attrs: { type: "button", title: t.imageViewerPrevious, "aria-label": t.imageViewerPrevious },
		text: "‹",
	});
	const next = el("button", {
		class: "image-viewer-nav image-viewer-next",
		attrs: { type: "button", title: t.imageViewerNext, "aria-label": t.imageViewerNext },
		text: "›",
	});
	const dialog = el("dialog", {
		class: "image-viewer",
		attrs: { "aria-label": t.imageViewer },
		children: [
			el("div", {
				class: "image-viewer-bar",
				children: [title, count, altButton, sizeButton, closeButton],
			}),
			stage,
			previous,
			next,
		],
	});
	document.body.append(dialog);

	function setActualSize(actual: boolean): void {
		stage.classList.toggle("actual", actual);
		const label = actual ? t.imageViewerFit : t.imageViewerActualSize;
		sizeButton.title = label;
		sizeButton.setAttribute("aria-label", label);
		sizeButton.setAttribute("aria-pressed", String(actual));
	}

	function show(at: number): void {
		const image = images[at];
		if (image === undefined) return;
		index = at;
		picture.src = image.currentSrc || image.src;
		picture.alt = image.getAttribute("alt") ?? "";
		title.textContent = caption(image);
		title.title = title.textContent;
		const many = images.length > 1;
		count.hidden = !many;
		count.textContent = `${at + 1} / ${images.length}`;
		previous.hidden = !many;
		next.hidden = !many;
		altButton.hidden = options.readOnly();
		setActualSize(false);
		stage.scrollTo(0, 0);
	}

	const step = (by: number): void => {
		if (images.length > 1) show((index + by + images.length) % images.length);
	};

	function close(): void {
		if (dialog.open) dialog.close();
	}

	picture.addEventListener("click", () => setActualSize(!stage.classList.contains("actual")));
	sizeButton.addEventListener("click", () => setActualSize(!stage.classList.contains("actual")));
	// The dark area around the picture closes it, as in a photo viewer.
	stage.addEventListener("click", (event) => {
		if (event.target === stage) close();
	});
	closeButton.addEventListener("click", close);
	previous.addEventListener("click", () => step(-1));
	next.addEventListener("click", () => step(1));
	altButton.addEventListener("click", () => {
		const image = images[index];
		close();
		if (image?.isConnected) options.editAlt(image);
	});
	dialog.addEventListener("keydown", (event) => {
		if (event.key === "ArrowLeft") step(-1);
		else if (event.key === "ArrowRight") step(1);
		else if (event.key === "Home") show(0);
		else if (event.key === "End") show(images.length - 1);
		else return;
		event.preventDefault();
	});
	dialog.addEventListener("close", () => {
		picture.removeAttribute("src");
		images = [];
	});

	return {
		open(image, all) {
			images = all.includes(image) ? all : [image];
			show(images.indexOf(image));
			if (!dialog.open) dialog.showModal();
			closeButton.focus();
		},
	};
}
