import type { JiraStatusChange } from "./jira-fields.js";

export const DAY_MS = 86_400_000;

export interface JourneyStep {
	readonly kind: "status" | "merge";
	readonly label: string;
	readonly days: number | null;
	readonly current: boolean;
	readonly enteredAt: string;
}

interface Visit {
	readonly status: string;
	readonly start: number;
	readonly end: number;
}

export function statusJourney(
	created: string | null,
	changes: readonly JiraStatusChange[],
	currentStatus: string,
	now: Date,
	mergedAt: string | null = null,
): JourneyStep[] {
	const sorted = [...changes]
		.filter((change) => !Number.isNaN(Date.parse(change.at)))
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const first = sorted[0];
	const createdAt = created === null ? Number.NaN : Date.parse(created);
	let status = first?.from || currentStatus;
	let start = Number.isNaN(createdAt)
		? first === undefined
			? now.getTime()
			: Date.parse(first.at)
		: createdAt;
	const visits: Visit[] = [];
	for (const change of sorted) {
		const at = Date.parse(change.at);
		if (status !== "") visits.push({ status, start, end: Math.max(start, at) });
		status = change.to;
		start = at;
	}
	if (status !== "") visits.push({ status, start, end: Math.max(start, now.getTime()) });

	const steps = new Map<string, { label: string; first: number; total: number }>();
	for (const visit of visits) {
		const step = steps.get(visit.status);
		if (step === undefined) {
			steps.set(visit.status, {
				label: visit.status,
				first: visit.start,
				total: visit.end - visit.start,
			});
		} else {
			step.total += visit.end - visit.start;
		}
	}
	const last = visits.at(-1)?.status ?? currentStatus;
	const result: JourneyStep[] = [...steps.values()]
		.sort((a, b) => a.first - b.first)
		.map((step) => ({
			kind: "status",
			label: step.label,
			days: step.total / DAY_MS,
			current: step.label === last,
			enteredAt: new Date(step.first).toISOString(),
		}));

	const merged = mergedAt === null ? Number.NaN : Date.parse(mergedAt);
	if (!Number.isNaN(merged)) {
		let index = 0;
		while (index < result.length && Date.parse(result[index]?.enteredAt ?? "") <= merged) index++;
		result.splice(index, 0, {
			kind: "merge",
			label: "",
			days: null,
			current: false,
			enteredAt: new Date(merged).toISOString(),
		});
	}
	return result;
}

export function journeyDays(days: number): { whole: number; lessThanOne: boolean } {
	return days < 1
		? { whole: 0, lessThanOne: true }
		: { whole: Math.round(days), lessThanOne: false };
}
