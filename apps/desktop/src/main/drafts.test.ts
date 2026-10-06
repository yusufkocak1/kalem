import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FORMAT } from "../shared/encoding.js";
import { DraftStore } from "./drafts.js";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

let folder: string;
let store: DraftStore;

beforeEach(async () => {
	folder = join(await mkdtemp(join(tmpdir(), "kalem-drafts-")), "drafts");
	store = new DraftStore(folder);
});

afterEach(async () => {
	await rm(join(folder, ".."), { recursive: true, force: true });
});

describe("DraftStore", () => {
	it("lists nothing when the folder does not exist", async () => {
		expect(await store.list()).toEqual([]);
	});

	it("writes, lists oldest first and deletes", async () => {
		const crlf = { ...DEFAULT_FORMAT, lineEnding: "crlf" as const };
		await store.write(
			ID_B,
			{ path: null, name: "Adsız", text: "ikinci", format: DEFAULT_FORMAT },
			200,
		);
		await store.write(ID_A, { path: "C:\\a.md", name: "a", text: "birinci", format: crlf }, 100);

		expect(await store.list()).toEqual([
			{ id: ID_A, path: "C:\\a.md", name: "a", text: "birinci", format: crlf, time: 100 },
			{ id: ID_B, path: null, name: "Adsız", text: "ikinci", format: DEFAULT_FORMAT, time: 200 },
		]);

		await store.delete(ID_A);
		expect((await store.list()).map((draft) => draft.id)).toEqual([ID_B]);
		await store.delete(ID_A);
	});

	it("keeps the Confluence page a draft belongs to", async () => {
		const remote = {
			site: "https://acme.atlassian.net/wiki",
			id: "42",
			title: "Plan",
			spaceKey: "DEV",
			version: 3,
			webUrl: "https://acme.atlassian.net/wiki/spaces/DEV/pages/42",
		};
		await store.write(
			ID_A,
			{ path: null, remote, name: "Plan", text: "x", format: DEFAULT_FORMAT },
			1,
		);
		await store.write(
			ID_B,
			{
				path: null,
				remote: { ...remote, id: "../x" },
				name: "y",
				text: "y",
				format: DEFAULT_FORMAT,
			},
			2,
		);
		const [a, b] = await store.list();
		expect(a?.remote).toEqual(remote);
		expect(b?.remote).toBeUndefined();
	});

	it("overwrites the draft of the same window and leaves no temp file", async () => {
		const request = { path: null, name: "x", format: DEFAULT_FORMAT };
		await store.write(ID_A, { ...request, text: "eski" }, 1);
		await store.write(ID_A, { ...request, text: "yeni" }, 2);
		expect((await store.list()).map((draft) => draft.text)).toEqual(["yeni"]);
		expect(await readdir(folder)).toEqual([`${ID_A}.json`]);
	});

	it("rejects ids that could escape the folder", async () => {
		const request = { path: null, name: "x", text: "y", format: DEFAULT_FORMAT };
		await expect(store.write("../evil", request, 1)).rejects.toThrow("Invalid draft id");
		await expect(store.delete("..\\..\\settings")).rejects.toThrow("Invalid draft id");
	});

	it("skips corrupt and foreign files", async () => {
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, `${ID_A}.json`), "{ truncated");
		await writeFile(join(folder, `${ID_B}.json`), JSON.stringify({ name: "no text" }));
		await writeFile(join(folder, "notes.txt"), "hello");
		expect(await store.list()).toEqual([]);
	});
});
