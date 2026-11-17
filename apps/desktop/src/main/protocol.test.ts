import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ net: {}, protocol: {} }));

const { servedPath } = await import("./protocol.js");

const url = (text: string): URL => new URL(text);
const none = new Set<string>();

describe("kalem-doc addresses", () => {
	it("serves pictures next to a document on a drive", () => {
		expect(servedPath(url("kalem-doc://local/C%3A/Docs/img/a.png"), true, none)).toBe(
			"C:\\Docs\\img\\a.png",
		);
		expect(servedPath(url("kalem-doc://local/home/u/a.png"), false, none)).toBe("/home/u/a.png");
	});

	it("never reaches a share no open document is on", () => {
		const attack = url("kalem-doc://local//evil.example/share/x.png");
		expect(attack.pathname).toBe("//evil.example/share/x.png");
		expect(servedPath(attack, true, none)).toBeNull();
		expect(
			servedPath(url("kalem-doc://local/%5C%5Cevil.example%5Cshare%5Cx.png"), true, none),
		).toBeNull();
		expect(
			servedPath(url("kalem-doc://local/%2F%2F%2Fevil.example/share/x.png"), true, none),
		).toBeNull();
	});

	it("reads a share an open document is on", () => {
		const shares = new Set(["\\\\files\\docs"]);
		expect(servedPath(url("kalem-doc://local//FILES/Docs/img/a.png"), true, shares)).toBe(
			"\\\\FILES\\Docs\\img\\a.png",
		);
		expect(servedPath(url("kalem-doc://local//files/other/a.png"), true, shares)).toBeNull();
	});

	it("refuses other hosts, device paths, streams and files that are not pictures", () => {
		expect(servedPath(url("kalem-doc://evil.example/C%3A/a.png"), true, none)).toBeNull();
		expect(servedPath(url("kalem-doc://local//%3F/C%3A/a.png"), true, none)).toBeNull();
		expect(servedPath(url("kalem-doc://local/C%3A/a.png%3Ax"), true, none)).toBeNull();
		expect(servedPath(url("kalem-doc://local/C%3A/secret.txt"), true, none)).toBeNull();
		expect(servedPath(url("kalem-doc://local/share/a.png"), true, none)).toBeNull();
	});
});

const { imageResponse } = await import("./protocol.js");

const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	),
	(char) => char.charCodeAt(0),
);

describe("pictures from Confluence and Jira", () => {
	it("passes a picture on with the type its bytes have", async () => {
		const sent = new Response(PNG, {
			headers: { "Content-Type": "application/octet-stream", "Cache-Control": "max-age=60" },
		});
		const shown = await imageResponse(sent);
		expect(shown?.headers.get("Content-Type")).toBe("image/png");
		expect(shown?.headers.get("Cache-Control")).toBe("max-age=60");
		expect(new Uint8Array((await shown?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(PNG);
	});

	it("turns away a sign-in page, an error and an empty answer sent for a picture", async () => {
		const signIn = new Response("<!DOCTYPE html><html><title>Log in</title></html>", {
			headers: { "Content-Type": "text/html;charset=UTF-8" },
		});
		expect(await imageResponse(signIn)).toBeNull();
		expect(await imageResponse(new Response(PNG, { status: 401 }))).toBeNull();
		expect(await imageResponse(new Response(new Uint8Array(0)))).toBeNull();
	});

	it("keeps a picture whose bytes it does not know when the server calls it one", async () => {
		const tiff = new Response(Uint8Array.of(0x49, 0x49, 0x2a, 0x00), {
			headers: { "Content-Type": "image/tiff" },
		});
		expect((await imageResponse(tiff))?.headers.get("Content-Type")).toBe("image/tiff");
	});
});
