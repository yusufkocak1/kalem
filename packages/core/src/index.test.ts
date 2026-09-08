import { describe, expect, it } from "vitest";
import { PACKAGE } from "./index.js";

describe("@kalem/core", () => {
	it("paket kimliğini dışa aktarır", () => {
		expect(PACKAGE).toBe("@kalem/core");
	});
});
