function circle(x: number, y: number, r: number): string {
	return `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

const MAGNIFIER = [circle(11, 11, 6.5), "m20 20-4.4-4.4"];
const LINES = ["M11 6h10", "M11 12h10", "M11 18h10"];
const PAGE = ["M6 3h8l4 4v14H6z", "M14 3v4h4"];
const FRAME = "M4 5h16v14H4z";
const BRACES = [
	"M9 4c-2 0-3 1-3 3v2.5c0 1.4-.8 2.5-2 2.5 1.2 0 2 1.1 2 2.5V17c0 2 1 3 3 3",
	"M15 4c2 0 3 1 3 3v2.5c0 1.4.8 2.5 2 2.5-1.2 0-2 1.1-2 2.5V17c0 2-1 3-3 3",
];

// 24×24 grid, stroke only, `currentColor`.
const PATHS = {
	new: [...PAGE, "M12 11v6", "M9 14h6"],
	open: ["M3 6h6l2 2h10v11H3z"],
	save: ["M5 3h11l3 3v15H5z", "M8 3v5h7V3", "M8 21v-7h8v7"],
	undo: ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"],
	redo: ["m15 14 5-5-5-5", "M20 9H10a6 6 0 0 0 0 12h3"],
	paste: ["M9 3h6v4H9z", "M9 5H6v16h12V5h-3"],
	cut: [circle(6, 6, 2.5), circle(6, 18, 2.5), "M8 7.5 20 19", "M8 16.5 20 5"],
	copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
	code: ["m8 8-4 4 4 4", "m16 8 4 4-4 4", "m13.5 6-3 12"],
	link: [
		"M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1",
		"M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
	],
	bulletList: [
		circle(4.5, 6, 1),
		circle(4.5, 12, 1),
		circle(4.5, 18, 1),
		"M9 6h11",
		"M9 12h11",
		"M9 18h11",
	],
	orderedList: [
		"M10 6h10",
		"M10 12h10",
		"M10 18h10",
		"M4 5l1.5-1v4",
		"M3.5 14.5c0-1.2 2.5-1.2 2.5 0 0 1-2.5 2-2.5 3.5H6",
	],
	taskList: ["M3.5 4.5h5v5h-5z", "m5 7 .9.9L7.5 6", "M3.5 14.5h5v5h-5z", "M12 7h8.5", "M12 17h8.5"],
	outdent: [...LINES, "m7 9-3 3 3 3"],
	indent: [...LINES, "m4 9 3 3-3 3"],
	find: MAGNIFIER,
	replace: ["M4 8h13", "m14 5 3 3-3 3", "M20 16H7", "m10 13-3 3 3 3"],
	image: [FRAME, circle(9, 10, 1.5), "m4 17 5-4.5 4 3.5 3-2.5 4 3.5"],
	table: [FRAME, "M4 10h16", "M4 14.5h16", "M9.5 5v14", "M14.5 5v14"],
	divider: ["M3 12h18", "M7 7h10", "M7 17h10"],
	codeBlock: [FRAME, "m10 10-2 2 2 2", "m14 10 2 2-2 2"],
	quote: ["M10 8H6v5h3c0 2-1 3-3 3", "M18 8h-4v5h3c0 2-1 3-3 3"],
	word: [...PAGE, "m8.5 12 1.2 5 2.3-4 2.3 4 1.2-5"],
	navigation: [FRAME, "M9.5 5v14", "M6 9h1.5", "M6 12h1.5"],
	source: ["M3 6h18v12H3z", "M6.5 15V9l2.5 3 2.5-3v6", "M17 9v5.5", "m14.8 12.5 2.2 2.5 2.2-2.5"],
	readOnly: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
	focus: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
	zoomOut: [...MAGNIFIER, "M8.5 11h5"],
	zoomIn: [...MAGNIFIER, "M8.5 11h5", "M11 8.5v5"],
	fullWidth: ["M3 5v14", "M21 5v14", "M7 12h10", "m10 9-3 3 3 3", "m14 9 3 3-3 3"],
	themeLight: [
		circle(12, 12, 4),
		"M12 2.5v2",
		"M12 19.5v2",
		"M2.5 12h2",
		"M19.5 12h2",
		"m5.3 5.3 1.4 1.4",
		"m17.3 17.3 1.4 1.4",
		"m5.3 18.7 1.4-1.4",
		"m17.3 6.7 1.4-1.4",
	],
	themeDark: ["M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"],
	themeSystem: ["M3 5h18v11H3z", "M8.5 20h7", "M12 16v4"],
	spellCheck: ["m4 15 3.5-9 3.5 9", "M5.2 12h4.6", "m13 16 3 3 5.5-6.5"],
	autoSave: [
		"M20 12a8 8 0 0 1-13.5 5.8",
		"M4 12a8 8 0 0 1 13.5-5.8",
		"M17.5 2.5v3.7h-3.7",
		"M6.5 21.5v-3.7h3.7",
	],
	rowAbove: ["M4 12h16v8H4z", "M12 3v6", "M9 6h6"],
	rowBelow: ["M4 4h16v8H4z", "M12 15v6", "M9 18h6"],
	deleteRow: ["M4 8h16v8H4z", "m9.5 10 5 4", "m14.5 10-5 4"],
	columnLeft: ["M12 4h8v16h-8z", "M3 12h6", "M6 9v6"],
	columnRight: ["M4 4h8v16H4z", "M15 12h6", "M18 9v6"],
	deleteColumn: ["M8 4h8v16H8z", "m10 9.5 4 5", "m14 9.5-4 5"],
	alignLeft: ["M4 6h16", "M4 12h10", "M4 18h13"],
	alignCenter: ["M4 6h16", "M7 12h10", "M5.5 18h13"],
	alignRight: ["M4 6h16", "M10 12h10", "M7 18h13"],
	deleteTable: [FRAME, "m9 9 6 6", "m15 9-6 6"],
	columnNarrow: ["M9 5v14", "M15 5v14", "M2 12h4", "m4 10 2 2-2 2", "M22 12h-4", "m20 10-2 2 2 2"],
	columnWiden: ["M10 5v14", "M14 5v14", "M7 12H2", "m4 10-2 2 2 2", "M17 12h5", "m20 10 2 2-2 2"],
	columnAuto: ["M5 5v14", "M19 5v14", "M8 12h8", "m10 10-2 2 2 2", "m14 10 2 2-2 2"],
	sortAscending: ["M7 5v14", "m4 16 3 3 3-3", "M13 7h3", "M13 12h5", "M13 17h7"],
	sortDescending: ["M7 5v14", "m4 16 3 3 3-3", "M13 7h7", "M13 12h5", "M13 17h3"],
	braces: BRACES,
	bracesAll: [...BRACES, "M10.5 9.5h3", "M10.5 12h3", "M10.5 14.5h3"],
	close: ["m6 6 12 12", "m18 6-12 12"],
	plus: ["M12 5v14", "M5 12h14"],
	attach: [
		"M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5",
	],
} as const satisfies Record<string, readonly string[]>;

const LETTERS = {
	bold: "B",
	italic: "I",
	strikethrough: "S",
	textColor: "A",
} as const;

export type IconName = keyof typeof PATHS | keyof typeof LETTERS;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Decorative: the accessible name comes from the button. */
export function icon(name: IconName): Element {
	if (name in LETTERS) {
		const letter = document.createElement("span");
		letter.className = `icon icon-letter icon-${name}`;
		letter.textContent = LETTERS[name as keyof typeof LETTERS];
		letter.setAttribute("aria-hidden", "true");
		return letter;
	}

	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("class", "icon");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	for (const d of PATHS[name as keyof typeof PATHS]) {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}
