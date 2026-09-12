# apps/docs — Kalem dokümantasyon sitesi

[Astro Starlight](https://starlight.astro.build) ile kurulmuş doküman sitesi.

## Çalıştırma

```bash
pnpm install
pnpm docs:dev      # http://localhost:4321
pnpm docs:build    # dist/ + Pagefind arama indeksi
pnpm guard:docs    # örneklerdeki API adları gerçekten var mı
```

> Astro 7 **Node 22.12+** istiyor; deponun geri kalanı Node 20'de de
> koşuyor. Bu yüzden site CI'da kendi işinde (`dokuman`) derleniyor.

## Neden Starlight?

Kütüphanenin ana iddiası framework bağımsızlığı. Starlight, **aynı doküman
sayfasında** vanilla, React ve Vue canlı örneklerini gömebildiği için bu
iddiayı sitenin kendisi kanıtlıyor: `/canli/` sayfasında üç editör aynı
anda çalışıyor ve dokuz tarayıcı testi bunu sabitliyor. Vue tabanlı
VitePress veya React tabanlı Docusaurus bu mesajla çelişirdi.

Site artık paketleri **gerçekten tüketiyor**, yani `pnpm docs:build`
öncesinde `pnpm build` gerekiyor.

Ayrıca yerleşik gelen: Pagefind araması, i18n, koyu tema, erişilebilir
varsayılanlar.

## Marka teması

`src/styles/kalem.css` renkleri uydurmuyor: `@kalem/themes/tokens.css`
paletinin aynısı. Sitenin ürünle aynı renkte olması süs değil — okuyucu,
ekran görüntüsündeki editörle sayfanın kendisi arasında bir kopukluk
görmemeli. Starlight'ın soğuk gri merdiveni de Kalem'in sıcak nötrleriyle
değiştiriliyor.

## İki dil

`root` Türkçe, `en` İngilizce. Starlight çevrilmemiş bir sayfayı
varsayılan dile **düşürüyor** ve okuyucuya "bu içerik henüz sizin
dilinizde yok" diyor; yani İngilizce bölüm yarım da olsa site kırılmıyor.
Kenar çubuğu etiketleri iki dilde de yazılı (`astro.config.mjs`), içerik
çevirisi F6-10'un işi.

## İçerik durumu

| Sayfa | Durum | Görev |
|---|---|---|
| Başlangıç · Rehber (7) · Framework'ler (9) · Tarifler (5) · Mimari | ✅ Gerçek API'ye göre yazıldı | F6-02 |
| Canlı gömülü örnekler (`/canli/`) | ✅ vanilla + React + Vue, aynı sayfada | F6-03 |
| API referansı (TypeDoc) | Eksik | F6-04 |
| Landing sayfası | Taslak | F6-05 |
| Playground | Eksik | F6-07 |
| İngilizce çeviri (`en/`) | İskelet var, içerik yok | F6-10 |

## Doküman kapısı

Site bir kez, kütüphane yazılmadan önce yazıldı ve on beş görev boyunca
kimse fark etmeden yanlış kaldı: "beş satırda ilk editör" örneği
`toolbar()`, `slashMenu()` ve `dragHandle()` çağırıyordu — üçü de hiç var
olmadı.

`pnpm guard:docs` bunu bir daha olmaz hâle getiriyor: her
`import { … } from "@kalem/…"` satırındaki her adın paketin gerçek dışa
aktarmaları arasında olup olmadığına bakıyor. Tip denetimi değil —
örnekler kısaltılmış olduğu için derlenmeleri beklenmiyor — ama yazılan
adların var olması beklenebilir.

## Dizin yapısı

```
src/
  content.config.ts       Starlight koleksiyon tanımı
  content/docs/           Markdown/MDX içerik — dizin yapısı = URL yapısı
  styles/kalem.css        Marka renkleri ve tipografi
astro.config.mjs          Kenar çubuğu (iki dilde), diller, site meta
```
