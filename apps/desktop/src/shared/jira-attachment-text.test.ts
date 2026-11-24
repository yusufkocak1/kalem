import { describe, expect, it } from "vitest";
import {
	attachmentEntriesOf,
	attachmentKind,
	attachmentListText,
	attachmentTextPart,
	findAttachment,
	looksLikeText,
	MAX_ATTACHMENT_TEXT,
} from "./jira-attachment-text.js";

const RAW = {
	fields: {
		attachment: [
			{
				id: "100",
				filename: "log.txt",
				mimeType: "text/plain",
				size: 2048,
				author: { displayName: "Ayşe" },
				created: "2026-01-02T10:00:00.000+0300",
			},
			{
				id: "101",
				filename: "Gereksinimler.docx",
				mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				size: 30000,
				created: "2026-03-01T10:00:00.000+0300",
			},
			{ id: "x", filename: "bad" },
		],
	},
};

describe("attachmentEntriesOf", () => {
	it("reads the attachments newest first and drops broken ones", () => {
		const entries = attachmentEntriesOf(RAW);
		expect(entries.map((entry) => entry.id)).toEqual(["101", "100"]);
		expect(entries[1]).toMatchObject({ author: "Ayşe", created: "2026-01-02", size: 2048 });
		expect(attachmentEntriesOf({})).toEqual([]);
	});

	it("lists them for the model", () => {
		const text = attachmentListText("ABC-1", attachmentEntriesOf(RAW));
		expect(text).toContain("Attachments of ABC-1 (2)");
		expect(text).toContain("- log.txt (text/plain, 2 KB, Ayşe, 2026-01-02, id 100)");
		expect(attachmentListText("ABC-1", [])).toBe("ABC-1 has no attachments.");
	});
});

describe("findAttachment", () => {
	const entries = attachmentEntriesOf(RAW);
	it("finds by id, name or part of the name", () => {
		expect(findAttachment(entries, "100")).toMatchObject({ filename: "log.txt" });
		expect(findAttachment(entries, "LOG.TXT")).toMatchObject({ id: "100" });
		expect(findAttachment(entries, "gereksinim")).toMatchObject({ id: "101" });
	});
	it("says why when none or many match", () => {
		expect(findAttachment(entries, "nope")).toContain('No attachment named "nope"');
		expect(findAttachment(entries, ".")).toContain("More than one attachment");
	});
});

describe("attachmentKind", () => {
	it("tells text, Word, images and the rest apart", () => {
		expect(attachmentKind("a.json", "")).toBe("text");
		expect(attachmentKind("a.bin", "text/csv")).toBe("text");
		expect(attachmentKind("a.feature", "application/octet-stream")).toBe("text");
		expect(attachmentKind("a.docx", "")).toBe("word");
		expect(attachmentKind("a.png", "image/png")).toBe("image");
		expect(attachmentKind("a.svg", "image/svg+xml")).toBe("text");
		expect(attachmentKind("a.pdf", "application/pdf")).toBe("other");
	});
	it("sees NUL bytes as binary", () => {
		expect(looksLikeText(new TextEncoder().encode("merhaba"))).toBe(true);
		expect(looksLikeText(new Uint8Array([1, 0, 2]))).toBe(false);
	});
});

describe("attachmentTextPart", () => {
	const entry = attachmentEntriesOf(RAW)[1]!;
	it("returns a short text whole", () => {
		expect(attachmentTextPart("ABC-1", entry, "hello", 0)).toContain("5 characters:\n\nhello");
	});
	it("returns a long text in parts", () => {
		const long = "a".repeat(MAX_ATTACHMENT_TEXT + 10);
		const first = attachmentTextPart("ABC-1", entry, long, 0);
		expect(first).toContain(`"from": ${MAX_ATTACHMENT_TEXT}`);
		const rest = attachmentTextPart("ABC-1", entry, long, MAX_ATTACHMENT_TEXT);
		expect(rest).toContain(`characters ${MAX_ATTACHMENT_TEXT}–${MAX_ATTACHMENT_TEXT + 10}`);
		expect(rest).not.toContain("More follows");
	});
});
