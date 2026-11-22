import { systemPreferences } from "electron";

/** `RRGGBBAA` or `RRGGBB` as the system gives it, as `#rrggbb`; `null` for anything else. */
export function accentHex(raw: string): string | null {
	const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw.trim());
	// kalem-locale-ok: hex digits are ASCII
	return match?.[1] === undefined ? null : `#${match[1].toLowerCase()}`;
}

/**
 * The system's accent colour, `#rrggbb`: Windows' and macOS's own; `null`
 * on Linux, which has none Electron can read. `KALEM_SYSTEM_ACCENT` stands
 * in for it (the tests).
 */
export function systemAccent(): string | null {
	const forced = process.env.KALEM_SYSTEM_ACCENT;
	if (forced !== undefined && forced !== "") return accentHex(forced);
	if (process.platform !== "win32" && process.platform !== "darwin") return null;
	try {
		return accentHex(systemPreferences.getAccentColor());
	} catch {
		return null;
	}
}

/** Calls `changed` when the user picks another accent in the system's settings. */
export function watchSystemAccent(changed: (accent: string | null) => void): void {
	if (process.platform === "win32") {
		systemPreferences.on("accent-color-changed", () => changed(systemAccent()));
	} else if (process.platform === "darwin") {
		systemPreferences.subscribeNotification("AppleColorPreferencesChangedNotification", () =>
			changed(systemAccent()),
		);
	}
}
