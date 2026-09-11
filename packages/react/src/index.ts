/**
 * `@kalem/react` — React sarmalayıcısı  (İş listesi: F5-01)
 *
 *     import { KalemEditor } from "@kalem/react";
 *     import "@kalem/themes/tokens.css";
 *     import "@kalem/themes/viewer.css";
 *     import "@kalem/themes/editor.css";
 *
 *     <KalemEditor defaultValue="# Merhaba" onChange={(md) => console.log(md)} />
 *
 * React bir **peer** bağımlılık: paket kendi kopyasını taşımıyor.
 * `react >= 17` yeterli — `useSyncExternalStore` 18'de geldi ama
 * `use-sync-external-store` shim'i olmadan da 17'de derleniyor; kancayı
 * yalnızca `useKalemValue` kullanıyor.
 */

export { KalemContext, useKalem, useKalemValue } from "./context.js";
export type { KalemEditorProps } from "./KalemEditor.js";
export { KalemEditor } from "./KalemEditor.js";
