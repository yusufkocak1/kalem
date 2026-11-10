import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_ID } from "../shared/templates.js";
import { TemplateStore, WORKSPACE_TEMPLATES } from "./templates.js";
import { renamed } from "./templates-ipc.js";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} }, dialog: {} }));

describe("TemplateStore", () => {
	it("lists the team's templates first, keeps a personal one of the same name out, and the built-in one last", async () => {
		const root = await mkdtemp(join(tmpdir(), "kalem-templates-"));
		const personal = join(root, "personal");
		const team = join(root, "repo");
		await mkdir(join(team, WORKSPACE_TEMPLATES), { recursive: true });
		await mkdir(personal, { recursive: true });
		await writeFile(
			join(team, WORKSPACE_TEMPLATES, "kurum.md"),
			'---\nkalem-template: "Kurum"\nrequired: [Amaç]\n---\n# x\n',
		);
		await writeFile(join(personal, "kurum.md"), '---\nkalem-template: "Kurum"\n---\n# mine\n');
		await writeFile(join(personal, "notes.txt"), "not a template");
		const store = new TemplateStore({
			folder: personal,
			workspaces: () => [team],
			language: () => "tr",
		});

		const list = await store.list();
		expect(list.map((template) => [template.name, template.source])).toEqual([
			["Kurum", "workspace"],
			["Yazılım Analiz Dokümanı (best practice)", "builtin"],
		]);
		expect((await store.find("kurum"))?.source).toBe("workspace");
		expect((await store.read(BUILTIN_ID)).text).toContain("## Açık Sorular");

		const saved = await store.save(
			"personal",
			"kurum",
			'---\nkalem-template: "Kurum 2"\n---\n# y\n',
		);
		expect(saved.path).toBe(join(personal, "kurum 2.md"));
		expect(store.isFile(saved.id)).toBe(true);
		expect(store.isFile(join(root, "elsewhere.md"))).toBe(false);
		await expect(store.remove(join(root, "elsewhere.md"))).rejects.toThrow();
		await expect(store.remove(BUILTIN_ID)).rejects.toThrow();
		await store.remove(saved.id);
		await expect(readFile(saved.id)).rejects.toThrow();
		await expect(store.save("workspace", "x", "y")).resolves.toMatchObject({ source: "workspace" });
	});

	it("renames a copy in its front matter", () => {
		expect(renamed('---\nkalem-template: "A"\nrequired: []\n---\n# x\n', "B")).toBe(
			'---\nkalem-template: "B"\nrequired: []\n---\n# x\n',
		);
		expect(renamed("---\nrequired: []\n---\n# x\n", "B")).toBe(
			'---\nkalem-template: "B"\nrequired: []\n---\n# x\n',
		);
		expect(renamed("# x\n", "B")).toBe('---\nkalem-template: "B"\nrequired: []\n---\n\n# x\n');
	});
});
