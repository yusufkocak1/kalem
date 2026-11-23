/**
 * What the user writes while the assistant is still answering. It is not a
 * new question that waits for the answer to end: it is added to the one in
 * hand, and the answer takes it in at the next point it can (after a round
 * of tools, or when Claude Code reads it from its input). What comes too
 * late for that is asked as the next question once the answer has ended.
 */

/** A message the user added while an answer ran, by the id the window gave it. */
export interface Steered {
	readonly id: string;
	readonly text: string;
}

/** The longest message that can be added; more is cut. */
export const MAX_STEER_TEXT = 20_000;

/** How the model is told what the user added while it worked; empty when nothing was. */
export function steeringNote(texts: readonly string[]): string {
	const said = texts.map((text) => text.trim()).filter((text) => text !== "");
	if (said.length === 0) return "";
	return [
		"<user-added-while-you-worked>",
		said.length === 1
			? "While you were working, the user added this:"
			: "While you were working, the user added these, in order:",
		"",
		...(said.length === 1 ? said : said.map((text) => `<message>\n${text}\n</message>`)),
		"",
		"Take it into account from here on, in what you do next and in your answer. It adds to the question; it replaces the question only if it says so.",
		"</user-added-while-you-worked>",
	].join("\n");
}

/** A question with what the user added while it was answered, as the model is told. */
export function withSteering(question: string, texts: readonly string[]): string {
	const note = steeringNote(texts);
	return note === "" ? question : `${question}\n\n${note}`;
}
