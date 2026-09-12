import { mount } from "svelte";
import App from "./App.svelte";

import "@kalem/themes/tokens.css";
import "@kalem/themes/viewer.css";
import "@kalem/themes/editor.css";
import "./stil.css";

/*
 * Elemanı kaydeden tek satır.
 *
 * `@kalem/wc/define` yan etkili giriş: `defineKalemEditor()` çağrısını
 * kendisi yapıyor. Uygulamadan **önce** çalışması gerekmiyor — özel
 * elemanlar geç kaydolabiliyor, tarayıcı sayfada duran etiketleri o anda
 * yükseltiyor — ama burada durması niyeti okunur kılıyor.
 */
import "@kalem/wc/define";

const kok = document.getElementById("kok");
if (kok !== null) mount(App, { target: kok });
