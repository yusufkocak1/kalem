# `@kalem-editor/react` — Vite + React

```bash
pnpm --filter example-react-vite dev
```

`<KalemEditor>` hem **kontrollü** (`value` + `onChange`) hem
**kontrolsüz** (`defaultValue`) çalışıyor; buradaki uygulama kontrollü
kipi kullanıyor.

- `src/App.tsx` — metin React durumunda; `value` dışarıdan değiştiğinde
  editöre iniyor.
- `Durum` bileşeni `<KalemEditor>`in **çocuğu**: editöre `useKalem()` ile,
  metne `useKalemValue()` ile erişiyor. İkisi de sarmalayıcının API'sinin
  tamamı.

Editör yalnızca **bir kez** kuruluyor; `lang`, `label` ve `plugins` montaj
anında okunuyor. Değişebilen `value` ve `readOnly` editörün kendi API'siyle
güncelleniyor.

Uygulama `<StrictMode>` altında: React 19'un geliştirme kipi her etkiyi
kurup söküp yeniden kuruyor ve editör bunu tek bir örnekle atlatıyor.
