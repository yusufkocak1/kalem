/**
 * The automatic mode: which mode a question is for, from its words (in
 * Turkish and English, and the user's own words for each mode) and what
 * it has to work on (an open document, a workspace). No model is asked:
 * it is instant, and the reply says which mode it chose. Pure.
 */
import type { Mode, ModeSettings } from "./mode-config.js";
import { MODES, resolveMode } from "./mode-config.js";

/** Words that point to a mode; a longer phrase counts more. */
const WORDS: Readonly<Record<Exclude<Mode, "ask">, readonly string[]>> = {
	review: [
		"incele",
		"inceler misin",
		"gözden geçir",
		"review",
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
	readonly mode: Mode;
	/** The words that chose it; empty when nothing pointed anywhere. */
	readonly because: readonly string[];
}

const fold = (text: string): string => text.toLocaleLowerCase("tr");

/** The mode a question is for; "ask" when nothing points elsewhere, or the mode is off. */
export function detectMode(
	question: string,
	context: DetectContext,
	settings: ModeSettings = {},
): Detected {
	const text = ` ${fold(question)} `;
	let best: Detected = { mode: "ask", because: [] };
	let bestScore = 0;
	for (const mode of MODES) {
		if (mode === "ask") continue;
		const resolved = resolveMode(mode, settings);
		if (!resolved.enabled) continue;
		const words = [...WORDS[mode], ...resolved.keywords.map(fold)];
		const found = words.filter((word) => word !== "" && text.includes(fold(word)));
		// A phrase of several words says more than one word.
		let score = found.reduce((sum, word) => sum + (word.includes(" ") ? 2 : 1), 0);
		if (score === 0) continue;
		// What there is to work on makes a mode likelier.
		if ((mode === "review" || mode === "write" || mode === "prompt") && context.hasDocument) {
			score += 0.5;
		}
		if (mode === "code" && context.hasWorkspace) score += 0.5;
		if (score > bestScore) {
			bestScore = score;
			best = { mode, because: found };
		}
	}
	return best;
}
