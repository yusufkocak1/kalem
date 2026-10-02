import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface LaunchOptions {
	/** Reuse a profile from an earlier launch. */
	readonly userData?: string;
	readonly args?: readonly string[];
	readonly settings?: Record<string, unknown>;
	readonly welcomed?: boolean;
}

export interface Launched {
	readonly app: ElectronApplication;
	readonly page: Page;
	readonly userData: string;
	/** Uncaught renderer errors and console errors seen so far. */
	readonly errors: string[];
}

export async function tempDir(prefix: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `kalem-${prefix}-`));
}

export async function launch(options: LaunchOptions = {}): Promise<Launched> {
	const userData = options.userData ?? (await tempDir("profile"));
	if (options.userData === undefined) {
		await mkdir(userData, { recursive: true });
		await writeFile(
			join(userData, "settings.json"),
			JSON.stringify({
				settings: { language: "en", theme: "light", ...options.settings },
				welcomed: options.welcomed ?? true,
			}),
		);
	}

	// Inherited when the tests are started from an Electron-based host (VS Code);
	// it would make the app start as plain Node.
	const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
	const app = await electron.launch({
		args: [appDir, ...(options.args ?? [])],
		env: { ...(env as Record<string, string>), KALEM_USER_DATA_DIR: userData, KALEM_DEV_URL: "" },
		// Playwright forces a light colour scheme by default, which would hide the app's own theme.
		colorScheme: null,
	});
	const page = await app.firstWindow();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.locator("#editor [contenteditable]").first().waitFor();
	return { app, page, userData, errors };
}

export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
	await app.evaluate(({ dialog }, path) => {
		dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
	}, filePath);
}

/** Makes every message box answer with the given button index. */
export async function stubMessageBox(app: ElectronApplication, response: number): Promise<void> {
	await app.evaluate(({ dialog }, index) => {
		dialog.showMessageBox = async () => ({ response: index, checkboxChecked: false });
	}, response);
}

/** Clicks an application menu item by its label path, e.g. `["File", "Save As…"]`. */
export async function clickMenu(app: ElectronApplication, ...labels: string[]): Promise<void> {
	await app.evaluate(({ Menu, BrowserWindow }, path) => {
		let items = Menu.getApplicationMenu()?.items ?? [];
		let found: Electron.MenuItem | undefined;
		for (const label of path) {
			found = items.find((item) => item.label === label);
			if (found === undefined) throw new Error(`Menu item not found: ${path.join(" > ")}`);
			items = found.submenu?.items ?? [];
		}
		const window = BrowserWindow.getAllWindows()[0];
		found?.click(undefined, window, window?.webContents);
	}, labels);
}

export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
	await app.evaluate(({ dialog }, paths) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
	}, filePaths);
}
