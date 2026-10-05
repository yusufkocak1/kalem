export type CaseChange = "upper" | "lower" | "title" | "sentence" | "toggle";

/** Upper- or lower-cases the first letter of `text`, leaving the rest. */
function firstLetter(text: string, lang: string): string {
	const index = text.search(/\p{L}/u);
	if (index === -1) return text;
	const letter = String.fromCodePoint(text.codePointAt(index) as number);
	return text.slice(0, index) + letter.toLocaleUpperCase(lang) + text.slice(index + letter.length);
}

/** Every word starts with a capital, the rest is lower case. */
function titleCase(text: string, lang: string): string {
	let out = "";
	for (const { segment, isWordLike } of new Intl.Segmenter(lang, { granularity: "word" }).segment(
		text,
	)) {
		out += isWordLike === true ? firstLetter(segment.toLocaleLowerCase(lang), lang) : segment;
	}
	return out;
}

/** Lower case with a capital at the start of each sentence. */
function sentenceCase(text: string, lang: string): string {
	let out = "";
	for (const { segment } of new Intl.Segmenter(lang, { granularity: "sentence" }).segment(text)) {
		out += firstLetter(segment.toLocaleLowerCase(lang), lang);
	}
	return out;
}

function toggleCase(text: string, lang: string): string {
	let out = "";
	for (const char of text) {
		const upper = char.toLocaleUpperCase(lang);
		out += char === upper ? char.toLocaleLowerCase(lang) : upper;
	}
	return out;
}

/** Case changes with the language's rules: in Turkish `i` ↔ `İ` and `ı` ↔ `I`. */
export function changeCase(text: string, change: CaseChange, lang: string): string {
	switch (change) {
		case "upper":
			return text.toLocaleUpperCase(lang);
		case "lower":
			return text.toLocaleLowerCase(lang);
		case "title":
			return titleCase(text, lang);
		case "sentence":
			return sentenceCase(text, lang);
		case "toggle":
			return toggleCase(text, lang);
	}
}

/** Shift+F3, as in Word: lower case → UPPER CASE → Title Case → lower case. */
export function nextCase(text: string, lang: string): CaseChange {
	if (text === text.toLocaleLowerCase(lang)) return "upper";
	if (text === text.toLocaleUpperCase(lang)) return "title";
	return "lower";
}

/** Runs of spaces and tabs become one space; spaces at the ends of lines go. */
export function collapseSpaces(text: string): string {
	return text.replace(/[ \t ]{2,}/g, " ").replace(/[ \t]+$/gm, "");
}
