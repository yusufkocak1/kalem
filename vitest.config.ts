import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Paketler arası import'lar **kaynağa** yönlendiriliyor, `dist`'e değil.
 *
 * Aksi hâlde `@kalem/core`'u kullanan bir test, `pnpm build` unutulduğunda
 * eski bundle'a bakar ve yanlış sonuç verir — bu tuzağa F2-02 yazılırken
 * bir kez düşüldü: kaynakta düzeltilen ayrıştırıcı hatası testte hâlâ
 * hatalı görünüyordu.
 */
const kaynak = (yol: string) => fileURLToPath(new URL(yol, import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@kalem\/core$/, replacement: kaynak("./packages/core/src/index.ts") },
			{ find: /^@kalem\/core\/(.*)$/, replacement: kaynak("./packages/core/src/$1.ts") },
		],
	},
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
