/** Desktop releases are the ones tagged `desktop-v<version>`; the repository has other tags too. */
export const RELEASES_URL = "https://api.github.com/repos/yusufkocak1/kalem/releases?per_page=30";
const TAG_PREFIX = "desktop-v";

export interface Release {
	readonly version: string;
	readonly tag: string;
	/** The release's web page. */
	readonly page: string;
	/** Where `latest.yml` and the installer are downloaded from. */
	readonly downloads: string;
	/** Whether the release carries the installer's update manifest. */
	readonly installable: boolean;
}

/** `[major, minor, patch]`, or `null` for anything that is not a plain release version. */
function parts(version: string): [number, number, number] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
	return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: string, b: string): number {
	const left = parts(a);
	const right = parts(b);
	if (left === null || right === null) return 0;
	for (let i = 0; i < 3; i++) {
		const diff = (left[i] as number) - (right[i] as number);
		if (diff !== 0) return Math.sign(diff);
	}
	return 0;
}

/** The newest published desktop release in a GitHub releases listing. */
export function latestRelease(listing: unknown): Release | null {
	if (!Array.isArray(listing)) return null;
	let best: Release | null = null;
	for (const raw of listing) {
		if (typeof raw !== "object" || raw === null) continue;
		const release = raw as Record<string, unknown>;
		const tag = release.tag_name;
		if (typeof tag !== "string" || !tag.startsWith(TAG_PREFIX)) continue;
		if (release.draft === true || release.prerelease === true) continue;
		const version = tag.slice(TAG_PREFIX.length);
		if (parts(version) === null) continue;
		if (best !== null && compareVersions(version, best.version) <= 0) continue;

		const assets = Array.isArray(release.assets) ? release.assets : [];
		const installable = assets.some(
			(asset) =>
				typeof asset === "object" &&
				asset !== null &&
				(asset as { name?: unknown }).name === "latest.yml",
		);
		best = {
			version,
			tag,
			page:
				typeof release.html_url === "string"
					? release.html_url
					: "https://github.com/yusufkocak1/kalem/releases",
			downloads: `https://github.com/yusufkocak1/kalem/releases/download/${tag}`,
			installable,
		};
	}
	return best;
}

/** Automatic checks run at most this often. */
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export function checkDue(lastCheck: number | null, now: number): boolean {
	return lastCheck === null || now - lastCheck >= CHECK_INTERVAL || now < lastCheck;
}
