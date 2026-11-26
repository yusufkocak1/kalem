import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: { fetch: () => Promise.reject(new Error("no network")) } }));

const { RegistryClient, sha256, verifySignature } = await import("./extension-registry.js");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const KEY = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const URL = "https://catalog.example.com/index.json";

function serving(files: Record<string, Uint8Array | string>) {
	return async (url: string): Promise<Response> => {
		const file = files[url];
		return file === undefined
			? new Response(null, { status: 404 })
			: new Response(file as unknown as BodyInit);
	};
}

function catalog(packageBytes: Uint8Array, tamperIndex = false) {
	const index = Buffer.from(
		JSON.stringify({
			name: "Acme",
			extensions: [
				{
					id: "acme.tool",
					version: "1.0.0",
					url: "acme.tool-1.0.0.kalem-ext",
					sha256: sha256(packageBytes),
				},
			],
		}),
	);
	const signature = sign(null, index, privateKey).toString("base64");
	return {
		[URL]: tamperIndex ? Buffer.concat([index, Buffer.from(" ")]) : index,
		[`${URL}.sig`]: signature,
		"https://catalog.example.com/acme.tool-1.0.0.kalem-ext": packageBytes,
	};
}

describe("RegistryClient", () => {
	const bytes = new Uint8Array([1, 2, 3]);

	it("trusts a signed index and the package it names", async () => {
		const client = new RegistryClient(serving(catalog(bytes)));
		const index = await client.index({ name: "Acme", url: URL, publicKey: KEY });
		expect(index.entries.map((entry) => entry.id)).toEqual(["acme.tool"]);
		expect(await client.download(index.entries[0] as (typeof index.entries)[number])).toEqual(
			bytes,
		);
	});

	it("asks the server for the index and its signature each time, past the HTTP cache", async () => {
		const files = catalog(bytes);
		const asked: [string, RequestCache | undefined][] = [];
		const fetch = (url: string, init?: RequestInit) => {
			asked.push([url, init?.cache]);
			return serving(files)(url);
		};
		const client = new RegistryClient(fetch);
		await client.index({ name: "Acme", url: URL, publicKey: KEY }, true);
		expect(asked).toEqual([
			[URL, "no-cache"],
			[`${URL}.sig`, "no-cache"],
		]);
	});

	it("refuses an index changed after it was signed, or signed with another key", async () => {
		await expect(
			new RegistryClient(serving(catalog(bytes, true))).index({
				name: "Acme",
				url: URL,
				publicKey: KEY,
			}),
		).rejects.toThrow(/signature does not match/);
		const other = generateKeyPairSync("ed25519")
			.publicKey.export({ type: "spki", format: "der" })
			.toString("base64");
		await expect(
			new RegistryClient(serving(catalog(bytes))).index({
				name: "Acme",
				url: URL,
				publicKey: other,
			}),
		).rejects.toThrow(/signature does not match/);
	});

	it("refuses a package whose bytes are not the signed ones", async () => {
		const files = catalog(bytes);
		files["https://catalog.example.com/acme.tool-1.0.0.kalem-ext"] = new Uint8Array([9]);
		const client = new RegistryClient(serving(files));
		const index = await client.index({ name: "Acme", url: URL, publicKey: KEY });
		await expect(
			client.download(index.entries[0] as (typeof index.entries)[number]),
		).rejects.toThrow(/sha256 differs/);
	});

	it("checks signatures", () => {
		const data = Buffer.from("x");
		expect(verifySignature(data, sign(null, data, privateKey).toString("base64"), KEY)).toBe(true);
		expect(verifySignature(data, "AAAA", KEY)).toBe(false);
		expect(verifySignature(data, "AAAA", "not a key")).toBe(false);
	});
});
