/** Pretty, coloured JSON and XML for a response, as DOM nodes (never HTML strings). */

const span = (kind, text) => {
	const element = document.createElement("span");
	element.className = `tok-${kind}`;
	element.textContent = text;
	return element;
};

export function prettyJson(text) {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return null;
	}
}

const JSON_TOKEN =
	/("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function highlightJson(text) {
	const fragment = document.createDocumentFragment();
	let last = 0;
	for (const match of text.matchAll(JSON_TOKEN)) {
		if (match.index > last) fragment.append(text.slice(last, match.index));
		if (match[1] !== undefined) {
			fragment.append(span(match[2] ? "key" : "string", match[1]));
			if (match[2]) fragment.append(span("punct", match[2]));
		} else if (match[3] !== undefined) fragment.append(span("number", match[3]));
		else if (match[4] !== undefined) fragment.append(span("literal", match[4]));
		else fragment.append(span("punct", match[5]));
		last = match.index + match[0].length;
	}
	fragment.append(text.slice(last));
	return fragment;
}

export function prettyXml(text) {
	const source = text.trim();
	if (!source.startsWith("<")) return null;
	const document_ = new DOMParser().parseFromString(source, "application/xml");
	if (document_.querySelector("parsererror")) return null;
	const lines = [];
	const walk = (node, depth) => {
		const pad = "  ".repeat(depth);
		if (node.nodeType === Node.TEXT_NODE) {
			const value = node.nodeValue.trim();
			if (value !== "") lines.push(pad + escapeText(value));
			return;
		}
		if (node.nodeType === Node.COMMENT_NODE) {
			lines.push(`${pad}<!--${node.nodeValue}-->`);
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const attrs = [...node.attributes]
			.map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`)
			.join("");
		const children = [...node.childNodes].filter(
			(child) => child.nodeType !== Node.TEXT_NODE || child.nodeValue.trim() !== "",
		);
		if (children.length === 0) lines.push(`${pad}<${node.nodeName}${attrs}/>`);
		else if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
			lines.push(
				`${pad}<${node.nodeName}${attrs}>${escapeText(children[0].nodeValue.trim())}</${node.nodeName}>`,
			);
		} else {
			lines.push(`${pad}<${node.nodeName}${attrs}>`);
			for (const child of children) walk(child, depth + 1);
			lines.push(`${pad}</${node.nodeName}>`);
		}
	};
	const declaration = /^<\?xml[^>]*\?>/.exec(source);
	if (declaration) lines.push(declaration[0]);
	walk(document_.documentElement, 0);
	return lines.join("\n");
}

const escapeText = (value) =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (value) => escapeText(value).replace(/"/g, "&quot;");

const XML_TOKEN =
	/(<!--[\s\S]*?-->)|(<\/?)([\w:.-]+)|([\w:.-]+)(=)("[^"]*"|'[^']*')|(\/?>|\?>|<\?)/g;

export function highlightXml(text) {
	const fragment = document.createDocumentFragment();
	let last = 0;
	let inTag = false;
	for (const match of text.matchAll(XML_TOKEN)) {
		if (match.index > last) fragment.append(text.slice(last, match.index));
		if (match[1] !== undefined) fragment.append(span("comment", match[1]));
		else if (match[2] !== undefined) {
			fragment.append(span("punct", match[2]), span("tag", match[3]));
			inTag = true;
		} else if (match[4] !== undefined && inTag) {
			fragment.append(span("attr", match[4]), span("punct", match[5]), span("string", match[6]));
		} else if (match[7] !== undefined) {
			fragment.append(span("punct", match[7]));
			inTag = match[7] === "<?";
		} else fragment.append(match[0]);
		last = match.index + match[0].length;
	}
	fragment.append(text.slice(last));
	return fragment;
}

/** The body, pretty and coloured when it is JSON or XML. */
export function renderBody(target, text, contentType = "") {
	target.replaceChildren();
	const json = /json/i.test(contentType) || /^\s*[[{]/.test(text) ? prettyJson(text) : null;
	if (json !== null) {
		target.append(highlightJson(json));
		return "json";
	}
	const xml = /xml|html/i.test(contentType) || /^\s*</.test(text) ? prettyXml(text) : null;
	if (xml !== null) {
		target.append(highlightXml(xml));
		return "xml";
	}
	target.append(text);
	return "text";
}

export function formatSize(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Small line icons, drawn in the text's colour. */
const PATHS = {
	send: "M4 12l16-8-6 16-2.5-6.5L4 12z",
	plus: "M12 5v14M5 12h14",
	trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
	copy: "M8 8h11v12H8zM5 16V4h11",
	save: "M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7",
	search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
	history: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2",
	folder: "M3 6h6l2 2h10v11H3z",
	globe:
		"M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
	settings:
		"M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-2-4-2 .5-1.5-1L15 4h-6l-.5 2.5-1.5 1L5 7 3 11l2 1v0l-2 1 2 4 2-.5 1.5 1L9 20h6l.5-2.5 1.5-1 2 .5 2-4z",
	code: "M8 7l-5 5 5 5M16 7l5 5-5 5",
	close: "M6 6l12 12M18 6L6 18",
	check: "M5 12l5 5 9-10",
	play: "M7 4v16l13-8z",
	stop: "M6 6h12v12H6z",
	refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
	list: "M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1",
	alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
	upload: "M12 16V4M6 10l6-6 6 6M4 20h16",
	file: "M6 3h8l4 4v14H6zM14 3v4h4",
};

export function icon(name) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.8");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", PATHS[name] ?? "");
	svg.append(path);
	return svg;
}

/** `el("div", { class: "a", onclick }, [children])` */
export function el(tag, props = {}, children = []) {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined || value === null || value === false) continue;
		if (key === "class") element.className = value;
		else if (key === "text") element.textContent = value;
		else if (key === "value") element.value = value;
		else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
		else element.setAttribute(key, value === true ? "" : value);
	}
	element.append(
		...children.filter((child) => child !== null && child !== undefined && child !== false),
	);
	return element;
}
