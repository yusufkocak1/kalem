import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliCommands, frontMatter } from "./cli-commands.js";

async function file(path: string, text: string): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, text);
}

describe("Claude Code's slash commands", () => {
	it("finds the user's, a folder's and the plugins' commands and skills", async () => {
		const root = await mkdtemp(join(tmpdir(), "kalem-cli-"));
		const config = join(root, "config");
		const project = join(root, "project");
		const plugin = join(root, "plugin");
		const off = join(root, "off");
		await file(
			join(config, "commands", "standup.md"),
			"---\ndescription: Daily standup notes\nargument-hint: <team>\n---\nWrite it.",
		);
		await file(
			join(config, "skills", "tone", "SKILL.md"),
			"---\nname: tone\ndescription: Fix the tone\n---\n",
		);
		await file(join(config, "skills", "hidden", "SKILL.md"), "---\nuser-invocable: false\n---\n");
		await file(
			join(project, ".claude", "commands", "release.md"),
			"# Release\nMake a release note.",
		);
		await file(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "docs-kit" }));
		await file(join(plugin, "commands", "outline.md"), "---\ndescription: Outline a doc\n---\n");
		await file(join(plugin, "skills", "glossary", "SKILL.md"), "---\ndescription: Terms\n---\n");
		await file(join(off, "commands", "nope.md"), "x");
		await file(
			join(config, "plugins", "installed_plugins.json"),
			JSON.stringify({
				version: 2,
				plugins: {
					"docs-kit@market": [{ scope: "user", installPath: plugin }],
					"off@market": [{ scope: "user", installPath: off }],
				},
			}),
		);
		await file(
			join(config, "settings.json"),
			JSON.stringify({ enabledPlugins: { "docs-kit@market": true, "off@market": false } }),
		);

		const found = await cliCommands([project], config);
		expect(found.map((command) => command.name).sort()).toEqual([
			"docs-kit:glossary",
			"docs-kit:outline",
			"release",
			"standup",
			"tone",
		]);
		expect(found.find((command) => command.name === "standup")).toEqual({
			name: "standup",
			description: "Daily standup notes",
			argument: "<team>",
			source: "user",
		});
		expect(found.find((command) => command.name === "release")).toMatchObject({
			description: "Make a release note.",
			source: "project",
		});
		expect(found.find((command) => command.name === "docs-kit:outline")?.source).toBe("docs-kit");
	});

	it("finds nothing where Claude Code is not set up", async () => {
		expect(await cliCommands([], join(tmpdir(), "kalem-none-here"))).toEqual([]);
	});

	it("reads front matter", () => {
		expect(frontMatter('---\ndescription: "Quoted"\nmodel: sonnet\n---\nBody')).toEqual({
			description: "Quoted",
			model: "sonnet",
		});
	});
});
