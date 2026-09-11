import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	treeshake: true,
	platform: "neutral",
	// Vue peer bağımlılık: paketlemek uygulamanın Vue'suyla ikinci bir
	// kopya çalıştırmak olurdu.
	external: ["vue"],
});
