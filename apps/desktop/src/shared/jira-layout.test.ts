import { describe, expect, it } from "vitest";
import {
	DEFAULT_ISSUE_LAYOUT,
	movedField,
	parseIssueLayout,
	withField,
	withoutField,
} from "./jira-layout.js";

describe("issue layout", () => {
	it("reads a stored layout, dropping what is not a field", () => {
		expect(parseIssueLayout(null)).toEqual(DEFAULT_ISSUE_LAYOUT);
		expect(
			parseIssueLayout({
				columns: "1:2",
				fields: ["assignee", "customfield_10", "x y", 3, "assignee"],
			}),
		).toEqual({ columns: "1:2", fields: ["assignee", "customfield_10"] });
		expect(parseIssueLayout({ columns: "4" }).columns).toBe("1");
	});

	it("adds, removes and moves fields", () => {
		const layout = { columns: "2" as const, fields: ["a", "b", "c"] };
		expect(withField(layout, "d").fields).toEqual(["a", "b", "c", "d"]);
		expect(withField(layout, "a")).toBe(layout);
		expect(withoutField(layout, "b").fields).toEqual(["a", "c"]);
		expect(movedField(layout, "c", -1).fields).toEqual(["a", "c", "b"]);
		expect(movedField(layout, "a", -1)).toBe(layout);
	});
});
