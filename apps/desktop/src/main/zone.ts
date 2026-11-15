import { writeFile } from "node:fs/promises";

/** Windows' "from the internet" mark (zone 3), as a browser leaves on what it downloads. */
export function zoneIdentifier(source: string): string {
	const url = /^https?:\/\//i.test(source) ? source.replace(/[\r\n]/g, "") : "";
	return `[ZoneTransfer]\r\nZoneId=3\r\n${url === "" ? "" : `HostUrl=${url}\r\n`}`;
}

/**
 * Marks a downloaded file so Windows and Office treat it as from the
 * internet (SmartScreen, Protected View, macros blocked). A volume without
 * alternate streams (FAT, a network share) keeps the file unmarked.
 */
export async function markFromInternet(path: string, source: string): Promise<void> {
	if (process.platform !== "win32") return;
	await writeFile(`${path}:Zone.Identifier`, zoneIdentifier(source)).catch(() => {});
}
