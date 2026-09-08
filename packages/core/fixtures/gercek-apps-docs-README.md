# apps/docs — Kalem dokümantasyon sitesi

[Astro Starlight](https://starlight.astro.build) ile kurulmuş doküman sitesi.

## Çalıştırma

```bash
pnpm install
pnpm --filter @kalem/docs dev      # http://localhost:4321
pnpm --filter @kalem/docs build
```

:::note
`package.json` içindeki Astro ve Starlight sürümleri yazıldığı andaki kararlı
sürümlerdir. Kurulumda uyarı alırsanız güncelleyin:
`pnpm dlx @astrojs/upgrade`
:::

## Neden Starlight?

Kütüphanenin ana iddiası framework bağımsızlığı. Starlight, **aynı doküman
sayfasında** vanilla, React ve Vue canlı örneklerini gömebildiği için bu iddiayı
sitenin kendisi kanıtlar (görev F6-03). Vue tabanlı VitePress veya React tabanlı
Docusaurus bu mesajla çelişirdi.

Ayrıca yerleşik gelen: Pagefind araması, i18n, karanlık tema, erişilebilir
varsayılanlar.

## İçerik durumu

Sayfalar **planlanan v1.0 API'sini** dokümante eder — kütüphane henüz yazılmadı.
Her sayfanın başında bunu belirten bir uyarı vardır ve v1.0 yayınında
kaldırılacaktır.

| Sayfa | Durum | Görev |
|---|---|---|
| Başlangıç | Taslak | F6-02 |
| Rehber (6 sayfa) | Taslak | F6-02 |
| Framework'ler (4 sayfa) | Taslak | F6-02 |
| Mimari | Taslak | F6-02 |
| Canlı gömülü örnekler | **Eksik** | F6-03 |
| API referansı (TypeDoc) | **Eksik** | F6-04 |
| Playground | **Eksik** | F6-07 |
| İngilizce çeviri (`en/`) | **Eksik** | F6-10 |
| Tarifler (cookbook) | **Eksik** | F6-02 |

Eksik olanlar kütüphane kodu gerektirir; Faz 6'da tamamlanacaktır.

## Dizin yapısı

```
src/
  content.config.ts       Starlight koleksiyon tanımı
  content/docs/           Markdown/MDX içerik — dizin yapısı = URL yapısı
  styles/kalem.css        Marka renkleri ve tipografi
astro.config.mjs          Kenar çubuğu, diller, site meta
```
