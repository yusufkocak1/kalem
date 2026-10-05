import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkspace, searchWorkspace } from "./workspace.js";

const collator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });

async function folder(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kalem-workspace-"));
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, ...path.split("/"));
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, text);
	}
	return root;
}

describe("listWorkspace", () => {
	it("lists documents, folders first, and leaves out other files and empty folders", async () => {
		const root = await folder({
			"b.md": "",
			"a10.md": "",
			"a2.md": "",
			"notlar.txt": "",
			"resim.png": "",
			"çalışma/ilk.md": "",
			"boş/resim.png": "",
			"rapor.assets/ek.md": "",
			".git/HEAD.md": "",
			"node_modules/x/readme.md": "",
		});
		const { entries, truncated } = await listWorkspace(root, collator);
		expect(entries.map((entry) => `${"  ".repeat(entry.depth)}${entry.name}`)).toEqual([
			"çalışma",
			"  ilk.md",
			"a2.md",
			"a10.md",
			"b.md",
			"notlar.txt",
		]);
		expect(entries[0]?.folder).toBe(true);
		expect(truncated).toBe(false);
	});
});

describe("searchWorkspace", () => {
	it("finds lines with Turkish case folding and reports where they are", async () => {
		const root = await folder({
			"bir.md": "# Başlık\n\nISPARTA ve ılık su\n",
			"alt/iki.md": "Isparta gezisi\nbaşka satır\n",
			"üç.md": "hiçbir şey\n",
		});
		const { entries } = await listWorkspace(root, collator);
		const { hits, truncated } = await searchWorkspace(entries, root, "ısparta", "tr");
		expect(truncated).toBe(false);
		expect(hits.map((hit) => [hit.relative, hit.line, hit.column])).toEqual([
			["alt/iki.md", 1, 0],
			["bir.md", 3, 0],
		]);
		expect((await searchWorkspace(entries, root, "  ", "tr")).hits).toEqual([]);
	});
});
