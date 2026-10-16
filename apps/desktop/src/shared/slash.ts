/**
 * Slash commands in the assistant's input: `/name argument`. Commands are
 * found by their name or by their label in the interface's language, so
 * `/save` and `/kayd` both find "Kaydet".
 */

export interface SlashEntry {
	/** What is typed after the slash: ASCII, the same in every language. */
	readonly name: string;
	/** What the interface calls it. */
	readonly label: string;
}

export interface SlashQuery {
	/** The typed name, without the slash. */
	readonly name: string;
	/** What follows the name. */
	readonly arg: string;
	/** Whether a space ended the name: the argument is being typed. */
	readonly complete: boolean;
}

/** The command being typed; `null` when the text is not one. */
export function slashQuery(text: string): SlashQuery | null {
	const match = /^\/(\S*)(\s+([\s\S]*))?$/.exec(text.trimStart());
	if (match === null) return null;
	return { name: match[1] ?? "", arg: (match[3] ?? "").trim(), complete: match[2] !== undefined };
}

/** Commands for what was typed after the slash: names starting with it first, then names and labels containing it. */
export function matchSlash<T extends SlashEntry>(
	entries: readonly T[],
	typed: string,
	lang: string,
): T[] {
	const fold = (text: string): string => text.toLocaleLowerCase(lang);
	const query = fold(typed);
	if (query === "") return [...entries];
	const starts = entries.filter((entry) => fold(entry.name).startsWith(query));
	const contains = entries.filter(
		(entry) =>
			!starts.includes(entry) &&
			(fold(entry.name).includes(query) || fold(entry.label).includes(query)),
	);
	return [...starts, ...contains];
}

/** The command with exactly this name. */
export function findSlash<T extends SlashEntry>(
	entries: readonly T[],
	name: string,
	lang: string,
): T | undefined {
	const wanted = name.toLocaleLowerCase(lang);
	return entries.find((entry) => entry.name.toLocaleLowerCase(lang) === wanted);
}
