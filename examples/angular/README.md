# `@kalem-editor/wc` — Angular

```bash
pnpm --filter example-angular dev
```

**Angular için de Kalem paketi yok.** Angular'a söylenmesi gereken tek şey
"bu etiketi ben bilmiyorum, tarayıcı biliyor":

```ts
@Component({ schemas: [CUSTOM_ELEMENTS_SCHEMA], template: `
  <kalem-editor [value]="metin()" (input)="girdi($event)"></kalem-editor>
` })
```

- `[value]` — Angular tanımadığı bir elemanda köşeli parantezi **DOM
  özelliği** olarak yazıyor.
- `(input)` — sıradan `addEventListener`; olay `detail.value` taşıyor.
- `viewChild` — imperatif erişim (`focus()`).

Uygulama **zonesiz** (`provideZonelessChangeDetection`): editörün yaydığı
olay bir sinyal yazıyor ve değişiklik algılaması onu görüyor.

> Angular derleyicisi TypeScript sürümüne kilitli. Bu örnek kendi
> `catalogs.ng` girdisinden `~5.9` çekiyor; deponun geri kalanı
> TypeScript 7 kullanıyor.
