/**
 * Settings' long parts fold: a heading inside a block (and each group of the
 * assistant's tools) is a button that hides or shows what follows it, so a
 * long page is a few headings to choose from. What the user folded is kept
 * for next time. A search shows everything, folded or not (the style sheet
 * does that from `data-searching` / `data-filtering`).
 */

const KEY = "kalem.settings.folded";

/** The headings that fold what follows them. */
const HEADINGS = ".settings-block h4, .mode-section h4, .tool-settings-group h5";

/** The groups of the tools are long lists: closed until opened. */
const closedByDefault = (heading: HTMLElement): boolean => heading.tagName === "H5";

function kept(): Record<string, boolean> {
	try {
		const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, boolean>)
			: {};
	} catch {
		return {};
	}
}

/** A heading's name in what is kept: its block or group, and its words. */
const nameOf = (heading: HTMLElement): string =>
	`${heading.closest<HTMLElement>("[data-block], [data-group]")?.dataset.block ?? heading.closest<HTMLElement>("[data-group]")?.dataset.group ?? ""}/${heading.textContent ?? ""}`;

/** Makes the headings under `root` fold, now and whenever its parts are drawn again. */
export function installFolds(root: HTMLElement): void {
	const folded = kept();

	const dress = (): void => {
		for (const heading of root.querySelectorAll<HTMLElement>(HEADINGS)) {
			// A heading with nothing after it has nothing to fold.
			if (heading.nextElementSibling === null) continue;
			const open = !(folded[nameOf(heading)] ?? closedByDefault(heading));
			if (heading.classList.contains("settings-fold")) {
				if (heading.getAttribute("aria-expanded") !== String(open)) {
					heading.setAttribute("aria-expanded", String(open));
				}
				continue;
			}
			heading.classList.add("settings-fold");
			heading.setAttribute("role", "button");
			heading.tabIndex = 0;
			heading.setAttribute("aria-expanded", String(open));
		}
	};

	const toggle = (heading: HTMLElement): void => {
		const open = heading.getAttribute("aria-expanded") !== "true";
		heading.setAttribute("aria-expanded", String(open));
		const name = nameOf(heading);
		if (open === !closedByDefault(heading)) delete folded[name];
		else folded[name] = !open;
		try {
			localStorage.setItem(KEY, JSON.stringify(folded));
		} catch {
			// Not kept: it folds for now.
		}
	};

	const headingOf = (target: EventTarget | null): HTMLElement | null =>
		target instanceof Element ? target.closest<HTMLElement>(".settings-fold") : null;

	root.addEventListener("click", (event) => {
		const heading = headingOf(event.target);
		if (heading !== null) toggle(heading);
	});
	root.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		if (!(event.target instanceof HTMLElement) || !event.target.matches(".settings-fold")) return;
		event.preventDefault();
		toggle(event.target);
	});
	new MutationObserver(dress).observe(root, { childList: true, subtree: true });
	dress();
}
