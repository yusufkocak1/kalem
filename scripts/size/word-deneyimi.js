/**
 * "Word deneyimi" boyut ölçümünün giriş noktası  (İş listesi: F3-11)
 *
 * ## Neden ayrı bir dosya
 *
 * `.size-limit.json` içinde iki yol verip `import: "*"` yazmak **sessizce
 * yanlış ölçüyordu**: size-limit yalnızca ilk dosyayı hesaba katıyor ve
 * kalanı ölçüm dışı bırakıyordu. Bütçe 58 kB'ken ölçüm 2.81 kB
 * görünüyordu — yani projenin en görünür vaadini koruyan kapı, aslında
 * hiçbir şeyi korumuyordu.
 *
 * Her iki dosyaya da `import: "*"` vermek de mümkün değil: size-limit
 * ikisi için de `import * as all` üretiyor ve isimler çakışıyor.
 *
 * Gerçek bir giriş dosyası bu belirsizliği ortadan kaldırıyor: burada ne
 * yazıyorsa o ölçülüyor.
 */
// Göreli yol şart: size-limit giriş dosyasını geçici bir klasöre kopyalıyor
// ve orada `node_modules` çözümlemesi çalışmıyor.
import * as editor from "../../packages/editor/dist/index.js";
import * as ui from "../../packages/ui/dist/index.js";

export { editor, ui };
