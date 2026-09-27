/**
 * @kalem-editor/vue — Bağlam  (İş listesi: F5-02)
 *
 * React tarafındaki `useKalem()`in Vue karşılığı: `provide` / `inject`.
 *
 * Verilen şey bir `ShallowRef`, düz bir değer değil. Sebep zamanlama:
 * editör `onMounted` içinde kuruluyor, yani alt bileşenlerin `setup`ı
 * çalıştığında henüz yok. Ref olunca alt bileşen ona **abone** kalıyor ve
 * editör hazır olduğunda kendiliğinden güncelleniyor.
 */
import type { Editor } from "@kalem-editor/editor";
import type { InjectionKey, ShallowRef } from "vue";
import { inject, shallowRef } from "vue";

export const KALEM_KEY: InjectionKey<ShallowRef<Editor | null>> = Symbol("kalem");

/**
 * Editör örneği — `<KalemEditor>`in içindeki bileşenler için.
 *
 * Sağlayıcı dışında çağrılırsa hep `null` taşıyan bir ref dönüyor:
 * hata atmak, isteğe bağlı bir araç çubuğunu zorunlu kılardı.
 */
export function useKalem(): ShallowRef<Editor | null> {
	return inject(KALEM_KEY, shallowRef<Editor | null>(null));
}
