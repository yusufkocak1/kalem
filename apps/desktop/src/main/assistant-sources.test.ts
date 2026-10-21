import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectSources, readText } from "./assistant-sources.js";

async function folder(files: Record<string, string | Uint8Array>): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "kalem-sources-"));
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, ...path.split("/"));
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, content);
	}
	return root;
}

describe("assistant sources", () => {
	it("reads any text file, not binary ones", async () => {
		const root = await folder({
			"Main.java": "class Main {}\r\n",
			"veri.bin": new Uint8Array([1, 0, 2, 3]),
			"resim.png": "not really",
		});
		expect(await readText(join(root, "Main.java"))).toBe("class Main {}\n");
		expect(await readText(join(root, "veri.bin"))).toBeNull();
		expect(await readText(join(root, "resim.png"))).toBeNull();
	});

	it("lists a folder and sends its files' text to an API", async () => {
		const root = await folder({
			"src/App.java": "class App {}",
			"src/util/Yardim.java": "class Yardim {}",
			"analiz.txt": "Gereksinimler",
			"node_modules/x/index.js": "skip",
			".git/HEAD": "skip",
			"target/App.class": "skip",
		});
		const { text, folders } = await collectSources([root], { budget: 10_000, listOnly: false });
		expect(text).toContain("  analiz.txt\n  src/App.java\n  src/util/Yardim.java\n</folder>");
		expect(text).toContain(`<file path="${join(root, "src", "App.java")}">\nclass App {}\n</file>`);
		expect(text).toContain("Gereksinimler");
		expect(text).not.toContain("skip");
		expect(folders).toEqual([root]);
	});

	it("only lists a folder for a CLI, but sends a file added by itself", async () => {
		const root = await folder({ "kod/A.java": "class A {}", "analiz.txt": "Analiz" });
		const file = join(root, "analiz.txt");
		const { text, folders } = await collectSources([join(root, "kod"), file], {
			budget: 10_000,
			listOnly: true,
		});
		expect(text).toContain("  A.java");
		expect(text).not.toContain("class A {}");
		expect(text).toContain("Analiz");
		expect(folders).toEqual([join(root, "kod"), root]);
	});

	it("keeps to the budget and skips sources that are gone", async () => {
		const root = await folder({ "a.txt": "a".repeat(60), "b.txt": "b".repeat(60) });
		const { text } = await collectSources([root, join(root, "yok")], {
			budget: 100,
			listOnly: false,
		});
		expect(text).toContain("a".repeat(60));
		expect(text).not.toContain("b".repeat(60));
		expect(text).toContain("[1 more files not included");
		expect(await collectSources([join(root, "yok")], { budget: 100, listOnly: false })).toEqual({
			text: "",
			folders: [],
		});
	});
});
