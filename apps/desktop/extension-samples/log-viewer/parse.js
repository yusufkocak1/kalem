/** Log lines into entries: a line with its stack trace, its level, where it matches a search. Pure. */

export const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"];

const WORDS = [
	["fatal", /\b(FATAL|SEVERE|CRITICAL|CRIT|EMERG|ALERT|PANIC)\b/],
	["error", /\b(ERROR|ERR)\b/],
	["warn", /\b(WARN|WARNING)\b/],
	["info", /\b(INFO|NOTICE)\b/],
	["debug", /\b(DEBUG|FINE|CONFIG)\b/],
	["trace", /\b(TRACE|FINER|FINEST|VERBOSE)\b/],
];
const NAMED = /["']?(?:level|severity|lvl|loglevel)["']?\s*[:=]\s*["']?([a-zA-Z]+)/i;
const ALIASES = {
	fatal: "fatal",
	critical: "fatal",
	crit: "fatal",
	severe: "fatal",
	panic: "fatal",
	emergency: "fatal",
	alert: "fatal",
	error: "error",
	err: "error",
	warn: "warn",
	warning: "warn",
	info: "info",
	information: "info",
	notice: "info",
	debug: "debug",
	fine: "debug",
	trace: "trace",
	verbose: "trace",
	finer: "trace",
	finest: "trace",
};

/** The level a line says it is, or null. */
export function levelOf(line) {
	const head = line.slice(0, 160);
	const named = NAMED.exec(head);
	// kalem-locale-ok: log level words are ASCII
	if (named) return ALIASES[named[1].toLowerCase()] ?? null;
	for (const [level, pattern] of WORDS) if (pattern.test(head)) return level;
	return null;
}

const TIMESTAMP =
	/^\[?(\d{4}-\d{2}-\d{2}|\d{2}[-/.]\d{2}[-/.]\d{2,4}|\d{2}:\d{2}:\d{2}|[A-Z][a-z]{2}\s+\d{1,2}[, ]|\d{2}-[A-Z][a-z]{2}-\d{4}|\{)/;
const CONTINUATION =
	/^(\s|at\s|Caused by:|Suppressed:|\.\.\. \d+ (more|common frames omitted)|[\w$]+(\.[\w$]+)+(Exception|Error|Throwable)\b)/;

/** Whether a line belongs to the entry before it (a stack trace's line, an indented part). */
export const continues = (line) => line !== "" && !TIMESTAMP.test(line) && CONTINUATION.test(line);

/**
 * Adds a piece of a log to its entries (`{ line, more, level }`), the first of its lines
 * joining the last entry when it continues it. Returns how many entries are new.
 */
export function appendText(entries, text, maxEntries = Number.POSITIVE_INFINITY) {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	let added = 0;
	for (const line of lines) {
		const last = entries.at(-1);
		if (last && continues(line)) {
			last.more.push(line);
			if (last.level === null) last.level = levelOf(line);
			continue;
		}
		entries.push({ line, more: [], level: levelOf(line) });
		added++;
	}
	const over = entries.length - maxEntries;
	if (over > 0) entries.splice(0, over);
	return added;
}

/** Lines into entries, for the earlier part of a file put before what is there. */
export function parseText(text) {
	const entries = [];
	appendText(entries, text);
	return entries;
}

export function countLevels(entries) {
	const counts = Object.fromEntries([...LEVELS, "none"].map((level) => [level, 0]));
	for (const entry of entries) counts[entry.level ?? "none"]++;
	return counts;
}

/** A search as a global RegExp (`text` taken as it is, or as a pattern), or null when empty. Throws on a bad pattern. */
export function searchPattern(text, { regex = false, caseSensitive = false } = {}) {
	if (text === "") return null;
	const source = regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(source, caseSensitive ? "g" : "gi");
}

export function entryMatches(entry, pattern) {
	if (pattern === null) return true;
	pattern.lastIndex = 0;
	if (pattern.test(entry.line)) return true;
	return entry.more.some((line) => {
		pattern.lastIndex = 0;
		return pattern.test(line);
	});
}

/** A line cut into plain and matched parts: `[{ text, hit }]`. */
export function splitMatches(line, pattern) {
	if (pattern === null) return [{ text: line, hit: false }];
	const parts = [];
	let last = 0;
	pattern.lastIndex = 0;
	for (const match of line.matchAll(pattern)) {
		if (match[0] === "") break;
		if (match.index > last) parts.push({ text: line.slice(last, match.index), hit: false });
		parts.push({ text: match[0], hit: true });
		last = match.index + match[0].length;
	}
	if (last < line.length) parts.push({ text: line.slice(last), hit: false });
	return parts;
}
