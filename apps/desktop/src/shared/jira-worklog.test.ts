import { describe, expect, it } from "vitest";
import {
	formatDuration,
	jiraWorklogRequest,
	missingAttributes,
	parseDuration,
	remainingAfter,
	tempoWorklogBody,
	workAttributesOf,
	worklogsOf,
} from "./jira-worklog.js";

describe("durations", () => {
	it("reads the time as people write it", () => {
		expect(parseDuration("8h")).toBe(8 * 3600);
		expect(parseDuration("1h 30m")).toBe(5400);
		expect(parseDuration("1h30m")).toBe(5400);
		expect(parseDuration("90m")).toBe(5400);
		expect(parseDuration("1,5")).toBe(5400);
		expect(parseDuration("2")).toBe(7200);
		expect(parseDuration("1d")).toBe(8 * 3600);
		expect(parseDuration("2s 15dk")).toBe(2 * 3600 + 900);
		expect(parseDuration("1g")).toBe(8 * 3600);
		expect(parseDuration("")).toBeNull();
		expect(parseDuration("0")).toBeNull();
		expect(parseDuration("iki saat")).toBeNull();
		expect(parseDuration("2x")).toBeNull();
	});

	it("writes it as Jira does", () => {
		expect(formatDuration(8 * 3600)).toBe("8h");
		expect(formatDuration(5400)).toBe("1h 30m");
		expect(formatDuration(2700)).toBe("45m");
		expect(formatDuration(0)).toBe("0h");
	});

	it("counts the estimate down, never below zero", () => {
		expect(remainingAfter(10 * 3600, 3 * 3600)).toBe(7 * 3600);
		expect(remainingAfter(3600, 8 * 3600)).toBe(0);
		expect(remainingAfter(null, 3600)).toBeNull();
	});
});

const TEMPO_ATTRIBUTES = [
	{
		id: 1,
		key: "_FaturalandirilacakSirket_",
		name: "Faturalandırılacak Şirket",
		type: { value: "STATIC_LIST" },
		required: false,
		staticListValues: [
			{ id: 2, name: "THY Teknik", value: "THYT", sequence: 2 },
			{ id: 1, name: "TKAO - Türk Hava Yolları A.O.", value: "TKAO", sequence: 1 },
			{ id: 3, name: "Eski", value: "OLD", removed: true, sequence: 3 },
		],
	},
	{ id: 2, key: "_Servis_", name: "Servis", type: { value: "ACCOUNT" }, required: true },
	{ id: 3, key: "_Not_", name: "Not", type: { value: "INPUT_FIELD" }, required: false },
];
const ACCOUNTS = [
	{ key: "QUICKRES", name: "Satış Kanalı (QuickRes) Uygulaması", status: "OPEN" },
	{ key: "OLD", name: "Kapalı", status: "CLOSED" },
];

describe("Tempo's work attributes", () => {
	it("are read with their choices, in order, without removed ones", () => {
		const attributes = workAttributesOf(TEMPO_ATTRIBUTES, ACCOUNTS);
		expect(attributes.map((a) => [a.key, a.kind, a.required])).toEqual([
			["_FaturalandirilacakSirket_", "list", false],
			["_Servis_", "list", true],
			["_Not_", "text", false],
		]);
		expect(attributes[0]?.options.map((o) => o.value)).toEqual(["TKAO", "THYT"]);
		expect(attributes[1]?.options).toEqual([
			{ value: "QUICKRES", name: "Satış Kanalı (QuickRes) Uygulaması" },
		]);
		expect(missingAttributes(attributes, { _Servis_: " " })).toEqual(["Servis"]);
		expect(missingAttributes(attributes, { _Servis_: "QUICKRES" })).toEqual([]);
	});

	it("go with the log Tempo is sent", () => {
		const attributes = workAttributesOf(TEMPO_ATTRIBUTES, ACCOUNTS);
		const body = tempoWorklogBody(
			"QR-28278",
			"JIRAUSER1",
			{
				date: "2026-11-10",
				seconds: 8 * 3600,
				remainingSeconds: 0,
				comment: "Working on issue QR-28278",
				attributes: { _Servis_: "QUICKRES", _FaturalandirilacakSirket_: "TKAO", _Not_: "" },
				remember: true,
			},
			attributes,
		);
		expect(body).toEqual({
			worker: "JIRAUSER1",
			originTaskId: "QR-28278",
			started: "2026-11-10",
			timeSpentSeconds: 28800,
			billableSeconds: 28800,
			comment: "Working on issue QR-28278",
			includeNonWorkingDays: false,
			remainingEstimate: 0,
			attributes: {
				_FaturalandirilacakSirket_: {
					name: "Faturalandırılacak Şirket",
					workAttributeId: 1,
					value: "TKAO",
				},
				_Servis_: { name: "Servis", workAttributeId: 2, value: "QUICKRES" },
			},
		});
	});
});

describe("Jira's own work log", () => {
	it("starts at nine on the day, in the local zone, and sets or counts down the estimate", () => {
		const entry = {
			date: "2026-11-10",
			seconds: 7200,
			remainingSeconds: null,
			comment: "",
			attributes: {},
			remember: false,
		};
		expect(jiraWorklogRequest(entry, 180)).toEqual({
			query: "adjustEstimate=auto",
			body: { started: "2026-11-10T09:00:00.000+0300", timeSpentSeconds: 7200 },
		});
		expect(jiraWorklogRequest({ ...entry, remainingSeconds: 5400 }, -330).query).toBe(
			"adjustEstimate=new&newEstimate=90m",
		);
		expect(jiraWorklogRequest(entry, -330).body.started).toBe("2026-11-10T09:00:00.000-0530");
	});

	it("lists the user's own logs, newest first", () => {
		const logs = worklogsOf(
			{
				worklogs: [
					{
						author: { key: "JIRAUSER1", displayName: "Yusuf" },
						started: "2026-10-15T09:00:00.000+0300",
						timeSpentSeconds: 21600,
						comment: "a",
					},
					{
						author: { key: "JIRAUSER2", displayName: "Cendel" },
						started: "2026-10-20T09:00:00.000+0300",
						timeSpentSeconds: 3600,
					},
					{
						author: { key: "JIRAUSER1", displayName: "Yusuf" },
						started: "2026-10-16T09:00:00.000+0300",
						timeSpentSeconds: 21600,
					},
				],
			},
			{ key: "JIRAUSER1", name: "" },
		);
		expect(logs.map((log) => log.started.slice(0, 10))).toEqual(["2026-10-16", "2026-10-15"]);
		expect(logs[1]?.comment).toBe("a");
	});
});
