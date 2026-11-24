/**
 * The assistant's Confluence look-ups beyond a page's text: its attachments
 * (text, Word documents and pictures it sees), its versions and what each
 * changed, and the people of the site. They only read.
 */
import type { ConfluenceAttachment } from "../shared/bridge.js";
import { attachmentTextPart, sizeText } from "../shared/jira-attachment-text.js";
import { diffText } from "../shared/text-diff.js";
import { readingMarkdown } from "./assistant-confluence.js";
import { pageIdOf } from "./assistant-confluence-tools.js";
import type { KalemTool, ToolContext } from "./assistant-tools.js";
import { registerTools } from "./assistant-tools.js";
import { attachmentContent, downloadBytes, MAX_ATTACHMENT_BYTES } from "./attachment-reading.js";
import type { ConfluenceClient, ConfluenceVersion } from "./confluence-client.js";

const text = (input: Record<string, unknown>, key: string): string =>
	typeof input[key] === "string" ? (input[key] as string).trim() : "";

const fold = (value: string): string => value.trim().toLocaleLowerCase("tr");

const clientOf = (ctx: ToolContext): ConfluenceClient => ctx.confluenceClient as ConfluenceClient;

const connected = (ctx: ToolContext): boolean => ctx.confluenceClient !== null;

const NO_PAGE = "Give a page id (or the page's address).";

/** The longest diff a call returns. */
const MAX_DIFF = 60_000;

/** A page's attachments for the model. */
export function confluenceAttachmentsText(
	pageId: string,
	files: readonly ConfluenceAttachment[],
): string {
	if (files.length === 0) return `Page ${pageId} has no attachments.`;
	const lines = files.map((file) => {
		const facts = [
			file.mediaType,
			sizeText(file.size),
			file.author,
			file.modified === null ? "" : new Date(file.modified).toISOString().slice(0, 10),
			`id ${file.id}`,
		].filter((part) => part !== "");
		return `- ${file.name} (${facts.join(", ")})`;
	});
	return `Attachments of page ${pageId} (${files.length}):\n${lines.join("\n")}\n\nRead one with confluence_get_attachment and its name.`;
}

/** The attachment the model named (id, exact name, or part of it); why not otherwise. */
export function findConfluenceAttachment(
	files: readonly ConfluenceAttachment[],
	named: string,
): ConfluenceAttachment | string {
	const wanted = fold(named);
	const found =
		files.find((file) => file.id === named.trim()) ??
		files.find((file) => fold(file.name) === wanted);
	if (found !== undefined) return found;
	const partial = files.filter((file) => wanted !== "" && fold(file.name).includes(wanted));
	if (partial.length === 1) return partial[0] as ConfluenceAttachment;
	const names = (partial.length > 1 ? partial : files).map((file) => file.name).join(", ");
	return partial.length > 1
		? `More than one attachment matches "${named}": ${names}. Call again with its full name.`
		: `No attachment named "${named}". The attachments: ${names || "none"}.`;
}

/** A page's versions for the model. */
export function versionsText(pageId: string, versions: readonly ConfluenceVersion[]): string {
	if (versions.length === 0) return `No versions of page ${pageId} could be read.`;
	const lines = versions.map(
		(version) =>
			`- Version ${version.number}: ${[version.by, version.when?.slice(0, 16).replace("T", " ") ?? ""].filter((part) => part !== "").join(", ")}${version.minor ? " (minor)" : ""}${version.message.trim() === "" ? "" : ` — "${version.message.trim()}"`}`,
	);
	return `Versions of page ${pageId}, newest first:\n${lines.join("\n")}\n\nWhat a version changed: confluence_page_history with its "version".`;
}

/** What changed between two versions' texts, as `git diff` shows it. */
export function changesText(
	pageId: string,
	from: number,
	to: number,
	before: string,
	after: string,
): string {
	const diff = diffText(before, after, 2);
	const head = `Changes to page ${pageId} from version ${from} to ${to}: ${diff.added} lines added, ${diff.removed} removed.`;
	if (diff.hunks.length === 0)
		return `${head}\nThe text did not change (only formatting, macros or attachments may have).`;
	const parts: string[] = [];
	let length = 0;
	for (const hunk of diff.hunks) {
		const block = [
			`@@ ${hunk.heading === "" ? "" : `${hunk.heading} `}@@`,
			...hunk.rows.map((row) => `${row.kind}${row.text}`),
		].join("\n");
		if (length + block.length > MAX_DIFF) {
			parts.push(`[${diff.hunks.length - parts.length} more changes left out.]`);
			break;
		}
		parts.push(block);
		length += block.length + 1;
	}
	return `${head}\n\n${parts.join("\n")}`;
}

const TOOLS: readonly KalemTool[] = [
	{
		definition: {
			name: "confluence_get_attachment",
			description:
				"Reads a Confluence page's attachments. With only `page_id` it lists them (name, type, size, who, when). With `name` it reads that file: text files (txt, md, csv, json, xml, yaml, log, sql, code…) and Word documents (.docx) as text, long ones in parts continued with `from`; pictures (screenshots, diagrams; a draw.io or Gliffy diagram's picture is its name with .png) are shown to you. PDFs and other binary files cannot be read: it says so.",
			parameters: {
				type: "object",
				properties: {
					page_id: { type: "string", description: "The page id (or its address)." },
					name: {
						type: "string",
						description: "The attachment's file name; leave out to list them.",
					},
					from: {
						type: "number",
						description: "The character to start reading at, for a long file's next part.",
					},
				},
				required: ["page_id"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const id = pageIdOf(input);
			if (id === null) return NO_PAGE;
			ctx.readExternal = true;
			const confluence = clientOf(ctx);
			const files = await confluence.attachments(id);
			const named = text(input, "name");
			if (named === "") {
				ctx.step({ tool: "confluence_get_attachment", detail: id });
				return confluenceAttachmentsText(id, files);
			}
			const file = findConfluenceAttachment(files, named);
			if (typeof file === "string") return file;
			ctx.step({ tool: "confluence_get_attachment", detail: file.name });
			const about = `${file.name} (${[file.mediaType, sizeText(file.size)].filter((part) => part !== "").join(", ")})`;
			if (file.size !== null && file.size > MAX_ATTACHMENT_BYTES) {
				return `${about} is too large to read here.`;
			}
			const response = await confluence.attachment(id, file.name);
			if (response === null) return `${file.name} could not be downloaded.`;
			const bytes = await downloadBytes(response, file.name, sizeText);
			if (typeof bytes === "string") return bytes;
			const content = await attachmentContent(bytes, file.name, file.mediaType, about);
			if (content.kind === "none") return content.why;
			if (content.kind === "image") {
				return { text: `Attachment ${about} of page ${id}:`, images: [content.image] };
			}
			const from = typeof input.from === "number" && Number.isFinite(input.from) ? input.from : 0;
			return attachmentTextPart(
				`page ${id}`,
				{ filename: file.name, mimeType: file.mediaType },
				content.text,
				from,
				"confluence_get_attachment",
			);
		},
	},
	{
		definition: {
			name: "confluence_page_history",
			description:
				"A Confluence page's history. Without `version` it lists the versions (number, who, when, the note). With `version` it shows what that version changed, as a diff of the page's text from the version before (or from `compare_to`).",
			parameters: {
				type: "object",
				properties: {
					page_id: { type: "string", description: "The page id (or its address)." },
					version: { type: "integer", description: "The version whose changes to show." },
					compare_to: {
						type: "integer",
						description: "The older version to compare it with; the one before by default.",
					},
				},
				required: ["page_id"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const id = pageIdOf(input);
			if (id === null) return NO_PAGE;
			ctx.readExternal = true;
			const confluence = clientOf(ctx);
			const version =
				typeof input.version === "number" && Number.isInteger(input.version) ? input.version : null;
			if (version === null) {
				ctx.step({ tool: "confluence_page_history", detail: id });
				return versionsText(id, await confluence.versions(id));
			}
			const from =
				typeof input.compare_to === "number" && Number.isInteger(input.compare_to)
					? input.compare_to
					: version - 1;
			if (version < 2 && from < 1)
				return `Version ${version} is the page's first: nothing came before it.`;
			if (from < 1 || from === version) return "Give an older version to compare with.";
			const [older, newer] = from < version ? [from, version] : [version, from];
			ctx.step({ tool: "confluence_page_history", detail: `${id} v${older}→v${newer}` });
			const [before, after] = await Promise.all([
				confluence.pageVersion(id, older).then((storage) => readingMarkdown(confluence, storage)),
				confluence.pageVersion(id, newer).then((storage) => readingMarkdown(confluence, storage)),
			]);
			return changesText(id, older, newer, before, after);
		},
	},
	{
		definition: {
			name: "confluence_find_user",
			description:
				"Finds people on Confluence by their name: their full name, user name (Server) or account id (Cloud) and e-mail where it can be seen. Use it to tell who someone a page mentions is, or to name a person in CQL (creator, contributor, mention).",
			parameters: {
				type: "object",
				properties: { query: { type: "string", description: "Words of the person's name." } },
				required: ["query"],
			},
		},
		risk: "read",
		available: connected,
		async run(input, ctx) {
			const query = text(input, "query").slice(0, 100);
			if (query === "") return "Give words of the person's name.";
			ctx.readExternal = true;
			ctx.step({ tool: "confluence_find_user", detail: query });
			const users = await clientOf(ctx).users(query);
			if (users.length === 0) return `Nobody named "${query}" was found.`;
			return `People matching "${query}":\n${users
				.map((user) => {
					const facts = [
						user.username === undefined ? "" : `user name ${user.username}`,
						user.accountId === undefined ? "" : `account id ${user.accountId}`,
						user.key === undefined || user.username !== undefined ? "" : `key ${user.key}`,
						user.detail ?? "",
					].filter((part) => part !== "");
					return `- ${user.name}${facts.length === 0 ? "" : ` (${facts.join(", ")})`}`;
				})
				.join("\n")}`;
		},
	},
];

registerTools(TOOLS);
