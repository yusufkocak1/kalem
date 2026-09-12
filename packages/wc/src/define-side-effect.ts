/**
 * `@kalem/wc/define` — tek satırlık kurulum  (İş listesi: F5-03)
 *
 *     import "@kalem/wc/define";
 *
 * Bu modülün **tek işi** yan etki. Ayrı bir giriş olmasının sebebi ağaç
 * sarsma: `@kalem/wc` yan etkisiz ilan edilmiş, yani paketleyici ondan
 * kullanılmayan her şeyi atabiliyor. Kayıt aynı modülde dursaydı ya
 * sarsma kapanırdı ya da kayıt sessizce düşerdi.
 */
import { defineKalemEditor } from "./define.js";

defineKalemEditor();
