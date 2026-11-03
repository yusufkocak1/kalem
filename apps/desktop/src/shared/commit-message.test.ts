import { describe, expect, it } from "vitest";
import { cleanCommitMessage } from "./commit-message.js";

describe("a suggested commit message", () => {
	it("is the message only", () => {
		expect(cleanCommitMessage("```\nAdd Git badges\n\nWhy.\n```")).toBe("Add Git badges\n\nWhy.");
		expect(cleanCommitMessage("Here is a commit message:\n\nFix the tree")).toBe("Fix the tree");
		expect(cleanCommitMessage('"Fix the tree"')).toBe("Fix the tree");
		expect(cleanCommitMessage("  Desktop: fix the tree\n")).toBe("Desktop: fix the tree");
	});
});
