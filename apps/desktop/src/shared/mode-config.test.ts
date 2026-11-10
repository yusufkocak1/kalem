import { describe, expect, it } from "vitest";
import {
	BUILTIN_STEPS,
	modeExcluded,
	modeInstructions,
	newStepId,
	parseModeSettings,
	resolveMode,
	storeMode,
} from "./mode-config.js";
import { detectMode } from "./mode-detect.js";

describe("modes as the user shapes them", () => {
	it("say what they always said when untouched", () => {
		const review = modeInstructions("review");
		expect(review).toContain("## Mode: review an analysis document");
		expect(review).toContain("1. First call analysis_lint");
		expect(review).toContain("report_findings");
		// Ask says nothing of its own; its steps are offered, off.
		expect(modeInstructions("ask")).toBe("");
		expect(modeExcluded("review").has("analysis_lint")).toBe(false);
		expect(modeExcluded("ask").has("report_findings")).toBe(true);
	});

	it("skip the steps turned off, and leave out their tools", () => {
		const settings = parseModeSettings({
			review: {
				steps: [
					{ id: "lint", on: false },
					{ id: "scope", on: false },
				],
			},
		});
		const text = modeInstructions("review", settings);
		expect(text).not.toContain("analysis_lint");
		expect(text).not.toContain("Check the scope");
		expect(text).toContain("1. Read the document part by part");
		expect(modeExcluded("review", settings).has("analysis_lint")).toBe(true);
		expect(modeExcluded("review", settings).has("report_findings")).toBe(false);
	});

	it("take steps reordered, rewritten and added, and the options", () => {
		const settings = parseModeSettings({
			review: {
				steps: [
					{ id: "summary", on: true },
					{
						id: "custom-1",
						on: true,
						custom: true,
						title: "KVKK",
						instruction: "Check KVKK consent texts.",
					},
					{ id: "lint", on: true, instruction: "Run analysis_lint twice." },
				],
				detail: "short",
				language: "tr",
				extra: "Answer with a table.",
				minSeverity: "medium",
				maxFindings: 10,
				keywords: ["bakar mısın", "bakar mısın", ""],
			},
		});
		const resolved = resolveMode("review", settings);
		expect(resolved.steps.slice(0, 3).map((step) => step.id)).toEqual([
			"summary",
			"custom-1",
			"lint",
		]);
		// Kalem's steps not placed keep coming, at the end.
		expect(resolved.steps).toHaveLength(BUILTIN_STEPS.review.length + 1);
		expect(resolved.keywords).toEqual(["bakar mısın"]);
		const text = modeInstructions("review", settings);
		expect(text).toMatch(
			/1\. Then reply with a short summary[\s\S]*2\. Check KVKK consent texts\.[\s\S]*3\. Run analysis_lint twice\./,
		);
		expect(text).toContain("Report only medium- and high-severity problems.");
		expect(text).toContain("Report at most 10 problems");
		expect(text).toContain("Keep the reply short");
		expect(text).toContain("Reply in Turkish.");
		expect(text).toContain("Answer with a table.");
		expect(newStepId(resolved)).toBe("custom-2");
	});

	it("are kept as only what differs from the default", () => {
		expect(storeMode(resolveMode("write"))).toEqual({});
		const changed = resolveMode("write", { write: { detail: "detailed", enabled: false } });
		expect(storeMode(changed)).toEqual({ detail: "detailed", enabled: false });
		const off = resolveMode(
			"write",
			parseModeSettings({ write: { steps: [{ id: "gather", on: false }] } }),
		);
		expect(storeMode(off).steps?.find((step) => step.id === "gather")).toEqual({
			id: "gather",
			on: false,
		});
	});

	it("drop what is not a mode or a step", () => {
		expect(
			parseModeSettings({
				nope: {},
				review: {
					steps: [{ id: "Bad Id" }, { id: "x", custom: true }, "junk"],
					detail: "loud",
					maxFindings: 9999,
				},
			}),
		).toEqual({ review: { steps: [], maxFindings: 200 } });
		expect(parseModeSettings("junk")).toEqual({});
	});
});

describe("the automatic mode", () => {
	const none = { hasDocument: false, hasWorkspace: false };

	it("picks a mode from the question's words", () => {
		expect(
			detectMode("Bu analizi geliştirme öncesi incele", { ...none, hasDocument: true }).mode,
		).toBe("review");
		expect(detectMode("Şablona göre analiz dokümanı yaz", none).mode).toBe("write");
		expect(detectMode("Bunu Claude Code için bir prompt'a çevir", none).mode).toBe("prompt");
		expect(detectMode("UserService.java içindeki bug'ı bul", none).mode).toBe("code");
		expect(detectMode("Koyu moda geç", none).mode).toBe("app");
		expect(detectMode("KVKK nedir?", none)).toEqual({ mode: "ask", because: [] });
	});

	it("follows the user's words, and leaves out modes turned off", () => {
		const settings = parseModeSettings({ review: { keywords: ["bakar mısın"] } });
		expect(detectMode("Şuna bir bakar mısın", none, settings).mode).toBe("review");
		const off = parseModeSettings({ review: { enabled: false } });
		expect(detectMode("Bu analizi incele", none, off).mode).toBe("ask");
	});
});
