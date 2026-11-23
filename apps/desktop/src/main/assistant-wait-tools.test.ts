import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { CHANNEL, DEFAULT_SETTINGS } from "../shared/bridge.js";
import { stringsFor } from "../shared/i18n.js";
import { modeExcluded } from "../shared/modes.js";
import type { ApprovalAnswer, ApprovalRequest } from "../shared/tool-protocol.js";
import { parseApprovalAnswer } from "../shared/tool-protocol.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));

const { PermissionGate } = await import("./assistant-permissions.js");
const { approver, runTool, toolsFor } = await import("./assistant-tools.js");
await import("./assistant-wait-tools.js");
type ToolContext = import("./assistant-tools.js").ToolContext;

/** A chat whose cards are answered as told, with the approval setting and tool policy given. */
function context(
	answer: ApprovalAnswer | null,
	setup: { approvals?: "ask" | "edits" | "all"; policy?: "auto" | "ask" } = {},
) {
	const asked: ApprovalRequest[] = [];
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		send(channel: string, request: ApprovalRequest) {
			if (channel !== CHANNEL.assistantApproval) return;
			asked.push(request);
			if (answer !== null) queueMicrotask(() => gate.answer(request.id, answer));
		},
	});
	const gate = new PermissionGate({
		always: () => ["wait:user"],
		setAlways: () => {},
		approvalMode: () => setup.approvals ?? "ask",
		toolPolicy: () => setup.policy,
	});
	const ctx: ToolContext = {
		chatId: "chat-1",
		sender: window as unknown as WebContents,
		t: stringsFor("tr"),
		excluded: modeExcluded("ask"),
		settings: () => DEFAULT_SETTINGS,
		changeSettings: () => {},
		changeLanguage: () => {},
		confluence: null,
		jira: null,
		confluenceClient: null,
		jiraClient: null,
		connections: null,
		workspace: null,
		templates: null,
		document: null,
		step: () => {},
		emit: () => {},
		approve: (request) => approve(request),
		renderer: async () => ({ ok: true, text: "" }),
		readExternal: false,
	};
	const approve = approver(gate, ctx.sender, "chat-1", () => false);
	return { ctx, asked, gate };
}

const picked = (choice: number): ApprovalAnswer => ({ approved: true, scope: "once", choice });

const HOT_SWAP = {
	title: "IntelliJ'de sınıfları güncelleyin",
	steps: ["Run/Debug → Update 'Tomcat'", "Hot swap classes ya da Update classes and resources"],
	reason: "Sunucu yeni kodu henüz yüklemedi",
};

describe("waiting for the user to do something", () => {
	it("is offered in every mode, and shows what to do with done, skip and stop", async () => {
		const { ctx, asked } = context(picked(0));
		expect(toolsFor(ctx).map((tool) => tool.definition.name)).toContain("wait_for_user");
		const result = await runTool("wait_for_user", HOT_SWAP, ctx);
		expect(result.text).toBe("The user says it is done: go on.");
		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			tool: "wait_for_user",
			title: "IntelliJ'de sınıfları güncelleyin",
			lines: HOT_SWAP.steps,
			reason: "Sunucu yeni kodu henüz yüklemedi",
			choices: ["Yaptım, devam et", "Atla", "Burada bitir"],
			mustAsk: true,
			scopes: ["once"],
		});
	});

	it("offers the model's own words for how it went, before skip and stop", async () => {
		const own = { ...HOT_SWAP, choices: ["Sınıflar güncellendi", "Tomcat'i yeniden başlattım"] };
		const { ctx, asked } = context(picked(1));
		const result = await runTool("wait_for_user", own, ctx);
		expect(asked[0]?.choices).toEqual([
			"Sınıflar güncellendi",
			"Tomcat'i yeniden başlattım",
			"Atla",
			"Burada bitir",
		]);
		expect(result.text).toBe("The user chose “Tomcat'i yeniden başlattım”: go on as that says.");
	});

	it("tells the model to go on without it, or to stop here", async () => {
		expect((await runTool("wait_for_user", HOT_SWAP, context(picked(1)).ctx)).text).toContain(
			"The user skipped it: go on without it",
		);
		expect((await runTool("wait_for_user", HOT_SWAP, context(picked(2)).ctx)).text).toContain(
			"The user wants to stop here: do nothing more.",
		);
	});

	it("passes on what the user wrote instead of picking", async () => {
		const wrote: ApprovalAnswer = {
			approved: true,
			scope: "once",
			text: "Hot swap olmadı, Tomcat'i yeniden başlatıyorum",
		};
		const result = await runTool("wait_for_user", HOT_SWAP, context(wrote).ctx);
		expect(result.text).toContain(
			"The user answered in their own words: “Hot swap olmadı, Tomcat'i yeniden başlatıyorum”.",
		);
	});

	it("waits until the user answers, however the approvals are set", async () => {
		const { ctx, asked, gate } = context(null, { approvals: "all", policy: "auto" });
		let done = false;
		const running = runTool("wait_for_user", HOT_SWAP, ctx).then((result) => {
			done = true;
			return result;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(asked).toHaveLength(1);
		expect(done).toBe(false);
		gate.answer(asked[0]?.id ?? "", picked(0));
		expect((await running).text).toBe("The user says it is done: go on.");
	});

	it("ends when the reply is stopped", async () => {
		const { ctx, asked, gate } = context(null);
		const running = runTool("wait_for_user", HOT_SWAP, ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(asked).toHaveLength(1);
		gate.cancel(ctx.sender, "chat-1");
		expect((await running).text).toContain("The user did not answer");
	});

	it("reads the choice and the words from the window, and nothing else", () => {
		expect(parseApprovalAnswer({ approved: true, choice: 2, text: "  tamam  " })).toEqual({
			approved: true,
			scope: "once",
			choice: 2,
			text: "tamam",
		});
		expect(parseApprovalAnswer({ approved: true, choice: -1, text: 5 })).toEqual({
			approved: true,
			scope: "once",
		});
		expect(parseApprovalAnswer({ approved: true, choice: 1.5, text: "   " })).toEqual({
			approved: true,
			scope: "once",
		});
	});
});
