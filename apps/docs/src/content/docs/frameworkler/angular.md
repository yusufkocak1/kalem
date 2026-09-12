---
title: Angular
description: CUSTOM_ELEMENTS_SCHEMA ile sarmalayıcısız kurulum.
---

**Angular için de Kalem paketi yok.** Angular'a söylenmesi gereken tek şey
"bu etiketi ben bilmiyorum, tarayıcı biliyor".

```bash
npm i @kalem/wc @kalem/themes
```

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA, type ElementRef, signal, viewChild } from '@angular/core';

type Kalem = HTMLElement & { value: string; readOnly: boolean };

@Component({
  selector: 'app-belge',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <kalem-editor
      #kutu
      class="editor"
      label="Belge"
      [value]="metin()"
      [readOnly]="saltOkunur()"
      (input)="girdi($event)"
    ></kalem-editor>

    <p>{{ metin().length }} karakter</p>
  `,
})
export class BelgeComponent {
  readonly metin = signal('# Merhaba');
  readonly saltOkunur = signal(false);

  private readonly kutu = viewChild<ElementRef<Kalem>>('kutu');

  girdi(olay: Event): void {
    this.metin.set((olay as CustomEvent<{ value: string }>).detail.value);
  }

  odakla(): void {
    this.kutu()?.nativeElement.focus();
  }
}
```

Elemanı kaydetmeyi unutmayın — `main.ts` içinde tek satır:

```ts
import '@kalem/wc/define';
```

## Bağlama nasıl çalışıyor

- **`[value]`** — Angular tanımadığı bir elemanda köşeli parantezi **DOM
  özelliği** olarak yazıyor, yani `el.value = …` çalışıyor.
- **`(input)`** — sıradan `addEventListener`; olay `detail.value` taşıyor.
- **`viewChild`** — imperatif erişim (`focus()`, `el.editor`).

`strictTemplates` açıkken `$event` tipi `Event`; `detail`e erişmek için
bileşen metodunda daraltın (yukarıdaki `girdi`).

## Sonsuz döngü kendiliğinden kırılıyor

Elemanın `value` setter'ı, gelen metin güncel metinle aynıysa duruyor.
Kullanıcı yazıyor → olay → sinyal → bağlama aynı metni geri yazıyor →
setter sessizce duruyor. İmleç yerinde kalıyor.

## Zonesiz çalışıyor

Örnek `provideZonelessChangeDetection()` kullanıyor: editörün yaydığı olay
bir sinyal yazıyor ve Angular'ın değişiklik algılaması onu görüyor.
Zone.js kurmanıza gerek yok.

```ts
bootstrapApplication(App, {
  providers: [provideZonelessChangeDetection()],
});
```

## Stil

Bileşen kapsamlı CSS (`ViewEncapsulation.Emulated`, varsayılan) editörün
**içine** ulaşmıyor: oradaki düğümleri Angular üretmediği için
`_ngcontent-*` özniteliğini almıyorlar. Tema dosyalarını global
`styles` listesine ekleyin:

```json
"styles": [
  "node_modules/@kalem/themes/css/tokens.css",
  "node_modules/@kalem/themes/css/viewer.css",
  "node_modules/@kalem/themes/css/editor.css",
  "src/styles.css"
]
```

## Reactive Forms

`<kalem-editor>` bir form-associated custom element; yani **sıradan HTML
formlarında** `name` ile doğrudan çalışıyor. Angular'ın `ReactiveForms`u
için bir `ControlValueAccessor` yazmanız gerekiyor — eleman `value`,
`input` ve `disabled` sunduğu için on beş satırlık bir iş.

## Çalışan örnek

[`examples/angular`](https://github.com/yusufkocak1/kalem/tree/main/examples/angular)
— Angular 21, zonesiz, CI'da derleniyor ve sekiz tarayıcı testiyle
sınanıyor.

Elemanın tüm yüzeyi: [Web Components](/frameworkler/web-components/).
