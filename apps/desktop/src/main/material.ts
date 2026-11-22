import { release } from "node:os";
import type { WindowMaterial } from "../shared/bridge.js";

/** Windows 11 22H2: the first build whose windows can take Mica (`backgroundMaterial`). */
const MICA_BUILD = 22621;

/**
 * The system material a new window takes behind its frame (`windowMaterial`):
 * Mica on Windows 11 22H2 and later, vibrancy on macOS, none elsewhere or
 * when the setting is off.
 */
export function windowMaterial(
	enabled: boolean,
	platform: string = process.platform,
	osRelease: string = release(),
): WindowMaterial {
	if (!enabled) return null;
	if (platform === "darwin") return "vibrancy";
	if (platform !== "win32") return null;
	// "10.0.22631": major, minor, build.
	const build = Number(osRelease.split(".")[2]);
	return Number.isFinite(build) && build >= MICA_BUILD ? "mica" : null;
}
