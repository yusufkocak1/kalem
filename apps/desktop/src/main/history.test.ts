import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_VERSIONS, VERSION_INTERVAL, VersionStore } from "./history.js";

async function store(): Promise<VersionStore> {
	return new VersionStore(await mkdtemp(join(tmpdir(), "kalem-history-")));
}

const MINUTE = 60 * 1000;

describe("VersionStore", () => {
	it("keeps one version per interval and skips unchanged saves", async () => {
		const versions = await store();
		const doc = join(tmpdir(), "notlar.md");
		await versions.record(doc, "bir", 0);
		await versions.record(doc, "iki", 2 * MINUTE);
		await versions.record(doc, "iki", 3 * MINUTE);
		await versions.record(doc, "üç", VERSION_INTERVAL + 5 * MINUTE);

		const list = await versions.list(doc);
		expect(list.map((version) => version.time)).toEqual([
			VERSION_INTERVAL + 5 * MINUTE,
			2 * MINUTE,
		]);
		expect(await versions.read(doc, String(2 * MINUTE))).toBe("iki");
		expect(list[0]?.size).toBe(Buffer.byteLength("üç"));
	});

	it("keeps documents apart and drops the oldest versions", async () => {
		const versions = await store();
		const a = join(tmpdir(), "a.md");
		const b = join(tmpdir(), "b.md");
		for (let i = 0; i < MAX_VERSIONS + 3; i++) {
			await versions.record(a, `sürüm ${i}`, i * VERSION_INTERVAL);
		}
		await versions.record(b, "başka", 0);

		const list = await versions.list(a);
		expect(list).toHaveLength(MAX_VERSIONS);
		expect(list.at(-1)?.time).toBe(3 * VERSION_INTERVAL);
		expect(await versions.list(b)).toHaveLength(1);
		await expect(versions.read(a, "../b")).rejects.toThrow("Invalid version id");
	});

	it("keeps the text from before the assistant's change, whatever is saved after", async () => {
		const versions = await store();
		const doc = join(tmpdir(), "analiz.md");
		await versions.record(doc, "elle yazılan", 0);
		await versions.checkpoint(doc, "asistan öncesi", MINUTE);
		// A save soon after does not take its place, as a save would take a save's.
		await versions.record(doc, "asistandan sonra", 2 * MINUTE);
		await versions.record(doc, "biraz daha", 3 * MINUTE);

		const list = await versions.list(doc);
		expect(list.map((version) => [version.time, version.kind ?? "save"])).toEqual([
			[3 * MINUTE, "save"],
			[MINUTE, "assistant"],
			[0, "save"],
		]);
		expect(await versions.read(doc, `${MINUTE}.assistant`)).toBe("asistan öncesi");
		// Nothing changed since the last one: no new point.
		await versions.checkpoint(doc, "biraz daha", 4 * MINUTE);
		expect(await versions.list(doc)).toHaveLength(3);
	});
});
