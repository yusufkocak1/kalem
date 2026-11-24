/**
 * A Jira issue's attachments for the assistant: the list it is shown, which
 * one the model means, and whether its bytes can be read as text. Pure: the
 * main process downloads them.
 */

export interface AttachmentEntry {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	/** Bytes; `null` when Jira did not say. */
	readonly size: number | null;
	readonly author: string;
	/** `YYYY-MM-DD`, or "" */
	readonly created: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** The attachments of a raw issue (`fields.attachment`), newest first. */
export function attachmentEntriesOf(raw: unknown): AttachmentEntry[] {
	const list = asRecord(asRecord(raw).fields).attachment;
	if (!Array.isArray(list)) return [];
	const entries = list.flatMap((item): AttachmentEntry[] => {
		const file = asRecord(item);
		const id = String(file.id ?? "");
		const filename = asString(file.filename);
		if (!/^\d+$/.test(id) || filename === "") return [];
		const author = asRecord(file.author);
		return [
			{
				id,
				filename,
				mimeType: asString(file.mimeType),
				size: typeof file.size === "number" && Number.isFinite(file.size) ? file.size : null,
				author: asString(author.displayName) || asString(author.name),
				created: asString(file.created).slice(0, 10),
			},
		];
	});
	// Dates as YYYY-MM-DD: plain ordering is right.
	return entries.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0));
}

/** A size as people read it: 512 B, 12 KB, 3.4 MB. */
export function sizeText(bytes: number | null): string {
	if (bytes === null) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The attachment list for the model. */
export function attachmentListText(key: string, entries: readonly AttachmentEntry[]): string {
	if (entries.length === 0) return `${key} has no attachments.`;
	const lines = entries.map((entry) => {
		const facts = [
			entry.mimeType,
			sizeText(entry.size),
			entry.author,
			entry.created,
			`id ${entry.id}`,
		].filter((part) => part !== "");
		return `- ${entry.filename} (${facts.join(", ")})`;
	});
	return `Attachments of ${key} (${entries.length}):\n${lines.join("\n")}\n\nRead one with jira_get_attachment and its name or id.`;
}

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

/** The attachment the model named (by id, its exact name, or part of it); why not otherwise. */
export function findAttachment(
	entries: readonly AttachmentEntry[],
	named: string,
): AttachmentEntry | string {
	const wanted = fold(named);
	const byId = entries.find((entry) => entry.id === named.trim());
	if (byId !== undefined) return byId;
	const exact = entries.filter((entry) => fold(entry.filename) === wanted);
	if (exact.length >= 1) return exact[0] as AttachmentEntry;
	const partial = entries.filter((entry) => wanted !== "" && fold(entry.filename).includes(wanted));
	if (partial.length === 1) return partial[0] as AttachmentEntry;
	const names = (partial.length > 1 ? partial : entries)
		.map((entry) => `${entry.filename} (id ${entry.id})`)
		.join(", ");
	return partial.length > 1
		? `More than one attachment matches "${named}": ${names}. Call again with its id.`
		: `No attachment named "${named}". The attachments: ${names}.`;
}

export type AttachmentKind = "text" | "word" | "image" | "other";

const TEXT_EXTENSIONS = new Set([
	"txt",
	"text",
	"md",
	"markdown",
	"csv",
	"tsv",
	"json",
	"xml",
	"yaml",
	"yml",
	"log",
	"sql",
	"html",
	"htm",
	"css",
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"py",
	"java",
	"kt",
	"kts",
	"cs",
	"go",
	"rb",
	"php",
	"sh",
	"bash",
	"ps1",
	"bat",
	"properties",
	"ini",
	"conf",
	"cfg",
	"toml",
	"env",
	"feature",
	"gradle",
	"swift",
	"c",
	"h",
	"cpp",
	"hpp",
	"rs",
	"scala",
	"vue",
	"svelte",
	"graphql",
	"gql",
	"proto",
	"diff",
	"patch",
	"har",
	"puml",
	"mmd",
	"svg",
]);

const TEXT_TYPES =
	/^(?:text\/|application\/(?:json|xml|javascript|x-javascript|ecmascript|x-yaml|yaml|x-sh|sql|graphql|x-ndjson|ld\+json|xhtml\+xml)|image\/svg\+xml)|[+/](?:json|xml)$/;

/** How an attachment can be read, from its name and its type. */
export function attachmentKind(filename: string, mimeType: string): AttachmentKind {
	// kalem-locale-ok: extensions and MIME types are ASCII
	const extension = (/\.([^./\\]+)$/.exec(filename)?.[1] ?? "").toLowerCase();
	// kalem-locale-ok: MIME types are ASCII
	const type = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
	if (
		extension === "docx" ||
		type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	)
		return "word";
	if (TEXT_EXTENSIONS.has(extension) || TEXT_TYPES.test(type)) return "text";
	if (type.startsWith("image/")) return "image";
	return "other";
}

/** Whether bytes look like text: no NUL in their first part. */
export function looksLikeText(bytes: Uint8Array): boolean {
	const end = Math.min(bytes.length, 8192);
	for (let i = 0; i < end; i++) if (bytes[i] === 0) return false;
	return true;
}

/** The longest text one read returns; `from` reads further. */
export const MAX_ATTACHMENT_TEXT = 60_000;

/** A part of an attachment's text for the model, with how to read the rest. */
export function attachmentTextPart(
	key: string,
	entry: AttachmentEntry,
	text: string,
	from: number,
): string {
	const start = Math.min(Math.max(0, Math.floor(from)), text.length);
	const part = text.slice(start, start + MAX_ATTACHMENT_TEXT);
	const end = start + part.length;
	const head = `Attachment ${entry.filename} of ${key}${entry.mimeType === "" ? "" : ` (${entry.mimeType})`}`;
	const range =
		start === 0 && end === text.length
			? `${text.length} characters`
			: `characters ${start}–${end} of ${text.length}`;
	const more =
		end < text.length
			? `\n\n[More follows: call jira_get_attachment again with "from": ${end}.]`
			: "";
	return `${head}, ${range}:\n\n${part === "" ? "(empty)" : part}${more}`;
}
