import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { App } from "./app";

/*
 * Elemanı kaydeden tek satır.
 *
 * Angular için bir Kalem paketi yok; `<kalem-editor>` tarayıcının kendi
 * bileşen modeli ve Angular onu `CUSTOM_ELEMENTS_SCHEMA` ile tanıyor
 * (`app.ts`).
 */
import "@kalem/wc/define";

bootstrapApplication(App, {
	// Zone.js yok: değişiklik algılama sinyallerden besleniyor. Editörün
	// yaydığı olay bir sinyal yazıyor, Angular da onu görüyor.
	providers: [provideZonelessChangeDetection()],
}).catch((hata: unknown) => {
	console.error(hata);
});
