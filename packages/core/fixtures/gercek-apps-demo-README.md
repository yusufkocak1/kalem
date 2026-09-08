# apps/demo — Kalem prototipi

`index.html` tek dosyalık, bağımsız bir **mimari doğrulama prototipidir**.
Kütüphanenin kendisi değildir.

## Çalıştırma

Bağımlılık gerekmez — dosyayı tarayıcıda açın:

```bash
start index.html          # Windows
```

Yayımlanmış hâli: https://claude.ai/code/artifact/12236fdb-f13a-4c35-aafa-c073672dce8e

## Neyi kanıtlıyor

Analiz dokümanı §5.1'deki **Seçenek C** (blok-tabanlı hibrit motor) mimarisinin
çalıştığını gösterir:

| Gösterilen | İlgili karar |
|---|---|
| Her blok ayrı `contenteditable` | §5.1 — contenteditable acısını tarayıcıya devretme |
| Blok tutamacıyla sürükle-bırak | §6 — Word'ün "paragrafı taşı" davranışı |
| `Ctrl+Shift+↑/↓` ile klavye alternatifi | §5.1 / F3-10 — sürükle-bırak tek yol olamaz |
| Seçimde balon araç çubuğu | F3-01 |
| `/` komut menüsü | F3-03 |
| Giriş kuralları (`# `, `- `, `> `, ` ``` `) | F2-10 |
| Canlı Markdown serileştirme | F1-07 |
| AST görünümü (mdast uyumlu) | §5.2 |
| Word HTML → AST normalizasyonu | F1-09 / F3-07 |
| URL protokol beyaz listesi | §5.7 |

## Prototipin bilinçli eksikleri

Bunlar gerçek kütüphanede farklı yapılacaktır:

- Biçimlendirme `document.execCommand` ile — **gerçek motor kendi satır içi
  format motorunu kullanacak** (F2-07)
- Kendi undo/redo yığını yok; tarayıcının undo'su kullanılıyor (F2-09)
- Gidiş-dönüş sadakati yok; sözdizimi tercihleri saklanmıyor (F1-03, F1-07)
- Bloklar arası sürükleyerek çoklu seçim yok (F2-06)
- Ayrıştırıcı yok — yalnızca serileştirme var (F1-03, F1-04)
- İç içe liste, tablo UI, görsel yok

## Sonraki adım

Bu dosya, iş listesindeki **F1.5-01** görevinin başlangıç noktasıdır.
`docs/01-is-listesi.md` → Faz 1.5'teki riskli senaryo matrisini bu prototiple
doldurun; sonuç `docs/02-spike-sonuclari.md` dosyasına yazılır.
