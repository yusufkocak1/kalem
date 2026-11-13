import type { KalemBridge } from "../shared/bridge.js";
import type { Strings } from "../shared/i18n.js";
import { format } from "../shared/i18n.js";
import type { JiraIssue } from "../shared/jira.js";
import { shortDateTime } from "../shared/jira-comments.js";
import type { JourneyStep } from "../shared/jira-journey.js";
import { journeyDays, statusJourney } from "../shared/jira-journey.js";
import { el } from "./dom.js";
import { icon } from "./icons.js";

export interface JourneyBarOptions {
	readonly t: Strings;
	readonly lang: string;
	readonly bridge: KalemBridge;
	readonly issue: JiraIssue;
}

function latestMerge(items: readonly { state: string; when: string | null }[]): string | null {
	const merged = items
		.filter((item) => /^merged$/i.test(item.state) && item.when !== null)
		.map((item) => item.when as string)
		.sort((a, b) => Date.parse(a) - Date.parse(b));
	return merged.at(-1) ?? null;
}

export function createJourneyBar(options: JourneyBarOptions): HTMLElement {
	const { t, issue } = options;
	const list = el("ol", { class: "jira-journey", attrs: { "aria-label": t.jiraJourney } });

	const daysText = (days: number): string => {
		const value = journeyDays(days);
		return value.lessThanOne ? t.jiraJourneyUnderDay : format(t.jiraJourneyDays, value.whole);
	};

	const draw = (steps: readonly JourneyStep[]): void => {
		list.replaceChildren(
			...steps.map((step) => {
				const since = shortDateTime(step.enteredAt, options.lang);
				if (step.kind === "merge") {
					return el("li", {
						class: "jira-journey-step merge",
						attrs: { title: since.full },
						children: [
							icon("branch"),
							el("span", { class: "jira-journey-label", text: t.jiraJourneyMerged }),
						],
					});
				}
				return el("li", {
					class: step.current ? "jira-journey-step current" : "jira-journey-step",
					attrs: {
						title: `${step.label} · ${since.full}`,
						...(step.current ? { "aria-current": "step" } : {}),
					},
					children: [
						el("span", { class: "jira-journey-label", text: step.label }),
						el("span", {
							class: "jira-journey-days",
							text: step.days === null ? "" : daysText(step.days),
						}),
					],
				});
			}),
		);
	};

	const steps = (mergedAt: string | null): JourneyStep[] =>
		statusJourney(issue.created, issue.statusChanges, issue.status, new Date(), mergedAt);

	draw(steps(null));
	if (issue.id !== "") {
		void options.bridge
			.jiraDevelopment(issue.id)
			.then((summary) => {
				if (summary === null || summary.pullRequests.count === 0) return null;
				return options.bridge.jiraDevelopmentDetail(issue.id, "pullRequests");
			})
			.then((items) => {
				const mergedAt = items === null ? null : latestMerge(items);
				if (mergedAt !== null && list.isConnected) draw(steps(mergedAt));
			})
			.catch(() => {});
	}
	return el("div", { class: "jira-journey-wrap", children: [list] });
}
