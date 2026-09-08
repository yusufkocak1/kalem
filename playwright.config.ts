import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
	use: {
		baseURL: "http://localhost:5173",
		trace: "on-first-retry",
		// Türkçe locale varsayılan: locale'e duyarlı davranışlar (F6-10)
		// varsayılan olarak Türkçe altında test edilir; İngilizce'de geçip
		// Türkçe'de patlayan hataların CI'a girmesi bu şekilde zorlaşır.
		locale: "tr-TR",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: {
		command: "node scripts/serve-demo.mjs 5173",
		url: "http://localhost:5173",
		reuseExistingServer: !process.env.CI,
		stdout: "ignore",
	},
});
