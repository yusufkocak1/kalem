import { describe, expect, it } from "vitest";
import {
	externalPath,
	formatDuration,
	jiraWorklogRequest,
	missingAttributes,
	parseDuration,
	parseJsonOrJsonp,
	quickEntry,
	recentAttributeValues,
	remainingAfter,
	tempoOptionsOf,
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
		const attributes = workAttributesOf(TEMPO_ATTRIBUTES, { _Servis_: tempoOptionsOf(ACCOUNTS) });
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
		const attributes = workAttributesOf(TEMPO_ATTRIBUTES, { _Servis_: tempoOptionsOf(ACCOUNTS) });
		const body = tempoWorklogBody(
			"2680585",
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
			attributes: {
				_FaturalandirilacakSirket_: {
					name: "Faturalandırılacak Şirket",
					workAttributeId: 1,
					value: "TKAO",
				},
				_Servis_: { name: "Servis", workAttributeId: 2, value: "QUICKRES" },
			},
			billableSeconds: null,
			originId: -1,
			worker: "JIRAUSER1",
			comment: "Working on issue QR-28278",
			started: "2026-11-10",
			timeSpentSeconds: 28800,
			originTaskId: "2680585",
			remainingEstimate: 0,
			endDate: null,
			includeNonWorkingDays: false,
		});
		// An empty comment and an estimate left to Jira go as Tempo's dialog sends them.
		const plain = tempoWorklogBody(
			"2680585",
			"JIRAUSER1",
			{
				date: "2026-11-10",
				seconds: 3600,
				remainingSeconds: null,
				comment: " ",
				attributes: {},
				remember: false,
			},
			attributes,
		);
		expect(plain.comment).toBeNull();
		expect(plain.remainingEstimate).toBeNull();
		expect(plain.billableSeconds).toBeNull();
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

describe("quick logs", () => {
	const attributes = workAttributesOf(TEMPO_ATTRIBUTES, { _Servis_: tempoOptionsOf(ACCOUNTS) });
	const context = {
		tempo: true,
		attributes,
		defaults: { _Servis_: "QUICKRES", _FaturalandirilacakSirket_: "GONE" },
		spentSeconds: 0,
		remainingSeconds: 4 * 3600,
		mine: [],
		diagnostics: "",
	};

	it("use the remembered choices, and leave out one no longer offered", () => {
		expect(quickEntry(context, "QR-1", 5 * 3600, "2026-11-10")).toEqual({
			entry: {
				date: "2026-11-10",
				seconds: 5 * 3600,
				remainingSeconds: null,
				comment: "Working on issue QR-1",
				attributes: { _Servis_: "QUICKRES" },
				remember: false,
			},
		});
	});

	it("say what is missing when a required choice was never made", () => {
		expect(quickEntry({ ...context, defaults: {} }, "QR-1", 3600, "2026-11-10")).toEqual({
			missing: ["Servis"],
		});
	});
});

describe("Tempo's choices, whatever their shape", () => {
	it("reads static lists, dynamic drop-downs, accounts and plain texts", () => {
		expect(
			tempoOptionsOf([
				{ value: "TKAO", name: "TKAO - THY" },
				{ value: "X", removed: true },
			]),
		).toEqual([{ value: "TKAO", name: "TKAO - THY" }]);
		expect(tempoOptionsOf({ values: [{ key: "QR", value: "Satış Kanalı (QuickRes)" }] })).toEqual([
			{ value: "QR", name: "Satış Kanalı (QuickRes)" },
		]);
		expect(
			tempoOptionsOf([
				{ account: { key: "ACC1", name: "Hesap", status: "OPEN" } },
				{ key: "OLD", name: "Kapalı", status: "CLOSED" },
			]),
		).toEqual([{ value: "ACC1", name: "Hesap" }]);
		expect(tempoOptionsOf(["A", "A", "B"])).toEqual([
			{ value: "A", name: "A" },
			{ value: "B", name: "B" },
		]);
		expect(tempoOptionsOf(null)).toEqual([]);
	});

	it("makes a dynamic drop-down and an unknown type with choices a list", () => {
		const attributes = workAttributesOf(
			[
				{
					id: 5,
					key: "_Servis_",
					name: "Servis",
					type: { value: "DYNAMIC_DROPDOWN" },
					required: true,
				},
				{ id: 6, key: "_Yeni_", name: "Yeni", type: { value: "SOMETHING_NEW" } },
				{ id: 7, key: "_Bos_", name: "Boş", type: { value: "SOMETHING_NEW" } },
			],
			{ _Servis_: [{ value: "QR", name: "QuickRes" }], _Yeni_: [{ value: "a", name: "a" }] },
		);
		expect(attributes.map((a) => [a.key, a.kind, a.options.length])).toEqual([
			["_Servis_", "list", 1],
			["_Yeni_", "list", 1],
			["_Bos_", "text", 0],
		]);
	});

	it("finds the values used before, latest first", () => {
		expect(
			recentAttributeValues([
				{
					started: "2026-10-15",
					attributes: { _Servis_: { value: "QR" }, _Sirket_: { value: "TKAO" } },
				},
				{ started: "2026-10-20", attributes: { _Servis_: { value: "WEB" } } },
				{ started: "2026-10-16", attributes: { _Servis_: { value: "QR" } } },
			]),
		).toEqual({ _Servis_: ["WEB", "QR"], _Sirket_: ["TKAO"] });
	});
});

describe("an attribute's own address", () => {
	const issue = { issueKey: "QR-28278", issueId: "2749286", projectKey: "QR", projectId: "10400" };

	it("is filled in for the issue, and asked only on this Jira", () => {
		expect(
			externalPath(
				"/rest/tempo-rest/1.0/accounts/json/billingKeyList/{IssueKey}",
				"https://jira.thy.com",
				issue,
			),
		).toBe("/rest/tempo-rest/1.0/accounts/json/billingKeyList/QR-28278");
		expect(
			externalPath(
				"https://jira.thy.com/rest/scriptrunner/latest/custom/serviceList",
				"https://jira.thy.com",
				issue,
			),
		).toBe("/rest/scriptrunner/latest/custom/serviceList");
		expect(externalPath("/x?project={projectId}&id={IssueId}", "https://jira.thy.com", issue)).toBe(
			"/x?project=10400&id=2749286",
		);
		// A Jira under a path: the address is taken below it.
		expect(
			externalPath(
				"https://tools.example.com/jira/rest/a",
				"https://tools.example.com/jira",
				issue,
			),
		).toBe("/rest/a");
		expect(
			externalPath("https://evil.example.com/rest/a", "https://jira.thy.com", issue),
		).toBeNull();
		expect(externalPath("//evil.example.com/rest/a", "https://jira.thy.com", issue)).toBeNull();
	});

	it("gives choices in the shapes Tempo and ScriptRunner answer with", () => {
		expect(
			tempoOptionsOf({ values: [{ key: "TKAO", value: "TKAO - Türk Hava Yolları A.O." }] }),
		).toEqual([{ value: "TKAO", name: "TKAO - Türk Hava Yolları A.O." }]);
		expect(tempoOptionsOf([{ key: "QR", label: "Satış Kanalı (QuickRes) Uygulaması" }])).toEqual([
			{ value: "QR", name: "Satış Kanalı (QuickRes) Uygulaması" },
		]);
	});
});

describe("answers wrapped as JSONP", () => {
	it("are read as their JSON", () => {
		expect(parseJsonOrJsonp('[{"key":"3351"}]')).toEqual([{ key: "3351" }]);
		expect(
			parseJsonOrJsonp('jQuery123_456({"values":[{"key":"3351","value":"QuickRes"}]});'),
		).toEqual({
			values: [{ key: "3351", value: "QuickRes" }],
		});
		expect(parseJsonOrJsonp('null([{"key":"1"}])')).toEqual([{ key: "1" }]);
		expect(parseJsonOrJsonp("/**/cb([])")).toEqual([]);
		expect(parseJsonOrJsonp("  ")).toBeNull();
		expect(() => parseJsonOrJsonp("<html>")).toThrow();
	});
});
