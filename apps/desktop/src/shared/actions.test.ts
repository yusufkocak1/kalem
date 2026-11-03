import { describe, expect, it } from "vitest";
import { ACTIONS_PROMPT, actionsFromReply, applyActions, isAssistantCommand } from "./actions.js";
import { SYSTEM_PROMPT, splitReply } from "./claude.js";

describe("actionsFromReply", () => {
	it("reads an array of actions", () => {
		expect(
			actionsFromReply(
				JSON.stringify([
					{ type: "replace", find: "eski", replace: "yeni" },
					{ type: "replace", find: "a", replace: "b", all: true },
					{ type: "insert", at: "end", text: "## Son" },
					{ type: "insert", text: "burada" },
					{ type: "document", text: "# Baştan" },
					{ type: "command", command: "export-docx" },
				]),
			),
		).toEqual([
			{ type: "replace", find: "eski", replace: "yeni", all: false },
			{ type: "replace", find: "a", replace: "b", all: true },
			{ type: "insert", at: "end", text: "## Son" },
			{ type: "insert", at: "cursor", text: "burada" },
			{ type: "document", text: "# Baştan" },
			{ type: "command", command: "export-docx" },
		]);
	});

	it("takes an object with actions, or a single action", () => {
		expect(actionsFromReply('{"actions":[{"type":"command","command":"save"}]}')).toEqual([
			{ type: "command", command: "save" },
		]);
		expect(actionsFromReply('{"action":"command","command":"save"}')).toEqual([
			{ type: "command", command: "save" },
		]);
	});

	it("leaves out what it does not know", () => {
		expect(
			actionsFromReply(
				JSON.stringify([
					{ type: "command", command: "close-tab" },
					{ type: "command", command: "rm -rf" },
					{ type: "replace", find: "", replace: "x" },
					{ type: "shell", run: "ls" },
					{ type: "replace", find: "x", replace: "" },
				]),
			),
		).toEqual([{ type: "replace", find: "x", replace: "", all: false }]);
		expect(actionsFromReply("[]")).toBeNull();
		expect(actionsFromReply("not json")).toBeNull();
	});

	it("knows only the commands it may run", () => {
		expect(isAssistantCommand("save")).toBe(true);
		expect(isAssistantCommand("assistant")).toBe(false);
		expect(isAssistantCommand("toString")).toBe(false);
	});
});

describe("applyActions", () => {
	const doc = "# Başlık\n\nBirinci paragraf.\n\nİkinci paragraf.\n";

	it("replaces text that occurs once", () => {
		expect(
			applyActions(doc, [{ type: "replace", find: "Birinci", replace: "İlk", all: false }]),
		).toEqual({
			ok: true,
			text: "# Başlık\n\nİlk paragraf.\n\nİkinci paragraf.\n",
			changes: 1,
		});
	});

	it("refuses text that occurs more than once, unless for all", () => {
		const replace = { type: "replace", find: "paragraf", replace: "bölüm" } as const;
		expect(applyActions(doc, [{ ...replace, all: false }])).toEqual({
			ok: false,
			index: 0,
			reason: "ambiguous",
		});
		expect(applyActions(doc, [{ ...replace, all: true }])).toMatchObject({
			ok: true,
			text: "# Başlık\n\nBirinci bölüm.\n\nİkinci bölüm.\n",
			changes: 2,
		});
	});

	it("says which replacement found nothing", () => {
		expect(
			applyActions(doc, [
				{ type: "replace", find: "Birinci", replace: "İlk", all: false },
				{ type: "replace", find: "Üçüncü", replace: "x", all: false },
			]),
		).toEqual({ ok: false, index: 1, reason: "missing" });
	});

	it("finds text with other line ends or spaces at its ends", () => {
		expect(
			applyActions(doc, [
				{ type: "replace", find: "  Birinci paragraf.\r\n\r\nİkinci", replace: "Tek", all: false },
			]),
		).toMatchObject({ ok: true, text: "# Başlık\n\nTek paragraf.\n" });
	});

	it("keeps dollar signs as written", () => {
		expect(
			applyActions("fiyat X", [{ type: "replace", find: "X", replace: "$& $1 $$", all: false }]),
		).toMatchObject({ text: "fiyat $& $1 $$" });
	});

	it("inserts at the start and the end, and replaces the whole document", () => {
		expect(
			applyActions(doc, [
				{ type: "insert", at: "start", text: "Önsöz\n" },
				{ type: "insert", at: "end", text: "\nSon söz" },
				{ type: "insert", at: "cursor", text: "imleçte" },
			]),
		).toEqual({
			ok: true,
			text: "Önsöz\n\n# Başlık\n\nBirinci paragraf.\n\nİkinci paragraf.\n\nSon söz\n",
			changes: 2,
		});
		expect(applyActions("", [{ type: "insert", at: "end", text: "Yeni" }])).toMatchObject({
			text: "Yeni\n",
		});
		expect(applyActions(doc, [{ type: "document", text: "# Yeni" }])).toMatchObject({
			text: "# Yeni",
		});
	});
});

describe("actions in a reply", () => {
	it("are a part of their own", () => {
		const reply = [
			"Başlığı düzelttim:",
			"",
			"```kalem-actions",
			'[{ "type": "replace", "find": "Baslik", "replace": "Başlık" }]',
			"```",
			"",
			"Tamam.",
		].join("\n");
		const parts = splitReply(reply);
		expect(parts.map((part) => part.kind)).toEqual(["markdown", "actions", "markdown"]);
		expect(parts[1]).toMatchObject({
			kind: "actions",
			actions: [{ type: "replace", find: "Baslik", replace: "Başlık", all: false }],
		});
	});

	it("stay code when they hold no action", () => {
		const parts = splitReply("```kalem-actions\n{ nope\n```");
		expect(parts).toEqual([{ kind: "markdown", text: "```kalem-actions\n{ nope\n```" }]);
	});

	it("are explained to the model", () => {
		expect(SYSTEM_PROMPT).toContain(ACTIONS_PROMPT);
		expect(ACTIONS_PROMPT).toContain('"export-docx" (export the document as a Word file)');
	});
});
