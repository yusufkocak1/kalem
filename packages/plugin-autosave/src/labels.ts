/**
 * @kalem/plugin-autosave — Metinler  (İş listesi: F4-07)
 *
 * Durum adları doğrudan anahtar: gösterge `labels[state]` diyor ve yeni
 * bir durum eklendiğinde derleyici eksik metni gösteriyor.
 */
import type { SaveState } from "./plugin.js";

export type AutosaveLabels = Readonly<Record<SaveState, string>>;

export const enAutosaveLabels: AutosaveLabels = {
	idle: "",
	dirty: "Unsaved changes",
	saving: "Saving…",
	saved: "Saved",
	error: "Could not save",
};

export const trAutosaveLabels: AutosaveLabels = {
	idle: "",
	dirty: "Kaydedilmemiş değişiklik",
	saving: "Kaydediliyor…",
	saved: "Kaydedildi",
	error: "Kaydedilemedi",
};

/** Belge diline göre sözlük; yalnızca dil koduna bakılıyor, bölgeye değil. */
export function labelsFor(lang: string | null | undefined): AutosaveLabels {
	// kalem-locale-ok: dil kodları ASCII; Türkçe kuralı burada zarar verir
	return lang?.toLowerCase().startsWith("tr") === true ? trAutosaveLabels : enAutosaveLabels;
}
