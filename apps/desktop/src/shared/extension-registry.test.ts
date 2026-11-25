import { describe, expect, it } from "vitest";
import {
	blockedReason,
	latestCompatible,
	parseIndex,
	parseRegistries,
} from "./extension-registry.js";

const HASH = "a".repeat(64);
const KEY = "MCowBQYDK2VwAyEAN+3XazxLR7ME2uPajmicLCL2T/3/gtCGK1rOhZrTo7U=";

describe("parseRegistries", () => {
	it("keeps catalogs with an address and a key", () => {
		expect(
			parseRegistries([
				{ name: "Kalem", url: "https://example.com/index.json", publicKey: KEY },
				{ name: "No key", url: "https://example.com/other.json" },
				{ name: "Not web", url: "file:///index.json", publicKey: KEY },
				{ name: "Twice", url: "https://example.com/index.json", publicKey: KEY },
			]),
		).toEqual([{ name: "Kalem", url: "https://example.com/index.json", publicKey: KEY }]);
	});
});

describe("parseIndex", () => {
	const index = parseIndex(
		{
			name: "Acme",
			extensions: [
				{
					id: "acme.graylog",
					name: "Graylog",
					version: "1.0.0",
					engine: ">=3.0.0",
					url: "graylog-1.0.0.kalem-ext",
					sha256: HASH,
					permissions: { httpFromSettings: ["url"], assistantTools: true },
				},
				{
					id: "acme.graylog",
					name: "Graylog",
					version: "1.2.0",
					engine: ">=3.0.0",
					url: "graylog-1.2.0.kalem-ext",
					sha256: HASH,
				},
				{
					id: "acme.graylog",
					name: "Graylog",
					version: "2.0.0",
					engine: ">=9.0.0",
					url: "graylog-2.0.0.kalem-ext",
					sha256: HASH,
				},
				{
					id: "acme.run",
					name: "Run",
					version: "1.0.0",
					url: "https://cdn.example.com/run.kalem-ext",
					sha256: HASH,
				},
				{
					id: "acme.icon",
					version: "1.0.0",
					url: "icon.kalem-ext",
					sha256: HASH,
					icon: "data:image/svg+xml;base64,PHN2Zy8+",
				},
				{
					id: "acme.script",
					version: "1.0.0",
					url: "script.kalem-ext",
					sha256: HASH,
					icon: "javascript:alert(1)",
				},
				{ id: "acme.bad", version: "1.0.0", url: "x", sha256: "nothex" },
				{ id: "acme.local", version: "1.0.0", url: "file:///etc/passwd", sha256: HASH },
			],
			blocked: [{ id: "acme.run", versions: "<1.1.0", reason: "Leaks the token." }],
		},
		"https://example.com/catalog/index.json",
	);

	it("resolves package addresses next to the index and drops what cannot be trusted", () => {
		expect(index.entries.map((entry) => `${entry.id}@${entry.version}`)).toEqual([
			"acme.graylog@1.0.0",
			"acme.graylog@1.2.0",
			"acme.graylog@2.0.0",
			"acme.run@1.0.0",
			"acme.icon@1.0.0",
			"acme.script@1.0.0",
		]);
		expect(index.entries.find((entry) => entry.id === "acme.icon")?.icon).toBe(
			"data:image/svg+xml;base64,PHN2Zy8+",
		);
		expect(index.entries.find((entry) => entry.id === "acme.script")?.icon).toBe("");
		expect(index.entries[0]?.url).toBe("https://example.com/catalog/graylog-1.0.0.kalem-ext");
		expect(index.entries[0]?.permissions.httpFromSettings).toEqual(["url"]);
	});

	it("offers the newest version this Kalem runs, and nothing blocked", () => {
		expect(
			latestCompatible(index, "3.35.0").map((entry) => `${entry.id}@${entry.version}`),
		).toEqual(["acme.icon@1.0.0", "acme.script@1.0.0", "acme.graylog@1.2.0"]);
		expect(blockedReason(index, "acme.run", "1.0.0")).toBe("Leaks the token.");
		expect(blockedReason(index, "acme.run", "1.1.0")).toBeNull();
	});
});
