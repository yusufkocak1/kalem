import type { Plugin } from "vite";
import { defineConfig } from "vite";

/** Vite's HMR socket needs `ws:`; the packaged app must not allow it. */
function devContentSecurityPolicy(): Plugin {
	return {
		name: "kalem-dev-csp",
		apply: "serve",
		transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws:"),
	};
}

export default defineConfig({
	// Relative: the packaged renderer is loaded from file://.
	base: "./",
	plugins: [devContentSecurityPolicy()],
	build: {
		outDir: "dist/renderer",
		emptyOutDir: true,
		target: "chrome130",
	},
	server: {
		port: 5183,
	},
});
