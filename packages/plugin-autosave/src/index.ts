/**
 * `@kalem/plugin-autosave` — Otomatik kaydetme  (İş listesi: F4-07)
 *
 * Yazma durunca kaydeder, durumu bildirir, kaydedilemeyeni yerel depoda
 * tutar.
 *
 *     import { autosavePlugin } from "@kalem/plugin-autosave";
 *     import "@kalem/themes/plugin-autosave.css";
 *
 *     const eklenti = autosavePlugin({
 *       storageKey: "kalem:taslak:42",
 *       async save(markdown, signal) {
 *         await fetch("/api/belge/42", { method: "PUT", body: markdown, signal });
 *       },
 *     });
 *
 * Ağ hakkında hiçbir şey bilmiyor: `save` kancası çağrılıyor, gerisi
 * gömen uygulamanın.
 */
export type { AutosaveLabels } from "./labels.js";
export { enAutosaveLabels, labelsFor, trAutosaveLabels } from "./labels.js";
export type { AutosaveOptions, AutosavePlugin, SaveState } from "./plugin.js";
export { autosavePlugin } from "./plugin.js";
export type { SaveIndicator } from "./status.js";
export { createIndicator } from "./status.js";
