/**
 * `@kalem-editor/wc/global` — `<script>` etiketiyle düşen sürüm  (İş listesi: F5-04)
 *
 *     <script src="https://cdn.jsdelivr.net/npm/@kalem-editor/wc/dist/kalem-editor.iife.js"></script>
 *     <kalem-editor label="Belge"># Merhaba</kalem-editor>
 *
 * Modül değil, **IIFE**: `type="module"` yok, import haritası yok, derleme
 * adımı yok. Editörün ve çekirdeğin tamamı bu dosyanın içinde; tarayıcı
 * tek istek yapıyor.
 *
 * ## Neden ayrı bir derleme
 *
 * ESM çıktısı `@kalem-editor/core` ve `@kalem-editor/editor`i **dışarıda** bırakıyor —
 * paketleyici kullanan uygulamada doğrusu bu, yoksa aynı kod iki kez
 * paketlenirdi. Ama bir CDN kullanıcısının paketleyicisi yok: çıplak
 * `import "@kalem-editor/editor"` satırı tarayıcıda çözülmez. Bu giriş onları
 * içeri alıyor.
 *
 * ## Neden kendiliğinden kaydoluyor
 *
 * Modül girişlerinde kayıt açık bir çağrı (`defineKalemEditor()`), çünkü
 * aynı sayfada iki sürümü bulunan bir uygulamayı açılışta patlatmamak
 * gerekiyor. Burada beklenti tersine: script etiketi düşen kişi etiketin
 * çalışmasını bekliyor. Çağrı yine **tekrarlanabilir** — ad zaten
 * kayıtlıysa sessizce geçiliyor — yani sayfaya iki kez eklenmesi hata
 * vermiyor.
 *
 * `window.Kalem` üzerinden imperatif API de duruyor: farklı bir etiket
 * adıyla ikinci bir kayıt ya da sınıfı türetmek isteyen için.
 *
 * ## `exports` haritasında neden yok
 *
 * Bu dosya bir modül değil; `import` edilecek bir yüzeyi ve dolayısıyla
 * tip bildirimi de yok. Haritaya konsaydı tip yayın denetimi (`attw`)
 * haklı olarak "tipsiz giriş" derdi. CDN'ler (jsDelivr, unpkg) dosyayı
 * `exports` haritasına bakmadan, tarball içindeki yolundan servis ediyor.
 */
import { defineKalemEditor } from "./define.js";
import { kalemEditorElement } from "./element.js";

defineKalemEditor();

export { defineKalemEditor, kalemEditorElement };
