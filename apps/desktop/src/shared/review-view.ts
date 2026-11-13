/**
 * How a review's findings are laid out in the panel: what the filters
 * leave, the open ones before the ones already dealt with, the model's
 * before the rules' of the same severity, and the template's missing
 * sections together as one item. Pure.
 */
import type { Finding, FindingKind, Severity } from "./findings.js";
import { FINDING_KINDS, SEVERITIES } from "./findings.js";

/** What the user narrowed the list to; an empty set lets everything through. */
export interface ReviewFilter {
	readonly severities: ReadonlySet<Severity>;
	readonly kinds: ReadonlySet<FindingKind>;
}

export const NO_FILTER: ReviewFilter = { severities: new Set(), kinds: new Set() };

/** An item of the list: a finding, or the missing sections together. */
export type ReviewItem =
	| { readonly kind: "finding"; readonly finding: Finding }
	| { readonly kind: "sections"; readonly findings: readonly Finding[] };

export interface ReviewLayout {
	/** The open findings by severity, whatever the filter. */
	readonly severities: Readonly<Record<Severity, number>>;
	/** The open findings by kind, the kinds there are only, whatever the filter. */
	readonly kinds: readonly (readonly [FindingKind, number])[];
	/** What is still to deal with. */
	readonly open: readonly ReviewItem[];
	/** What was dealt with: fixed, asked, noted or dismissed. */
	readonly done: readonly ReviewItem[];
	/** How many the filter hides. */
	readonly hidden: number;
}

const ORDER: Readonly<Record<Severity, number>> = { high: 0, medium: 1, low: 2 };

/** Fewer missing sections than this are listed one by one. */
const GROUP_FROM = 2;

const passes = (finding: Finding, filter: ReviewFilter): boolean =>
	(filter.severities.size === 0 || filter.severities.has(finding.severity)) &&
	(filter.kinds.size === 0 || filter.kinds.has(finding.kind));

const severityOf = (item: ReviewItem): Severity =>
	item.kind === "finding"
		? item.finding.severity
		: item.findings.reduce<Severity>(
				(worst, finding) => (ORDER[finding.severity] < ORDER[worst] ? finding.severity : worst),
				"low",
			);

/** The model's findings come before the rules' of the same severity; the sections first among those. */
const rank = (item: ReviewItem): number =>
	item.kind === "sections" ? 1 : item.finding.rule === true ? 2 : 0;

function sorted(items: ReviewItem[]): ReviewItem[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort(
			(a, b) =>
				ORDER[severityOf(a.item)] - ORDER[severityOf(b.item)] ||
				rank(a.item) - rank(b.item) ||
				a.index - b.index,
		)
		.map(({ item }) => item);
}

/**
 * `keep` holds findings dealt with in the open list all the same: the
 * ones the user has opened, so what they just did stays in sight with its
 * undo.
 */
export function reviewLayout(
	findings: readonly Finding[],
	isOpen: (finding: Finding) => boolean,
	filter: ReviewFilter = NO_FILTER,
	keep: (finding: Finding) => boolean = () => false,
): ReviewLayout {
	const stays = (finding: Finding): boolean => isOpen(finding) || keep(finding);
	const open = findings.filter(isOpen);
	const severities = Object.fromEntries(
		SEVERITIES.map((level) => [level, open.filter((finding) => finding.severity === level).length]),
	) as Record<Severity, number>;
	const kinds = FINDING_KINDS.map(
		(kind) => [kind, open.filter((finding) => finding.kind === kind).length] as const,
	).filter(([, count]) => count > 0);
	const shown = findings.filter((finding) => passes(finding, filter));
	const sections = shown.filter(
		(finding) => finding.rule === true && finding.missingSection !== undefined,
	);
	const grouped = sections.length >= GROUP_FROM ? new Set(sections) : new Set<Finding>();
	const openItems: ReviewItem[] = [];
	const doneItems: ReviewItem[] = [];
	let groupPlaced = false;
	for (const finding of shown) {
		if (grouped.has(finding)) {
			if (groupPlaced) continue;
			groupPlaced = true;
			const group: ReviewItem = { kind: "sections", findings: sections };
			(sections.some(stays) ? openItems : doneItems).push(group);
			continue;
		}
		(stays(finding) ? openItems : doneItems).push({ kind: "finding", finding });
	}
	return {
		severities,
		kinds,
		open: sorted(openItems),
		done: sorted(doneItems),
		hidden: findings.length - shown.length,
	};
}

/** A finding's problem in a line: its first sentence, cut short when long. */
export function firstSentence(text: string, max = 140): string {
	const line = text.replace(/\s+/g, " ").trim();
	const end = /[.!?…](?=\s|$)/.exec(line);
	const sentence = end === null ? line : line.slice(0, end.index + 1);
	return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}
