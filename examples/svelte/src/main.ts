import { mount } from "svelte";
import App from "./App.svelte";

import "@kalem-editor/themes/tokens.css";
import "@kalem-editor/themes/viewer.css";
import "@kalem-editor/themes/editor.css";
import "./stil.css";

/*
 * Elemanı kaydeden tek satır.
 *
 * `@kalem-editor/wc/define` yan etkili giriş: `defineKalemEditor()` çağrısını
 * kendisi yapıyor. Uygulamadan **önce** çalışması gerekmiyor — özel
 * elemanlar geç kaydolabiliyor, tarayıcı sayfada duran etiketleri o anda
 * yükseltiyor — ama burada durması niyeti okunur kılıyor.
 */
import "@kalem-editor/wc/define";

const kok = document.getElementById("kok");
if (kok !== null) mount(App, { target: kok });
