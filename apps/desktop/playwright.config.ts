import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	// Each test launches its own Electron instance.
	workers: 1,
	reporter: "list",
	outputDir: "test-results",
});
