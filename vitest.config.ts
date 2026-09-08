import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: ["**/*.test.ts", "**/*.test-helper.ts"],
			reporter: ["text", "lcov"],
			// Eşik yalnızca core için: core saf fonksiyonlardan oluşur, yüksek
			// kapsam gerçekçi ve pazarlıksız. DOM'a dokunan paketlerin asıl
			// güvencesi Playwright tarafında (F0-05).
			//
			// F0-05 %90 ile başlamıştı; F1-02'nin kabul kriteri %95 olduğu için
			// yükseltildi. Şu anki gerçek kapsam %100.
			thresholds: {
				"packages/core/src/**": {
					statements: 95,
					branches: 95,
					functions: 95,
					lines: 95,
				},
			},
		},
	},
});
