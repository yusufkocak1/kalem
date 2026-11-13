/**
 * Exploration: drives the app through many actions that must not move what
 * is being read, and after each checks the same things — the paragraph in
 * view stays where it was, nothing overflows sideways, the document is not
 * made unsaved, the file is untouched, nothing is logged as an error. Bugs
 * of the "the page jumps to the top" and "it needs a sideways scroll" kind
 * show up here as a list. With KALEM_EXPLORE_REPORT=<file> it writes the
 * findings there instead of failing on them.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, recordMessageBoxes, tempDir } from "./launch.js";

test.setTimeout(300_000);

const ANCHOR = "ÇAPA paragrafı burada";

function longDocument(): string {
	const parts = ["# Keşif Belgesi", "Giriş paragrafı."];
	for (let section = 1; section <= 12; section++) {
		parts.push(`## Bölüm ${section}`);
		for (let i = 1; i <= 6; i++) {
			parts.push(
				`Bölüm ${section} paragraf ${i}: Kullanıcı siparişi kargoya verilmeden iptal edebilir; iptal edilen siparişin ödemesi aynı gün iade edilir ve bildirim gönderilir.`,
			);
		}
		if (section === 6) parts.push(`${ANCHOR}. Bu satır keşif testinin baktığı yer.`);
		if (section % 3 === 0) {
			parts.push("- Madde bir\n- Madde iki\n  - İç madde\n- [ ] Görev");
			parts.push(
				"| Alan | Tür | Açıklama |\n| --- | --- | --- |\n| id | sayı | Kimlik |\n| ad | metin | Ad |",
			);
			parts.push("```ts\nconst x: number = 42;\nconsole.log(x);\n```");
			parts.push("> Alıntı bloğu, biraz da uzun bir satır olsun diye yazılmış.");
		}
	}
	return `${parts.join("\n\n")}\n`;
}

interface Probe {
	readonly anchorTop: number | null;
	readonly scrollTop: number;
	readonly deskOverflowX: number;
	readonly pageOverflowX: number;
	readonly status: string;
	readonly active: string;
	/** The focus is in the document's text (where typing goes). */
	readonly inDocument: boolean;
}

async function probe(page: Page): Promise<Probe> {
	return page.evaluate((anchorText) => {
		const desk = document.querySelector<HTMLElement>(".desk:not([hidden])");
		const anchor = [...document.querySelectorAll<HTMLElement>("#editor p")].find((p) =>
			p.textContent?.includes(anchorText),
		);
		const deskTop = desk?.getBoundingClientRect().top ?? 0;
		const visible = anchor !== undefined && anchor.offsetParent !== null;
		const active = document.activeElement;
		const editable =
			active instanceof HTMLElement ? active.closest("[contenteditable='true']") : null;
		return {
			inDocument: editable !== null && desk !== null && desk.contains(editable),
			anchorTop: visible ? Math.round(anchor.getBoundingClientRect().top - deskTop) : null,
			scrollTop: Math.round(desk?.scrollTop ?? 0),
			deskOverflowX: desk === null ? 0 : desk.scrollWidth - desk.clientWidth,
			pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
			status: document.querySelector(".save-status")?.textContent ?? "",
			active:
				active === null
					? "none"
					: // kalem-locale-ok: an HTML tag name is ASCII
						`${active.tagName.toLowerCase()}${active.className === "" ? "" : `.${String(active.className).split(" ")[0]}`}`,
		};
	}, ANCHOR);
}

async function command(app: ElectronApplication, name: string): Promise<void> {
	await app.evaluate(({ BrowserWindow }, n) => {
		BrowserWindow.getAllWindows()[0]?.webContents.send("kalem:command", n);
	}, name);
}

/** Puts the anchor paragraph about a third down the view, and the caret in it. */
async function readAnchor(page: Page): Promise<void> {
	const anchor = page.locator("#editor p", { hasText: ANCHOR });
	await anchor.evaluate((element) => {
		const desk = document.querySelector<HTMLElement>(".desk:not([hidden])");
		if (desk === null) return;
		desk.scrollTop +=
			element.getBoundingClientRect().top -
			desk.getBoundingClientRect().top -
			desk.clientHeight / 3;
	});
	await page.waitForTimeout(100);
}

interface Finding {
	readonly action: string;
	readonly step: "do" | "undo";
	readonly problem: string;
}

test("exploration: actions that must not move, dirty or overflow the document", async () => {
	const folder = await tempDir("explore");
	const doc = join(folder, "kesif.md");
	const other = join(folder, "ikinci.md");
	const text = longDocument();
	await writeFile(doc, text);
	await writeFile(other, "# İkinci\n\nKısa bir belge.\n");
	const { app, page, errors } = await launch({ args: [other, doc] });
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
	await page.locator("#editor p", { hasText: ANCHOR }).waitFor();
	await recordMessageBoxes(app, 1);

	const findings: Finding[] = [];
	// With KALEM_EXPLORE_SHOTS=<folder>, a screenshot of each step, for a person to look at.
	const shots = process.env.KALEM_EXPLORE_SHOTS ?? "";
	if (shots !== "") await mkdir(shots, { recursive: true });
	let shotIndex = 0;
	const shot = async (name: string): Promise<void> => {
		if (shots === "") return;
		const file = `${String(++shotIndex).padStart(3, "0")}-${name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}.png`;
		await page.screenshot({ path: join(shots, file) }).catch(() => {});
	};
	const press = (key: string) => async () => {
		await page.keyboard.press(key);
	};
	const menu =
		(...labels: string[]) =>
		async () =>
			clickMenu(app, ...labels);
	const run = (name: string) => async () => command(app, name);
	const ribbonTab = (label: string) => async () => {
		await page.locator(".ribbon-tab", { hasText: label }).first().click();
	};
	const clickAnchor = async () => {
		await page.locator("#editor p", { hasText: ANCHOR }).click({ position: { x: 40, y: 8 } });
	};
	const selectWord = async () => {
		await page.evaluate((anchorText) => {
			const p = [...document.querySelectorAll("#editor p")].find((node) =>
				node.textContent?.includes(anchorText),
			);
			const node = p?.firstChild as Text | null;
			if (node === null || node === undefined) return;
			const range = document.createRange();
			range.setStart(node, 0);
			range.setEnd(node, 4);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}, ANCHOR);
	};

	interface Action {
		readonly name: string;
		readonly before?: () => Promise<void>;
		readonly do: () => Promise<void>;
		readonly undo?: () => Promise<void>;
		/** May leave the document unsaved (it edits); its undo must bring it back. */
		readonly edits?: boolean;
		/** The anchor is out of sight while it is on (source mode). */
		readonly hidesAnchor?: boolean;
	}

	const actions: Action[] = [
		{ name: "click in the paragraph", do: clickAnchor },
		{ name: "select a word, Escape", do: selectWord, undo: press("Escape") },
		{ name: "ribbon: Insert tab", do: ribbonTab("Insert"), undo: ribbonTab("Home") },
		{ name: "ribbon: Review tab", do: ribbonTab("Review"), undo: ribbonTab("Home") },
		{ name: "ribbon: View tab", do: ribbonTab("View"), undo: ribbonTab("Home") },
		{
			name: "navigation pane off/on",
			do: menu("View", "Navigation Pane"),
			undo: menu("View", "Navigation Pane"),
		},
		{ name: "assistant pane on/off", do: run("assistant"), undo: run("assistant") },
		{ name: "full width on/off", do: menu("View", "Full Width"), undo: menu("View", "Full Width") },
		{ name: "focus mode on/off", do: run("focus"), undo: run("focus") },
		{ name: "read only on/off", do: run("read-only"), undo: run("read-only") },
		{
			name: "Markdown source on/off",
			before: clickAnchor,
			do: run("source"),
			undo: run("source"),
			hidesAnchor: true,
		},
		{ name: "zoom in/out", do: run("zoom-in"), undo: run("zoom-out") },
		{
			name: "theme dark/light",
			do: menu("View", "Theme", "Dark"),
			undo: menu("View", "Theme", "Light"),
		},
		{
			name: "spell check off/on",
			do: menu("View", "Spell Check"),
			undo: menu("View", "Spell Check"),
		},
		{ name: "find, Escape", before: clickAnchor, do: run("find"), undo: press("Escape") },
		{ name: "replace, Escape", before: clickAnchor, do: run("replace"), undo: press("Escape") },
		{ name: "command palette, Escape", do: run("command-palette"), undo: press("Escape") },
		{ name: "quick open, Escape", do: run("quick-open"), undo: press("Escape") },
		{ name: "settings, Escape", do: run("settings"), undo: press("Escape") },
		{ name: "version history, Escape", do: run("version-history"), undo: press("Escape") },
		{ name: "new from template, Escape", do: run("new-from-template"), undo: press("Escape") },
		{ name: "Jira, Escape", do: run("jira-open"), undo: press("Escape") },
		{ name: "Confluence open, Escape", do: run("confluence-open"), undo: press("Escape") },
		{
			name: "next tab and back",
			do: run("next-tab"),
			undo: run("previous-tab"),
			hidesAnchor: true,
		},
		{
			name: "window narrow and back",
			do: async () => {
				await app.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0]?.setSize(820, 900),
				);
			},
			undo: async () => {
				await app.evaluate(({ BrowserWindow }) =>
					BrowserWindow.getAllWindows()[0]?.setSize(1400, 900),
				);
			},
		},
		{ name: "save a clean document", do: run("save") },
		{
			name: "undo/redo with nothing to undo",
			before: clickAnchor,
			do: run("undo"),
			undo: run("redo"),
		},
		{
			name: "new note, Escape",
			before: async () => {
				await clickAnchor();
				await selectWord();
			},
			do: run("note-new"),
			undo: press("Escape"),
		},
		{
			name: "note: add, resolve",
			before: async () => {
				await clickAnchor();
				await selectWord();
			},
			do: async () => {
				await command(app, "note-new");
				await page.waitForTimeout(150);
				await page.keyboard.type("Keşif notu");
				await page.keyboard.press("ControlOrMeta+Enter");
			},
			undo: async () => {
				const balloon = page.locator(".note-balloon").first();
				await balloon.click();
				await balloon.locator('button[aria-label="Resolve"]').click();
			},
		},
		{ name: "notes off/on", do: run("notes-toggle"), undo: run("notes-toggle") },
		{ name: "next note", do: run("note-next") },
		{
			name: "type in the paragraph, undo",
			before: clickAnchor,
			edits: true,
			do: async () => {
				await page.keyboard.press("End");
				await page.keyboard.type(" ek");
			},
			undo: async () => {
				await command(app, "undo");
				await page.waitForTimeout(100);
				await command(app, "undo");
			},
		},
		{
			name: "Enter then undo",
			before: clickAnchor,
			edits: true,
			do: async () => {
				await page.keyboard.press("End");
				await page.keyboard.press("Enter");
			},
			undo: run("undo"),
		},
		{
			name: "bold a word, undo",
			before: async () => {
				await clickAnchor();
				await selectWord();
			},
			edits: true,
			do: run("bold"),
			undo: run("undo"),
		},
		{
			name: "heading 2 on the paragraph, undo",
			before: clickAnchor,
			edits: true,
			do: run("heading-2"),
			undo: run("undo"),
		},
	];

	for (const action of actions) {
		await page.keyboard.press("Escape").catch(() => {});
		await readAnchor(page);
		await action.before?.();
		await page.waitForTimeout(120);
		const start = await probe(page);
		const errorCount = errors.length;
		const check = async (
			step: "do" | "undo",
			allowMove: boolean,
			allowDirty: boolean,
		): Promise<void> => {
			await page.waitForTimeout(450);
			const now = await probe(page);
			let reported = false;
			const report = (problem: string): void => {
				findings.push({ action: action.name, step, problem });
				reported = true;
			};
			if (!allowMove && start.anchorTop !== null) {
				if (now.anchorTop === null) report("the paragraph being read is no longer shown");
				else if (Math.abs(now.anchorTop - start.anchorTop) > 48) {
					report(
						`the paragraph moved ${now.anchorTop - start.anchorTop}px (scroll ${start.scrollTop} → ${now.scrollTop})`,
					);
				}
			}
			if (now.deskOverflowX > 1) report(`the page scrolls sideways by ${now.deskOverflowX}px`);
			if (now.pageOverflowX > 1) report(`the window scrolls sideways by ${now.pageOverflowX}px`);
			if (!allowDirty && start.status === "Saved" && now.status !== "Saved") {
				report(`the document became "${now.status}"`);
			}
			if (errors.length > errorCount) report(`errors: ${errors.slice(errorCount).join(" | ")}`);
			// A dialog or box closed with Escape gives the focus back to the text.
			if (
				step === "undo" &&
				action.name.endsWith(", Escape") &&
				start.inDocument &&
				!now.inDocument
			) {
				report(`the focus did not come back to the document (it is on ${now.active})`);
			}
			await shot(`${action.name} ${step}${reported ? " PROBLEM" : ""}`);
		};
		try {
			await action.do();
			await check(
				"do",
				action.hidesAnchor === true || action.edits === true,
				action.edits === true,
			);
			if (action.undo !== undefined) {
				await action.undo();
				await check("undo", false, false);
			}
		} catch (error) {
			findings.push({
				action: action.name,
				step: "do",
				problem: `failed: ${String(error).split("\n")[0]}`,
			});
		}
	}

	// Sideways overflow, at several widths, with the panes on and off.
	const combos: { name: string; set: () => Promise<void>; reset: () => Promise<void> }[] = [
		{ name: "default", set: async () => {}, reset: async () => {} },
		{ name: "assistant", set: run("assistant"), reset: run("assistant") },
		{ name: "full width", set: menu("View", "Full Width"), reset: menu("View", "Full Width") },
		{
			name: "full width + assistant",
			set: async () => {
				await clickMenu(app, "View", "Full Width");
				await command(app, "assistant");
			},
			reset: async () => {
				await clickMenu(app, "View", "Full Width");
				await command(app, "assistant");
			},
		},
		{
			name: "zoom 150%",
			set: async () => {
				for (let i = 0; i < 5; i++) await command(app, "zoom-in");
			},
			reset: run("zoom-reset"),
		},
	];
	// The My Notes pane on, for the widths below.
	if (!(await page.locator(".notes-pane").isVisible())) await command(app, "notes-toggle");
	await page.waitForTimeout(200);
	const notesShown = await page.locator(".notes-pane").isVisible();
	for (const width of [700, 900, 1100, 1400]) {
		await app.evaluate(
			({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]?.setSize(w, 860),
			width,
		);
		for (const combo of combos) {
			await combo.set();
			await page.waitForTimeout(350);
			const now = await probe(page);
			const label = `${width}px, ${combo.name}${notesShown ? ", notes pane" : ""}`;
			await shot(`width ${label}`);
			if (now.deskOverflowX > 1)
				findings.push({
					action: label,
					step: "do",
					problem: `page scrolls sideways by ${now.deskOverflowX}px`,
				});
			if (now.pageOverflowX > 1)
				findings.push({
					action: label,
					step: "do",
					problem: `window scrolls sideways by ${now.pageOverflowX}px`,
				});
			await combo.reset();
			await page.waitForTimeout(150);
		}
	}

	expect(await readFile(doc, "utf8")).toBe(text);
	const report = process.env.KALEM_EXPLORE_REPORT;
	if (report !== undefined && report !== "") {
		await writeFile(report, JSON.stringify({ findings, errors }, null, 2));
	} else {
		expect(findings).toEqual([]);
		expect(errors).toEqual([]);
	}
	await app.close();
});

test("the assistant's shortcut opens it with the cursor in its box, and a second press closes it", async () => {
	const folder = await tempDir("explore-assistant");
	const doc = join(folder, "a.md");
	await writeFile(doc, "# Başlık\n\nMetin.\n");
	const { app, page, errors } = await launch({ args: [doc] });
	await page.locator("#editor p", { hasText: "Metin." }).click();
	await command(app, "assistant");
	await expect(page.locator(".assistant-input")).toBeFocused();
	await command(app, "assistant");
	await expect(page.locator(".assistant")).toBeHidden();
	expect(errors).toEqual([]);
	await app.close();
});
