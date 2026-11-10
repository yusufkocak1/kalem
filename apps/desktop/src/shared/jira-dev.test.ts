import { describe, expect, it } from "vitest";
import {
	developmentItemsOf,
	developmentSummaryOf,
	hasDevelopment,
	transitionBody,
	transitionsOf,
} from "./jira-dev.js";

const TRANSITIONS = {
	transitions: [
		{
			id: "21",
			name: "Start Test",
			to: { name: "Test", statusCategory: { key: "indeterminate" } },
			fields: {},
		},
		{
			id: "31",
			name: "Resolve",
			to: { name: "Done", statusCategory: { key: "done" } },
			fields: {
				resolution: {
					required: true,
					name: "Resolution",
					allowedValues: [{ name: "Won't Fix" }, { name: "Done" }],
				},
				comment: { required: false, name: "Comment" },
			},
		},
		{
			id: "41",
			name: "Reject",
			to: { name: "Rejected", statusCategory: { key: "done" } },
			fields: {
				customfield_1: { required: true, name: "Reason" },
				assignee: { required: true, name: "Assignee", hasDefaultValue: true },
			},
		},
	],
};

describe("status changes", () => {
	it("read the steps, with a resolution chosen and what only Jira can ask for", () => {
		const steps = transitionsOf(TRANSITIONS);
		expect(steps).toEqual([
			{
				id: "21",
				name: "Start Test",
				to: "Test",
				toCategory: "indeterminate",
				needs: [],
				resolution: null,
			},
			{ id: "31", name: "Resolve", to: "Done", toCategory: "done", needs: [], resolution: "Done" },
			{
				id: "41",
				name: "Reject",
				to: "Rejected",
				toCategory: "done",
				needs: ["Reason"],
				resolution: null,
			},
		]);
		expect(transitionBody(steps[0] as never)).toEqual({ transition: { id: "21" } });
		expect(transitionBody(steps[1] as never)).toEqual({
			transition: { id: "31" },
			fields: { resolution: { name: "Done" } },
		});
		expect(transitionsOf({})).toEqual([]);
	});
});

const SUMMARY = {
	summary: {
		branch: {
			overall: { count: 2, lastUpdated: "2026-11-03T10:00:00.000+0300" },
			byInstanceType: { stash: { count: 2, name: "Bitbucket Server" } },
		},
		repository: {
			overall: { count: 8, lastUpdated: "2026-11-07T10:00:00.000+0300" },
			byInstanceType: { stash: { count: 8 } },
		},
		pullrequest: {
			overall: { count: 4, lastUpdated: "2026-11-07T11:00:00.000+0300", state: "MERGED" },
			byInstanceType: { stash: { count: 4 }, github: { count: 0 } },
		},
		build: { overall: { count: 0 } },
	},
};

describe("development", () => {
	it("counts branches, commits and pull requests, and names the tools that hold them", () => {
		const summary = developmentSummaryOf(SUMMARY);
		expect(summary).toEqual({
			branches: { count: 2, updated: "2026-11-03T10:00:00.000+0300" },
			commits: { count: 8, updated: "2026-11-07T10:00:00.000+0300" },
			pullRequests: { count: 4, updated: "2026-11-07T11:00:00.000+0300", state: "MERGED" },
			builds: { count: 0, updated: null },
			sources: ["stash"],
		});
		expect(hasDevelopment(summary)).toBe(true);
		expect(hasDevelopment(developmentSummaryOf({}))).toBe(false);
	});

	it("lists them newest first", () => {
		const detail = {
			detail: [
				{
					branches: [
						{
							name: "feature/QR-28278-offload",
							url: "https://git.example.com/b/1",
							repository: { name: "quickres-web" },
							lastCommit: {
								authorTimestamp: 1762500000000,
								author: { name: "Yusuf" },
								message: "fix",
							},
						},
					],
					repositories: [
						{
							name: "quickres-web",
							commits: [
								{
									displayId: "a1b2c3d",
									message: "QR-28278 first\n\nbody",
									authorTimestamp: 1762000000000,
									author: { name: "Yusuf" },
									url: "u1",
								},
								{
									id: "ffffffffffffffff",
									message: "QR-28278 second",
									authorTimestamp: 1762900000000,
									author: { name: "Cendel" },
									url: "u2",
								},
							],
						},
					],
					pullRequests: [
						{
							name: "QR-28278 Acente offload",
							url: "https://git.example.com/pr/9",
							status: "MERGED",
							author: { name: "Yusuf" },
							source: { branch: "feature/QR-28278", repository: { name: "quickres-web" } },
							destination: { branch: "develop" },
							lastUpdate: "2026-11-07T11:00:00.000+0300",
						},
					],
				},
			],
		};
		expect(developmentItemsOf(detail, "commits").map((c) => [c.title, c.detail, c.author])).toEqual(
			[
				["fffffffffff", "QR-28278 second", "Cendel"],
				["a1b2c3d", "QR-28278 first", "Yusuf"],
			],
		);
		expect(developmentItemsOf(detail, "branches")[0]).toMatchObject({
			title: "feature/QR-28278-offload",
			repository: "quickres-web",
			url: "https://git.example.com/b/1",
		});
		expect(developmentItemsOf(detail, "pullRequests")[0]).toMatchObject({
			title: "QR-28278 Acente offload",
			detail: "feature/QR-28278 → develop",
			state: "MERGED",
		});
	});
});
