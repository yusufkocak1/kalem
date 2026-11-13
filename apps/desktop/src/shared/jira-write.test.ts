import { describe, expect, it } from "vitest";
import {
	clonePlan,
	fieldMetasOf,
	fieldMetasText,
	fieldValue,
	findField,
	issueFieldsText,
	linkBody,
	linkTypesOf,
} from "./jira-write.js";

const SERVICE = {
	required: true,
	name: "Service",
	schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" },
	allowedValues: [
		{ id: "100", value: "Canlı" },
		{ id: "101", value: "Ödeme" },
	],
};

const CREATE_META = {
	values: [
		{
			fieldId: "summary",
			name: "Summary",
			required: true,
			schema: { type: "string", system: "summary" },
		},
		{ fieldId: "project", name: "Project", required: true, schema: { type: "project" } },
		{ fieldId: "issuetype", name: "Issue Type", required: true, schema: { type: "issuetype" } },
		{ fieldId: "customfield_10100", ...SERVICE },
		{
			fieldId: "description",
			name: "Description",
			required: false,
			schema: { type: "string", system: "description" },
		},
		{
			fieldId: "components",
			name: "Component/s",
			required: false,
			schema: { type: "array", items: "component", system: "components" },
			allowedValues: [
				{ id: "1", name: "Frontend" },
				{ id: "2", name: "Backend" },
			],
		},
		{
			fieldId: "assignee",
			name: "Assignee",
			required: false,
			schema: { type: "user", system: "assignee" },
		},
		{
			fieldId: "customfield_10200",
			name: "Area",
			required: false,
			schema: {
				type: "option-with-child",
				custom: "com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect",
			},
			allowedValues: [{ id: "5", value: "Web", children: [{ id: "6", value: "Mobile web" }] }],
		},
		{
			fieldId: "customfield_10300",
			name: "Story Points",
			required: false,
			schema: { type: "number" },
		},
	],
};

describe("fieldMetasOf", () => {
	it("reads the newer createmeta list, editmeta's object and the old createmeta", () => {
		expect(fieldMetasOf(CREATE_META).map((meta) => meta.id)).toContain("customfield_10100");
		const edit = fieldMetasOf({ fields: { customfield_10100: SERVICE } });
		expect(edit[0]).toMatchObject({ id: "customfield_10100", name: "Service", required: true });
		expect(edit[0]?.choices.map((choice) => choice.name)).toEqual(["Canlı", "Ödeme"]);
		const old = fieldMetasOf({
			projects: [{ issuetypes: [{ fields: { customfield_10100: SERVICE } }] }],
		});
		expect(old[0]?.id).toBe("customfield_10100");
	});
});

describe("fieldValue", () => {
	const metas = fieldMetasOf(CREATE_META);
	const field = (name: string) => {
		const meta = findField(metas, name);
		if (meta === null) throw new Error(name);
		return meta;
	};

	it("finds a field by its name, in any case, or its id", () => {
		expect(findField(metas, "service")?.id).toBe("customfield_10100");
		expect(findField(metas, "CUSTOMFIELD_10300")?.name).toBe("Story Points");
		expect(findField(metas, "nothing")).toBeNull();
	});

	it("picks a choice by its name or id", () => {
		expect(fieldValue(field("Service"), "canlı", false)).toEqual({
			ok: true,
			value: { id: "100" },
			shown: "Canlı",
		});
		expect(fieldValue(field("Service"), "101", false)).toMatchObject({ value: { id: "101" } });
		const wrong = fieldValue(field("Service"), "Yok", false);
		expect(wrong.ok).toBe(false);
		expect(!wrong.ok && wrong.error).toContain("Canlı, Ödeme");
	});

	it("turns lists, users, numbers, cascades and Markdown into what Jira takes", () => {
		expect(fieldValue(field("Component/s"), "Frontend, backend", false)).toMatchObject({
			value: [{ id: "1" }, { id: "2" }],
		});
		expect(fieldValue(field("Assignee"), "ayse", false)).toMatchObject({ value: { name: "ayse" } });
		expect(fieldValue(field("Assignee"), "5b10a", true)).toMatchObject({
			value: { accountId: "5b10a" },
		});
		expect(fieldValue(field("Story Points"), "3,5", false)).toMatchObject({ value: 3.5 });
		expect(fieldValue(field("Area"), "Web › Mobile web", false)).toMatchObject({
			value: { id: "5", child: { id: "6" } },
		});
		const wiki = fieldValue(field("Description"), "**bold**", false);
		expect(wiki.ok && String(wiki.value).trim()).toBe("*bold*");
	});

	it("passes Jira's own shape through, and will not empty a required field", () => {
		expect(fieldValue(field("Service"), { id: "100" }, false)).toMatchObject({
			value: { id: "100" },
		});
		expect(fieldValue(field("Service"), null, false).ok).toBe(false);
		expect(fieldValue(field("Story Points"), null, false)).toMatchObject({ value: null });
	});
});

describe("clonePlan", () => {
	const metas = fieldMetasOf(CREATE_META);
	const source = {
		fields: {
			summary: "Canli90 - Frontend",
			project: { key: "QR" },
			issuetype: { id: "10001", name: "Story" },
			customfield_10100: { self: "…", id: "100", value: "Canlı" },
			description: "h1. Notes",
			components: [{ id: "1", name: "Frontend" }],
			assignee: { name: "ayse", displayName: "Ayşe", emailAddress: "a@example.com" },
			customfield_10200: { id: "5", value: "Web", child: { id: "6", value: "Mobile web" } },
			customfield_10300: null,
			status: { name: "Done" },
		},
	};

	it("copies every field the create screen has and the issue holds", () => {
		const plan = clonePlan(source, metas, "Canli91 - Frontend", {}, false);
		expect(plan.fields).toEqual({
			summary: "Canli91 - Frontend",
			customfield_10100: { id: "100" },
			description: "h1. Notes",
			components: [{ id: "1" }],
			assignee: { name: "ayse" },
			customfield_10200: { id: "5", child: { id: "6" } },
		});
		expect(plan.copied).toContain("Service");
		expect(plan.missing).toEqual([]);
	});

	it("lets given fields win, and names required fields nobody has a value for", () => {
		const given = { customfield_10100: { id: "101" } };
		expect(clonePlan(source, metas, "x", given, false).fields.customfield_10100).toEqual({
			id: "101",
		});
		const empty = clonePlan({ fields: {} }, metas, "x", {}, false);
		expect(empty.missing).toEqual(["Service"]);
	});

	it("lists a screen's fields with what is required first", () => {
		const text = fieldMetasText(metas, "Fields");
		expect(text.indexOf("Service")).toBeLessThan(text.indexOf("Story Points"));
		expect(text).toContain("Service [customfield_10100] option, required; choices: Canlı, Ödeme");
	});
});

describe("links", () => {
	const types = linkTypesOf({
		issueLinkTypes: [
			{ id: "1", name: "Blocks", outward: "blocks", inward: "is blocked by" },
			{ id: "2", name: "Cloners", outward: "clones", inward: "is cloned by" },
		],
	});

	it("goes out of the first issue for a type's name or outward words", () => {
		expect(linkBody(types, "blocks", "A-1", "A-2")?.body).toEqual({
			type: { name: "Blocks" },
			inwardIssue: { key: "A-1" },
			outwardIssue: { key: "A-2" },
		});
		expect(linkBody(types, "Cloners", "A-3", "A-1")?.shown).toBe("A-3 clones A-1");
	});

	it("turns around for the inward words", () => {
		expect(linkBody(types, "is blocked by", "A-1", "A-2")?.body).toMatchObject({
			inwardIssue: { key: "A-2" },
			outwardIssue: { key: "A-1" },
		});
		expect(linkBody(types, "relates", "A-1", "A-2")).toBeNull();
	});
});

describe("issueFieldsText", () => {
	it("shows custom fields with their ids, values and choices", () => {
		const text = issueFieldsText({
			fields: { customfield_10100: { id: "100", value: "Canlı" }, customfield_1: null },
			names: { customfield_10100: "Service", customfield_1: "Unused" },
			editmeta: { fields: { customfield_10100: SERVICE } },
		});
		expect(text).toContain(
			"- Service [customfield_10100]: Canlı (option, required; choices: Canlı, Ödeme)",
		);
		expect(text).not.toContain("Unused");
	});
});
