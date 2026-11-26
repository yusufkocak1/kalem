import { describe, expect, it } from "vitest";
import { claudeUsageOf, copilotQuotaOf, copilotUserUsageOf, openRouterUsageOf } from "./usage.js";

describe("plan usage", () => {
	it("reads Claude Code's windows, per-model ones and extra usage", () => {
		const usage = claudeUsageOf({
			session: { total_cost_usd: 0.42 },
			subscription_type: "max",
			rate_limits_available: true,
			rate_limits: {
				five_hour: { utilization: 37.5, resets_at: "2026-11-26T12:00:00Z" },
				seven_day: { utilization: 112, resets_at: "2026-11-30T00:00:00Z" },
				seven_day_opus: null,
				model_scoped: [{ display_name: "Fable", utilization: 8, resets_at: null }],
				extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 5, utilization: null },
			},
		});
		expect(usage).toEqual({
			plan: "max",
			meters: [
				{ kind: "session", percent: 37.5, resetsAt: "2026-11-26T12:00:00Z" },
				{ kind: "week", percent: 100, resetsAt: "2026-11-30T00:00:00Z" },
				{ kind: "weekModel", name: "Fable", percent: 8, resetsAt: null },
				{ kind: "extra", percent: 10, resetsAt: null },
			],
		});
	});

	it("has none for Claude Code with an API key", () => {
		expect(
			claudeUsageOf({ subscription_type: null, rate_limits_available: false, rate_limits: null }),
		).toBeNull();
	});

	it("reads the Copilot CLI's quota, premium requests first", () => {
		expect(
			copilotQuotaOf({
				quotaSnapshots: {
					chat: {
						isUnlimitedEntitlement: true,
						entitlementRequests: -1,
						usedRequests: 3,
						remainingPercentage: 100,
					},
					premium_interactions: {
						isUnlimitedEntitlement: false,
						entitlementRequests: 300,
						usedRequests: 75,
						remainingPercentage: 75,
						resetDate: "2026-12-01T00:00:00Z",
					},
				},
			}),
		).toEqual({
			plan: null,
			meters: [
				{
					kind: "premium",
					percent: 25,
					used: 75,
					limit: 300,
					unit: "requests",
					resetsAt: "2026-12-01T00:00:00Z",
				},
				{ kind: "chat", percent: null, unit: "requests", unlimited: true, resetsAt: null },
			],
		});
		expect(copilotQuotaOf({ quotaSnapshots: {} })).toBeNull();
	});

	it("reads GitHub's Copilot user record", () => {
		expect(
			copilotUserUsageOf({
				copilot_plan: "individual_pro",
				quota_reset_date: "2026-12-01",
				quota_snapshots: {
					premium_interactions: {
						entitlement: 1500,
						remaining: 1200,
						percent_remaining: 80,
						unlimited: false,
					},
				},
			}),
		).toEqual({
			plan: "individual_pro",
			meters: [
				{
					kind: "premium",
					percent: 20,
					used: 300,
					limit: 1500,
					unit: "requests",
					resetsAt: "2026-12-01",
				},
			],
		});
	});

	it("reads OpenRouter's credits, with and without a limit", () => {
		expect(openRouterUsageOf({ data: { usage: 2.5, limit: 10 } })?.meters[0]?.percent).toBe(25);
		expect(openRouterUsageOf({ data: { usage: 2.5, limit: null } })?.meters[0]).toEqual({
			kind: "credits",
			percent: null,
			used: 2.5,
			unit: "usd",
			unlimited: true,
			resetsAt: null,
		});
		expect(openRouterUsageOf({})).toBeNull();
	});
});
