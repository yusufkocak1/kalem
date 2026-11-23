/**
 * Waiting for the user: when the work needs something only the user can do
 * (restart a server, update the classes in their IDE, sign in in a browser
 * window), the answer does not end asking them to type "continue". A card
 * in the chat says what to do, with a button for each way it can go (done,
 * or the model's own words for it; skip; stop) and a box for the user's
 * own words. The answer waits, the CLI with it, and goes on with what the
 * user chose. It is asked every time: no approval setting answers it.
 */
import type { KalemTool } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";

/** At most this many buttons of the model's own; skip and stop come after them. */
const MAX_CHOICES = 3;

const text = (value: unknown, max: number): string =>
	typeof value === "string" ? value.trim().slice(0, max) : "";

const list = (value: unknown, max: number, each: number): string[] =>
	Array.isArray(value)
		? value
				.map((item) => text(item, each))
				.filter((item) => item !== "")
				.slice(0, max)
		: [];

export const WAIT_FOR_USER: KalemTool = {
	definition: {
		name: "wait_for_user",
		description:
			"Waits, in this same answer, while the user does something only they can do outside the chat: restart or redeploy a server, update classes or run something in their IDE, sign in in a browser window, plug a device in, check a screen. Call it instead of ending your answer with 'do X, then type continue'. The chat shows what to do with buttons; it returns when the user has chosen: done (or one of your own choices), skip (go on without it), stop (end here), or their own words. Then go on as that says. Give: title (what to do, in a few words), steps (how, a step each), choices (optional: up to 3 buttons of your own for how it went, the first meaning done; skip and stop are always offered), reason (optional: why you need it). All in the user's language.",
		parameters: {
			type: "object",
			properties: {
				title: { type: "string", description: "What the user is to do, in a few words." },
				steps: {
					type: "array",
					items: { type: "string" },
					description: "How to do it, a step each.",
				},
				choices: {
					type: "array",
					items: { type: "string" },
					description:
						"Up to 3 buttons of your own for how it went, the first meaning it is done (“Classes updated”, “Restarted Tomcat”).",
				},
				reason: { type: "string", description: "Why you need it, in a few words." },
			},
			required: ["title"],
		},
	},
	risk: "ui",
	available: () => true,
	async run(input, ctx) {
		const t = ctx.t;
		const own = list(input.choices, MAX_CHOICES, 80);
		const done = own.length === 0 ? [t.waitDone] : own;
		const reason = text(input.reason, 500);
		const answer = await ctx.approve({
			tool: "wait_for_user",
			risk: "ui",
			permission: "wait:user",
			title: text(input.title, 200) || t.waitTitle,
			lines: list(input.steps, 20, 1000),
			choices: [...done, t.waitSkip, t.waitStop],
			// Only the user can say how it went: nothing answers it for them.
			mustAsk: true,
			...(reason === "" ? {} : { reason }),
		});
		if (!answer.approved) {
			return "The user did not answer: the reply was stopped or the window closed. Do nothing more.";
		}
		if (answer.text !== undefined) {
			return `The user answered in their own words: “${answer.text}”. Go on as that says; if it is unclear whether they did it, ask with wait_for_user again.`;
		}
		const chosen = answer.choice ?? 0;
		if (chosen === done.length) {
			return "The user skipped it: go on without it where you can, and say at the end what that leaves undone.";
		}
		if (chosen > done.length) {
			return "The user wants to stop here: do nothing more. Say briefly what was done and what is left.";
		}
		return own.length === 0
			? "The user says it is done: go on."
			: `The user chose “${done[chosen]}”: go on as that says.`;
	},
};

registerTools([WAIT_FOR_USER]);
