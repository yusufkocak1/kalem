import { describe, expect, it } from "vitest";
import {
	attachmentFor,
	customFieldsOf,
	fieldText,
	fieldValueBody,
	labelsBody,
	mentionMarkup,
	sprintOf,
	statusChangesOf,
} from "./jira-fields.js";

const RAW = {
	names: {
		customfield_1: "Sprint",
		customfield_2: "Takım",
		customfield_3: "Team",
		customfield_4: "Story Origin",
		customfield_5: "Parent Link",
		customfield_6: "Branch",
		customfield_7: "Rank",
		reporter: "Reporter",
		resolution: "Resolution",
		fixVersions: "Fix Version/s",
		summary: "Summary",
	},
	schema: {
		customfield_1: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
		customfield_2: { custom: "com.tempoplugin.tempo-teams:team.customfield" },
	},
	fields: {
		summary: "TK PNR",
		customfield_1: [
			"com.atlassian.greenhopper.service.sprint.Sprint@1[id=26,rapidViewId=5,state=CLOSED,name=Kırmızı Sprint 26,startDate=x]",
			"com.atlassian.greenhopper.service.sprint.Sprint@2[id=27,rapidViewId=5,state=ACTIVE,name=Kırmızı Sprint 27,startDate=x]",
		],
		customfield_2: { id: 12, name: "Quickres Kırmızı" },
		customfield_3: { value: "Kırmızı" },
		customfield_4: { value: "Business Requirement" },
		customfield_5: "FT-30468",
		customfield_6: "None",
		customfield_7: "0|i0abc:",
		reporter: { displayName: "Ao.jiraadmin" },
		resolution: null,
		fixVersions: [],
	},
};

describe("custom fields", () => {
	it("finds the sprint, the Takım field, the parent link and the rest", () => {
		const fields = customFieldsOf(RAW);
		expect(fields.sprint?.fieldId).toBe("customfield_1");
		expect(fields.sprintValue).toEqual({
			id: "27",
			name: "Kırmızı Sprint 27",
			state: "ACTIVE",
			boardId: "5",
		});
		expect(fields.team?.fieldId).toBe("customfield_2");
		expect(fields.teamValue).toEqual({ id: "12", name: "Quickres Kırmızı" });
		expect(fields.parentLink).toEqual({ key: "FT-30468", summary: "" });
		expect(fields.allFields.filter((entry) => !entry.empty).map((e) => [e.name, e.value])).toEqual([
			["Story Origin", "Business Requirement"],
			["Team", "Kırmızı"],
		]);
	});

	it("reads Cloud's sprints and parent links", () => {
		expect(sprintOf([{ id: 3, name: "S3", state: "future", boardId: 9 }])).toEqual({
			id: "3",
			name: "S3",
			state: "future",
			boardId: "9",
		});
		const fields = customFieldsOf({
			fields: { parent: { key: "EP-1", fields: { summary: "Epik" } } },
		});
		expect(fields.parentLink).toEqual({ key: "EP-1", summary: "Epik" });
	});

	it("writes values as text", () => {
		expect(fieldText({ value: "A", child: { value: "B" } })).toBe("A › B");
		expect(fieldText(["x", { name: "y" }])).toBe("x, y");
		expect(fieldText("{summaryBean=...}")).toBe("");
	});
});

describe("field values", () => {
	it("takes the field that has a value when two share a name", () => {
		const fields = customFieldsOf({
			names: {
				customfield_1: "Takım",
				customfield_2: "Takım",
				customfield_3: "Sprint",
				customfield_4: "Sprint",
			},
			schema: {
				customfield_3: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
				customfield_4: { custom: "com.pyxis.greenhopper.jira:gh-sprint" },
			},
			editmeta: {
				fields: { customfield_2: { allowedValues: [{ id: 12, name: "Quickres Kırmızı" }] } },
			},
			fields: {
				customfield_1: null,
				customfield_2: 12,
				customfield_3: [],
				customfield_4: [{ id: 5, name: "S5", state: "active", boardId: 3 }],
			},
		});
		expect(fields.team?.fieldId).toBe("customfield_2");
		expect(fields.teamValue).toEqual({ id: "12", name: "Quickres Kırmızı" });
		expect(fields.sprintValue?.name).toBe("S5");
	});

	it("reads time in status, people, dates and select fields", () => {
		const fields = customFieldsOf(
			{
				names: {
					customfield_1: "Time In Open",
					customfield_2: "Time In Test",
					customfield_3: "Analist",
					customfield_4: "Story Origin",
					customfield_5: "Odd",
					customfield_6: "Running",
				},
				schema: {
					customfield_3: { type: "user" },
					customfield_4: { type: "option", custom: "x:select" },
				},
				editmeta: {
					fields: {
						customfield_4: { allowedValues: [{ id: "1", value: "Business Requirement" }] },
					},
				},
				fields: {
					customfield_1:
						"TimeInStatus(running=false, updateTime=1794560819397, timeInStatus=469176000)",
					customfield_2: "TimeInStatus(running=false, updateTime=1794560819419, timeInStatus=0)",
					customfield_3: { name: "kubra", displayName: "KUBRA DANIS - Quickres Analist Takimi" },
					customfield_4: { id: "1", value: "Business Requirement" },
					customfield_5: "com.example.Thing@1a2b3c",
					customfield_6: "TimeInStatus(running=true, updateTime=1000, timeInStatus=500)",
				},
			},
			3000,
		);
		const byName = new Map(fields.allFields.map((entry) => [entry.name, entry]));
		expect(byName.get("Time In Open")).toMatchObject({
			kind: "duration",
			durationMs: 469176000,
			empty: false,
		});
		expect(byName.get("Time In Test")?.empty).toBe(true);
		expect(byName.get("Running")?.durationMs).toBe(2500);
		expect(byName.get("Analist")).toMatchObject({
			kind: "person",
			value: "KUBRA DANIS - Quickres Analist Takimi",
		});
		expect(byName.get("Story Origin")).toMatchObject({
			field: { fieldId: "customfield_4" },
			option: { id: "1", name: "Business Requirement" },
		});
		expect(byName.get("Odd")?.empty).toBe(true);
	});
});

describe("saving", () => {
	it("builds the bodies Jira takes", () => {
		const team = { fieldId: "customfield_2", name: "Takım", custom: "x:tempo-teams:team" };
		expect(fieldValueBody(team, { id: "12", name: "Q" })).toBe("12");
		expect(
			fieldValueBody(
				{ fieldId: "customfield_9", name: "T", custom: "x:select" },
				{ id: "4", name: "" },
			),
		).toEqual({ id: "4" });
		expect(fieldValueBody(team, null)).toBeNull();
		expect(labelsBody(["a"], ["b"])).toEqual({
			update: { labels: [{ add: "a" }, { remove: "b" }] },
		});
		expect(mentionMarkup({ id: "isil.sen", name: "" }, false)).toBe("[~isil.sen]");
		expect(mentionMarkup({ id: "5b1", name: "" }, true)).toBe("[~accountid:5b1]");
	});
});

describe("history and attachments", () => {
	it("reads status changes, oldest first", () => {
		expect(
			statusChangesOf({
				changelog: {
					histories: [
						{
							created: "2026-10-03T09:00:00Z",
							items: [{ field: "status", fromString: "B", toString: "C" }],
						},
						{
							created: "2026-10-01T09:00:00Z",
							items: [{ field: "labels" }, { field: "status", fromString: "A", toString: "B" }],
						},
					],
				},
			}),
		).toEqual([
			{ at: "2026-10-01T09:00:00Z", from: "A", to: "B" },
			{ at: "2026-10-03T09:00:00Z", from: "B", to: "C" },
		]);
	});

	it("finds an image's attachment by its address or its name", () => {
		const files = [
			{ id: "7", filename: "pastedImage_1.png", mimeType: "image/png", url: "" },
			{ id: "8", filename: "a b.png", mimeType: "image/png", url: "" },
		];
		expect(attachmentFor("/secure/attachment/8/a%20b.png", files)?.id).toBe("8");
		expect(attachmentFor("pastedImage_1.png", files)?.id).toBe("7");
		expect(attachmentFor("https://jira/secure/attachment/99/x.png", files)).toMatchObject({
			id: "99",
			filename: "x.png",
		});
		expect(attachmentFor("other.png", files)).toBeNull();
	});
});
