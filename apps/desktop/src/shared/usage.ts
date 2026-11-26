/**
 * How much of a plan's allowance the account has used, as the services say
 * it: Claude Code's `get_usage` answer, the Copilot CLI's
 * `account.getQuota`, GitHub's Copilot user record, OpenRouter's key. Pure.
 */

export type UsageMeterKind =
	| "session"
	| "week"
	| "weekOpus"
	| "weekSonnet"
	| "weekModel"
	| "extra"
	| "premium"
	| "chat"
	| "completions"
	| "credits";

export interface UsageMeter {
	readonly kind: UsageMeterKind;
	/** A name the service gives the meter (a model's), shown after the kind's own. */
	readonly name?: string;
	/** Percentage used, 0–100; `null` when unlimited or unknown. */
	readonly percent: number | null;
	/** Amounts, when the service counts them: requests or money. */
	readonly used?: number;
	readonly limit?: number;
	readonly unit?: "requests" | "usd";
	readonly unlimited?: boolean;
	/** ISO 8601 time the meter starts again. */
	readonly resetsAt: string | null;
}

export interface ServiceUsage {
	/** The plan, as the service names it (`max`, `individual_pro`). */
	readonly plan: string | null;
	readonly meters: readonly UsageMeter[];
}

type Json = Record<string, unknown>;
const asJson = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const asNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
const asString = (value: unknown): string | null =>
	typeof value === "string" && value !== "" ? value : null;
const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** Claude Code's `get_usage` answer: the plan's windows; `null` when the plan has none (an API key). */
export function claudeUsageOf(response: unknown): ServiceUsage | null {
	const data = asJson(response);
	const limits = asJson(data.rate_limits);
	const meters: UsageMeter[] = [];
	const windows: readonly [string, UsageMeterKind][] = [
		["five_hour", "session"],
		["seven_day", "week"],
		["seven_day_opus", "weekOpus"],
		["seven_day_sonnet", "weekSonnet"],
	];
	for (const [key, kind] of windows) {
		const window = limits[key];
		if (window === null || window === undefined) continue;
		const used = asNumber(asJson(window).utilization);
		if (used === null) continue;
		meters.push({ kind, percent: clamp(used), resetsAt: asString(asJson(window).resets_at) });
	}
	for (const item of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
		const window = asJson(item);
		const used = asNumber(window.utilization);
		if (used === null) continue;
		meters.push({
			kind: "weekModel",
			name: asString(window.display_name) ?? "",
			percent: clamp(used),
			resetsAt: asString(window.resets_at),
		});
	}
	const extra = asJson(limits.extra_usage);
	if (extra.is_enabled === true) {
		const used = asNumber(extra.used_credits);
		const limit = asNumber(extra.monthly_limit);
		meters.push({
			kind: "extra",
			percent:
				asNumber(extra.utilization) ??
				(used !== null && limit ? clamp((used / limit) * 100) : null),
			resetsAt: null,
		});
	}
	if (data.rate_limits_available !== true && meters.length === 0) return null;
	return { plan: asString(data.subscription_type), meters };
}

const COPILOT_KINDS: Readonly<Record<string, UsageMeterKind>> = {
	premium_interactions: "premium",
	chat: "chat",
	completions: "completions",
};

function copilotMeter(
	kind: UsageMeterKind,
	snapshot: Json,
	resetsAt: string | null,
	fields: {
		readonly unlimited: string;
		readonly limit: string;
		readonly used?: string;
		readonly remaining?: string;
		readonly percentRemaining: string;
	},
): UsageMeter {
	const unlimited = snapshot[fields.unlimited] === true;
	const limit = asNumber(snapshot[fields.limit]);
	const remaining = fields.remaining === undefined ? null : asNumber(snapshot[fields.remaining]);
	const used =
		fields.used !== undefined
			? asNumber(snapshot[fields.used])
			: limit !== null && remaining !== null
				? Math.max(0, limit - remaining)
				: null;
	const left = asNumber(snapshot[fields.percentRemaining]);
	return {
		kind,
		percent: unlimited ? null : left !== null ? clamp(100 - left) : null,
		...(used === null || unlimited ? {} : { used }),
		...(limit === null || unlimited || limit < 0 ? {} : { limit }),
		unit: "requests",
		...(unlimited ? { unlimited: true } : {}),
		resetsAt: asString(snapshot.resetDate) ?? asString(snapshot.reset_date) ?? resetsAt,
	};
}

/** Orders Copilot's meters: premium requests first. */
const byKind = (a: UsageMeter, b: UsageMeter): number =>
	["premium", "chat", "completions"].indexOf(a.kind) -
	["premium", "chat", "completions"].indexOf(b.kind);

/** The Copilot CLI's `account.getQuota` answer. */
export function copilotQuotaOf(result: unknown): ServiceUsage | null {
	const snapshots = asJson(asJson(result).quotaSnapshots);
	const meters = Object.entries(snapshots).flatMap(([key, raw]) => {
		const kind = COPILOT_KINDS[key];
		if (kind === undefined || raw === null || typeof raw !== "object") return [];
		return [
			copilotMeter(kind, asJson(raw), null, {
				unlimited: "isUnlimitedEntitlement",
				limit: "entitlementRequests",
				used: "usedRequests",
				percentRemaining: "remainingPercentage",
			}),
		];
	});
	return meters.length === 0 ? null : { plan: null, meters: meters.sort(byKind) };
}

/** GitHub's Copilot user record (`copilot_internal/user`), as VS Code reads it. */
export function copilotUserUsageOf(raw: unknown): ServiceUsage | null {
	const data = asJson(raw);
	const snapshots = asJson(data.quota_snapshots);
	const resetsAt = asString(data.quota_reset_date_utc) ?? asString(data.quota_reset_date);
	const meters = Object.entries(snapshots).flatMap(([key, value]) => {
		const kind = COPILOT_KINDS[key];
		if (kind === undefined || value === null || typeof value !== "object") return [];
		return [
			copilotMeter(kind, asJson(value), resetsAt, {
				unlimited: "unlimited",
				limit: "entitlement",
				remaining: "remaining",
				percentRemaining: "percent_remaining",
			}),
		];
	});
	const plan = asString(data.copilot_plan) ?? asString(data.access_type_sku);
	return meters.length === 0 && plan === null ? null : { plan, meters: meters.sort(byKind) };
}

/** OpenRouter's key (`/api/v1/key`): credits spent, against its limit when it has one. */
export function openRouterUsageOf(raw: unknown): ServiceUsage | null {
	const data = asJson(asJson(raw).data);
	const used = asNumber(data.usage);
	if (used === null) return null;
	const limit = asNumber(data.limit);
	return {
		plan: data.is_free_tier === true ? "free" : null,
		meters: [
			{
				kind: "credits",
				percent: limit ? clamp((used / limit) * 100) : null,
				used,
				...(limit === null ? {} : { limit }),
				unit: "usd",
				...(limit === null ? { unlimited: true } : {}),
				resetsAt: null,
			},
		],
	};
}
