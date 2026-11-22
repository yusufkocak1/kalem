import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./bridge.js";
import { isPaneShown } from "./panes.js";
import { rolePreset } from "./roles.js";
import { AGENT_SPEC_ID, BUILTIN_ID } from "./templates.js";

const shown = (patch: object, pane: "outline" | "files") =>
	isPaneShown({ ...DEFAULT_SETTINGS, ...patch }, pane, () => true);

describe("rolePreset", () => {
	it("gives a writer a quiet page: simplified ribbon, no line numbers, the headings", () => {
		const patch = rolePreset("writer", DEFAULT_SETTINGS);
		expect(patch).toMatchObject({ role: "writer", ribbonSimple: true, lineNumbers: false });
		expect(shown(patch, "outline")).toBe(true);
		expect(patch).not.toHaveProperty("assistant");
	});

	it("gives an analyst the full ribbon, the assistant and the analysis template", () => {
		const patch = rolePreset("analyst", DEFAULT_SETTINGS);
		expect(patch).toMatchObject({
			role: "analyst",
			ribbonSimple: false,
			assistant: true,
			defaultTemplate: BUILTIN_ID,
		});
		expect(shown(patch, "outline")).toBe(true);
	});

	it("gives a developer line numbers, the files and the coding agent's spec template", () => {
		const patch = rolePreset("developer", DEFAULT_SETTINGS);
		expect(patch).toMatchObject({
			role: "developer",
			lineNumbers: true,
			codeLineNumbers: true,
			defaultTemplate: AGENT_SPEC_ID,
		});
		expect(shown(patch, "files")).toBe(true);
	});
});
