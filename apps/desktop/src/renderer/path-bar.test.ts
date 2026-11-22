import { describe, expect, it } from "vitest";
import type { Workspace, WorkspaceEntry } from "../shared/bridge.js";
import { folderEntries, parentOf, pathSegments } from "./path-bar.js";

function entry(path: string, folder = false): WorkspaceEntry {
	return { path, name: path.split(/[\\/]/).pop() ?? path, depth: 0, folder };
}

function workspace(root: string, entries: WorkspaceEntry[]): Workspace {
	return {
		roots: [{ path: root, entries, truncated: false, git: null, untrustedRepo: null }],
		opened: true,
	};
}

describe("pathSegments", () => {
	it("goes from the workspace folder down to the document", () => {
		const ws = workspace("/home/a/proje", []);
		expect(pathSegments("/home/a/proje/specs/odeme.md", null, ws)).toEqual([
			{ label: "proje", folder: "/home/a/proje", current: false },
			{ label: "specs", folder: "/home/a/proje/specs", current: false },
			{ label: "odeme.md", folder: "/home/a/proje/specs", current: true },
		]);
	});

	it("keeps Windows paths' separators", () => {
		const ws = workspace("C:\\Users\\a\\proje", []);
		expect(
			pathSegments("C:\\Users\\a\\proje\\specs\\odeme.md", null, ws).map((s) => s.folder),
		).toEqual(["C:\\Users\\a\\proje", "C:\\Users\\a\\proje\\specs", "C:\\Users\\a\\proje\\specs"]);
	});

	it("names a document outside the workspace by its folder", () => {
		const segments = pathSegments("/tmp/x/not.md", null, workspace("/home/a/proje", []));
		expect(segments.map((s) => s.label)).toEqual(["x", "not.md"]);
		expect(segments[0]?.folder).toBeNull();
	});

	it("names a Confluence page by its space, and has nothing for an unsaved document", () => {
		expect(
			pathSegments(null, { spaceKey: "ANLZ", title: "İptal" }, null).map((s) => s.label),
		).toEqual(["ANLZ", "İptal"]);
		expect(pathSegments(null, null, null)).toEqual([]);
	});

	it("does not take a folder whose name only starts the same", () => {
		const ws = workspace("/home/a/pro", []);
		expect(pathSegments("/home/a/proje/x.md", null, ws).map((s) => s.label)).toEqual([
			"proje",
			"x.md",
		]);
	});
});

describe("folderEntries", () => {
	it("lists a folder's own entries, folders first, by name", () => {
		const ws = workspace("/p", [
			entry("/p/b.md"),
			entry("/p/specs", true),
			entry("/p/specs/odeme.md"),
			entry("/p/a.md"),
		]);
		expect(folderEntries(ws, "/p", "tr").map((e) => e.name)).toEqual(["specs", "a.md", "b.md"]);
		expect(folderEntries(ws, "/p/specs", "tr").map((e) => e.name)).toEqual(["odeme.md"]);
		expect(parentOf("/p/specs/odeme.md")).toBe("/p/specs");
	});
});
