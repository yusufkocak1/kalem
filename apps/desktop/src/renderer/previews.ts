export type PreviewKind = "mermaid" | "math";

const KINDS: Readonly<Record<string, PreviewKind>> = {
	mermaid: "mermaid",
	math: "math",
	latex: "math",
	katex: "math",
	tex: "math",
};

/** Code fence languages that get a rendered preview. */
export function previewKind(lang: string | null | undefined): PreviewKind | null {
	// kalem-locale-ok: language names are ASCII
	return KINDS[(lang ?? "").trim().toLowerCase()] ?? null;
}

export interface Rendered {
	/** Inline markup for HTML export: SVG for diagrams, MathML for math. */
	readonly html: string;
	/** A standalone SVG for the editor's preview image. */
	readonly image: string;
	readonly width: number;
	readonly height: number;
}

type Outcome =
	| { readonly ok: true; readonly value: Rendered }
	| { readonly ok: false; readonly error: string };

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_FONT_SIZE = 18;
/** Rendering waits for typing to pause this long. */
const RENDER_DELAY = 400;

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
let renderCount = 0;

function loadMermaid(): Promise<typeof import("mermaid").default> {
	mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "default",
			// Text labels: an SVG used as an image draws no HTML.
			htmlLabels: false,
			flowchart: { htmlLabels: false },
		});
		return mermaid;
	});
	return mermaidReady;
}

/** The SVG with a fixed pixel size, so it scales like a picture when used as an image. */
function fixedSize(svg: string): { image: string; width: number; height: number } {
	const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
	const box = root
		.getAttribute("viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	const width =
		box?.length === 4 && Number.isFinite(box[2])
			? (box[2] as number)
			: Number.parseFloat(root.getAttribute("width") ?? "") || 600;
	const height =
		box?.length === 4 && Number.isFinite(box[3])
			? (box[3] as number)
			: Number.parseFloat(root.getAttribute("height") ?? "") || 300;
	root.setAttribute("width", String(width));
	root.setAttribute("height", String(height));
	root.removeAttribute("style");
	return { image: new XMLSerializer().serializeToString(root), width, height };
}

async function renderMermaid(source: string): Promise<Rendered> {
	const mermaid = await loadMermaid();
	const { svg } = await mermaid.render(`kalem-mermaid-${++renderCount}`, source);
	return { html: svg, ...fixedSize(svg) };
}

async function renderMath(source: string): Promise<Rendered> {
	const { default: katex } = await import("katex");
	const mathml = katex.renderToString(source, {
		displayMode: true,
		output: "mathml",
		throwOnError: true,
	});

	// Measured in the page, then drawn into an SVG through a foreignObject.
	const content = document.createElement("div");
	content.style.cssText = `display:inline-block;font-size:${MATH_FONT_SIZE}px;color:#1a1a1a`;
	content.innerHTML = mathml;
	const probe = document.createElement("div");
	probe.style.cssText = "position:absolute;left:-10000px;top:0";
	probe.append(content);
	document.body.append(probe);
	const box = content.getBoundingClientRect();
	probe.remove();
	const width = Math.ceil(box.width) + 16;
	const height = Math.ceil(box.height) + 16;

	const markup = new XMLSerializer().serializeToString(content);
	const image = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}"><foreignObject x="8" y="8" width="${width - 16}" height="${height - 16}">${markup}</foreignObject></svg>`;
	return { html: mathml, image, width, height };
}

/**
 * Rendered previews of Mermaid and math code blocks, cached by source. The
 * editor shows them under the code through CSS (see style.css), so nothing
 * is added to the editor's DOM.
 */
export class Previews {
	readonly #cache = new Map<string, Outcome | Promise<Outcome>>();
	readonly #onReady: () => void;
	/** Sources waiting for typing to pause before they are rendered. */
	readonly #queued = new Map<string, [PreviewKind, string]>();
	#timer: ReturnType<typeof setTimeout> | null = null;

	/** `onReady` runs when a preview finished rendering after being asked for. */
	constructor(onReady: () => void) {
		this.#onReady = onReady;
	}

	#key(kind: PreviewKind, source: string): string {
		return `${kind}\u0000${source}`;
	}

	/** Rendered now if cached; otherwise queued for rendering and `undefined`. */
	#peek(kind: PreviewKind, source: string): Outcome | undefined {
		const key = this.#key(kind, source);
		const cached = this.#cache.get(key);
		if (cached !== undefined) return cached instanceof Promise ? undefined : cached;
		this.#queued.set(key, [kind, source]);
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.#flush(), RENDER_DELAY);
		return undefined;
	}

	#flush(): void {
		this.#timer = null;
		const queued = [...this.#queued];
		this.#queued.clear();
		for (const [key, [kind, source]] of queued) {
			if (this.#cache.has(key)) continue;
			const pending = this.#render(kind, source).then((outcome) => {
				this.#cache.set(key, outcome);
				this.#onReady();
				return outcome;
			});
			this.#cache.set(key, pending);
		}
	}

	async #render(kind: PreviewKind, source: string): Promise<Outcome> {
		try {
			const value = kind === "mermaid" ? await renderMermaid(source) : await renderMath(source);
			return { ok: true, value };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, error: message.split("\n").slice(0, 3).join("\n") };
		}
	}

	async get(kind: PreviewKind, source: string): Promise<Outcome> {
		const key = this.#key(kind, source);
		const cached = this.#cache.get(key);
		if (cached !== undefined) return cached;
		const outcome = await this.#render(kind, source);
		this.#cache.set(key, outcome);
		return outcome;
	}

	/** Puts the previews on the code blocks under `root`; runs after every change. */
	decorate(root: HTMLElement): void {
		for (const code of root.querySelectorAll<HTMLElement>("pre > code[class*='language-']")) {
			const pre = code.parentElement as HTMLElement;
			const lang = /language-(\S+)/.exec(code.className)?.[1];
			const kind = previewKind(lang);
			if (kind === null) {
				if (pre.hasAttribute("data-preview")) clear(pre);
				continue;
			}
			const outcome = this.#peek(kind, code.textContent?.replace(/\n$/, "") ?? "");
			if (outcome === undefined) continue;
			if (outcome.ok) show(pre, outcome.value);
			else showError(pre, outcome.error);
		}
	}
}

function clear(pre: HTMLElement): void {
	pre.removeAttribute("data-preview");
	pre.removeAttribute("data-preview-error");
	for (const name of ["--preview", "--preview-width", "--preview-ratio"])
		pre.style.removeProperty(name);
}

function show(pre: HTMLElement, rendered: Rendered): void {
	const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.image)}")`;
	if (pre.style.getPropertyValue("--preview") === url) return;
	pre.setAttribute("data-preview", "ready");
	pre.removeAttribute("data-preview-error");
	pre.style.setProperty("--preview", url);
	pre.style.setProperty("--preview-width", `${rendered.width}px`);
	pre.style.setProperty("--preview-ratio", `${rendered.width} / ${rendered.height}`);
}

function showError(pre: HTMLElement, error: string): void {
	clear(pre);
	pre.setAttribute("data-preview", "error");
	pre.setAttribute("data-preview-error", error);
}
