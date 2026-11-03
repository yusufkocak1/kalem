/** What the assistant is told when it writes a commit message. */
export const COMMIT_MESSAGE_PROMPT = `You write Git commit messages. You get the changes of a commit: the files, their diffs, and the subjects of the last commits of the repository.

Reply with the commit message only: no introduction, no quotes, no code fence. A subject line of at most 72 characters in the imperative ("Add …", "Fix …"), saying what the change does; then, when the change needs it, a blank line and a short body (wrapped at 72 characters) saying why. Follow the language and the style of the recent subjects when there are some (a prefix such as "feat:" or "Desktop:", English or another language).`;

/** A reply as a commit message: without a fence or quotes around it, or a line before it. */
export function cleanCommitMessage(reply: string): string {
	let text = reply.trim();
	const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text);
	if (fenced !== null) text = (fenced[1] ?? "").trim();
	// A first line that only introduces the message ("Here is a commit message:").
	text = text.replace(/^[^\n]*(?:commit message|commit mesaj)[^\n]*:\s*\n+/i, "");
	if (/^(["'`])[\s\S]*\1$/.test(text)) text = text.slice(1, -1).trim();
	return text;
}
