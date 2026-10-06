import type { Block, Blockquote, Definition, Inline, Root } from "@kalem-editor/core";

/**
 * Markdown has no panels: an info/note/warning/tip panel becomes a quote that
 * starts with its icon, and such a quote becomes the panel again on export.
 */
export const PANEL_ICONS = {
	info: "ℹ️",
	note: "📝",
	warning: "⚠️",
	tip: "💡",
} as const;

export type PanelKind = keyof typeof PANEL_ICONS | "panel";

export interface Panel {
	readonly kind: PanelKind;
	readonly title: string | null;
	readonly children: Block[];
}

export function panelKind(name: string): PanelKind | null {
	return name in PANEL_ICONS || name === "panel" ? (name as PanelKind) : null;
}

/** The quote a panel imports as. */
export function panelQuote(kind: PanelKind, title: string | null, blocks: Block[]): Blockquote {
	const icon = kind === "panel" ? null : PANEL_ICONS[kind];
	const children = [...blocks];
	if (title !== null && title !== "") {
		const label = icon === null ? title : `${icon} ${title}`;
		children.unshift({
			type: "paragraph",
			children: [{ type: "strong", children: [{ type: "text", value: label }] }],
		});
	} else if (icon !== null) {
		const first = children[0];
		if (first?.type === "paragraph") {
			children[0] = {
				...first,
				children: [{ type: "text", value: `${icon} ` }, ...first.children],
			};
		} else {
			children.unshift({ type: "paragraph", children: [{ type: "text", value: icon }] });
		}
	}
	return { type: "blockquote", children };
}

/** The panel a quote stands for, when it starts with a panel icon. */
export function quotePanel(quote: Blockquote): Panel | null {
	const [first, ...rest] = quote.children;
	if (first?.type !== "paragraph") return null;
	const [lead, ...tail] = first.children;
	for (const [kind, icon] of Object.entries(PANEL_ICONS) as [PanelKind, string][]) {
		if (
			lead?.type === "strong" &&
			tail.length === 0 &&
			lead.children.length === 1 &&
			lead.children[0]?.type === "text" &&
			lead.children[0].value.startsWith(icon)
		) {
			const title = lead.children[0].value.slice(icon.length).trim();
			return { kind, title: title === "" ? null : title, children: rest };
		}
		if (lead?.type === "text" && lead.value.startsWith(icon)) {
			const value = lead.value.slice(icon.length).trimStart();
			const inlines: Inline[] = value === "" ? tail : [{ ...lead, value }, ...tail];
			return {
				kind,
				title: null,
				children: inlines.length === 0 ? rest : [{ ...first, children: inlines }, ...rest],
			};
		}
	}
	return null;
}

/** Kalem's language names and the ones Confluence's code macro knows. */
const TO_CONFLUENCE: Readonly<Record<string, string>> = {
	javascript: "js",
	typescript: "typescript",
	ts: "typescript",
	python: "py",
	shell: "bash",
	sh: "bash",
	zsh: "bash",
	yaml: "yml",
	csharp: "c#",
	cs: "c#",
	"c++": "cpp",
	html: "xml",
};

const FROM_CONFLUENCE: Readonly<Record<string, string>> = {
	js: "javascript",
	py: "python",
	yml: "yaml",
	"c#": "csharp",
};

export function toConfluenceLanguage(lang: string | null): string | null {
	if (lang === null || lang === "") return null;
	// kalem-locale-ok: language identifiers are ASCII
	const key = lang.toLowerCase();
	return TO_CONFLUENCE[key] ?? key;
}

export function fromConfluenceLanguage(lang: string | null | undefined): string | null {
	if (lang == null) return null;
	// kalem-locale-ok: language identifiers are ASCII
	const key = lang.trim().toLowerCase();
	if (key === "" || key === "none" || key === "text") return null;
	return FROM_CONFLUENCE[key] ?? key;
}

/** Reference definitions by identifier, for `[text][label]` links. */
export function definitionsOf(doc: Root): Map<string, Definition> {
	const found = new Map<string, Definition>();
	const visit = (node: { type?: string; children?: readonly unknown[] }): void => {
		if (node.type === "definition") {
			const definition = node as Definition;
			if (!found.has(definition.identifier)) found.set(definition.identifier, definition);
		}
		for (const child of node.children ?? []) visit(child as typeof node);
	};
	visit(doc);
	return found;
}

/** A relative file name as a Markdown URL. */
export function fileUrl(name: string): string {
	return name.replace(/ /g, "%20");
}

/** A Markdown URL as the file name Confluence knows the attachment by. */
export function attachmentName(url: string): string | null {
	if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return null;
	const path = url.split(/[?#]/)[0] ?? "";
	let decoded = path;
	try {
		decoded = decodeURIComponent(path);
	} catch {}
	return decoded.split("/").pop() || null;
}
