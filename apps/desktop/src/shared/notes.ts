const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * `Not 2026-10-05 14.30` — sortable, and free of characters Windows rejects
 * in file names. A name already taken gets ` (2)`, ` (3)`….
 */
export function quickNoteName(
	prefix: string,
	date: Date,
	taken: (name: string) => boolean,
): string {
	const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
	const base = `${prefix} ${stamp}`;
	if (!taken(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base} (${n})`;
		if (!taken(name)) return name;
	}
}
