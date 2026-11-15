import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

/**
 * A picture of the page or a part of it, for a person to look at, when
 * `KALEM_SHOTS` names a folder; nothing otherwise.
 */
export async function shot(target: Page | Locator, name: string): Promise<void> {
	const folder = process.env.KALEM_SHOTS;
	if (folder === undefined || folder === "") return;
	await mkdir(folder, { recursive: true });
	await target.screenshot({ path: join(folder, `${name}.png`), animations: "disabled" });
}
