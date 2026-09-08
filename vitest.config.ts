import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["**/*.test.ts"],
			reporter: ["text", "lcov"],
			// Eşik yalnızca core için: core saf fonksiyonlardan oluşur, %90
			// gerçekçi ve pazarlıksız. DOM'a dokunan paketlerin asıl güvencesi
			// Playwright tarafında (F0-05).
			thresholds: {
				"packages/core/src/**": {
					statements: 90,
					branches: 85,
					functions: 90,
					lines: 90,
				},
			},
		},
	},
});
