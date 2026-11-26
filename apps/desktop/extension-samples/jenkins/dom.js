/** DOM helpers for the pane: elements and small line icons. */

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
	chevron: "M9 6l6 6-6 6",
	down: "M6 9l6 6 6-6",
	terminal: "M4 6l5 5-5 5M11 17h9",
	server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
	target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
	more: "M6 12h.01M12 12h.01M18 12h.01",
	pipeline: "M5 6h4v4H5zM15 14h4v4h-4zM9 8h3a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2",
	exchange: "M4 8h13l-3-3M20 16H7l3 3",
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

export function duration(ms) {
	if (!Number.isFinite(ms) || ms < 0) return "";
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ago(timestamp, language) {
	const seconds = Math.round((Date.now() - new Date(timestamp).getTime()) / 1000);
	const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
	if (seconds < 60) return format.format(-seconds, "second");
	if (seconds < 3600) return format.format(-Math.round(seconds / 60), "minute");
	if (seconds < 86400) return format.format(-Math.round(seconds / 3600), "hour");
	return format.format(-Math.round(seconds / 86400), "day");
}
