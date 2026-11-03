import { describe, expect, it } from "vitest";
import type { ConfluenceFavorite } from "./bridge.js";
import { favoriteSections, groupName, moveToGroup, renameGroup, ungroup } from "./favorites.js";

const site = "https://wiki";
const fav = (id: string, group?: string, at = site): ConfluenceFavorite => ({
	site: at,
	id,
	title: `Sayfa ${id}`,
	...(group === undefined ? {} : { group }),
});

describe("favorite groups", () => {
	it("shows the loose favorites first, then the groups in the order they appear", () => {
		const all = [
			fav("1", "B"),
			fav("2"),
			fav("3", "A"),
			fav("4", "B"),
			fav("5", "A", "https://other"),
		];
		const { loose, groups } = favoriteSections(all, site);
		expect(loose.map((item) => item.id)).toEqual(["2"]);
		expect(groups.map((group) => [group.name, group.items.map((item) => item.id)])).toEqual([
			["B", ["1", "4"]],
			["A", ["3"]],
		]);
	});

	it("moves a favorite into a group, out of one, renames and takes groups apart", () => {
		let all = [fav("1"), fav("2"), fav("3", "Eski")];
		all = moveToGroup(all, site, "1", "  Yeni   grup ");
		expect(all.at(-1)).toEqual(fav("1", "Yeni grup"));
		all = moveToGroup(all, site, "1", null);
		expect(all.at(-1)).toEqual(fav("1"));
		all = renameGroup(all, site, "Eski", "Yeni");
		expect(all.find((item) => item.id === "3")?.group).toBe("Yeni");
		all = ungroup(all, site, "Yeni");
		expect(all.every((item) => item.group === undefined)).toBe(true);
		expect(groupName("   ")).toBeNull();
		expect(groupName("x".repeat(300))).toHaveLength(100);
	});
});
