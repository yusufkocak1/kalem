/**
 * Starred Confluence pages in groups the user names. A favorite carries
 * its group's name; a group is there while it holds a favorite, and the
 * groups keep the order in which they first appear in the list.
 */
import type { ConfluenceFavorite } from "./bridge.js";

/** Longest group name kept. */
export const MAX_GROUP_NAME = 100;

export interface FavoriteGroup {
	readonly name: string;
	readonly items: readonly ConfluenceFavorite[];
}

/** A group name as kept: trimmed, one line, not too long; `null` for none. */
export function groupName(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME);
	return name === "" ? null : name;
}

/** A site's favorites as shown: those in no group first, then each group. */
export function favoriteSections(
	favorites: readonly ConfluenceFavorite[],
	site: string,
): { readonly loose: ConfluenceFavorite[]; readonly groups: FavoriteGroup[] } {
	const loose: ConfluenceFavorite[] = [];
	const groups = new Map<string, ConfluenceFavorite[]>();
	for (const item of favorites) {
		if (item.site !== site) continue;
		const name = groupName(item.group);
		if (name === null) loose.push(item);
		else groups.set(name, [...(groups.get(name) ?? []), item]);
	}
	return { loose, groups: [...groups].map(([name, items]) => ({ name, items })) };
}

/** The site's group names, in their order. */
export function groupNames(favorites: readonly ConfluenceFavorite[], site: string): string[] {
	return favoriteSections(favorites, site).groups.map((group) => group.name);
}

const without = ({ group: _group, ...item }: ConfluenceFavorite): ConfluenceFavorite => item;

/** Puts a favorite in `group`, or in none with `null`; it moves to the end of that group. */
export function moveToGroup(
	favorites: readonly ConfluenceFavorite[],
	site: string,
	id: string,
	group: string | null,
): ConfluenceFavorite[] {
	const moved = favorites.find((item) => item.site === site && item.id === id);
	if (moved === undefined) return [...favorites];
	const name = groupName(group);
	const rest = favorites.filter((item) => item !== moved);
	return [...rest, name === null ? without(moved) : { ...moved, group: name }];
}

/** Renames a group; into a name already used, the two become one. */
export function renameGroup(
	favorites: readonly ConfluenceFavorite[],
	site: string,
	from: string,
	to: string,
): ConfluenceFavorite[] {
	const name = groupName(to);
	if (name === null) return [...favorites];
	return favorites.map((item) =>
		item.site === site && groupName(item.group) === from ? { ...item, group: name } : item,
	);
}

/** Takes a group apart: its favorites stay, in no group. */
export function ungroup(
	favorites: readonly ConfluenceFavorite[],
	site: string,
	name: string,
): ConfluenceFavorite[] {
	return favorites.map((item) =>
		item.site === site && groupName(item.group) === name ? without(item) : item,
	);
}
