/**
 * A look at the window as a person would give it, done by rule: what is on
 * the screen must fit and be reachable. Used by the exploration tests after
 * each step ("scene"), at several window sizes, with a screenshot of each
 * for a person to look at too.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";

export interface Finding {
	readonly scene: string;
	readonly size: string;
	readonly problem: string;
}

/** What the page says is wrong with what it shows; an empty list when nothing is. */
export async function auditPage(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const problems = new Set<string>();
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const name = (element: Element): string => {
			const text = (
				element.getAttribute("aria-label") ??
				element.getAttribute("title") ??
				element.textContent ??
				""
			)
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 40);
			const cls = typeof element.className === "string" ? element.className.split(" ")[0] : "";
			// kalem-locale-ok: an HTML tag name is ASCII
			return `${element.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${text ? ` “${text}”` : ""}`;
		};
		const visible = (element: Element): boolean => {
			if (!(element instanceof HTMLElement)) return false;
			if (element.offsetParent === null && getComputedStyle(element).position !== "fixed")
				return false;
			const style = getComputedStyle(element);
			if (style.visibility !== "visible" || style.opacity === "0") return false;
			// Inside a closed <details>, or otherwise not drawn.
			if (
				!element.checkVisibility({
					contentVisibilityAuto: true,
					opacityProperty: true,
					visibilityProperty: true,
				})
			) {
				return false;
			}
			const box = element.getBoundingClientRect();
			return box.width > 1 && box.height > 1;
		};

		if (document.documentElement.scrollWidth > vw + 1) {
			problems.add(`the window scrolls sideways by ${document.documentElement.scrollWidth - vw}px`);
		}

		// Dialogs and floating boxes are whole within the window.
		const dialogs = [...document.querySelectorAll<HTMLElement>("dialog[open]")].filter(visible);
		const floating = [
			...dialogs,
			...[
				...document.querySelectorAll<HTMLElement>(
					".link-card, .dock-menu, .jira-row-menu, .atom-picker, .combo-list, .jira-transition-menu, .kalem-slash-menu, .files-menu",
				),
			].filter(visible),
		];
		for (const box of floating) {
			const rect = box.getBoundingClientRect();
			if (rect.left < -1 || rect.top < -1 || rect.right > vw + 1 || rect.bottom > vh + 1) {
				problems.add(
					`${name(box).split(" “")[0]} does not fit the window (${Math.round(rect.left)},${Math.round(rect.top)} – ${Math.round(rect.right)},${Math.round(rect.bottom)} in ${vw}×${vh})`,
				);
			}
		}

		// What is looked at: the topmost dialog, or the whole window.
		const scope: HTMLElement = dialogs[dialogs.length - 1] ?? document.body;
		const inDocument = (element: Element): boolean =>
			element.closest("#editor, .kalem-source") !== null;

		// Boxes that scroll sideways (the document's own tables and code may).
		for (const element of scope.querySelectorAll<HTMLElement>("*")) {
			if (!visible(element) || inDocument(element)) continue;
			if (
				element.matches(
					"pre, textarea, input, .tabstrip, .doc-tabs, .git-diff, .changes-body, .ribbon-groups, .ribbon-body, .desk",
				)
			)
				continue;
			const overflow = getComputedStyle(element).overflowX;
			if (
				(overflow === "auto" || overflow === "scroll") &&
				element.scrollWidth > element.clientWidth + 4
			) {
				problems.add(
					`${name(element).split(" “")[0]} scrolls sideways by ${element.scrollWidth - element.clientWidth}px`,
				);
			}
		}

		// Controls: within the window, not cut by their box, their label whole, not covered.
		const controls = [
			...scope.querySelectorAll<HTMLElement>(
				"button, input, select, textarea, a[href], [role='menuitem'], [role='option'], [role='tab'], [role='treeitem'] > .confluence-row-main",
			),
		].filter((element) => visible(element) && !inDocument(element));
		for (const control of controls) {
			const box = control.getBoundingClientRect();
			// Scrolled out of its list, up or down: fine. Sideways: not.
			let clipped = false;
			let hiddenByScroll = false;
			for (
				let parent = control.parentElement;
				parent !== null && parent !== document.body;
				parent = parent.parentElement
			) {
				const style = getComputedStyle(parent);
				const rect = parent.getBoundingClientRect();
				if (
					style.overflowY !== "visible" &&
					(box.bottom < rect.top + 2 || box.top > rect.bottom - 2)
				) {
					hiddenByScroll = true;
					break;
				}
				if (
					style.overflowX !== "visible" &&
					(box.right > rect.right + 2 || box.left < rect.left - 2)
				) {
					if (box.left >= rect.right - 2 || box.right <= rect.left + 2)
						hiddenByScroll = style.overflowX !== "hidden";
					clipped = true;
					problems.add(`${name(control)} is cut off by ${name(parent).split(" “")[0]}`);
					break;
				}
			}
			if (hiddenByScroll || clipped) continue;
			if (box.right > vw + 1 || box.left < -1) {
				problems.add(`${name(control)} is outside the window`);
				continue;
			}
			if (
				control.tagName === "BUTTON" &&
				control.scrollWidth > control.clientWidth + 2 &&
				getComputedStyle(control).textOverflow !== "ellipsis" &&
				![...control.querySelectorAll("*")].some(
					(child) => getComputedStyle(child).textOverflow === "ellipsis",
				)
			) {
				problems.add(`${name(control)}: its label does not fit`);
			}
			if (box.width < 12 || box.height < 12) {
				if (control.tagName === "BUTTON")
					problems.add(
						`${name(control)} is only ${Math.round(box.width)}×${Math.round(box.height)}px`,
					);
				continue;
			}
			// Covered: what is at its middle is something else.
			const x = box.left + box.width / 2;
			const y = box.top + box.height / 2;
			if (x < 0 || y < 0 || x > vw || y > vh) continue;
			// Its middle scrolled out of a list it is in: not covered, only not in view.
			let inView = true;
			for (
				let parent = control.parentElement;
				parent !== null && parent !== document.body;
				parent = parent.parentElement
			) {
				if (getComputedStyle(parent).overflowY === "visible") continue;
				const rect = parent.getBoundingClientRect();
				if (y < rect.top || y > rect.bottom) {
					inView = false;
					break;
				}
			}
			if (!inView) continue;
			const top = document.elementFromPoint(x, y);
			if (top === null || top === control || control.contains(top) || top.contains(control))
				continue;
			// A label over its own checkbox, or a control's own decoration.
			if (top.closest("label")?.contains(control) === true) continue;
			if (control.tagName === "INPUT" && top.parentElement === control.parentElement) continue;
			// Under a header or footer that stays while the rest scrolls, or under an open menu: as meant.
			let over = false;
			for (
				let node: Element | null = top;
				node !== null && node !== scope;
				node = node.parentElement
			) {
				const position = getComputedStyle(node).position;
				if (
					position === "sticky" ||
					position === "fixed" ||
					floating.includes(node as HTMLElement)
				) {
					over = true;
					break;
				}
				if (node.matches("[role='menu'], [role='listbox'], dialog")) {
					over = true;
					break;
				}
			}
			if (over) continue;
			problems.add(`${name(control)} is covered by ${name(top)}`);
		}

		// Text that runs out of a one-line box without an ellipsis: titles, cells, chips.
		for (const element of scope.querySelectorAll<HTMLElement>(
			"h1, h2, h3, th, td, label, .jira-key, .jira-status, .jira-summary, .doc-tab-title",
		)) {
			if (!visible(element) || inDocument(element)) continue;
			const style = getComputedStyle(element);
			if (
				style.whiteSpace === "nowrap" &&
				style.overflow === "visible" &&
				element.scrollWidth > element.clientWidth + 2
			) {
				const parent = element.parentElement;
				if (
					parent !== null &&
					element.getBoundingClientRect().right > parent.getBoundingClientRect().right + 2
				) {
					problems.add(`${name(element)} runs out of its box`);
				}
			}
		}
		return [...problems];
	});
}

export interface Explorer {
	readonly findings: Finding[];
	/**
	 * Looks at what is shown now, at each size (or only as it is, for a menu
	 * or card a resize would close), and keeps a screenshot.
	 */
	scene(name: string, options?: { fixed?: boolean }): Promise<void>;
	/** Writes the findings where `KALEM_EXPLORE_REPORT` says; resolves with whether to fail on them. */
	finish(errors: readonly string[]): Promise<boolean>;
}

export const SIZES: readonly (readonly [number, number])[] = [
	[1400, 900],
	[1000, 720],
	[700, 600],
];

export async function setSize(
	app: ElectronApplication,
	width: number,
	height: number,
): Promise<void> {
	await app.evaluate(
		({ BrowserWindow }, [w, h]) =>
			BrowserWindow.getAllWindows()[0]?.setSize(w as number, h as number),
		[width, height],
	);
}

export async function createExplorer(
	app: ElectronApplication,
	page: Page,
	label: string,
	errors: readonly string[],
): Promise<Explorer> {
	const shots = process.env.KALEM_EXPLORE_SHOTS ?? "";
	const folder = shots === "" ? "" : join(shots, label);
	if (folder !== "") await mkdir(folder, { recursive: true });
	const findings: Finding[] = [];
	let index = 0;
	let seenErrors = 0;
	const slug = (text: string): string =>
		text.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
	await setSize(app, SIZES[0]?.[0] ?? 1400, SIZES[0]?.[1] ?? 900);

	const look = async (name: string, size: string): Promise<void> => {
		await page.waitForTimeout(350);
		const problems = await auditPage(page);
		if (errors.length > seenErrors) {
			problems.push(`errors: ${errors.slice(seenErrors).join(" | ")}`);
			seenErrors = errors.length;
		}
		for (const problem of problems) findings.push({ scene: name, size, problem });
		if (folder !== "") {
			const file = `${String(index).padStart(2, "0")}-${slug(name)}-${size}${problems.length > 0 ? "-PROBLEM" : ""}.png`;
			await page.screenshot({ path: join(folder, file) }).catch(() => {});
		}
	};

	return {
		findings,
		async scene(name, options = {}) {
			index++;
			if (options.fixed === true) {
				const size = await page.evaluate(() => `${window.innerWidth}`);
				await look(name, size);
				return;
			}
			for (const [width, height] of SIZES) {
				await setSize(app, width, height);
				await look(name, String(width));
			}
			await setSize(app, SIZES[0]?.[0] ?? 1400, SIZES[0]?.[1] ?? 900);
			await page.waitForTimeout(200);
		},
		async finish(allErrors) {
			const report = process.env.KALEM_EXPLORE_REPORT ?? "";
			if (report === "") return true;
			await writeFile(
				report.replace(/\.json$/, `-${label}.json`),
				JSON.stringify({ findings, errors: allErrors }, null, 2),
			);
			return false;
		},
	};
}
