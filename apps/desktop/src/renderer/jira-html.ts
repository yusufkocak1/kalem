import type { Root } from "@kalem-editor/core";
import { fromHtml } from "@kalem-editor/core/html";

/** An HTML editor plug-in's panels (JEditor), drawn as Confluence's: an alert with its icon. */
const PANEL_ICONS: Readonly<Record<string, string>> = {
	warning: "⚠️",
	error: "❌",
	info: "ℹ️",
	note: "📝",
	idea: "💡",
	tip: "💡",
	success: "✅",
};

/**
 * A Jira field kept as HTML, as a document Kalem draws like any page:
 * parsed inert (nothing runs, nothing loads), panels become alerts, and the
 * result goes through the same HTML → Markdown converter as pasting.
 */
export function jiraHtmlRoot(html: string): Root {
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const unsafe of doc.body.querySelectorAll("script, style, iframe, object, embed, form")) {
		unsafe.remove();
	}
	for (const panel of doc.body.querySelectorAll<HTMLElement>(
		'div[class*="jePanel_"], div.panel, div.confluence-information-macro',
	)) {
		const kind = /jePanel_(\w+)|confluence-information-macro-(\w+)/.exec(panel.className);
		const name = kind?.[1] ?? kind?.[2] ?? "";
		const quote = doc.createElement("blockquote");
		quote.append(...panel.childNodes);
		const icon = PANEL_ICONS[name];
		if (icon !== undefined) {
			const first = quote.querySelector("p");
			if (first !== null) first.prepend(`${icon} `);
			else quote.prepend(Object.assign(doc.createElement("p"), { textContent: icon }));
		}
		panel.replaceWith(quote);
	}
	return fromHtml(doc.body);
}
