import { describe, expect, it } from "vitest";
import {
	anthropicModelsOf,
	claudeInitModel,
	claudeModelName,
	claudeModelOptions,
	copilotModelOptions,
	copilotModelsOf,
	copilotOauthToken,
} from "./models.js";

describe("model names", () => {
	it("name Claude's ids as people say them", () => {
		expect(claudeModelName("claude-opus-5-5")).toBe("Opus 5.5");
		expect(claudeModelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
		expect(claudeModelName("claude-haiku-5")).toBe("Haiku 5");
		expect(claudeModelName("claude-opus-5-5[1m]")).toBe("Opus 5.5");
		expect(claudeModelName("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
		expect(claudeModelName("gpt-5")).toBe("gpt-5");
	});

	it("read the model Claude Code says it answers with", () => {
		expect(claudeInitModel({ type: "system", subtype: "init", model: "claude-opus-5-5" })).toBe(
			"claude-opus-5-5",
		);
		expect(claudeInitModel({ type: "assistant" })).toBeNull();
	});
});

describe("Claude Code's choices", () => {
	it("name each alias by what it answered with, then the full models", () => {
		const listed = anthropicModelsOf({
			data: [
				{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" },
				{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
			],
		});
		expect(
			claudeModelOptions(
				["opus", "sonnet", "haiku"],
				{ opus: "claude-opus-5-5", default: "claude-sonnet-5-5" },
				listed,
				["fable", "opus", "claude-fable-5-2"],
			),
		).toEqual([
			{ id: "opus", label: "opus · Claude Opus 5.5" },
			{ id: "sonnet", label: "sonnet" },
			{ id: "haiku", label: "haiku" },
			{ id: "fable", label: "fable" },
			{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
			{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
			{ id: "claude-fable-5-2", label: "Fable 5.2" },
		]);
	});
});

describe("Copilot's choices", () => {
	const account = copilotModelsOf({
		data: [
			{
				id: "claude-opus-5.5",
				name: "Claude Opus 5.5",
				model_picker_enabled: true,
				capabilities: { type: "chat" },
			},
			{
				id: "gpt-5",
				name: "GPT-5",
				model_picker_enabled: true,
				capabilities: { type: "chat" },
				preview: true,
			},
			{ id: "acme-internal", name: "Acme Internal", capabilities: { type: "chat" } },
			{ id: "text-embedding-3", name: "Embedding", capabilities: { type: "embeddings" } },
			{ id: "hidden", name: "Hidden", model_picker_enabled: false },
			{ id: "off", name: "Off", policy: { state: "disabled" } },
		],
	});

	it("are the account's chat models, an organization's own included", () => {
		expect(account).toEqual([
			{ id: "claude-opus-5.5", label: "Claude Opus 5.5" },
			{ id: "gpt-5", label: "GPT-5 (Preview)" },
			{ id: "acme-internal", label: "Acme Internal" },
		]);
	});

	it("keep to the CLI's own list when it has one, named as the account names them", () => {
		expect(copilotModelOptions(["gpt-5", "claude-sonnet-4.5"], account)).toEqual([
			{ id: "gpt-5", label: "GPT-5 (Preview)" },
			{ id: "claude-sonnet-4.5", label: "claude-sonnet-4.5" },
		]);
		expect(copilotModelOptions([], account)).toEqual(account);
	});

	it("find the Copilot plugins' GitHub login", () => {
		expect(
			copilotOauthToken({ "github.com:Iv1.b507": { user: "ayse", oauth_token: "gho_x" } }),
		).toBe("gho_x");
		expect(copilotOauthToken({})).toBeNull();
	});
});
