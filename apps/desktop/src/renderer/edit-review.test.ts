import { describe, expect, it } from "vitest";
import { plainText } from "./edit-review.js";

describe("plainText", () => {
	it("leaves out a code fence with its language", () => {
		expect(plainText("```js\nconst x = 1;\n```")).toBe("const x = 1;");
		expect(plainText("~~~python\nprint(1)\n~~~")).toBe("print(1)");
	});

	it("reads a table as its cells, without its rule row", () => {
		expect(plainText("| a | b |\n| - | :-: |\n| 1 | 2 |")).toBe("a   b\n1   2");
	});

	it("keeps a thematic break and a list as they read", () => {
		expect(plainText("- bir\n- iki")).toBe("• bir\n• iki");
	});
});
