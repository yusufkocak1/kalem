/**
 * The automatic mode: which mode a question is for, from its words (in
 * Turkish and English, and the user's own words for each mode) and what
 * it has to work on (an open document, a workspace). A question that asks
 * for several kinds of work is for several modes at once. No model is asked:
 * it is instant, and the reply says which mode it chose. Pure.
 */
import type { CustomMode } from "./custom-modes.js";
import type { Mode, ModeSettings } from "./mode-config.js";
import { MODES, resolveMode } from "./mode-config.js";

/** Words that point to a mode; a longer phrase counts more. */
const WORDS: Readonly<Record<Exclude<Mode, "ask">, readonly string[]>> = {
	review: [
		"incele",
		"inceler misin",
		"gözden geçir",
		"review",
		"review et",
		"denetle",
		"kontrol et",
		"eksik var mı",
		"eksikleri",
		"hata var mı",
		"tutarsız",
		"çelişki",
		"belirsiz",
		"geliştirmeye hazır",
		"hazır mı",
		"değerlendir",
		"audit",
		"check the document",
		"findings",
		"bulgu",
	],
	write: [
		"analiz yaz",
		"analizi yaz",
		"analizini yaz",
		"analiz hazırla",
		"analizi hazırla",
		"analizini hazırla",
		"doküman hazırla",
		"analiz dokümanı",
		"analiz dökümanı",
		"doküman yaz",
		"dokümanı yaz",
		"taslak",
		"bölüm yaz",
		"bölümünü yaz",
		"gereksinim yaz",
		"gereksinimleri yaz",
		"kabul kriter",
		"user story",
		"write the analysis",
		"write a section",
		"draft",
		"requirements document",
		"şablona göre",
	],
	prompt: [
		"prompt",
		"istem",
		"claude code için",
		"copilot için",
		"junie",
		"kodlama ajanı",
		"coding agent",
		"ajana ver",
		"geliştiriciye ver",
	],
	code: [
		"kod",
		"kodu",
		"kodda",
		"kod yaz",
		"kodunu yaz",
		"kodla",
		"write the code",
		"fonksiyon",
		"metot",
		"method",
		"sınıf",
		"class",
		"bug",
		"hata ayıkla",
		"debug",
		"refactor",
		"dosyada",
		"repo",
		"implement",
		"uygula",
		"endpoint",
		"test yaz",
		"unit test",
		"stack trace",
		"exception",
		".ts",
		".java",
		".py",
		".js",
	],
	app: [
		"ayar",
		"ayarlar",
		"ayarını",
		"tema",
		"koyu mod",
		"karanlık mod",
		"panel",
		"paneli",
		"kısayol",
		"yakınlaştır",
		"setting",
		"settings",
		"theme",
		"dark mode",
		"shortcut",
		"zoom",
		"kalem'de",
		"uygulamada",
	],
};

export interface DetectContext {
	/** The open document is shared with the question. */
	readonly hasDocument: boolean;
	/** Folders are added to the chat. */
	readonly hasWorkspace: boolean;
}

export interface Detected {
	/** The mode the question points to most: one of Kalem's, or the id of one of the user's. */
	readonly mode: Mode | string;
	/**
	 * Every mode the question asks for, in the order it asks for them ("write
	 * the analysis, review it, then write its code" is three); `[mode]` when
	 * it is for one.
	 */
	readonly modes: readonly (Mode | string)[];
	/** The words that chose them; empty when nothing pointed anywhere. */
	readonly because: readonly string[];
}

const fold = (text: string): string => text.toLocaleLowerCase("tr");

const LETTER = /\p{L}/u;

/**
 * Where a word starts in the text, or -1. A word that begins with a letter
 * must begin a word of the text ("istem" is not in "sistem"); what follows
 * is free, for Turkish suffixes ("kodunu").
 */
function wordAt(text: string, word: string): number {
	const bound = LETTER.test(word.charAt(0));
	for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
		if (!bound || at === 0 || !LETTER.test(text.charAt(at - 1))) return at;
	}
	return -1;
}

interface Candidate {
	readonly mode: Mode | string;
	readonly found: readonly string[];
	/** What a word counts: a phrase, and the user's own words, say more. */
	readonly weigh: (word: string) => number;
	readonly bonus: number;
}

/** The modes a question is for; "ask" when nothing points elsewhere, or the mode is off. */
export function detectMode(
	question: string,
	context: DetectContext,
	settings: ModeSettings = {},
	custom: readonly CustomMode[] = [],
): Detected {
	const text = ` ${fold(question)} `;
	const candidates: Candidate[] = [];
	for (const mode of MODES) {
		if (mode === "ask") continue;
		const resolved = resolveMode(mode, settings);
		if (!resolved.enabled) continue;
		const words = [...new Set([...WORDS[mode], ...resolved.keywords].map(fold))];
		// What there is to work on makes a mode likelier.
		const bonus =
			((mode === "review" || mode === "write" || mode === "prompt") && context.hasDocument) ||
			(mode === "code" && context.hasWorkspace)
				? 0.5
				: 0;
		candidates.push({
			mode,
			found: words.filter((word) => word !== "" && wordAt(text, word) !== -1),
			// A phrase of several words says more than one word.
			weigh: (word) => (word.includes(" ") ? 2 : 1),
			bonus,
		});
	}
	// The user's own modes: their words, and their name.
	for (const mode of custom) {
		if (!mode.enabled) continue;
		const words = [...new Set([...mode.keywords, mode.name].map(fold))];
		candidates.push({
			mode: mode.id,
			found: words.filter((word) => word !== "" && wordAt(text, word) !== -1),
			// The user's words say more than Kalem's guesses.
			weigh: (word) => (word.includes(" ") ? 3 : 1.5),
			bonus: 0,
		});
	}
	// A word inside another mode's longer phrase is that phrase, not a mode of
	// its own ("kod" in "kodlama ajanı" is a prompt, not code).
	const scored = candidates
		.map((candidate) => {
			const found = candidate.found.filter(
				(word) =>
					!candidates.some(
						(other) =>
							other !== candidate &&
							other.found.some((longer) => longer.length > word.length && longer.includes(word)),
					),
			);
			const score = found.reduce((sum, word) => sum + candidate.weigh(word), 0);
			return {
				mode: candidate.mode,
				found,
				score: score === 0 ? 0 : score + candidate.bonus,
				at: Math.min(...found.map((word) => wordAt(text, word))),
			};
		})
		.filter((each) => each.score > 0);
	if (scored.length === 0) return { mode: "ask", modes: ["ask"], because: [] };
	// The first of equals wins, as the modes are listed.
	const best = scored.reduce((top, each) => (each.score > top.score ? each : top));
	const ordered = [...scored].sort((a, b) => a.at - b.at);
	return {
		mode: best.mode,
		modes: ordered.map((each) => each.mode),
		because: ordered.flatMap((each) => each.found),
	};
}
