export type ColumnLayout = "1" | "2" | "3" | "1:2" | "2:1";

export const COLUMN_LAYOUTS: readonly ColumnLayout[] = ["1", "2", "3", "1:2", "2:1"];

export interface IssueLayout {
	readonly columns: ColumnLayout;
	readonly fields: readonly string[];
}

export const BUILTIN_FIELDS = [
	"assignee",
	"sprint",
	"team",
	"labels",
	"time",
	"reporter",
	"priority",
	"resolution",
	"components",
	"fixVersions",
	"due",
] as const;

export const DEFAULT_ISSUE_LAYOUT: IssueLayout = {
	columns: "1",
	fields: ["assignee", "sprint", "team", "labels", "time"],
};

const MAX_FIELDS = 40;
const FIELD_KEY = /^(?:[a-zA-Z]+|customfield_\d+)$/;

export function parseIssueLayout(value: unknown): IssueLayout {
	if (typeof value !== "object" || value === null) return DEFAULT_ISSUE_LAYOUT;
	const { columns, fields } = value as Record<string, unknown>;
	const layout = COLUMN_LAYOUTS.includes(columns as ColumnLayout)
		? (columns as ColumnLayout)
		: DEFAULT_ISSUE_LAYOUT.columns;
	if (!Array.isArray(fields)) return { columns: layout, fields: DEFAULT_ISSUE_LAYOUT.fields };
	const keys = [
		...new Set(
			fields.filter((key): key is string => typeof key === "string" && FIELD_KEY.test(key)),
		),
	];
	return { columns: layout, fields: keys.slice(0, MAX_FIELDS) };
}

export function withField(layout: IssueLayout, key: string): IssueLayout {
	if (layout.fields.includes(key)) return layout;
	return { ...layout, fields: [...layout.fields, key] };
}

export function withoutField(layout: IssueLayout, key: string): IssueLayout {
	return { ...layout, fields: layout.fields.filter((field) => field !== key) };
}

export function movedField(layout: IssueLayout, key: string, by: number): IssueLayout {
	const fields = [...layout.fields];
	const from = fields.indexOf(key);
	const to = from + by;
	if (from < 0 || to < 0 || to >= fields.length) return layout;
	fields.splice(from, 1);
	fields.splice(to, 0, key);
	return { ...layout, fields };
}
