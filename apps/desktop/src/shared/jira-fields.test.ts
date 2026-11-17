import { describe, expect, it } from "vitest";
import {
	attachmentFor,
	customFieldsOf,
	fieldText,
	fieldValueBody,
	jeditorImageOf,
	jiraImageOf,
	labelsBody,
	mentionMarkup,
	objectOptionsOf,
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

	it("reads a sprint whose goal spans lines", () => {
		expect(
			sprintOf([
				"com.atlassian.greenhopper.service.sprint.Sprint@1[id=26,rapidViewId=5,state=CLOSED,name=Kırmızı Sprint 26,goal=1-) a\n\n1.1) b, c\n2-) d,synced=false]",
				"com.atlassian.greenhopper.service.sprint.Sprint@2[id=27,rapidViewId=5,state=ACTIVE,name=Kırmızı Sprint 27,completeDate=<null>,goal=1-) a \n    1.1) b,synced=false,incompleteIssuesDestinationId=<null>]",
			]),
		).toEqual({ id: "27", name: "Kırmızı Sprint 27", state: "ACTIVE", boardId: "5" });
	});

	it("reads an Insight object field as a choice, Takım or any other", () => {
		const custom = "com.riadalabs.jira.plugins.insight:rlabs-customfield-default-object";
		const fields = customFieldsOf({
			names: {
				customfield_1: "Takım",
				customfield_2: "Team",
				customfield_3: "Asset Şirket",
				customfield_4: "Sunucular",
				customfield_5: "Salt Okunur",
			},
			schema: {
				customfield_1: { type: "any", custom },
				customfield_2: { type: "option", custom: "x:select" },
				customfield_3: { type: "any", custom },
				customfield_4: { type: "any", custom },
				customfield_5: { type: "any", custom },
			},
			editmeta: {
				fields: {
					customfield_1: {},
					customfield_2: { allowedValues: [{ id: "512671", value: "Kırmızı" }] },
					customfield_3: {},
					customfield_4: {},
				},
			},
			fields: {
				customfield_1: ["Quickres Kırmızı (TK-285799)"],
				customfield_2: { id: "512671", value: "Kırmızı" },
				customfield_3: null,
				customfield_4: ["web (01) (SRV-1)", "db (SRV-2)"],
				customfield_5: ["Sabit (X-9)"],
			},
		});
		expect(fields.team).toEqual({ fieldId: "customfield_1", name: "Takım", custom });
		expect(fields.teamValue).toEqual({ id: "TK-285799", name: "Quickres Kırmızı" });
		const entry = (name: string) => fields.allFields.find((field) => field.name === name);
		expect(entry("Team")?.option).toEqual({ id: "512671", name: "Kırmızı" });
		// Empty and on the edit screen: a chip to pick from.
		expect(entry("Asset Şirket")?.field?.fieldId).toBe("customfield_3");
		expect(entry("Asset Şirket")?.option).toBeNull();
		// Several objects, or not editable: text.
		expect(entry("Sunucular")?.field).toBeNull();
		expect(entry("Sunucular")?.value).toBe("web (01) (SRV-1), db (SRV-2)");
		expect(entry("Salt Okunur")?.field).toBeNull();
		expect(objectOptionsOf(["web (01) (SRV-1)", { objectKey: "SRV-2", label: "db" }])).toEqual([
			{ id: "SRV-1", name: "web (01)" },
			{ id: "SRV-2", name: "db" },
		]);
		const team = fields.team as NonNullable<typeof fields.team>;
		expect(fieldValueBody(team, { id: "TK-1", name: "x" })).toEqual([{ key: "TK-1" }]);
		expect(fieldValueBody(team, null)).toEqual([]);
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

	it("reads the address JEditor gives a picture pasted into it", () => {
		expect(
			jeditorImageOf(
				"/jira/plugins/servlet/jeditor_file_provider?imgId=ckupload202610242308&fileName=image%201.png",
			),
		).toEqual({
			query: "imgId=ckupload202610242308&fileName=image%201.png",
			id: "ckupload202610242308",
			fileName: "image 1.png",
			origin: null,
		});
		expect(
			jeditorImageOf(
				"https://jira.example.com/plugins/servlet/jeditor_file_provider?imgId=12&amp;fileName=a.png",
			),
		).toMatchObject({ id: "12", fileName: "a.png", origin: "https://jira.example.com" });
		expect(jeditorImageOf("/secure/attachment/8/a.png")).toBeNull();
		expect(jeditorImageOf("javascript:/plugins/servlet/jeditor_file_provider?x=1")).toBeNull();
	});

	it("loads a JEditor picture as the attachment it is, else from the plug-in, with the user's login", () => {
		const files = [
			{ id: "12", filename: "image-1.png", mimeType: "image/png", url: "u12" },
			{ id: "13", filename: "image-2.png", mimeType: "image/png", url: "u13" },
		];
		const site = "https://jira.example.com/jira";
		const servlet = "/jira/plugins/servlet/jeditor_file_provider";
		expect(jiraImageOf(`${servlet}?imgId=12&fileName=image-1.png`, site, files)).toEqual({
			name: "image-1.png",
			file: files[0],
			sources: [
				{ kind: "attachment", file: files[0] },
				{ kind: "jeditor", query: "imgId=12&fileName=image-1.png" },
			],
		});
		// Not an attachment's id: the plug-in first, an attachment of that name after it.
		expect(jiraImageOf(`${servlet}?imgId=ck1&fileName=image-2.png`, site, files)).toEqual({
			name: "image-2.png",
			file: files[1],
			sources: [
				{ kind: "jeditor", query: "imgId=ck1&fileName=image-2.png" },
				{ kind: "attachment", file: files[1] },
			],
		});
		// Its own name, never the servlet's, when nothing else is known of it.
		expect(jiraImageOf(`${servlet}?imgId=ck2&fileName=eksik.png`, site, files)).toMatchObject({
			name: "eksik.png",
			file: null,
			sources: [{ kind: "jeditor", query: "imgId=ck2&fileName=eksik.png" }],
		});
		// Another Jira's picture is only an address: the login is not sent there.
		expect(
			jiraImageOf(
				"https://other.example.com/plugins/servlet/jeditor_file_provider?imgId=1&fileName=x.png",
				site,
				files,
			).sources,
		).toEqual([
			{
				kind: "url",
				url: "https://other.example.com/plugins/servlet/jeditor_file_provider?imgId=1&fileName=x.png",
			},
		]);
		expect(jiraImageOf("/secure/attachment/13/image-2.png", site, files).sources).toEqual([
			{ kind: "attachment", file: files[1] },
		]);
		expect(jiraImageOf("kayip.png", site, files)).toEqual({
			name: "kayip.png",
			file: null,
			sources: [],
		});
	});
});
