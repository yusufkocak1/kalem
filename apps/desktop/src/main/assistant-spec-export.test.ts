import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/bridge.js";
import { DEFAULT_SETTINGS } from "../shared/bridge.js";
import { stringsFor } from "../shared/i18n.js";
import { modeExcluded } from "../shared/modes.js";
import { sourceOf } from "../shared/spec-export.js";
import type { ApprovalRequest } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { runTool } = await import("./assistant-tools.js");
await import("./assistant-analysis-tools.js");
type ToolContext = import("./assistant-tools.js").ToolContext;
type Workspace = import("./workspace-tools.js").Workspace;

const ANALYSIS = `# Ödeme İadesi

### FR-01: Tutar doğrulama

Kabul kriterleri: iade tutarı ödemeyi aşamaz.

### FR-02: Kısmi iade

Kabul kriterleri: kalan tutar iade edilebilir.
`;

const SPEC = {
	title: "Ödeme iadesi",
	requirements: "# Requirements\n\n## FR-01\nWHEN … THE SYSTEM SHALL …\n",
	design: "# Design\n\n- src/refund/validate.ts\n",
	tasks:
		"# Tasks\n\n- [ ] T1 (FR-01) Validate — test: over the amount → 422\n- [ ] T2 (FR-02) Partial refund\n",
};

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "kalem-spec-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function context(approved = true, settings: Partial<Settings> = {}) {
	const asked: Omit<ApprovalRequest, "id" | "chatId" | "scopes">[] = [];
	const ctx: ToolContext = {
		chatId: "chat-1",
		sender: {} as WebContents,
		t: stringsFor("en"),
		excluded: modeExcluded("prompt"),
		settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
		changeSettings: () => {},
		changeLanguage: () => {},
		confluence: null,
		jira: null,
		confluenceClient: null,
		jiraClient: null,
		connections: null,
		workspace: { roots: [root] } as unknown as Workspace,
		templates: null,
		document: { tabId: "t1", name: "iade.md", text: ANALYSIS, selection: "" },
		step: () => {},
		emit: () => {},
		approve: async (request) => {
			asked.push(request);
			return { approved, scope: "once" };
		},
		renderer: async () => ({ ok: true, text: "" }),
		readExternal: false,
	};
	return { ctx, asked };
}

describe("spec_export", () => {
	it("writes Spec Kit's three files after the user allows it, each naming its source", async () => {
		const { ctx, asked } = context();
		const result = await runTool("spec_export", SPEC, ctx);
		expect(result.isError).toBe(false);
		expect(result.text).toContain("specs/001-odeme-iadesi");
		expect(result.text).toContain("2 of the document's 2 functional requirements");
		expect(asked).toHaveLength(1);
		expect(asked[0]?.lines).toContain("specs/001-odeme-iadesi/tasks.md");
		const folder = join(root, "specs", "001-odeme-iadesi");
		expect((await readdir(folder)).sort()).toEqual(["plan.md", "spec.md", "tasks.md"]);
		const tasks = await readFile(join(folder, "tasks.md"), "utf8");
		expect(sourceOf(tasks)).toEqual({
			name: "iade.md",
			hash: expect.stringMatching(/^[0-9a-f]{12}$/),
		});
		expect(tasks).toContain("- [ ] T2 (FR-02) Partial refund\n");
	});

	it("writes in Kiro's layout when the folder uses it, and updates the same spec", async () => {
		await mkdir(join(root, ".kiro", "specs", "odeme-iadesi"), { recursive: true });
		const { ctx, asked } = context();
		const result = await runTool("spec_export", SPEC, ctx);
		expect(result.text).toContain("Updated the spec in .kiro/specs/odeme-iadesi (kiro)");
		expect(asked[0]?.lines[0]).toBe("Updates .kiro/specs/odeme-iadesi");
		expect(
			await readFile(join(root, ".kiro/specs/odeme-iadesi/requirements.md"), "utf8"),
		).toContain("WHEN … THE SYSTEM SHALL …");
	});

	it("writes nothing when a requirement has no task or a task names an unknown id", async () => {
		const { ctx, asked } = context();
		const result = await runTool(
			"spec_export",
			{ ...SPEC, tasks: "- [ ] T1 (FR-01) Validate\n- [ ] T2 (FR-05) Invented\n" },
			ctx,
		);
		expect(result.text).toMatch(/^Nothing written\./);
		expect(result.text).toContain("FR-05");
		expect(result.text).toContain("No task names FR-02");
		expect(asked).toHaveLength(0);
		expect(await readdir(root)).toEqual([]);
	});

	it("keeps a partial spec when the user wants it, and says what has no task", async () => {
		const { ctx, asked } = context(true, { specProfile: "kalem" });
		const result = await runTool(
			"spec_export",
			{ ...SPEC, tasks: "- [ ] T1 (FR-01) Validate\n", accept_gaps: true },
			ctx,
		);
		expect(result.text).toContain(".kalem/specs/odeme-iadesi");
		expect(result.text).toContain("(not FR-02)");
		expect(asked[0]?.lines).toContain("Without tasks, as you asked: FR-02");
	});

	it("asks for a task list and writes nothing when the user says no", async () => {
		const noList = await runTool(
			"spec_export",
			{ ...SPEC, tasks: "Do FR-01 and FR-02." },
			context().ctx,
		);
		expect(noList.text).toContain("`- [ ] …` list");
		const { ctx } = context(false);
		const refused = await runTool("spec_export", SPEC, ctx);
		expect(refused.text).toContain("did not allow");
		expect(await readdir(root)).toEqual([]);
	});

	it("is only offered where prompts and code are worked on", () => {
		expect(modeExcluded("prompt").has("spec_export")).toBe(false);
		expect(modeExcluded("code").has("spec_export")).toBe(false);
		expect(modeExcluded("review").has("spec_export")).toBe(true);
		expect(modeExcluded("ask").has("spec_export")).toBe(true);
	});
});
