import { describe, expect, it } from "vitest";
import { journeyDays, statusJourney } from "./jira-journey.js";

const changes = [
	{ at: "2026-10-01T09:00:00Z", from: "Analiz", to: "Onay" },
	{ at: "2026-10-03T09:00:00Z", from: "Onay", to: "Geliştirme" },
	{ at: "2026-10-10T09:00:00Z", from: "Geliştirme", to: "Analiz" },
	{ at: "2026-10-11T09:00:00Z", from: "Analiz", to: "Geliştirme" },
	{ at: "2026-11-09T09:00:00Z", from: "Geliştirme", to: "Ready to Test" },
];

describe("statusJourney", () => {
	it("counts the days in each status, revisits added to the first", () => {
		const steps = statusJourney(
			"2026-09-28T09:00:00Z",
			changes,
			"Ready to Test",
			new Date("2026-11-13T09:00:00Z"),
		);
		expect(steps.map((step) => [step.label, step.days, step.current])).toEqual([
			["Analiz", 4, false],
			["Onay", 2, false],
			["Geliştirme", 36, false],
			["Ready to Test", 4, true],
		]);
	});

	it("puts the merged pull request where it happened", () => {
		const steps = statusJourney(
			"2026-09-28T09:00:00Z",
			changes,
			"Ready to Test",
			new Date("2026-11-13T09:00:00Z"),
			"2026-11-08T12:00:00Z",
		);
		expect(steps.map((step) => step.kind)).toEqual([
			"status",
			"status",
			"status",
			"merge",
			"status",
		]);
	});

	it("shows the current status alone when nothing changed", () => {
		const steps = statusJourney(
			"2026-11-12T21:00:00Z",
			[],
			"Open",
			new Date("2026-11-13T09:00:00Z"),
		);
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ label: "Open", current: true, days: 0.5 });
	});

	it("rounds days, under one day apart", () => {
		expect(journeyDays(0.4)).toEqual({ whole: 0, lessThanOne: true });
		expect(journeyDays(3.6)).toEqual({ whole: 4, lessThanOne: false });
	});
});
