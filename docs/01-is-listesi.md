# Kalem — Adım Adım İş Listesi (v1.0 Yol Haritası)

> Tarih: 2026-09-08 · Analiz dokümanı: [00-analiz.md](./00-analiz.md)
> **Alınan kararlar bu plana gömülüdür.**

## Karar Özeti

| # | Karar | Sonuç |
|---|---|---|
| 1 | Editör motoru | **Kendi blok-tabanlı motorumuz** (Seçenek C). Sıfır 3rd-party runtime bağımlılığı. |
| 2 | Marka / scope | **Kalem** · `@kalem/*` |
| 3 | Yayın stratejisi | **Sessiz geliştirme.** npm'e ilk yayın = v1.0. Tek ve güçlü duyuru. |
| 4 | Dokümantasyon | **Astro Starlight** |
| 5 | Tablo | **v1 kapsamı dışında.** v1.1'de `@kalem/plugin-table` olarak gelir. |
| 6 | Mobil | v1'de **"çalışır ama optimize değil".** Dokunmatik cila v1.1. |
| 7 | Lisans | MIT *(varsayılan — F0-08'de nihai onay)* |

**Sessiz geliştirmenin iki bedeli var, ikisini de plana yazdım:**
- Geri bildirim yok → yerine **F1.5 spike'ı** ve **kendi projelerinde dogfooding** (F5-05) konuldu.
- Duyuru tek atış → **Faz 6'nın tamamı** (docs + demo + README) v1.0'ın parçası, sonraya bırakılamaz.

---

## İlerleme Durumu

> Son güncelleme: 2026-09-24 · `main` · `pnpm verify` yeşil · 1369 birim + 1218 tarayıcı + 88 örnek/uygulama testi
>
> Uzak depo: [yusufkocak1/kalem](https://github.com/yusufkocak1/kalem) (private)

| Faz | Görev | Durum |
|---|---|---|
| **Faz 0** — Temel altyapı | 8 / 8 | ✅ **Tamamlandı** |
| **Faz 1** — `@kalem/core` | 11 / 11 | ✅ **Tamamlandı** |
| **Faz 1.5** — Doğrulama spike'ı | 0 / 3 | ⏭️ Atlandı (Faz 2'ye geçildi) |
| **Faz 2** — Viewer + başsız editör | 13 / 13 | ✅ **Tamamlandı** |
| **Faz 3** — Word deneyimi | 11 / 11 | 🟡 Bitti (elle SR testi hariç) |
| **Faz 4** — Eklentiler | 7 / 7 | ✅ **Tamamlandı** |
| **Faz 5** — Sarmalayıcılar | 5 / 5 | 🟡 Bitti (2 haftalık kullanım sürüyor) |
| **Faz 6** — Cila ve yayın | 12 / 14 | 🔵 Sürüyor |
| | **67 / 72** | **%93** |

**İşaretler:** ✅ bitti · 🔵 devam ediyor · 🟡 kısmen · ⬜ başlanmadı · ⏭️ atlandı

### 👉 Şu an buradayız

**Bitenler:** `F0-01` … `F0-08` · `F1-01` … `F1-11` · `F2-01` … `F2-13` ·
**`F3-01` … `F3-11` (Faz 3 tamam; F3-10'un elle SR testi hariç)** · `F4-01` · `F4-02` · `F4-03` · `F4-04` · `F4-05` · `F4-06` · `F4-07` **(Faz 4 tamam)** · `F5-01` · `F5-02` · `F5-03` · `F5-04` · `F5-05` **(Faz 5 tamam; dogfooding uygulaması yazıldı, 2 haftalık kullanım sürüyor)** · `F6-01` · `F6-02` · `F6-03` · `F6-04` · `F6-05` · `F6-06` · `F6-07` · `F6-08` · `F6-09` · `F6-10` · `F6-11` · `F6-12`

**Sıradaki:** `F6-13` v1.0.0 yayını — hazırlık yapıldı, `npm publish` kullanıcının onayını bekliyor.

**Açık işler:** NVDA/VoiceOver ile elle test (F3-10) ve `apps/notlar`ın
iki haftalık günlük kullanımı (F5-05) — ikisi de bir insanın masasında
yapılmak zorunda.
Ayrıca playground'un
barındırılması ve `kalem.dev` alan adı (403 dönüyor).

> **Faz 1.5 atlandı.** Karar kullanıcının: doğrudan Faz 2'ye geçildi.
> Prototip (`apps/demo/index.html`) duruyor, riskli senaryo matrisi boş.
>
> **Faturası kesildi:** matristeki *"bloklar arası sürükleyerek seçim"*
> satırı F2-06'da gerçek kodda patladı — Chrome seçimi `contenteditable`
> köküne hapsediyor, plan bunun tersini varsayıyordu. Bir günlük ek iş
> oldu, mimariyi değiştirmedi. Kalan riskler: IME ve mobil klavye
> (`F2-13`).

> **Boyut kararı (uygulandı):** editöre özgü iki modül ayrı giriş
> noktalarına alındı. Boyut kapısı bunu kendisi dayattı — core bütçeyi
> 102 B aşınca kırdı.
>
> | Giriş | Boyut | Bütçe |
> |---|---|---|
> | `@kalem/core` | 11.51 kB | 12 kB |
> | `@kalem/core/commands` | 2.28 kB | 4 kB |
> | `@kalem/core/html` | 2.21 kB | 6 kB |
> | `@kalem/viewer` | 2.68 kB | 14 kB |
> | `@kalem/themes/viewer.css` | 1.16 kB | 3 kB |
> | `@kalem/themes/editor.css` | 340 B | 2 kB |
> | `@kalem/themes/ui.css` | 1.35 kB | 3 kB |
> | `@kalem/editor` (core + viewer dâhil) | 22.38 kB | 38 kB |
> | `@kalem/editor` + `@kalem/ui` | 27.58 kB | 58 kB |
>
> Gerekçe ikisinde de aynı: yalnızca Markdown işleyen kullanıcı (SSR,
> derleme betiği) editör komutlarını ve yapıştırma dönüştürücüsünü
> indirmemeli. Analiz §5.3 bunu öngörmüştü.
>
> ⚠️ **Core'da 0.49 kB kaldı.** Core özellik olarak tamam; buraya yeni
> bir şey eklenecekse ya bütçe gerekçelendirilerek yükseltilmeli ya da
> modül ayrı giriş noktasına alınmalı.

> **Karar (kapandı):** `F1-08` tam olarak F1-03'ten önce kurulamaz — gidiş-dönüş
> koşucusu hem `parse` hem `serialize` olmadan hiçbir şey koşamaz. Bunun yerine
> ayrıştırıcı ve serileştirici **blok tipi başına birlikte** ilerletiliyor;
> koşucu ikisi de var olur olmaz devreye girecek.

**Yazılan kod:** `@kalem/core` — AST tipleri, künye kaydı, tip koruyucular,
gezinme/konum/düzenleme yardımcıları, kaynak tarayıcı, blok ve satır içi
ayrıştırıcı, serileştirici, güvenlik katmanı, komutlar, HTML dönüştürücü.
`@kalem/viewer` — render planı, `renderToDOM`, `renderToString`.
`@kalem/themes` — görüntüleyici ve editör stilleri (saf CSS).
`@kalem/editor` — blok kapsayıcı, model↔DOM eşlemesi, satır içi geri okuma,
iki seviyeli seçim, satır içi biçimlendirme, klavye ve blok yapısı düzenleme,
geri al/yinele, giriş kuralları, pano, eklenti sistemi. **Faz 2 kapandı.**
`@kalem/ui` — balon araç çubuğu, bağlantı akışı, slash menü, yer tutucu.
**924 birim testi** + **518 tarayıcı testi** (Chromium · Firefox · WebKit),
axe ile WCAG 2.1 A/AA taraması ve CDP ile IME bileşimi dâhil.
`parse(md)` ↔ `serialize(ast)` gidiş-dönüş 17/17 byte-birebir;
`renderToDOM` ↔ `renderToString` üç motorda byte-birebir.

> **Faz 2'nin ilk bulduğu şey Faz 1 hatası oldu.** Viewer testleri yazılırken
> üç gerçek kusur çıktı ve düzeltildi:
> 1. `core`'un giriş noktası `parse`'ı hiç dışa aktarmıyordu — paket
>    dışarıdan kullanılamaz hâldeydi ve tüm testler modülleri doğrudan
>    import ettiği için hiçbiri bunu görmüyordu.
> 2. Bağlantı hedefinde **dengeli parantez** desteklenmiyordu:
>    `[a](https://.../Kalem_(araç))` bağlantı bile sayılmıyordu.
> 3. Bağlantı başlığında ters bölü kaçışı (`"tır\"nak"`) çalışmıyordu.
>
> (2) ve (3) tek bir regex'ten kaynaklanıyordu; hedef/başlık okuması elle
> yazılmış bir tarayıcıya taşındı. Ders: paketler arası testler `dist`'e
> değil kaynağa bakmalı — `vitest.config.ts`'e takma ad eklendi.

**Kayıt dokümanları:** [Faz 0 sonucu](./02-faz0-sonuc.md) ·
[F1-01 AST kararları](./03-f1-01-ast-kararlari.md)

---

## Efor Notasyonu

`[S]` ≈ 1 gün · `[M]` ≈ 2–4 gün · `[L]` ≈ 1–2 hafta · `[XL]` ≈ 2–4 hafta
Tek geliştirici, tam zamanlı olmayan tempo varsayımıyla. **Toplam tahmin: 6–9 ay.**

Her görevde: **Çıktı** (ne üretilir) ve **Kabul** (ne zaman bitti sayılır).

---

# FAZ 0 — Temel Altyapı ✅ TAMAMLANDI (2026-09-08)
**Amaç:** Kod yazmadan önce, yanlış yapmayı zorlaştıran bir iskelet. **Süre: ~1 hafta**

> `pnpm verify` uçtan uca yeşil. Kurulum kararlarının ayrıntısı ve doğrulama
> çıktıları: [02-faz0-sonuc.md](./02-faz0-sonuc.md)

### F0-01 · Monorepo iskeleti `[S]` ✅
- pnpm workspace kur (`pnpm-workspace.yaml`), `packages/*`, `apps/*`, `examples/*`
- Kök `package.json`: `private: true`, ortak scriptler (`build`, `test`, `lint`, `size`)
- Node 22 + pnpm 10 sürüm sabitleme (`packageManager` alanı, `.nvmrc`)
- **Çıktı:** çalışan boş monorepo
- **Kabul:** `pnpm install` temiz geçiyor

### F0-02 · TypeScript yapılandırması `[S]` ✅
- Kök `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- Paket başına `tsconfig.json` + project references
- **Kabul:** `tsc --noEmit` tüm workspace'te temiz

### F0-03 · Build hattı `[M]` ✅
- `tsdown` (veya `tsup`) ile paket başına build: ESM + CJS + `.d.ts`; `@kalem/editor` için ayrıca IIFE (CDN)
- `package.json` `exports` haritası + `sideEffects: false` + `files` alanı
- `publint` + `@arethetypeswrong/cli` ile paket sağlığı kontrolü
- **Kabul:** boş bir paket build alıyor, `publint` sıfır uyarı veriyor

### F0-04 · Lint / format `[S]` ✅
- **Biome** (tek bağımlılık, ESLint+Prettier yerine)
- Pre-commit hook (`simple-git-hooks` + `lint-staged` — dev bağımlılığı, runtime'a girmez)
- **Locale kuralı ⭐:** `toLowerCase()`, `toUpperCase()` ve `localeCompare()` çıplak kullanımı **yasaklanır**; yerine `toLocaleLowerCase(locale)` / `toLocaleUpperCase(locale)` / `localeCompare(x, locale)` zorunlu tutulur (Biome `noRestrictedSyntax` veya özel `grep` kapısı)
- **Kabul:** `pnpm lint` temiz; çıplak `toLowerCase()` ekleyen bir dal CI'ı kırıyor

> **Bu kural neden gün 1'de?** Türkçe'de `i`'nin büyüğü `I` değil `İ`, `I`'nın küçüğü `i` değil `ı`. İngilizce test edilen `toLowerCase()` çağrısı Türkçe'de **sessizce yanlış** çalışır — patlamaz, sadece arama sonucu bulmaz. Faz 6'da toplamaya kalkarsan onlarca yere yayılmış olur; lint kuralı bir günlük iş, sonradan temizlik bir haftalık.

### F0-05 · Test altyapısı `[M]` ✅
- **Vitest** (birim) + **Playwright** (tarayıcı) kurulumu
- Coverage raporu (v8), eşik: `core` için %90
- **Kabul:** örnek bir birim testi ve bir Playwright testi geçiyor

### F0-06 · CI hattı (GitHub Actions) `[M]` ✅
- İş akışı: install → lint → typecheck → test → build → **size-limit** → publint
- Matrix: Node 20 + 22
- **Kabul:** PR'da tüm kontroller yeşil

### F0-07 · İki koruyucu kapı ⭐ `[M]` ✅
Bunlar projenin iki temel vaadini **otomatik** koruyan testlerdir. Bunlar olmadan vaatler zamanla erir.
1. **Boyut kapısı:** `size-limit` yapılandırması, bütçeler analiz §5.6'daki tabloya göre. Aşım = build kırmızı.
2. **Saflık kapısı:** özel script — `packages/{core,viewer,editor,ui}` için `dependencies` boş mu; üretim bundle'ında `react`/`vue`/`preact` string'i geçiyor mu; `core` bundle'ında `document`/`window` erişimi var mı (SSR güvenliği).
- **Kabul:** kasıtlı olarak React import eden bir dal CI'ı kırıyor

### F0-08 · Proje hijyeni `[S]` ✅
- `LICENSE` (MIT — **nihai onay burada**), `README.md` (taslak), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- GitHub issue/PR şablonları, `.editorconfig`, `.gitignore`
- **Changesets** kurulumu (yayın v1.0'da olacak ama changelog gün 1'den birikmeli)
- **Kabul:** repo dışarıdan bakıldığında ciddi görünüyor

> **FAZ 0 ÇIKIŞ KRİTERİ:** Boş ama üzerine güvenle inşa edilebilir bir monorepo. CI, henüz var olmayan vaatleri koruyor.

---

# FAZ 1 — `@kalem/core` 🔵 DEVAM EDİYOR (2 / 11)
**Amaç:** DOM'suz, saf, test edilebilir Markdown çekirdeği. **Süre: ~5–7 hafta**

> Bu faz tamamen saf fonksiyonlardan oluşur — hızlı ve keyifli test edilir. Editörün en riskli kısmına girmeden önce sağlam bir zemin kurar.

### F1-01 · AST tip tanımları `[S]` ✅
- Analiz §5.2'deki `Block` / `Inline` tipleri, `id` ve `position` alanları
- Tip koruyucular (`isBlock`, `isInline`), `NodeSpec` kayıt tipi
- **Kabul:** tipler `core/src/ast.ts`'te, sıfır runtime kodu

> **Yapıldı.** `ast.ts` (tip-saf, 0 runtime) + `spec.ts` (künye kaydı) +
> `guards.ts` (9 koruyucu). 42 test, core kapsamı %100.
> Taslaktan üç sapma mdast uyumu lehine yapıldı — ayrıntı:
> [03-f1-01-ast-kararlari.md](./03-f1-01-ast-kararlari.md)

### F1-02 · AST yardımcıları `[M]` ✅
- `walk`, `visit`, `find`, `replace`, `remove`, `insertAt`, `clone`
- Konum yardımcıları: `pathToNode`, `nodeAtPath`
- **Kabul:** her fonksiyon için birim testi, %95 kapsam

> **Yapıldı.** `path.ts` (yol çözme) + `traverse.ts` (gezinme) + `edit.ts`
> (düzenleme). 109 test, core kapsamı **%100** (dallar ve fonksiyonlar dahil);
> kapsam eşiği %90'dan %95'e çekildi.
>
> **Karar: düzenleme işlemleri değişmez (immutable).** `insertAt` / `replaceAt`
> / `removeAt` girdiyi değiştirmez, yapısal paylaşımla yeni ağaç döndürür —
> yalnızca yol üzerindeki atalar kopyalanır. F2-09'un geri al/ileri al yığını
> ve F2'nin render karşılaştırması bunun üzerine kurulacak.

### F1-03 · Blok ayrıştırıcı `[L]` ✅
CommonMark blok yapısı: paragraf, ATX + setext başlık, fenced + indented kod, blockquote, liste (sırasız/sıralı, tight/loose, iç içe), thematic break, HTML blokları, boş satır işleme
- **Kritik:** her düğüme `position` (satır/sütun ofset) ve **sözdizimi tercihi** meta verisi yaz (`marker: '-' | '*' | '+'`, `fence: '```' | '~~~'`, `headingStyle: 'atx' | 'setext'`)
- **Kabul:** CommonMark spec suite'in blok bölümünde ≥ %90 geçiş

> **Yapıldı.** `scanner.ts` (satır bölme, sekme genişletme) + `blocks.ts`.
> Paragraf, ATX + setext başlık, yatay çizgi, çitli + girintili kod,
> blockquote (iç içe, tembel devam), liste (sırasız/sıralı, iç içe,
> sıkı/gevşek), HTML blokları (7 türün hepsi), bağlantı tanımları.
> Her düğümde `position` ve yazım tercihi var. 299 test.
>
> **Bilinen kısıtlar:** çok satırlı bağlantı tanımı desteklenmiyor;
> paragrafın girintili devam satırlarında baştaki boşluk atılıyor
> (CommonMark gereği ama gidiş-dönüşü etkiler). Spec suite F1-08'le koşulacak.

### F1-04 · Satır içi ayrıştırıcı `[L]` ✅
Vurgu (`*`/`_`, CommonMark'ın delimiter-run algoritması), kod span, link, referanslı link, görsel, autolink, ham HTML, kaçış karakterleri, hard/soft break
- **Uyarı:** Vurgu algoritması CommonMark'ın en zor kısmı. Referans implementasyonu birebir takip et, kestirme yapma.
- **Kabul:** spec suite'in satır içi bölümünde ≥ %90 geçiş

> **Yapıldı.** `inline.ts` — iki geçişli: önce belirteçleme, sonra
> CommonMark'ın sınırlayıcı eşleştirme algoritması. Vurgu (`*`/`_`, iç içe
> ve üçün kuralı dahil), üstü çizili, kod span, autolink, ham satır içi
> HTML, ters bölü kaçışı, sert/yumuşak satır sonu, bağlantı, görsel,
> üç biçimde başvurulu bağlantı (tam/daraltılmış/kısayol).
>
> `parse.ts` iki katmanı birleştiriyor: **`parse(md)` artık çalışıyor.**
> Spec suite F1-08'le koşulacak.

### F1-05 · GFM uzantıları `[M]` ✅
Üstü çizili (`~~`), görev listesi (`- [ ]`), otomatik link literal, **tablo ayrıştırma** (motor v1'de UI vermeyecek ama parser/serializer tabloyu **kayıpsız korumalı** — kullanıcının dosyasını bozmamak için zorunlu)
- **Kabul:** GFM spec testleri geçiyor; tablo içeren dosya parse→serialize'da bozulmuyor

> **Yapıldı.** Görev listesi (`- [ ]` / `- [x]`), tablo (hizalama, kaçırılmış
> boru, eksik/fazla hücre), otomatik bağlantı literali (`https://`, `www.`,
> e-posta; sondaki noktalama ve dengesiz parantez kırpılıyor). Üstü çizili
> F1-04'te gelmişti. Tablo `syntax.raw` ile kayıpsız korunuyor.

### F1-06 · Frontmatter `[S]` ✅
YAML/TOML frontmatter'ı **ayrıştırma, sadece koru** (opak string olarak). YAML parser bağımlılığı **eklenmez**.
- **Kabul:** frontmatter'lı dosya gidiş-dönüşte birebir korunuyor

> **Yapıldı.** YAML (`---`) ve TOML (`+++`) sınırlayıcıları, yalnızca dosyanın
> ilk satırında. İçerik opak string olarak korunuyor — YAML ayrıştırıcısı
> bağımlılığı eklenmedi. Kapanmamış sınırlayıcı yatay çizgiye/paragrafa
> düşüyor. Sırası F1-04'ün önüne alındı: blok katmanına ait ve `blocks.ts`
> zaten açıktı.

### F1-07 · Serileştirici (AST → Markdown) `[L]` ✅
- F1-03'te saklanan sözdizimi tercihlerini **kullan** — kullanıcının `*` kullandığı yerde `*` üret
- Yeni düğümler için yapılandırılabilir varsayılanlar (`bulletMarker`, `emphasisMarker`, `codeFence`)
- Doğru kaçışlama (metin içindeki `*`, `_`, `#`, `[` vb.)
- **Kabul:** F1-08'deki gidiş-dönüş testleri geçiyor

> **Yapıldı.** Yazım tercihleri kullanılıyor, yeni düğümler için
> `SerializeOptions` varsayılanları var. Kaçışlama **bağlama duyarlı**:
> `5 * 3` kaçırılmıyor, `### 1. Başlık` içindeki `1.` kaçırılmıyor.
> Blok arası boş satır sayısı `position`'dan okunuyor — F1-01'de bunun için
> ayrı alan açmama kararının karşılığı.

### F1-08 · Gidiş-dönüş test koşucusu ⭐ `[M]` ✅
**Projenin en önemli test altyapısı.**
- Golden-file koşucusu: `fixtures/*.md` → `serialize(parse(md)) === md` byte düzeyinde
- Korpus topla: CommonMark spec örnekleri, 30+ popüler repo README'si, Obsidian vault örneği, karmaşık iç içe listeler, tablo içeren dosyalar
- İdempotans testi: `serialize(parse(x)) === serialize(parse(serialize(parse(x))))`
- Property-based test (`fast-check`, dev-only): rastgele AST → serialize → parse → derin eşitlik
- **Kabul:** korpusun ≥ %95'i byte-birebir; kalan %5 bilinçli ve dokümante istisna

> **Yapıldı.** Golden-file koşucusu, idempotans, CommonMark korpusu,
> özellik tabanlı test.
>
> - **17/17 dosya byte-birebir** (analiz, iş listesi, CONTRIBUTING; CRLF+BOM)
> - **652 CommonMark örneğinde sıfır patlama**, idempotans ≥ %98
> - Özellik testi **yedi gerçek serileştirici hatası** buldu (boş vurgu,
>   boş kod span'i, kenardaki satır sonu, işaret yanındaki boşluk, sınır
>   çakışması, saran işaretin sağladığı "eş", `!` + `[` görsel tuzağı)
>
> ⚠️ **Açık kalan:** spec suite `markdown → HTML` karşılaştırır; HTML
> render'ı (`renderToString`) **F2-02**'de. Asıl uyum oranı o zaman
> ölçülecek — iş listesinde yakalanmamış bir bağımlılık. Spec verisi
> `html` alanıyla birlikte depoda, hazır.

### F1-09 · HTML → AST dönüştürücü `[L]` ✅
Yapıştırma normalizasyonunun beyni. Word, Google Docs, Excel, Notion ve genel web HTML'ini AST'ye çevirir.
- Beyaz liste yaklaşımı; bilinmeyen etiket = içeriği düz metne düşür
- Word'e özgü temizlik: `mso-*` stilleri, `<o:p>`, boş `<span>` yığınları, listeyi taklit eden `<p class="MsoListParagraph">`
- Google Docs: `<b style="font-weight:normal">` sarmalayıcısı gibi bilinen tuzaklar
- Stil çıkarımı: `font-weight:bold` → `strong`, `font-style:italic` → `emphasis`
- **Kabul:** gerçek Word ve GDocs kopya çıktılarından oluşan fixture seti doğru AST üretiyor
- **Not:** Bu görev sürekli iyileştirilir; v1 için "makul" hedeflenir, "mükemmel" değil

> **Yapıldı.** `@kalem/core/html` — **ayrı giriş noktası**. Yalnızca Markdown
> işleyen kullanıcı bu kodu indirmez (2.21 kB, core bütçesinin dışında).
>
> DOM tipleri kullanılmıyor: dönüştürücü, gerçek bir `Element`'in yapısal
> olarak uyduğu küçük bir arayüzle çalışıyor. HTML metnini DOM'a çevirmek
> çağıranın işi; testler jsdom olmadan düz nesnelerle yazılıyor.
>
> Beyaz liste, stil çıkarımı (`font-weight` → `strong`), Word `<o:p>` ve boş
> `<span>` yığını temizliği, **Google Docs sahte kalını** (`<b
> style="font-weight:normal">`), görev listesi onay kutusu, tablo.
> Yapıştırma en olası XSS yüzeyi olduğu için F1-10 kuralları burada da
> uygulanıyor.

### F1-10 · Güvenlik katmanı `[M]` ✅
- URL protokol beyaz listesi (`http`, `https`, `mailto`, `tel`, göreli); `javascript:`, `vbscript:`, `data:` (görsel istisnası hariç) reddedilir
- HTML düğümü politikası: varsayılan escape; `allowHtml` + `sanitizeHtml` kancası
- **Kabul:** XSS payload fixture seti (50+ vektör) hiçbirini geçirmiyor

> **Yapıldı.** 55 vektör, hepsi engelleniyor. Şema kontrolü `URL` sınıfına
> değil RFC 3986 dil bilgisine dayanıyor (core tarayıcı API'sine bağlanamaz)
> ve **önce kontrol karakterlerini temizliyor** — `java	script:` gibi
> vektörler tam olarak bu adım atlandığı için çalışır.
> `data:image/svg+xml` görsel bağlamında bile **reddediliyor**: SVG içinde
> script çalışır.

### F1-11 · Komut çekirdeği (saf) `[M]` ✅
DOM'suz, AST üzerinde çalışan işlemler: `toggleMark`, `setBlockType`, `wrapIn`, `lift`, `splitBlock`, `joinBlocks`, `insertNode`
- Editör bunları çağıracak; saf oldukları için Faz 2'den bağımsız test edilirler
- **Kabul:** her komut için birim testi

> **Yapıldı.** `toggleMark`, `hasMark`, `setBlockType`, `wrapIn`, `lift`,
> `splitBlock`, `joinBlocks`, `insertNode` + boş düğüm kurucuları. Hepsi
> `edit.ts` gibi değişmez.
> **Bilinçli sınır:** `lift` şimdilik yalnızca kapsayıcının ilk ya da son
> çocuğunu çıkarabiliyor; ortadaki, kapsayıcıyı ikiye bölmeyi gerektiriyor
> ve editör ihtiyacı netleşmeden tasarlanmamalı (F2).

> **FAZ 1 ÇIKIŞ KRİTERİ:** `@kalem/core` tek başına kullanılabilir, %90+ test kapsamlı, 0 bağımlılık, ≤ 12 kB. `pnpm size` yeşil.

---

# FAZ 1.5 — DOĞRULAMA SPIKE'I ⚠️ 🟡 (prototip hazır)
**Amaç:** Blok-tabanlı contenteditable mimarisinin gerçekten çalıştığını, aylar harcamadan kanıtlamak. **Süre: ~1 hafta**

> **Bu fazı atlama.** Sessiz geliştirme stratejisi seçildiği için dış geri bildirim yok; bu spike, mimari riski erken yakalayan tek mekanizma.

### F1.5-01 · Atılabilir prototip `[M]` 🟡 **KISMEN**
Tek dosyalık, test edilmemiş, çirkin bir prototip. Sadece şunu cevaplar: *bu mimari çalışıyor mu?*
- N tane `contenteditable` blok, aralarında ok tuşuyla geçiş
- Blok başında Backspace → önceki bloğa birleş; blok ortasında Enter → böl
- Bloklar arası sürükleyerek metin seçimi
- **Zaten var:** bu prototipin ilk sürümü Artifact olarak üretildi — başlangıç noktası olarak kullan

> **🟡 Kısmen yapıldı.** Prototip [`apps/demo/index.html`](../apps/demo/index.html)
> içinde duruyor ve `pnpm demo` ile açılıyor. Ok tuşuyla blok geçişi, Backspace
> birleştirme, Enter bölme, sürükle-bırak, balon araç çubuğu, slash menü ve
> Word yapıştırma normalleştirmesi çalışıyor.
> **Eksik:** bloklar arası sürükleyerek metin seçimi — listedeki üç maddeden
> en riskli olanı ve F1.5-02'nin asıl sınayacağı şey.

### F1.5-02 · Riskli senaryo matrisi `[M]` ⬜
Prototipi şu senaryolarda **elle** sına ve sonucu tabloya yaz:

| Senaryo | Chrome | Firefox | Safari | iOS Safari | Android Chrome |
|---|---|---|---|---|---|
| IME ile Japonca/Çince yazım (blok içi) | | | | | |
| Bloklar arası sürükleyerek seçim + kopyala | | | | | |
| Blok başında Backspace ile birleşme + imleç konumu | | | | | |
| Undo/redo (tarayıcının kendi undo'su ile çakışma) | | | | | |
| Mobil klavye + otomatik düzeltme | | | | | |
| Ekran okuyucu ile gezinme (NVDA / VoiceOver) | | | | | |

### F1.5-03 · Karar noktası ⭐ `[S]` ⬜
Sonuçları değerlendir ve **açıkça karar ver**:
- ✅ **Devam:** kırmızı hücreler yönetilebilir → Faz 2'ye geç
- ⚠️ **Uyarla:** belirli senaryolar sorunlu → kapsamı daralt (ör. "IME tam desteği v1.1"), yaz ve devam
- ❌ **Dön:** temel bir sorun var → analiz §5.1 Seçenek B'ye geç, 5 hafta kaybettin, 6 ay kurtardın
- **Çıktı:** `docs/02-spike-sonuclari.md`

> **FAZ 1.5 ÇIKIŞ KRİTERİ:** Yazılı, gerekçeli bir git/dön kararı.

---

# FAZ 2 — Viewer + Başsız Editör ✅ TAMAMLANDI (2026-09-09)
**Amaç:** Görsel olmadan çalışan bir editör motoru. **Süre: ~7–9 hafta**

## 2A · `@kalem/viewer` (~1 hafta) ✅ TAMAMLANDI

> **Mimari karar (uygulandı):** iki render hedefi ayrı ayrı yazılmadı.
> Aralarına saf bir **render planı** kondu (`plan.ts`): AST → element
> tarifi. `renderToDOM` ve `renderToString` yalnızca o planı çeviriyor.
> Böylece F2-02'nin "aynı çıktıyı üretiyor" kriteri umut değil, yapısal
> sonuç — ve ölçülebilir: `renderToString(ast) === kapsayıcı.innerHTML`,
> byte-birebir. Bu eşitlik SSR hidrasyonunun da tam ihtiyacı.

### F2-01 · `renderToDOM(ast, el)` `[M]` ✅
AST → DOM, `createElement` + `textContent` ile. `innerHTML` **hiçbir yerde kullanılmaz**.
- **Kabul:** tüm blok/satır içi tipleri doğru render ediliyor ✅

> Tek istisna `html: "allow"` politikası — orada da kütüphane HTML
> ayrıştırmıyor, `renderRawHtml` kancasıyla işi çağırana devrediyor.
> Kanca yoksa ham HTML metin olarak basılıyor (görünür ve zararsız).
> `document` kapsayıcının kendi belgesinden okunuyor: iframe ve
> `<template>` içeriği global `document`'a bağlanınca sessizce bozulur.

### F2-02 · `renderToString(ast)` `[M]` ✅
Saf, DOM'suz fonksiyon. Doğru HTML kaçışlaması.
- **Kabul:** Node'da (DOM shim olmadan) çalışıyor ✅; F2-01 ile aynı çıktıyı üretiyor ✅

> Kaçışlama `escapeHtml`'den ayrı: HTML serileştirme algoritması (Standard
> §13.3) metinde yalnızca `&`, `<`, `>`, U+00A0'yı kaçışlar. Fazladan
> kaçışlamak çıktıyı bozmaz ama **eşitliği** bozardı.

### F2-03 · Viewer stilleri `[S]` ✅
`@kalem/themes` içindeki temel tipografi; `kalem-` sınıf öneki
- **Kabul:** salt-okunur bir doküman düzgün görünüyor ✅

> Sınıf öneki plandaki `mdx-` değil `kalem-`: `mdx-` marka kararından önce
> yazılmıştı. Önek `classPrefix` seçeneğiyle değiştirilebilir.
>
> **Paket saf CSS** — derleme adımı, JS, bağımlılık yok. Tek dosya:
> `@kalem/themes/viewer.css` (1.16 kB gzip, bütçe 3 kB).
>
> İki tasarım kararı:
> - **Her kural `.kalem-doc` altında.** `:root` üzerine tek değişken bile
>   yazılmıyor: bir görüntüleyicinin, gömüldüğü uygulamanın düğmelerinin
>   görünümünü değiştirmesi kabul edilemez. Sızıntı e2e ile sınanıyor.
> - **Tema `--kalem-*` değişkenleriyle** değiştiriliyor, kural ezerek
>   değil. Koyu tema üç durumu da karşılıyor: seçim yoksa
>   `prefers-color-scheme`, varsa `[data-theme]`.
>
> Demo sayfası da bu dosyayı yüklüyor; demoya özel tipografi yok, yani
> ekranda görünen şey kullanıcının göreceğinin aynısı.

### F2-04 · Viewer testleri `[S]` ✅
Render doğruluğu + XSS fixture'ları + a11y (axe)
- **Kabul:** CI'da yeşil ✅, ≤ 14 kB ✅ (2.68 kB)

> **56 birim testi** (`renderToString`, saf, Node'da) + **32 tarayıcı testi
> × 3 motor = 96 Playwright testi** (Chromium · Firefox · WebKit).
> Kapsanan: iki hedefin byte-birebir eşitliği, XSS vektörleri, tema
> kapsamı, axe ile WCAG 2.1 A/AA taraması (açık ve koyu temada).
>
> **axe ilk koşusunda gerçek bir kusur buldu:** görev listesi onay
> kutularının erişilebilir adı yoktu — ekran okuyucu "onay kutusu,
> işaretli" diyor, neyin işaretli olduğunu söylemiyordu. Ad artık
> maddenin **kendi metninden** üretiliyor: sabit bir dize koymak
> kütüphaneye dil eklerdi, oysa her belge kendi dilinde yazılıyor.
> Metinsiz maddede (editörde Enter'a basınca oluşan ilk hâl) kutu
> erişilebilirlik ağacından çıkarılıyor.
>
> Tek dev bağımlılık eklendi: `@axe-core/playwright`. Yayımlanan hiçbir
> pakete girmiyor.

## 2B · `@kalem/editor` — blok motoru (~6–8 hafta) ✅ TAMAMLANDI

### F2-05 · Blok kapsayıcı ve yaşam döngüsü `[L]` ✅
- `Editor` sınıfı: `new Editor(el, { value, onChange, readOnly, plugins })` ✅ *(`plugins` F2-12'de)*
- Her AST bloğu için bir DOM elemanı; her biri kendi `contenteditable="true"` ✅
- Model↔DOM eşlemesi (`blockId` ↔ element), sıralı bloklar ✅
- Sanal DOM yok: hedefli, minimal DOM yamaları ✅
- **Dil bağlamı:** kök elemanın `lang` özniteliği okunur ve bloklara miras verilir; `new Editor(el, { lang: 'tr' })` ile ezilebilir. Bu, tarayıcının `spellcheck` sözlüğünü ve satır sonu/hecelemeyi doğru dile bağlar. ✅
- **Kabul:** doküman render ediliyor ✅, her blokta yazı yazılabiliyor ✅; `lang="tr"` verilen editörde yazım denetimi Türkçe sözlük kullanıyor ✅

> **Veri akışının yönü ikiye bölündü — fazın en önemli kararı.**
>
> ```
> blok yapısı :  model ──► DOM      (komutlar, hedefli yamalar)
> satır içi   :  DOM   ──► model    (`input` olayında geri okunur)
> ```
>
> Sebep IME: bileşim (composition) sırasında DOM'a karışmak Japonca/Çince
> yazımı bozar, o yüzden satır içinde tarayıcı serbest bırakıldı. Blok
> yapısında ise tarayıcıya güvenilemez — Enter'a basınca ürettiği `<div>`
> çorbası Markdown'a çevrilemez.
>
> **İkinci kazanç:** blok düzeyi modelde kaldığı için `syntax` alanları
> düzenlemeden etkilenmiyor. Kullanıcı bir paragrafa harf eklediğinde
> listenin `*` işareti `-`ye dönmüyor; e2e testi tam olarak bunu ölçüyor.
> Satır içinde de içerik değişmemişse modeldeki düğüm korunuyor, yani
> `_italik_` yazan `*italik*` görmüyor.
>
> **Hedefli yama:** blok yalnızca **referansı** değiştiyse yeniden
> kuruluyor. Bu, `@kalem/core`'un değişmez düzenleme kararının (F1-02)
> karşılığını aldığı yer: `replaceAt` yalnızca yoldaki ataları kopyaladığı
> için dokunulmayan blokların referansı aynı kalıyor ve karşılaştırma tek
> bir `!==`. Sanal DOM'a gerek kalmamasının sebebi bu.
>
> **F2-07'nin ilk maddesi burada indi:** blok içi DOM'dan `Inline[]`
> dönüşümü, "yazı yazılabiliyor" kriterinin ön koşuluydu. F2-07'ye
> biçimlendirme komutları kaldı.
>
> Testler: 29 birim (sahte DOM'la normalleştirme mantığı) + 17 tarayıcı
> testi × 3 motor. `@kalem/editor` 13.37 / 38 kB.

### F2-06 · Seçim modeli `[L]` ✅
İki seviyeli seçim:
- **Blok içi** → tarayıcının native `Selection`'ı (bedava, IME dahil) ✅
- **Blok arası** → kendi `BlockSelection` modelimiz (`{ anchorBlock, focusBlock }`), görsel vurgu ile ✅
- `selectionchange` dinleyicisi, model↔DOM seçim eşleme ✅
- **Kabul:** üç paragrafı sürükleyerek seçip Delete ile silmek çalışıyor ✅

> ### ⚠️ F1.5'in atlanmasının ilk faturası burada geldi
>
> Plan "blok arası seçim tarayıcıdan gelir, biz sadece vurgularız"
> varsayıyordu. **Gelmiyor.** Chrome, bir `contenteditable` içinde başlayan
> seçimi o düzenleme kökünün dışına taşımıyor: kullanıcı fareyi bir sonraki
> bloğa sürüklese de seçim ilk blokta kalıyor. Firefox ve WebKit daha
> izin verici, ama üç motorda aynı davranışı vaat ediyorsak en
> kısıtlayıcısına göre yazmak gerekiyor.
>
> Bu, F1.5-02 matrisindeki *"Bloklar arası sürükleyerek seçim + kopyala"*
> satırıydı — prototipte eksik olan tek maddeydi ve atlandığı için gerçek
> kodda karşımıza çıktı. Maliyeti bir günlük iş oldu, mimariyi değiştirmedi;
> matris doldurulsaydı aynı sonuca daha ucuza varılırdı.
>
> **Çözüm:** işaretçi bir blokta basılıp **başka** bir bloğa geçtiği anda
> blok moduna geçiliyor — tarayıcının aralığı temizleniyor, seçim kendi
> modelimizde tutuluyor. Tek blok içinde kalındığı sürece hiç
> karışılmıyor; orada tarayıcı bizden iyi (karakter sınırları, çift
> tıklama, IME, dokunmatik tutamaçlar). `pointer` olayları kullanıldı,
> `mouse` değil: aynı kod dokunmatikte de çalışıyor.
>
> **İkinci hata:** seçim sınırı okunurken `anchorNode`/`focusNode` yetmiyor.
> Kapsayıcının kendisi sınır düğümü olduğunda `offset` çocuğu değil
> **çocuklar arası boşluğu** gösteriyor; aralığın bitişi düzeltilmeden
> okununca seçime bir fazla blok giriyordu. Artık `Range`'in başı ve sonu
> ayrı ayrı, hangi tarafta oldukları bilinerek çözülüyor.
>
> **Görsel:** blok modundayken tarayıcının kısmi vurgusu
> `::selection { background: transparent }` ile susturuluyor — iki vurgu
> üst üste binince okunmaz bir görüntü çıkıyor ve kullanıcı "metin
> seçtim" sanıyor, oysa seçili olan bloklar.
>
> Testler: 13 birim (yön normalleştirmesi, karşılaştırma) + 8 tarayıcı
> testi × 3 motor. Gerçek fare sürüklemesiyle ölçülüyor.

### F2-07 · Satır içi format motoru `[L]` ✅
Blok içi `strong`/`emphasis`/`delete`/`inlineCode`/`link` uygulama ve kaldırma ✅
- Blok içi DOM'dan `Inline[]` AST'sine dönüştürme (her `input` olayında) ✅ *(F2-05'te indi)*
- İç içe format normalizasyonu (`<b><b>x</b></b>` → tek `strong`) ✅
- **Kabul:** Ctrl+B ile seçili metin kalın oluyor ✅; tekrar basınca kalkıyor ✅; AST doğru ✅

> **Biçim DOM'da değil modelde uygulanıyor.** Seçim karakter ofsetine
> çevriliyor, `Inline[]` o ofsetlerden kesiliyor, çekirdeğin `toggleMark`'ı
> uygulanıyor, blok yeniden basılıyor, seçim geri konuyor.
>
> Alternatif `document.execCommand("bold")` idi ve reddedildi: kullanımdan
> kaldırılmış, üç tarayıcıda üç farklı HTML üretiyor, `inlineCode` gibi
> kendi biçimlerimizi bilmiyor — ve sonucu yine modele geri okumak
> gerekiyordu. Karar çekirdekte kalınca aynı mantık başsız kullanımda
> (SSR, betik) da geçerli.
>
> **Kesmenin kritik kuralı:** sarmalayıcılar korunuyor.
> `strong[text("abc")]` listesinin `[1,2)` dilimi `strong[text("b")]`
> veriyor, çıplak `text("b")` değil. Düşseydi, kalın bir metnin ortasını
> seçip Ctrl+B'ye basmak kalınlığı kaldırmak yerine bir kat daha kalın
> yapardı.
>
> **İki uzunluk hesabı birebir aynı olmak zorunda:** DOM tarafı
> (`offsets.ts`) ve model tarafı (`inline-edit.ts`) — metin karakteri 1,
> `<br>`/`break` 1, görsel 0. Ayrışırlarsa hata "yanlış yeri
> kalınlaştırmak" olarak görünür ve bulunması zordur.
>
> **Bir sıralama hatası demo düğmeleri sayesinde yakalandı:** `onChange`,
> seçim geri konmadan önce tetikleniyordu; o anda `isMarkActive` sorulunca
> yanlış cevap veriyordu. Artık seçim kancadan önce kuruluyor — dinleyici
> her zaman tutarlı durum görüyor.
>
> **Kapsam dışı bırakılanlar (gerekçeli):**
> - **İmleçle Ctrl+B** (saklı işaret / stored mark) hiçbir şey yapmıyor.
>   "Bundan sonra yazacaklarım kalın olsun" ayrı bir makine ve balon araç
>   çubuğuyla birlikte anlam kazanıyor → F3-01.
> - **Ctrl+U** bilerek engelleniyor ama bir şey yapmıyor: Markdown'da altı
>   çizili yok. Engellenmezse tarayıcı `<u>` üretir, o da bir sonraki
>   okumada sessizce kaybolur — kullanıcının bastığı tuşun izsiz
>   kaybolması, hiç tepki vermemesinden kötü.
> - **Bağlantı URL'si** demo sabitinden geliyor; gerçek düzenleme akışı
>   F3-02.
>
> Testler: 27 birim (kesme, birleştirme, işaret durumu — hepsi saf) +
> 13 tarayıcı testi × 3 motor.

### F2-08 · Klavye ve gezinme `[L]` ✅
- Enter (blok böl), Shift+Enter (satır sonu), Backspace/Delete (birleş, sınır durumları), Tab/Shift+Tab (liste girinti) ✅
- Ok tuşlarıyla bloklar arası geçiş ✅, Home/End/PageUp/PageDown ⏭️ *(tarayıcıya bırakıldı)*
- Kısayollar: Ctrl+B/I/U/K/Z/Y ✅🟡, Ctrl+Alt+1..6 ✅, Ctrl+Shift+8/7 (liste) ✅
- **Kabul:** klavye ile fare kullanmadan tam doküman yazılabiliyor ✅

> **Tuşların kararı modelde, DOM'da değil.** `block-edit.ts` tamamen saf:
> girdi bir belge ve bir imleç, çıktı yeni belge ve imlecin yeni yeri.
> Davranış 26 birim testiyle sabitleniyor; tarayıcı testleri yalnızca
> tuşun oraya doğru bağlandığını doğruluyor.
>
> **Home/End/PageUp/PageDown bilerek tarayıcıda bırakıldı:** hepsi görsel
> satır ve kaydırma geometrisiyle ilgili ve tarayıcı bunu bizden iyi
> biliyor. Ctrl+Z/Y F2-09'un işi; Ctrl+K bağlantı akışıyla birlikte
> F3-02'de.
>
> **Bu adımda çıkan dört gerçek hata:**
> 1. **Boş belgede hiç blok yoktu.** `new Editor(el)` — yani en sık
>    başlangıç hâli — tıklanacak yeri olmayan bir editör üretiyordu.
>    `normalizeDocument` artık en az bir paragraf garanti ediyor.
> 2. **Boş liste maddesi düzenlenemiyordu.** Ayrıştırıcı `- ` maddesini
>    çocuksuz üretiyor (doğru); ama çocuksuz maddenin içerik taşıyıcısı
>    olmuyor. Editör her maddeye boş bir paragraf koyuyor.
> 3. **Sondaki satır sonu tarayıcının doldurucusuyla karışıyordu.**
>    Tarayıcı sondaki tek `<br>`'yi "satır kutusunu ayakta tut"
>    doldurucusu sayıp imleci **önüne** koyuyor; kullanıcı yeni satıra
>    yazdığını sanırken metin bir üst satıra gidiyordu. Gerçek satır
>    sonunun arkasına bir doldurucu daha konuyor, okurken **tek** bir
>    sondaki satır sonu atılıyor.
> 4. **Ok tuşu gezinmesi hiç çalışmıyordu.** Blok arama yardımcısı yalnızca
>    `Element` kabul ediyordu, oysa seçim sınırları neredeyse her zaman
>    metin düğümü — sessizce `null` dönüyordu.
>
> **İki tarayıcı farkı ayrıca çıktı:** WebKit `<pre contenteditable>`
> içinde Enter'a basınca içeriği yeniden yapılandırıp mevcut satırı
> yutuyor. Kaynak bloklarında satır sonu da artık modele elle yazılıyor.
>
> **Çekirdekte bir varsayılan değişti:** yeni sert satır sonu artık `\`
> ile yazılıyor, iki boşlukla değil. İki boşluk görünmez; çoğu editör ve
> linter satır sonu boşluğunu kırpar ve kırpınca satır sonu sessizce
> kaybolur. Kaynakta iki boşlukla yazılmış olanlar `syntax` sayesinde
> korunuyor. remark de aynı sebeple ters bölü yazıyor.
>
> Testler: 26 birim (saf model işlemleri) + 17 tarayıcı testi × 3 motor,
> sonuncusu baştan sona klavyeyle bir belge yazıyor.

### F2-09 · Geçmiş (undo/redo) `[L]` ✅
- İşlem tabanlı (transaction) geçmiş yığını; her komut tersine çevrilebilir bir işlem üretir ✅ *(anlık görüntü olarak — aşağıya bakın)*
- **Kritik:** tarayıcının kendi undo'sunu devre dışı bırak, çakışmayı engelle ✅
- Yazma işlemlerinde akıllı gruplama (harf harf undo olmasın) ✅
- Geçmişte seçim durumunu da sakla ve geri yükle ✅
- **Kabul:** 50 adımlık karmaşık düzenleme dizisi doğru geri alınıyor ✅

> **Ters işlem yerine anlık görüntü.** Plan "her komut tersine çevrilebilir
> bir işlem üretir" diyordu; uygulama daha basit bir yoldan aynı sonucu
> veriyor ve gerekçesi şu: `@kalem/core`'un düzenleme işlemleri değişmez ve
> **yapısal paylaşımlı** (F1-02), yani bir anlık görüntü tüm belgeyi
> kopyalamıyor — yalnızca değişen yoldaki ataları. Bir geçmiş kaydı
> pratikte tek bir kök referansı.
>
> Ters işlem yaklaşımının bedeli, her yeni komutun ayrıca tersini yazmak
> zorunda olması ve o terslerin zamanla sessizce yanlışlanmasıydı. Bu, F1-02'de
> *"geri al/yinele anlık görüntüleri bir kök referansına iner"* diye yazılan
> gerekçenin karşılığını aldığı yer.
>
> **Tarayıcının kendi geçmişi iki yerden kapatılıyor:** Ctrl+Z/Y kısayolu
> **ve** `beforeinput`'un `historyUndo`/`historyRedo` türü. İkincisi şart:
> menüden ya da dokunmatik jestle gelen geri alma klavyeden geçmiyor ve
> engellenmezse tarayıcı DOM'u eski hâline döndürüp modeli olduğu yerde
> bırakıyor — ikisi ayrışıyor.
>
> **Bir tasarım hatası test sırasında çıktı:** kayıtta "değişiklikten
> **sonraki**" imleç tutuluyordu. İlk kaydın imleci hiç dolmadığı için geri
> alan kullanıcı bloğun başına düşüyor ve yazmaya oradan devam ediyordu.
> Doğrusu "değişiklikten **önceki**" imleci, terk edilen kayda yazmak;
> o konum da ancak tarayıcı DOM'a dokunmadan önce (`keydown` anında)
> okunabiliyor.
>
> Testler: 13 birim (gruplama zamanı dışarıdan veriliyor, `Date.now()`'a
> bağlı kırılgan test yok) + 11 tarayıcı testi × 3 motor.

### F2-10 · Giriş kuralları (input rules) `[M]` ✅
Yazarken otomatik dönüşüm: `# ` → başlık ✅, `- ` / `* ` → liste ✅, `1. ` → sıralı liste ✅, `> ` → alıntı ✅, ` ``` ` → kod bloğu ✅, `---` → yatay çizgi ✅, `**x**` → kalın ✅, `` `x` `` → kod ✅
- Undo ile dönüşüm geri alınabilmeli (bir kez Ctrl+Z = kuralı iptal et, metni koru) ✅
- **Kabul:** her kural test edilmiş ✅; segment C kullanıcısı Markdown yazar gibi yazabiliyor ✅

> **Kullanıcının yazdığı işaret korunuyor.** `* ` yazan `*` görüyor, `- `
> yazan `-`; `3) ` yazan hem 3'ü hem parantezi. Kural işareti metinden
> silerken `syntax` alanına taşıyor — projenin "yazdığın gibi geri yaz"
> kuralı burada da geçerli.
>
> **Geri alınabilirlik nasıl bedava geldi:** dönüşüm ayrı bir geçmiş kaydı
> olarak yazılıyor (gruplanmıyor), yani dönüşümün hemen ardından basılan
> tek bir Ctrl+Z onu iptal edip yazılan metni olduğu gibi bırakıyor.
> F2-09'un anlık görüntü tasarımı sayesinde ek bir mekanizma gerekmedi.
>
> **Kurallar yalnızca paragrafta çalışıyor.** Başlıkta `- ` yazmak listeye
> çevirmiyor; kullanıcı orada gerçekten tire yazıyor olabilir. Kod
> bloklarında da hiç çalışmıyor.
>
> **Bir çökme hatası burada yakalandı:** blok etiketi değişince (paragraf →
> başlık) `#sync` kaldırılmış bir düğüme `insertBefore` yapıyor,
> `NotFoundError` atıyor ve **tüm editör DOM'u boş kalıyordu**. İmleç
> göstergesi artık kaldırmadan önce ilerletiliyor. Hata blok türü
> değiştiren her yolu etkiliyordu; giriş kuralları onu her tuşta
> tetiklediği için görünür oldu.
>
> Testler: 23 birim (kalıplar ve dönüşümler, saf) + 11 tarayıcı testi × 3 motor.

### F2-11 · Kopyala / kesme `[M]` ✅
- Kopyalarken panoya **hem** `text/html` **hem** `text/plain` (= Markdown) yaz ✅
- Blok arası seçimin doğru kopyalanması ✅
- **Kabul:** Kalem'den kopyalayıp Word'e yapıştırınca biçim korunuyor ✅; not defterine yapıştırınca Markdown çıkıyor ✅

> **İki biçim, tek kaynak.** İkisi de aynı AST parçasından üretiliyor:
> `text/html` Word ve Google Docs için, `text/plain` **Markdown** olarak.
> Not defterine yapıştıran kullanıcı `**kalın**` görüyor, düz "kalın"
> değil — projenin "doğru kaynak Markdown metnidir" kararının panoya
> yansıması.
>
> **Tarayıcıya hiç bırakılmıyor**, blok içi seçimde bile: asıl kazanç
> zaten orada, çünkü tarayıcının `text/plain`'i biçim işaretlerini atıyor.
>
> **Editör artık `@kalem/viewer`'a bağımlı.** `render.ts`'te "editör
> viewer'ı kullanmaz" yazıyordu ve editör *render'ı* için hâlâ doğru
> (farklı ihtiyaç). Ama pano için tam olarak viewer'ın ürettiği şey
> gerekiyordu: sunum amaçlı, kimliksiz, düzenleme özniteliği taşımayan
> HTML. Kopyalanan HTML'de `data-kalem-*` ya da `contenteditable`
> bulunmadığı test ediliyor.
>
> Satır içi kopyalamada paragraf sarmalayıcısı çıkarılıyor: cümle
> ortasından kopyalanan metin yapıştırıldığında yeni paragraf açmamalı.
>
> **Bir test tekniği notu:** Firefox sentetik pano olayında `getData`'yı
> boş döndürüyor (güvenlik). Test artık `setData`'yı gözleyerek editörün
> **yazdığını** okuyor; üç motorda da aynı şeyi ölçüyor.
>
> Testler: 9 birim + 7 tarayıcı testi × 3 motor.
> *(Yapıştırma bu adımda değil: kirli HTML normalleştirmesi F3-07.)*

### F2-12 · Eklenti sistemi `[M]` ✅
Analiz §5.9'daki `Plugin` arayüzü; kayıt ✅, yaşam döngüsü ✅, çakışma çözümü ✅
- **Dogfooding kuralı:** görev listesi ve kod bloğu bu API üzerinden yeniden yazılır 🟡 *(görev listesi ✅ + giriş kuralları ✅; kod bloğu render'ı çekirdekte kaldı — gerekçe aşağıda)*
- **Kabul:** çekirdek bir özellik eklenti olarak çıkarılıp tekrar takılabiliyor ✅

> **Yüzey üç noktayla sınırlı:** `keymap` (tuş yakalama), `inputRules`
> (yazarken dönüşüm), `setup` (kurulum + temizleyici). Bu üçü editörün
> gerçekten genişletme noktası olan yerleri.
>
> **Render'a kanca bilerek yok.** Düğüm başına bir kanca, blok motorunun
> en sıcak yolunda her düğüm için bir dolaylı çağrı demek; ihtiyaç
> ölçülmeden ödenecek bir bedel değil. Görsel genişletme Faz 3'ün
> (`@kalem/ui`) işi. **Kod bloğu render'ının eklentiye çıkarılmaması bu
> yüzden** — çıkarmak, ölçülmemiş bir maliyeti tüm bloklara yaymak
> olurdu. Görev listesinin **davranışı** (kutuya tıklayınca durum
> değişmesi) eklentiye taşındı, **çizimi** çekirdekte kaldı.
>
> **Çakışma çözümü tek kural: kayıt sırası.** Önce kayıtlı eklenti önce
> deneniyor, ilk `true` döndüren kazanıyor, çekirdek en sonda. Öncelik
> numarası ya da bağımlılık grafiği yok — ikisi de eklenti yazarını kendi
> eklentisini başkalarına göre konumlandırmaya zorluyor ve sistem tahmin
> edilemez hâle geliyor. Sıra çağıranın elinde ve görünür.
>
> **Dogfooding gerçek:** giriş kuralları (F2-10) ve görev listesi davranışı
> artık eklenti; ikisi de varsayılan olarak kayıtlı ve `plugins: []` ile
> kapatılabiliyor. E2E testi kaldırınca davranışın gerçekten kaybolduğunu,
> geri ekleyince döndüğünü ölçüyor — kabul kriterinin ta kendisi.
>
> Testler: 11 birim (kayıt, yaşam döngüsü, çakışma) + 6 tarayıcı testi × 3 motor.

### F2-13 · Editör E2E test paketi `[L]` ✅
Playwright ile: yazma ✅, seçim ✅, kısayollar ✅, giriş kuralları ✅, undo/redo ✅, kopyala-yapıştır 🟡 *(kopyala/kes ✅, yapıştırma F3-07)*, IME (CDP `Input.imeSetComposition`) ✅
- **Kabul:** Chromium + Firefox + WebKit'te yeşil ✅ (369 test)

> **IME nihayet ölçüldü.** Bileşim (composition) Playwright'ın klavye
> API'siyle taklit edilemiyor; gerçek bir IME durumu gerekiyor ve onu
> yalnızca Chrome DevTools Protocol'ün `Input.imeSetComposition` komutu
> kuruyor. CDP yalnızca Chromium'da olduğu için o testler diğer iki
> motorda atlanıyor (12 atlanan test).
>
> Bu, F1.5-02 matrisindeki *"IME ile Japonca/Çince yazım"* satırıydı.
> Matris doldurulmadı; ölçüm gerçek koda düştü ve **mimarinin en kırılgan
> varsayımını** doğruladı: bileşim sırasında DOM'a karışmıyoruz, o yüzden
> yarım kalan hece kaybolmuyor. F2-05'te satır içi içeriğin DOM'dan
> okunmasının gerekçesi tam olarak buydu.
>
> **Bir gerçek koruma eklendi:** giriş kuralları bileşim sırasında
> çalışmıyor. Çalışsalardı `# ` kalıbını bileşim metninin içinde görüp
> bloğu başlığa çevirir, bloğu yeniden basar ve bileşimi düşürürlerdi.
> Kurallar artık `compositionend`'de bir kez çalışıyor.
>
> **Yapıştırma bu adımda değil:** kirli HTML normalleştirmesi F3-07'nin
> boru hattı ve `@kalem/core/html` (F1-09) onu bekliyor.

> **FAZ 2 ÇIKIŞ KRİTERİ:** UI olmadan, sadece klavyeyle tam işlevli bir Markdown editörü ✅ · `@kalem/editor` ≤ 38 kB ✅ (21.85 kB)
>
> **Faz 1.5 atlandığı için matrise düşen üç riskin ikisi burada ölçüldü:**
> bloklar arası sürükleyerek seçim (F2-06) ve IME bileşimi (F2-13). Üçüncüsü
> — mobil klavye ve otomatik düzeltme — hâlâ ölçülmedi; F6-09 tarayıcı ve
> mobil geçişine kaldı.

---

# FAZ 3 — Word Deneyimi (`@kalem/ui`)
**Amaç:** Ürünün kalbi. Segment A'nın (yazılım bilmeyen kullanıcı) tüm değeri burada. **Süre: ~6–8 hafta**

### F3-01 · Balon araç çubuğu (bubble toolbar) `[L]` ✅
Metin seçilince seçimin üstünde beliren araç çubuğu ✅
- Butonlar: kalın, italik, üstü çizili, kod, link, blok tipi açılır listesi ✅ *(link düğmesi F3-02 akışını bekliyor)*
- Konumlandırma: viewport sınırı farkındalığı ✅, kaydırmada takip ✅, seçim değişince güncelle ✅ (küçük kendi popper mantığımız — Floating UI bağımlılığı **eklenmez** ✅)
- Aktif durum yansıması (seçili metin kalınsa buton basılı görünür) ✅
- **Kabul:** Word'deki mini araç çubuğu kadar akıcı ✅

> **Floating UI eklenmedi.** ~5 kB'lik kütüphaneden bize gereken kısım
> çok küçük: bir dikdörtgenin üstüne (yer yoksa altına) kutu koymak ve
> görünür alan dışına taşmasını engellemek. Ok göstergesi, otomatik
> yerleşim, sanal eleman — hiçbiri gerekmiyor. Hesap 40 satır ve **saf**,
> yani kenar durumları tarayıcı açmadan sınanıyor (10 birim testi).
>
> **Blok türü için yerel `<select>`** kullanıldı, özel açılır menü değil:
> klavye gezinmesi, ekran okuyucu duyurusu, dokunmatik davranış ve mobil
> yerel tekerlek bedava geliyor. Özel menü bunların hepsini yeniden yazmak
> demekti.
>
> **`mousedown` engelleniyor:** düğmeye basmak seçimi düşürürse
> uygulanacak biçim için seçim kalmaz. Kendi araç çubuğunu yazan herkesin
> bir kez düştüğü tuzak; test bunu ayrıca ölçüyor.
>
> **Bir CSS hatası buradan çıktı:** `display: flex` veren her kural
> tarayıcının `[hidden] { display: none }` kuralını eziyor ve `hidden`
> özniteliği sessizce işe yaramaz hâle geliyor. Yüzen parçaların hepsi
> `display` verdiği için açık bir `[hidden]` kuralı kondu.
>
> **Metinler tek bir sözlükten** (`labels.ts`) geliyor; hiçbir bileşen
> kendi içinde dize taşımıyor. Dil değiştirmek tek nesne vermek, yani
> i18n (F6-10) yeni bir mekanizma gerektirmeyecek. Varsayılan belgenin
> `lang`'ine göre seçiliyor.
>
> Testler: 17 birim (konumlandırma hesabı + sözlükler) + 18 tarayıcı testi × 3 motor.

### F3-02 · Link düzenleme akışı `[M]` ✅
Link ekleme popover'ı ✅, URL doğrulama ✅, mevcut linki düzenle/kaldır ✅, Ctrl+K ✅
- **Kabul:** URL yapıştırırken seçili metin otomatik linkleniyor ✅

> **Üç giriş yolu, tek popover:** araç çubuğu düğmesi, Ctrl+K, ve var olan
> bağlantıya tıklamak. Bağlantının içindeyken **seçim yapmak gerekmiyor** —
> `getActiveLink()` imlecin durduğu bağlantıyı buluyor ve uygulama onun
> tamamını değiştiriyor.
>
> **Doğrulama çekirdekten:** `isSafeUrl` (F1-10) hem render hem giriş
> tarafında aynı beyaz listeyi uyguluyor. `javascript:` yazan kullanıcı
> uyarı görüyor ve bağlantı kurulmuyor; sessizce `#`e çevirmek ona
> çalıştığını düşündürürdü. Uyarı hem kırmızı çerçeve hem **yazı** —
> renk tek başına bilgi taşıyıcısı olamaz (WCAG 1.4.1).
>
> **Şemasız adres kabul ediliyor:** `ornek.com` → `https://ornek.com`.
> Kullanıcıların çoğu şema yazmıyor; `/yol`, `#bolum` ve `mailto:` gibi
> zaten anlamlı biçimlere dokunulmuyor.
>
> **İki gerçek hata buradan çıktı:**
> 1. **Popover açılınca editörün seçimi kayboluyordu** — girdiye odak
>    gitmesi seçimi düşürüyor ve uygulama anında `setLink` bakacak bir
>    aralık bulamıyordu. Açılışta `Range` kopyalanıyor, uygulamadan önce
>    geri yükleniyor.
> 2. **`getSelection()` bayat cevap veriyordu.** Önbelleğe alınmış ve
>    `selectionchange` bir sonraki göreve ertelenebiliyor; klavye
>    kısayolundan hemen sonra sorulduğunda eski değeri veriyordu — Ctrl+K
>    ve URL yapıştırma sessizce çalışmıyordu. Editöre canlı okuyan
>    `getTextRange()` eklendi. Bu, kütüphaneyi kullanan herkesi
>    etkileyecek bir tuzaktı.
>
> **Ctrl+K bir eklenti olarak kaydediliyor** (F2-12 API'si), doğrudan
> dinleyici olarak değil: çakışma kuralı (kayıt sırası) tek yerde kalıyor.
>
> Testler: 11 birim (adres normalleştirme) + 12 tarayıcı testi × 3 motor.
> *(Yapıştırma testi Firefox'ta atlanıyor: sentetik `paste` olayında
> `clipboardData` okutulmuyor — F2-11'deki kopyalama kısıtının eşi.)*

### F3-03 · Slash menü `[L]` ✅
`/` yazınca açılan blok ekleme menüsü ✅
- Aranabilir liste ✅, klavye ile gezinme ✅, ikonlar ✅, kategori grupları ✅, i18n'e hazır etiketler ✅
- Eklentiler bu menüye öğe ekleyebilmeli ✅
- Arama, editörün `lang`'ine göre locale duyarlı karşılaştırma yapar ✅
- **Kabul:** `/bas` yazınca "Başlık 1" filtreleniyor ✅, Enter ile ekleniyor ✅
- **Kabul (locale):** `lang="tr"` iken `/ba**ş**` ve `/BAŞ` aynı sonucu veriyor ✅; `/ıst` ile "İstatistik" gibi bir öğe eşleşiyor ✅

> **Locale kriteri iki ayrı iş gerektirdi**, ikisi de sıradan
> `toLowerCase()` ile yanlış sonuç veriyor:
> 1. **Büyük/küçük katlaması.** `"BAŞLIK".toLowerCase()` → `"başlik"`;
>    doğrusu `"başlık"`. `toLocaleLowerCase("tr")` noktalı/noktasız i
>    ayrımını biliyor.
> 2. **Aksan katlaması.** `/bas` yazan kullanıcı "Başlık"ı bulmalı.
>
> **Noktasız `ı` ayrıca eşlendi:** o bir aksanlı harf değil, ayrı bir
> harf — Unicode ayrıştırması onu `i`ye indirmiyor. `/ıst` ile
> "İstatistik" kriterinin sınadığı şey tam olarak bu: `İ` katlanınca `i`
> oluyor, `ı` de eşlenmezse ikisi buluşmuyor. Toplam 10 satır; en küçük
> hazır alternatif ~8 kB.
>
> **Yazılan `/sorgu` metni gerçekten belgede kalıyor.** Ayrı bir kutuda
> toplamak, bileşimli yazımı (IME) ve imleç davranışını yeniden yazmak
> demekti. Öğe seçilince metnin silinmesi ve blok dönüşümü **tek bir
> düzenleme**: tek Ctrl+Z hepsini geri alıyor.
>
> **`/` yalnızca kelime başında açıyor** — `and/or` yazan kullanıcının
> karşısına menü çıkmamalı.
>
> **Odak editörde kalıyor**, menüye taşınmıyor: kullanıcı yazmaya devam
> ediyor ve seçili öğe `aria-activedescendant` ile duyuruluyor.
>
> **İki gerçek hata çıktı:**
> 1. **Editör `event.defaultPrevented`'ı yok sayıyordu.** `preventDefault()`
>    yayılmayı durdurmuyor; menünün yakaladığı Enter hem öğe seçiyor **hem
>    de** bloğu bölüyordu, ayrıca tek Ctrl+Z'yi bozuyordu. Dışarıdan gelen
>    hiçbir işleyici tuşu gerçekten tüketemiyordu — kütüphaneyi kullanan
>    herkesi etkileyecek bir hata.
> 2. Menü, yoldaki düğümün yalnızca `children` alanını okuyordu; ondan
>    kurulan yeni düğüm `type`'ı kaybediyor ve "Madde imli liste" sessizce
>    hiçbir şey yapmıyordu. Başlıklar çalışıyordu çünkü `setBlockType` türü
>    kendisi yazıyor.
>
> Testler: 15 birim (arama katlaması) + 13 tarayıcı testi × 3 motor.

### F3-04 · Blok drag handle + sürükle-bırak ⭐ `[L]` ✅
Kullanıcının açıkça istediği özellik.
- [x] Blok hover'ında sol kenarda tutamaç (⠿) + artı butonu
- [x] Sürükleme sırasında: bırakma göstergesi çizgisi, otomatik kaydırma
- [x] Çoklu blok seçimini birlikte sürükleme
- [x] **Kabul:** 5 paragraflık dokümanda 3. paragraf 1. sıraya sürüklenebiliyor, undo ile geri alınıyor

**Hayalet önizleme yapılmadı.** Uzun bir blokta hayalet ekranın yarısını
kaplıyor ve "nereye düşecek" sorusunu cevaplamak yerine gizliyor; bırakma
çizgisi o soruyu tek başına cevaplıyor. Kabul kriteri hayaleti istemiyor.

**Sürükle-bırak tek yol değil** (F3-10'un gereği): `Ctrl+Shift+↑/↓` aynı
işi yapıyor ve sonucu canlı bölgeye duyuruluyor (`live-region.ts`).

**Sol boşluk arayüz katmanının:** `.kalem-ui` `padding-left` ayırıyor.
Tutamaç metnin üstüne binerse tıklamaları ve sürükleyerek seçimi yutuyor
— e2e'de bağlantı ve bloklar arası seçim testleri bunu yakaladı. Yer
yoksa tutamaç hiç çıkmıyor.

**Yan bulgu — e2e eski kodu test ediyordu.** Demo sayfası paketleri
`dist/`ten, temaları kaynaktan yüklüyor; Playwright derleme yapmıyordu.
CSS düzeltmeleri anında görünüyor, TypeScript düzeltmeleri hiç
görünmüyordu. `serve-demo.mjs` artık açılışta derliyor ve
`reuseExistingServer: false` — açık duran sunucu kendinden sonra yazılan
kodu bilmiyor.

### F3-05 · Blok bağlam menüsü `[M]` ✅
Tutamaca tıklayınca: sil ✅, çoğalt ✅, blok tipini değiştir ✅, yukarı/aşağı taşı ✅, kopyala ✅
- [x] **Kabul:** menü klavyeyle de kullanılabiliyor

**Odak menüye taşınıyor — slash menünün tersine.** Slash menü odağı
editörde bırakıyor çünkü kullanıcı menü açıkken *yazmaya devam ediyor*
(`/bas` ile filtreliyor). Blok menüsünde yazılacak bir şey yok, o yüzden
standart `role="menu"` deseni: gerçek odak menüye giriyor, oklarla
geziliyor, Escape odağı geldiği düğmeye geri veriyor. Kabul kriteri
tam olarak bu.

**Blok türü alt menü değil**, aynı menüde başlıklı bir grup. Alt menü bir
gezinme seviyesi daha ekliyor ve altı öğe o karmaşıklığı hak etmiyor.

**Ön madde çoğaltılamıyor:** belgede en fazla bir ön madde olabiliyor ve
o da ilk çocuk olmak zorunda; kopyası geçersiz belge üretirdi. Tip
denetimi bunu kendiliğinden yakaladı.

**İki odak/görünürlük tuzağı çıktı:**
- Sürükleme de bir `click` ile bitiyor; menü yerinde tıklamada açılıyor
  (3 px eşik).
- Menü kapanırken tutamaca odaklanıp ardından tutamacı gizlemek odağı
  gövdeye düşürüyordu. Kural genelleştirildi: *odağı barındıran tutamaç
  gizlenmiyor.*

### F3-06 · Üst araç çubuğu (opsiyonel ribbon) `[M]` ✅
Word'e alışkın kullanıcı için sabit araç çubuğu ✅; yapılandırılabilir buton grupları ✅
- [x] **Kabul:** `toolbar: 'fixed' | 'bubble' | 'both' | false` seçeneğiyle çalışıyor

**Şerit değil, tek satır.** Word'ün sekmeli şeridi yüzlerce komut için
var; burada onlarca komut yok, sekmeler boş sekmeler olurdu. Gruplar
(`history`, `blockType`, `format`, `list`, `link`) tek satırda,
`toolbarGroups` ile sıralanabilir ve kısaltılabilir.

**Editörün kardeşi, `<body>`nin çocuğu değil.** Yüzen parçaların aksine
çubuk belgenin akışında; `position: sticky` kaydırmada üstte tutuyor.
Sarmalayıcı eklenmiyor ki gömen sayfanın kendi düzeni bozulmasın.

**Eylemler `toolbar-actions.ts`'te ortak.** Balon çubuğu da oradan
okuyor; "kalın" davranışının iki yerde ayrışması engellendi.

**Sabit çubuk gizli bir kusuru ortaya çıkardı.** `markActive` boş imleçte
her zaman `false` dönüyordu ve balon çubuğu boş seçimde gizlendiği için
bu hiç görünmemişti. Sabit çubuk kapanmadığı için imleç kalın metnin
içindeyken B yanmıyordu. Artık boş imleçte **soldaki** karaktere
bakılıyor (yazmaya devam eden kullanıcı soldaki biçimi sürdürüyor);
blok başında sağdakine. Eski beklentiyi sabitleyen test gerekçesiyle
değiştirildi.

**Kapalı düğmeler klavye gezinmesinde atlanıyor** — geri al geçmiş boşken
kapalı ve odak alamıyor; listede bırakılsaydı ok tuşu hiçbir yere
götürmüyor gibi görünürdü.

Editöre `readonlychange` olayı eklendi: arayüz düğmelerini yoklamak
yerine haberle kapatıyor.

### F3-07 · Yapıştırma boru hattı `[L]` ✅
F1-09'daki HTML→AST dönüştürücüyü editöre bağla ✅
- [x] Yapıştırma anında kaynak tespiti (Word / GDocs / HTML / Markdown metni / düz metin)
- [x] Düz metin yapıştırılırken Markdown olarak ayrıştırma seçeneği
      (`parseMarkdownOnPaste`, varsayılan açık)
- [x] Ctrl+Shift+V = biçimsiz yapıştır
- [x] **Kabul:** Word'den kopyalanan 3 sayfalık biçimli doküman doğru yapıya dönüşüyor

**Kabul kriteri nasıl ölçüldü.** Playwright'a Word kurulamıyor; ölçülen
şey Word'ün **panoya yazdığı HTML**. `e2e/fixtures/word-clipboard.ts` o
çıktının yapısını birebir taşıyor: `urn:schemas-microsoft-com` ad
alanları, `Generator` etiketi, `MsoNormal`, `mso-list` sahte listeleri,
`mso-list:Ignore` madde imleri, iç içe boş `<span>`'lar, `<o:p>` ve gizli
`<style>` blokları. Taklit olduğu fixture'ın başında yazıyor. 12 kabul
testi: başlık hiyerarşisi, stille verilen biçimler, listeler (iç içe ve
numaralı), bağlantı, tablo, çöpün düşmesi, tek Ctrl+Z.

**Word listeleri dönüştürücüye eklendi.** Word `<ul>`/`<ol>` üretmiyor:
her madde bir `<p style='mso-list:...level1...'>` ve madde imi paragrafın
içine gömülü bir `<span style='mso-list:Ignore'>`. İşlenmeden bırakılınca
liste diye bir şey kalmıyor ve madde imi kullanıcının **metnine**
karışıyor. Ardışık maddeler artık `level` numarasına göre iç içe
listelere çevriliyor.

**Çift işaretleme kusuru.** Word aynı biçimi hem etiketle hem stille
yazıyor (`<b><span style="font-weight:bold">`); ikisi de `strong`
üretiyordu ve çıktı `__**metin**__` oluyordu. Aynı biçim artık iki kez
sarılmıyor.

**Yapıştırma modelde yapılıyor, DOM'da değil.** Tarayıcının kendi
yapıştırması HTML'i olduğu gibi `contenteditable`'a gömüyor. Test bunu
ayrıca ölçüyor: yapıştırma sonrası editörün DOM'unda `mso-` geçmiyor.

**Markdown sezgisi dar tutuldu.** Yalnızca satır başı yapısal işaretler
(başlık, liste, alıntı, çit, çizgi) ve bağlantı/satır içi kod aranıyor.
Satır içi `*` ve `_` bilerek dışarıda: `2 * 3 * 4` yazan kullanıcının
metnini bozmak, kazanılan kolaylıktan pahalı.

**İki gizli kusur daha çıktı:**
- Editörün yapıştırma işleyicisi arayüzünkinden önce çalışıyordu ve URL
  yapıştırma akışını (F3-02) bozuyordu. Arayüz artık **yakalama
  evresinde** dinliyor, editör de `defaultPrevented` olayı görmezden
  geliyor (F3-03'teki kuralın aynısı).
- `selectionchange` blok **içinde** imleç gezdirilince hiç doğmuyordu:
  `EditorSelection` ofset taşımıyor. Sabit araç çubuğu bunu ortaya
  çıkardı (kalın kelimeye tıklamak B'yi yakmıyordu). Artık imlecin
  kendisi de karşılaştırılıyor; `EditorSelection`e ofset eklenmedi çünkü
  o tip bloklar arası seçimi de anlatıyor.

### F3-08 · Yer tutucu ve boş durumlar `[S]` ✅
Boş dokümanda "Yazmaya başlayın veya `/` ile komut çalıştırın" ipucu ✅
- **Kabul:** ipucu odaklanınca kaybolmuyor ✅, yazınca kayboluyor ✅

> **İpucu `::before` ile çiziliyor, gerçek bir düğüm olarak değil.**
> Düzenlenebilir alana metin koymanın iki yan etkisi var: metin
> seçilebilir hâle geliyor ve `readInline` onu **içerik sanıyor**.
> `content` ile çizilen metin DOM'da yok, yani modele de giremez —
> test bunu ayrıca ölçüyor.
>
> **Odakta gizlenmiyor.** Kullanıcı tıklar tıklamaz ipucunu kaybetmek,
> okumaya en çok ihtiyacı olduğu anda onu almak demek.
>
> **"Boş" = tek blok ve o blok içeriksiz paragraf.** İki boş paragraf
> varsa kullanıcı Enter'a basmıştır; artık boş bir belgeye değil boş bir
> satıra bakıyordur ve ipucu oraya ait değil.
>
> Testler: 6 tarayıcı testi × 3 motor.

### F3-09 · Tema sistemi `[M]` ✅
`@kalem/themes`: CSS değişkeni token seti ✅, `default` + `dark` + `minimal` ✅;
`prefers-color-scheme` + `[data-theme]` ✅
- [x] **Kabul:** tek CSS bloğuyla marka rengi değiştirilebiliyor

**Kabul kriteri önceden karşılanmıyordu.** Her katmanın kendi sözlüğü
vardı: görüntüleyicide `--kalem-accent`, arayüzde `--kalem-ui-accent`.
Marka rengini değiştiren kişi ikisini birden bulmak zorundaydı ve biri
unutulunca araç çubuğu belgeden farklı renkte kalıyordu. Sözlük artık
`tokens.css`te bir kez tanımlanıyor; `viewer.css`, `editor.css` ve
`ui.css` yalnızca tüketiyor.

**Seçiciler `:where()` içinde, sıfır özgüllükte.** Gömen sayfanın yazdığı
her kural bunu yeniyor; `!important` ya da uzun seçici zinciri gerekmiyor.

**Yüzen parçalar tema sınıfını kendileri taşıyor.** Araç çubuğu, menüler
ve tutamaç `<body>` altında duruyor (bir `overflow: hidden` kapsayıcı
onları kırpardı) ve orada gömen sayfanın sarmalayıcısından miras
alamıyorlar. `@kalem/ui` her birine `kalem-theme` ekliyor — testle
sabitlendi.

**`:root` yine yok.** Bir Markdown kütüphanesinin gömüldüğü uygulamanın
düğmelerinin rengini değiştirmesi kabul edilemez; test `:root`ta token
olmadığını ayrıca ölçüyor.

**`minimal` ne işe yarıyor:** kütüphanenin kendi görsel kimliğini geri
çekiyor. `--kalem-fg` ve `--kalem-font` `inherit`, vurgu `currentcolor`,
gölge ve yuvarlatma yok — kendi tasarım sistemi olan bir uygulamaya
gömülünce Kalem yabancı durmuyor.

**`dark` neden ayrı dosya:** `tokens.css` koyu temayı zaten sistem
tercihinden ve `[data-theme]`den veriyor. Ayrı dosya, kök elemana
öznitelik yazamayan gömme senaryoları için (bir CMS bloğu), çünkü hangi
CSS'in yükleneceğine karar verebiliyorlar.

Boyut: `tokens.css` 467 B, `dark.css` 191 B, `minimal.css` 221 B;
`viewer.css` 1.16 kB → 869 B. Üç yeni dosyaya rağmen toplam CSS düştü.

### F3-10 · Erişilebilirlik geçişi `[L]` 🟡
- [x] ARIA rolleri (`role="textbox"`, `aria-multiline`), menüler için `role="menu"` +
      `aria-activedescendant`
- [x] Odak yönetimi, odak halkaları, canlı bölge duyuruları ("Blok yukarı taşındı")
- [x] Sürükle-bırak için klavye alternatifi (Ctrl+Shift+↑/↓) — **sürükle-bırak tek yol olamaz**
- ⬜ **NVDA ve VoiceOver ile elle test — YAPILMADI**
- [x] **Kabul (otomatik kısım):** axe sıfır ihlal, sekiz farklı durumda

> **Elle ekran okuyucu testi yapılmadı ve yapılamaz.** NVDA ve VoiceOver
> gerçek bir masaüstünde, gerçek bir kişiyle çalıştırılmayı gerektiriyor.
> Otomatikleştirilebilir her şey yapıldı; bu madde bilerek açık bırakıldı
> ve Faz 3'ün çıkış kriteri ("gerçek bir kişiyle test et") ile birlikte
> yapılmalı.

**axe sekiz durumda taranıyor,** yalnızca açılış ekranında değil: balon,
slash menü, blok menüsü, bağlantı popover'ı, salt okunur, koyu ve yalın
tema. Arayüzün çoğu ancak bir etkileşimden sonra var oluyor; tek bir
tarama onu hiç görmüyor.

**Bulunan ve düzeltilen gerçek kusurlar:**
- `role="textbox"` **adsızdı** — ekran okuyucu "düzenle, çok satırlı"
  diyor, neyi düzenlediğini söylemiyordu. `EditorOptions.label` eklendi;
  `mountUi` sözlüğünden bir ad koyuyor (var olan `aria-label` /
  `aria-labelledby` ezilmiyor). Başsız paket kendi metnini uydurmuyor.
- **Görev kutularının etiketi yoktu.** Görüntüleyicide F2-04'te
  düzeltilmişti, editörde değil. Ad maddenin kendi metninden üretiliyor —
  sabit bir dize her dilde yanlış olurdu.
- **`dark.css` okunmaz çıktı üretiyordu:** `--kalem-bg` saydam kaldığı
  için açık renkli bir sayfada açık renkli metin; kontrast 1.24. Bu dosya
  tam olarak *sayfasını temalandıramayan* gömme için var, artık kendi
  zeminini boyuyor.
- **`minimal.css` soluk metni 3.73 kontrast veriyordu** (AA eşiği 4.5);
  alıntı, bağlantı ve satır içi kod aynı tokenı kullandığı için üçü
  birden sınırdaydı.
- **Demo sayfalarında doctype yoktu** — sayfa quirks modundaydı ve orada
  tablolar `color` miras almıyor. Koyu temada tablo başlığı okunmaz
  çıkıyordu. Gerçek bir gömme sayfasında da aynı tuzak var.

**Bilerek kabul edilen tek axe bulgusu:** slash menüsünün kaydırmalı
listesi `scrollable-region-focusable` kuralını karşılamıyor. Menü açıkken
kullanıcı **yazmaya devam ediyor**, yani odak editörde kalmak zorunda ve
seçili öğe `aria-activedescendant` ile bildiriliyor — ARIA APG'nin açılır
liste için önerdiği desen. Kuralın koruduğu asıl şey (*klavye kullanıcısı
listenin tamamına erişebiliyor mu*) ayrı bir testle ölçülüyor. İstisna
dar: yalnızca o kural, yalnızca o eleman.

**axe'ın göremediği 10 test** ayrıca yazıldı: adlandırma, salt okunur
duyurusu, görev kutusu adı, klavyeyle blok taşıma + duyuru, menü
işlemlerinin duyurulması, menü kapanınca odağın geri verilmesi, slash
listesinin son öğesine klavyeyle inilebilmesi, tek sekme durağı, simge
`aria-hidden`ları, canlı bölgenin kurulumu.

### F3-11 · UI E2E + görsel regresyon `[M]` ✅
Playwright: balon araç çubuğu ✅, slash menü ✅, sürükle-bırak ✅, yapıştırma ✅;
her tema için ekran görüntüsü karşılaştırması ✅
- [x] **Kabul:** CI'da yeşil ✅, `editor + ui` 34.47 / 58 kB ✅

**İşlevsel E2E** F3-01…F3-07 ile birlikte yazıldı ve üç motorda koşuyor.
Görsel regresyon burada eklendi: 3 tema × 6 durum = 18 referans
(belge, sabit çubuk, balon, slash menü, blok menüsü, bağlantı popover'ı).

**Yalnızca Chromium.** Üç motor aynı CSS'i üç farklı biçimde çiziyor; üç
referans kümesi, yakalanan her gerçek regresyona karşılık iki gürültü
demek. Motorlar arası fark zaten işlevsel testlerden yakalanıyor;
buradaki soru dar: *CSS'te ne değişti.*

**Referanslar platforma bağlı ve bu bir tuzak.** Yazı tipi çizimi Windows
ile Linux'ta birebir aynı değil; bir platformda üretilen referans
diğerinde her zaman kırmızı verir. Bu yüzden referansı olmayan platformda
test **atlanıyor** ve sebebi raporda yazıyor — sessizce yeşile dönmüyor,
eksik olan karşılaştırma ölçütü. Depoda şu an yalnızca
`*-chromium-win32.png` var (136 kB).

> **CI için Linux referansları henüz üretilmedi.** Tarayıcı işi
> `ubuntu-latest`te koşuyor ve orada 18 görsel test atlanıyor. Üretmek
> için o iş bir kez `pnpm e2e --update-snapshots` ile koşturulup
> `*-chromium-linux.png` dosyaları commit'lenmeli; gerekçe ve adımlar
> `ci.yml` içinde yazılı. Windows'ta üretilenler oraya taşınamaz.

>
> **Kapandı (Faz 6 sonu).** 18 Linux referansı Playwright'ın resmi
> imajında (`mcr.microsoft.com/playwright:v1.63.0-noble`) üretildi ve CI'daki
> tarayıcı işi de artık **aynı imajda** koşuyor — `ubuntu-latest`in kendi
> yazı tipleri pikseli değiştirebilirdi.
>
> **İlk deneme yanlıştı ve yakalandı.** Referansları `LANG` vermeden
> üretip Türkçe yerel ayarla (CI'ın ayarı) karşılaştırınca 18 testin
> hepsi kırmızıydı: 250–370 piksel fark, bazı öğeler 1 piksel dar.
> fontconfig yazı tipini `LANG`'a göre seçiyor. Referanslar CI'ın yerel
> ayarıyla yeniden üretildi ve aynı konteynerde iki ayrı karşılaştırma
> koşusunda 18/18 geçti.

**Testlerin gerçekten yakaladığı doğrulandı:** balon çubuğunun `gap`
değeri 2px → 9px yapılınca üç temada da kırmızıya döndüler. Ardışık iki
koşuda da kararlılar (imleç `caret: "hide"` ile gizleniyor; yanıp sönen
imleç aynı sayfadan iki farklı görüntü üretiyordu).

> **FAZ 3 ÇIKIŞ KRİTERİ:** Yazılım bilmeyen bir kişiye verildiğinde, açıklama yapmadan doküman yazabiliyor. **Bunu gerçek bir kişiyle test et** (sessiz geliştirmede bu tek gerçek kullanıcı sinyalin).

---

# FAZ 4 — Eklentiler
**Amaç:** Modülerlik vaadini kanıtlamak. **Süre: ~4–5 hafta**

> Tümü ayrı paket, tümü halka açık eklenti API'sini kullanır, tümü isteğe bağlı.

### F4-01 · `plugin-image-upload` `[L]` ✅
- [x] Sürükle-bırak / yapıştırarak görsel
- [x] Yükleme kancası (`upload`), iptal (`AbortSignal`) ve ilerleme
- [x] Yer tutucu + ilerleme + hata durumu
- [x] Alt metin düzenleme (görsele tıklayınca)
- ⬜ **Yeniden boyutlandırma — yapılmadı, gerekçesi aşağıda**
- [x] **Kabul:** sahte bir S3 yükleyiciyle uçtan uca çalışıyor (23 tarayıcı testi)

**Yeniden boyutlandırma neden yok.** Markdown'da görsel boyutu diye bir
sözdizimi yok. Yapılabilecek tek şey `<img width="...">` ham HTML'i
yazmak; o da temiz bir Markdown görselini ham HTML'e çeviriyor, başka
araçlarda görünmez kılıyor ve belgeyi taşınamaz hâle getiriyor. Bunun
kullanıcının belgesine yapılıp yapılmayacağı kütüphanenin kararı değil —
`onResize` kancası veriliyor, ne yapacağına gömen uygulama karar veriyor.

**Geçici adres `blob:` olamadı.** İlk hâli `blob:` idi ve çalışmadı:
çekirdeğin URL beyaz listesi (F1-10) `blob:`i tanımıyor, render adresi
`#`e çeviriyor ve önizleme hiç görünmüyordu. Beyaz liste **haklı ve
gevşetilmedi**: `data:` görselinin MIME türü adresin içinde yazıyor ve
`image/svg+xml` oradan ayıklanabiliyor, `blob:` adresinde tür bilgisi
yok. Denetleyemediğin bir şemayı açmak beyaz listeyi anlamsız kılar.
Modele `kalem-upload:<n>` giriyor, gerçek önizlemeyi eklenti DOM'a
kendisi yazıyor.

**Eklenti API'sinde iki boşluk bulundu ve kapatıldı** — Faz 4'ün çıkış
kriteri ("API kendi kullanımıyla doğrulanmış") tam olarak bunu istiyordu:
- `PluginContext.on` yoktu. Editör bloğu yeniden çizdiğinde eklentinin
  `<img>` üstüne koyduğu ilerleme süslemesi kayboluyordu ve eklentinin
  bunu öğrenmesinin hiçbir yolu yoktu. Render kancası hâlâ yok; bu ondan
  farklı — düğüm başına değil, değişiklik başına tek çağrı.
- `EditResult.caret` zorunluydu. Arka planda biten bir düzenleme (yükleme
  tamamlanması) imleci taşıyor, odak editörün dışındaysa oraya **geri
  çekiyordu**. Artık `null` = "imlece dokunma".

> **Editörde veri kaybına yol açan bir hata bulundu.** Görselin ofset
> uzunluğu 0 ve sıfır uzunluklu bir düğüm hiçbir aralıkla çakışmadığı
> için `sliceInline` onu hem baştan hem kuyruktan eliyordu: imleci
> görselin yanına koyup bir şey yapıştırmak (ya da ikinci bir görsel
> bırakmak) **görseli sessizce siliyordu**. Eklentiden bağımsız bir
> `spliceInline` testiyle doğrulandı ve düzeltildi; 6 birim testiyle
> sabitlendi.
>
> **Kalan iş:** görselin ofset uzunluğu hâlâ 0. Bunun ikinci bir sonucu
> var — kullanıcı görselin yanına imleç koyamıyor, onu seçemiyor ve
> Backspace ile silemiyor. Doğru çözüm atomik düğümlere uzunluk 1 vermek;
> `offsets.ts`teki DOM↔model eşlemesini de değiştiriyor, üç tarayıcıda
> imleç matematiği demek. F4-01'in ortasında yapılacak bir değişiklik
> değildi, ayrı bir iş olarak duruyor.
>
> **Kapandı (Faz 6 sonu).** Görsel artık tek karakterlik atomik öğe: DOM
> tarafında `<img>` = 1 (`offsets.ts`, `<br>` ile aynı yolda), modelde
> `image`/`imageReference` = 1 (`inline-edit.ts`). Bul-değiştir görseli
> arama metninde U+FFFC olarak tutuyor; düz arama artık görselin üstünden
> geçip eşleşmiyor.
>
> **Notun bir kısmı yanlıştı.** Ölçülünce imleç koymak ve Backspace'in eski
> kodda da çalıştığı görüldü — onları tarayıcı kendisi yapıyor. Kırık olan,
> seçimi **modelden** okuyan işlemlerdi: yalnızca görseli seçmek modelde 0
> uzunluklu bir aralıktı, Ctrl+B / bağlantı / kopyalama hiçbir şey
> yapmıyordu. Buna bakan tarayıcı testi eski kodda kırmızı, yenide üç
> motorda yeşil; ilk yazdığım iki test ise eski kodda da geçiyordu ve
> düzeltmeyi kanıtlamıyordu.
>
> **Yan kazanç: bul-değiştir tabloları da tarıyor.** F4-03'te tablolar
> "değişiklik çıktıya girmiyor" gerekçesiyle dışarıdaydı; tablo düzeltmesi
> o gerekçeyi kaldırdı. Her hücre ayrı bir bölge (`path` = `[satır,
> hücre]`); boyama ve değiştirme üç motorda sınandı.

Boyut: eklenti tek başına 2.92 kB (çekirdek ve editör hariç),
`plugin-image.css` 342 B.

### F4-02 · `plugin-code-highlight` `[M]` ✅
- [x] Kendi belirteçleyicimiz — sıfır bağımlılık, 8 dil (JS/TS, JSON, CSS, HTML, Python, Shell, SQL, Markdown)
- [x] Dil paketleri `import()` ile **tembel**, her biri ayrı chunk
- [x] Prism ve Shiki adaptörleri (`prismTokens`, `shikiTokens`) — ikisi de bağımlılık değil
- [x] Görüntüleyici için editörsüz yol: `highlightAll(root)`
- [x] Tema sözlüğü `plugin-code.css`, açık/koyu paletler AA kontrastında
- [x] **Kabul:** vurgulama kullanılmadığında ana bundle'a 0 byte ekliyor

**"0 byte" iki parçadan geliyor ve ikisi de makine tarafından ölçülüyor.**
İlki paket ayrımı: eklentiyi kurmayan hiçbir şey indirmiyor ve
`@kalem/editor` bütçesi (38 kB) değişmedi — hâlâ 25.92 kB. İkincisi dil
paketlerinin ayrı chunk olması: `.size-limit.json` tek bir dil paketini
adıyla ölçüyor (599 B), yani chunk'lar birleşirse kapı kırmızıya döner.
Çalışma zamanı tarafı e2e'de: sayfanın ağ istekleri izleniyor ve
belgede geçmeyen dilin hiç inmediği, geçen dilin **bir kez** indiği
sabitlendi.

**Neden kendi belirteçleyicimiz var.** Shiki tek başına bu kütüphanenin
tamamından büyük; Prism'in kolay arayüzü HTML dizesi döndürüyor ve onu
ekrana koymanın tek yolu `innerHTML` — kod bloğunun içeriği kullanıcının
yazdığı metin olduğu için o kapı doğrudan bir XSS yüzeyi. Buradaki ~90
satır **doğru ayrıştırıcı değil** ve öyle olduğunu iddia etmiyor:
düzenli ifadelerle tarıyor, sözdizimini anlamıyor. Yetmediğinde çıkış
yolu açık — `highlight` seçeneği ve iki adaptör.

**Vurgulama modele dokunmuyor.** Belirteçler `<code>` içine `<span>`
olarak yazılıyor; `offsets.ts` elemanları şeffaf saydığı için editörün
imleç matematiği ve `readCode()` süslemeyi hiç görmüyor. Yani Markdown
çıktısı değişmiyor (e2e ile sabit) ve eklenti söküldüğünde blok düz
metne dönüyor.

**Boyama imleci taşıyor.** Kullanıcı kod bloğunun içinde yazarken her
tuş vuruşundan sonra elemanın çocukları baştan kuruluyor; ofset boyama
**öncesinde** ölçülüp sonrasında geri kuruluyor. Ofset fonksiyonları
editörden içe aktarıldı, kopyalanmadı — ayrışırlarsa imleç kayar.
Bileşim (IME) sürerken boyama bekliyor, `change` olayları tek kareye
birleşiyor.

**Geri bakış (`(?<=`) gramerlerde yasak.** Eski Safari onu düzenli ifade
değişmezi olarak ayrıştıramıyor ve hata **modülün tamamını** yükletmiyor
— vurgulama o tarayıcıda sessizce kapanırdı. Bir testle sabitlendi.

**Metin `textContent` ile okunmuyor.** `textContent` `<br>` elemanını
görmüyor (`<code>a<br>b</code>` → "ab") ve tarayıcı `contenteditable`
içinde Enter'a basınca `<br>` üretebiliyor; o hâlde boyama kullanıcının
satır sonunu yutardı. Editörün `readCode`u da aynı sebeple kendi
okuyucusunu yazıyor.

**Koyu belirteç renkleri `dark.css`te tekrar ediyor.** `plugin-code.css`
üç tema durumunu karşılıyor (varsayılan, `prefers-color-scheme`,
`[data-theme]`); dördüncüsü olan `dark.css` — sayfa tamamen koyu ama kök
elemana öznitelik yazılamıyor — CSS'ten algılanamıyor. Tekrar bilerek:
alternatifi, o senaryoda okunmayan bir kod bloğu.

Boyut: eklenti sekiz dil paketiyle birlikte 3.69 kB, tek dil paketi
599 B, `plugin-code.css` 474 B (hepsi gzip, çekirdek ve editör hariç).
80 birim + 21 tarayıcı testi.

### F4-03 · `plugin-find-replace` `[M]` ✅
- [x] Ctrl+F / Ctrl+H, panel, sonraki/önceki, sayaç
- [x] Eşleşme vurgulama — CSS Özel Vurgu API'si, DOM'a düğüm eklemeden
- [x] Tümünü değiştir — tek düzenleme, tek Ctrl+Z
- [x] Büyük/küçük harf duyarlılığı ve tam kelime seçenekleri
- [x] Salt okunur belgede arama açık, değiştirme kapalı
- [x] **Kabul:** 100 sayfalık dokümanda takılmadan çalışıyor
- [x] **Kabul (locale):** `lang="tr"` iken `ışık` ↔ `IŞIK` ve `iyi` ↔ `İYİ` eşleşiyor, `ışık` ↔ `İŞİK` eşleşmiyor

**F3-03'ün `foldForSearch`u kullanılamadı.** Slash menüsü için yazılan
katlama aksanları da atıyor (`baş` → `bas`) ve orada doğru; burada kabul
kriterini **düşürüyor**, çünkü `ışık` ile `İŞİK` ikisi de `isik` olurdu.
Menüde kaçırılan bir öğenin bedeli ile bul-değiştir'de yanlış kelimeyi
değiştirmenin bedeli aynı değil. Bu yüzden yalnızca kasa katlanıyor, o da
`toLocaleLowerCase(locale)` ile.

**Katlama uzunluğu değiştiriyor ve bu sessiz bir hata kaynağı.**
`"İ".toLocaleLowerCase("en")` iki kod birimi veriyor (i + birleştirici
nokta), `"ß".toLocaleUpperCase("de")` iki harf. Eşleşme konumu özgün
metne göre verilmek zorunda — değiştirme orada yapılıyor. Katlama bu
yüzden kod noktası başına yapılıyor ve her katlanmış birim için özgün
indis bir tabloda tutuluyor. Tablo olmasa İngilizce locale'de
`İstanbul` içinde arama yapmak bir karakter kaymış aralık üretirdi.

**Düzenli ifade kullanılmadı.** Kullanıcının yazdığı şey desen değil
metin (`C++` geçersiz desen, `a.b` fazla eşleşir), `i` bayrağı Türkçe'yi
bilmiyor ve kullanıcının yazdığı desenin çalışma süresi denetlenemiyor.
Katlanmış metinde `indexOf`: öngörülebilir, locale'i doğru.

**Vurgulama DOM'a hiç dokunmuyor.** F4-02'deki `<span>` yolu burada daha
pahalıya gelirdi: imleç editörde dururken her tuşta paragraf içi yeniden
kurulacak, bir eşleşme biçim sınırını aşınca (`**ka**lın`) metin
düğümlerini `contenteditable` içinde elle bölmek gerekecekti. CSS Özel
Vurgu API'si (`CSS.highlights`) üç motorda da destekleniyor; olmayan bir
tarayıcıda boyama sessizce düşüyor, arama çalışmaya devam ediyor. Bir
tarayıcı testi, panel açıkken editörün `innerHTML`inin **byte olarak
aynı** kaldığını sabitliyor.

**Biçim yerinde değişiklikle korunuyor.** `**kedi**` içinde "kedi"
değiştirilince kalınlık duruyor: eşleşme tek bir metin düğümünün
içindeyse o düğüm yerinde güncelleniyor, kesilip yapıştırılmıyor.
Sınırı aşan eşleşme düz metne dönüyor — iki farklı biçimden hangisinin
kazanacağı keyfî olurdu.

**Tümünü değiştir sondan başa gidiyor.** Değişmeyen kısım hep solda
kalıyor, yani henüz kullanılmamış ofsetler geçerli; belge eşleşme sayısı
kadar yeniden taranmıyor. Sonuç tek bir `EditResult`, yani tek Ctrl+Z.

**Tablo ve bağlantı tanımı taranmıyor.** İkisi de aynı sebepten:
değiştirilemiyorlar. Serileştirici tabloyu `TableSyntax.raw`dan geri
yazıyor (Karar #5: v1'de tablo düzenleme yok), `definition` ise ekranda
kaynak metin gibi görünse de modelde üç ayrı alan. Bulunup
değiştirilemeyen metin, kullanıcı için kırık bir özellik; ham metni
düşürüp tabloyu yeniden üretmek ise bir kelime değiştirdiği için
kullanıcının hizalamasını bozmak olurdu.

> **Editörde sessiz veri kaybı bulundu (F4-03 dışında, düzeltilmedi).**
> Tablo hücreleri `contenteditable` çiziliyor — kullanıcı içlerine
> yazabiliyor, model güncelleniyor, ama `serialize` tabloyu
> `TableSyntax.raw`dan geri yazdığı için **yazdığı hiçbir şey çıktıya
> girmiyor**. Tarayıcıda doğrulandı: bir hücreye "XX" yazmak Markdown
> çıktısını değiştirmiyor.
>
> Karar #5 ile tutarlı çözüm, v1'de tablo hücrelerini düzenlenebilir
> çizmemek (`render.ts`): kullanıcıyı kaybolacak bir metni yazmaya davet
> etmemek. Gerçek çözüm `@kalem/plugin-table` (v1.1) ile tablo üreticisi.
> F4-03'ün ortasında yapılacak bir değişiklik değildi, ayrı bir iş
> olarak duruyor.
>
> **Kapandı (Faz 6 sonu).** Hücreleri salt okunur yapmak yerine düzenleme
> çalışır hâle getirildi: serileştirici ham tabloyu **satır satır**
> kullanıyor. Her ham satır yeniden ayrıştırılıp modeldeki satırla anlamca
> (ağaç olarak, `position`/`id`/`syntax` hariç) karşılaştırılıyor; aynıysa
> ham satır yazılıyor, değilse yalnızca o satır üretiliyor — kenar boruları
> ve hücre genişlikleri eski satırdan alınarak. Tek kelime için bütün
> tabloyu yeniden hizalamak dokunulmamış satırları değiştirmek olurdu.
> Satır sayısı ham metinle tutmazsa tablo baştan üretiliyor (v1'de satır
> ekleme arayüzü yok). Ek hata: tam üretim yolu hücredeki `|`'yi
> kaçırmıyordu; artık kaçırıyor, ayrıştırıcının kuralıyla (önünde tek ters
> bölü) aynı. 7 birim testi + 1 tarayıcı testi (üç motor).
>
> Çekirdek 12,6 → 13,0 kB; bütçe 13 → 14 kB (izin 15 kB'a kadar).
> `guard:sizes` artık `--fix` alıyor: eski sayıları biçimini koruyarak
> yerinde güncelliyor — bu seferki 25 sayı böyle güncellendi.

Boyut: eklenti 4.46 kB, `plugin-find.css` 649 B (gzip, çekirdek ve
editör hariç). 59 birim + 51 tarayıcı testi.

### F4-04 · `plugin-outline` `[S]` ✅
- [x] Başlık listesi, belge değiştikçe güncelleniyor
- [x] Tıklayarak atlama — imleç başlığa taşınıyor, görünür alana geliyor
- [x] Etkin başlık takibi: imleçten **ve** kaydırmadan
- [x] Panel gömen uygulamanın verdiği kapsayıcıya çiziliyor; verilmezse liste yine API'den okunabiliyor

**Girinti dereceden değil seviyeden geliyor.** Gerçek belgeler başlık
derecelerini atlıyor: `#` sonrası gelen bir `###`, girintiyi `depth`ten
alsaydı iki kat boşluk bırakırdı. Bir başlık, kendisinden daha sığ en
yakın atanın bir altına giriyor — belgenin ne demek istediği korunuyor,
kullanıcının yazım alışkanlığı cezalandırılmıyor.

**Etkin başlık iki sinyalden, son gelen kazanıyor.** Kullanıcının dikkati
yazarken imleçte, okurken görünür alanda; yalnızca kaydırmayı dinlemek
yazarken paneli donduruyor, yalnızca imleci dinlemek odak dışarıdayken
hiç güncellememek demek. İmleç sinyali **yalnızca odak editördeyken**
dinleniyor: bu ayrım olmadan salt okunur bir belgede panelden atlamak işe
yaramıyordu, çünkü tıklamanın ürettiği `selectionchange` az önce
işaretlenen başlığı eskisine geri çeviriyordu.

**Kaydırma eşiği kaydıran kaba göre ölçülüyor.** İlk hâli görünür alanın
üst kenarını (0) referans alıyordu ve editörü kendi kutusunda kaydıran
uygulamalarda hiçbir başlık etkin olmuyordu: kutu sayfanın 200 piksel
aşağısındaysa, kutunun tepesindeki başlığın `top`u 200 çıkıyor. Artık
editörü kaydıran ata bulunup eşik ona göre alınıyor.

**Ölçüm hiçbir başlık bulamazsa varsayımda bulunmuyor.** "Hiçbiri eşiğin
üstünde değilse ilki etkin olsun" kuralı, ekrana sığan bir belgede
atlamayı işe yaramaz kılıyordu: atlamanın tetiklediği kaydırma olayı
seçimi ilk başlığa geri alıyordu. Varsayım artık yalnızca **henüz bir
seçim yokken** yapılıyor.

**`@kalem/editor`e üç fonksiyon eklendi** (`blockElementOf`, `holderIn`,
`holderFor`). Model konumundan DOM elemanına gitmek, F4-03'te de F4-04'te
de gerekti ve eklentiler birbirine bağlanamıyor (her biri bağımsız
paket). İki eklentinin aynı on satırı kopyalaması, `render.ts`in
işaretleme biçimi değiştiğinde ikisinin birden sessizce bozulması
demekti. Bul-değiştir'in yerel kopyası silindi.

**Panel neden yüzen bir kutu değil.** Bul-değiştir paneli geçici, bu
kalıcı bir kenar çubuğu ve nereye konacağı uygulamanın yerleşim kararı.
Kapsayıcı dışarıdan geliyor; demo sayfasında varsayılan olarak kapalı,
çünkü açmak editörün genişliğini değiştiriyor.

Boyut: eklenti 1.92 kB, `plugin-outline.css` 435 B (gzip, çekirdek ve
editör hariç). 16 birim + 33 tarayıcı testi.

### F4-05 · `plugin-word-count` `[S]` ✅
- [x] Kelime, karakter (boşluklu/boşluksuz) ve okuma süresi
- [x] Durum çubuğu bileşeni; kapsayıcı verilmezse yalnızca sayıyor
- [x] Yazma durunca sayıyor (varsayılan 200 ms)

**Kelime sınırı `Intl.Segmenter`dan geliyor.** "Boşluklara böl" yalnızca
boşluk kullanan diller için doğru: Japonca bir cümle o yolla **1 kelime**
sayılıyor. Tarayıcının sözcük sınırı tablosu zaten orada ve hiçbir
düzenli ifadenin ulaşamayacağı doğrulukta — ek bir byte indirilmiyor.
`Segmenter` yoksa boşluk ayırmaya düşülüyor: sayaç kırılmıyor,
CJK'da kabalaşıyor.

**Karakter kod noktası sayılıyor.** `String.length` kod **birimi**
sayıyor: bir emoji 2 çıkıyor. Kullanıcının "karakter" dediği şey ve
yayıncılıkta kullanılan sınır kod noktası.

**Sayaç gecikmeli.** Sayma belge uzunluğunda doğrusal ve `Segmenter` ucuz
değil; 100 sayfalık belgeyi her tuş vuruşunda saymak yazmayı hissedilir
biçimde ağırlaştırıyor. Sayaç yazmanın sonucu, kendisi değil.

**Kod blokları varsayılan olarak sayılıyor**, seçenekle çıkarılabiliyor:
teknik bir belgede kod yazının parçası ve okuma süresine giriyor.
Görselin alt metni ve bağlantı tanımları sayılmıyor — ekranda
görünmüyorlar.

**Durum çubuğu canlı bölge değil.** `aria-live` koymak, ekran okuyucu
kullanan birine yazdığı her kelimeden sonra "247 kelime" dedirtmek
demekti. Şerit adlandırılmış bir grup; kullanıcı istediğinde okuyor.

Etiketlerin hepsi fonksiyon, çünkü çoğul kuralı dile bağlı: İngilizce'de
"1 word / 2 words", Türkçe'de ikisi de "kelime".

Boyut: eklenti 1.39 kB, `plugin-word-count.css` 210 B (gzip, çekirdek ve
editör hariç). 27 birim + 24 tarayıcı testi.

> **Yan düzeltme:** `editor.spec.ts`teki "yazarken diğer blokların
> elemanları yeniden kurulmuyor" testi sabit bir makro görev bekliyordu
> ve yüklü bir makinede Firefox'ta rastgele kırmızıya dönüyordu. Artık
> modelin değişmesini bekliyor.

### F4-06 · `plugin-source-mode` `[M]` ✅
- [x] WYSIWYG ↔ ham Markdown geçişi; Ctrl/Cmd+Shift+M ve Escape
- [x] Basit `<textarea>` — CodeMirror bağımlılığı yok
- [x] Salt okunur belgede kaynak da salt okunur
- [x] **Kabul:** iki mod arası geçişte içerik kaybı yok

**Neden CodeMirror yok.** Boyut: tek başına Kalem'in tamamından büyük.
Ham Markdown kipi kullanıcının **kaçış kapısı** — "editör bunu yanlış
yaptı, kaynağı kendim düzelteyim" anı. O an için sözdizimi vurgulaması,
kod katlama ve çoklu imleç gerekmiyor; metnin kendisi gerekiyor.
`<textarea>` ayrıca bedavaya doğru davranıyor: yerel geri alma, IME,
ekran okuyucu, mobil klavye.

**İçerik kaybı olmaması iki yerden geliyor.** Kaynağa geçerken belge
`serialize` ile metne çevriliyor (çekirdeğin gidiş-dönüş garantisi,
F1-07); geri dönerken metin **değişmediyse belgeye hiç dokunulmuyor**.
İkincisi asıl önemli olan: `setValue` çağırmak belgeyi yeniden ayrıştırır,
düğüm kimliklerini değiştirir ve geçmişe anlamsız bir adım yazardı.
Kullanıcı kaynağa bakıp hiçbir şey yapmadan döndüğünde hiçbir şey
olmuyor — bir tarayıcı testi bunu Ctrl+Z ile sabitliyor.

**İmleç korunmuyor ve bu bilinçli.** Model konumunu kaynak ofsetine
çeviren bir eşleme gerekiyor; serileştirici onu üretmiyor (konum bilgisi
ayrıştırmadan geliyor, üretimden değil). Yanlış yere konan bir imleç, hiç
konmayandan kötü.

**Editör gizleniyor, DOM'dan çıkarılmıyor.** Çıkarıp geri koymak blok
elemanlarını yeniden kurar ve editörün eleman haritasını (F2-05)
geçersizler; gizlemek geri dönüldüğünde hiçbir şeyin değişmemesini
garanti ediyor.

> **CSS hatası bulundu ve düzeltildi.** `.kalem-source { display: block }`
> kuralı, tarayıcının `[hidden] { display: none }` kuralını özgüllükle
> eziyordu: kipten çıkıldığında kutu ekranda kalıyordu. `ui.css` aynı
> tuzağa `!important` ile karşılık vermiş; burada `.kalem-source[hidden]`
> zaten daha özgül olduğu için gerekmedi.

Boyut: eklenti 1.01 kB, `plugin-source.css` 269 B. 23 birim + 36 tarayıcı
testi.

### F4-07 · `plugin-autosave` `[S]` ✅
- [x] Gecikmeli `save` kancası (varsayılan 1500 ms)
- [x] "kaydediliyor / kaydedildi / kaydedilemedi" durumu ve göstergesi
- [x] `localStorage` kurtarma — başarısız kayıt ve sekme kapanışı

**Ağ hakkında hiçbir şey bilmiyor.** `save(markdown, signal)` çağrılıyor,
gerisi gömen uygulamanın (F4-01'deki aynı karar).

**Aynı anda tek kayıt.** Kullanıcı yazmaya devam ederken önceki kayıt
sürüyor olabiliyor; paralel istek göndermek sunucuya **sırası karışmış**
sürümler yollamak demek — ağda geciken eski bir kayıt yenisinin üstüne
yazabiliyor. Bir kayıt sürerken yenisi başlatılmıyor, biterken belge yine
değiştiyse bir kez daha çalışıyor. Art arda gelen birden çok değişiklik
tek bir tekrara düşüyor.

**Kurtarma neden `localStorage`.** `beforeunload` sırasında çalışan tek
depo o: `IndexedDB` asenkron olduğu için sekme kapanırken yazma sözü
verip tutamıyor. Kurtarma kaydı **otomatik uygulanmıyor** — editör
açılışında yerel kopyayı sessizce yüklemek, sunucudaki daha yeni sürümü
gizleyebilir. `recovered()` soruluyor, kararı uygulama veriyor.

**Anahtar verilmezse kurtarma kapalı.** Rastgele bir anahtar üretmek,
başka bir belgenin taslağını bu belgeye getirme riski taşıyor.

**Gösterge canlı bölge (`role="status"`), kelime sayacının tersine.**
Kaydetme durumu seyrek değişiyor ve kullanıcının bilmesi gereken bir şey;
"kaydedildi mi?" sorusunun cevabı küçük gri bir yazıysa göremeyen
kullanıcı onu hiç öğrenemiyor.

Açılıştaki içerik "kaydedilmiş" sayılıyor: kurulur kurulmaz sunucuya
istek atmak, açılan her editörün gereksiz bir yazma yapması demekti.

Boyut: eklenti 652 B, `plugin-autosave.css` 256 B. 18 birim + 24 tarayıcı
testi.

> **FAZ 4 ÇIKIŞ KRİTERİ KARŞILANDI.** Yedi eklentinin yedisi de yalnızca
> halka açık API ile yazıldı: `Plugin`, `PluginContext`, `keymap`,
> `inputRules` ve editörün dışa açtığı saf yardımcılar. Hiçbiri editörün
> içine uzanmadı, hiçbiri bir diğerine bağlanmadı.
>
> **API kendi kullanımıyla doğrulandı** ve üç yerde eksik çıktı:
> - `PluginContext.on` yoktu (F4-01) — eklentinin editörün durumuna tepki
>   vermesinin hiçbir yolu yoktu.
> - `EditResult.caret` zorunluydu (F4-01) — arka planda biten bir
>   düzenleme imleci kullanıcının yazdığı yerden koparıyordu.
> - Model konumundan DOM elemanına gitmenin yolu yoktu (F4-04) —
>   `blockElementOf` / `holderIn` / `holderFor` eklendi; iki eklenti aynı
>   on satırı kopyalamak zorundaydı.
>
> Render kancası hâlâ **yok** ve yedi eklenti boyunca gerekmedi: süsleme
> çizimden sonra uygulanıp `change`te yenileniyor (F4-01, F4-02) ya da
> DOM'a hiç dokunulmuyor (F4-03'ün Özel Vurgu API'si).

---

# FAZ 5 — Framework Sarmalayıcıları
**Amaç:** "Framework bağımsız" vaadinin kanıtı. **Süre: ~2–3 hafta**
**Not:** Faz 3 ile paralel yürütülebilir ve yürütülmeli — API'yi erken sınar.

### F5-01 · `@kalem/react` `[M]` ✅
- [x] `<KalemEditor value onChange />` — hem kontrollü hem kontrolsüz
- [x] `useSyncExternalStore` ile abonelik (`useKalemValue`), `useKalem()` ile imperatif erişim
- [x] `peerDependencies: { react: ">=17" }`, kendi boyutu **903 B** (sınır 1.5 kB)
- [x] React 19 + Strict Mode + Next.js App Router (`'use client'`) uyumu
- [x] **Kabul:** `examples/react-vite` ve `examples/nextjs` çalışıyor (11 tarayıcı testi)

**Kontrollü kipin sonsuz döngüsü nasıl kırıldı.** Kullanıcı yazıyor →
`onChange` → üst bileşen `setState` → `value` değişiyor → editöre
yazılıyor → imleç başa kaçıyor. Çözüm, editörün **kendi yaydığı** metni
bir ref'te tutmak: gelen `value` ona eşitse hiçbir şey yapılmıyor, yani
yalnızca gerçekten dışarıdan gelen bir değişiklik editöre iniyor. Örnek
uygulamada art arda yazılan harflerin aynı yere gittiği testle sabit.

**Editör yalnızca bir kez kuruluyor.** Kurulum imleci, seçimi ve geçmişi
sıfırlıyor; `lang`, `plugins`, `label` bu yüzden montaj anında okunuyor.
Geri çağırmalar istisnası bir ref'te tutuluyor — aksi hâlde satır içi
yazılan her `onChange={() => …}` editörü yeniden kurardı.

**`useSyncExternalStore` neden.** Editörün metni React'in dışında
yaşıyor. `useEffect` + `useState` iki yerden yanlış olurdu: eşzamanlı
render'da yırtılma (aynı ağacın iki bileşeni farklı metin görebiliyor) ve
abonelik ile render arasında kaçırılan güncelleme. Anlık görüntü bir
ref'te saklanıyor, her okumada `getValue()` çağrılmıyor: `change` olayı
metni zaten taşıyor ve üç okuyucu bileşen, tuş başına üç serileştirme
demekti.

**React 17 için on satırlık yedek.** `useSyncExternalStore` 18'de geldi
ama peer aralığı `>=17`. Kanca yoksa `useReducer` + `useEffect` yedeği
devreye giriyor; yırtılmaya karşı korumuyor ama React 17'de eşzamanlı
render de yok. Seçim modül düzeyinde bir kez yapılıyor, koşullu kanca
çağrısı değil.

> **Paketleyici `"use client"` yönergesini düşürüyordu.** Kaynakta
> `KalemEditor.tsx`in başında duruyor, rolldown modülleri birleştirirken
> atıyor. Sonuç: Next.js App Router'da bir sunucu bileşeni
> `<KalemEditor>` import ettiğinde "useState yalnızca istemci
> bileşenlerinde çalışır" hatası — yani F5-01'in uyumluluk sözü, derleme
> çıktısında **sessizce** bozulmuştu. Yönerge artık bant (banner) olarak
> yeniden yazılıyor ve örnek uygulama bunu `transpilePackages` ya da
> `dynamic(… ssr: false)` olmadan kanıtlıyor.

**Örnekler yayımlanacak çıktıdan çalışıyor.** Kaynağa takma ad veren bir
geliştirme sunucusu, `exports` haritasındaki bir hatayı gizlerdi. Her iki
örnek de Playwright yapılandırmasının sunucu komutunda önce derleniyor
(`playwright.examples.config.ts`), sonra sınanıyor.

Örnek testleri ana e2e paketinden **ayrı** (`pnpm e2e:examples`): Next.js
üretim derlemesi yarım dakika sürüyor ve her e2e koşusunda bu bedeli
ödemek hızlı geri bildirimi öldürürdü. CI'da kendi işi var.

> **Yan düzeltme: `pnpm attw` zaten kırıktı.** `node10` çözümlemesi
> `exports` haritasıyla mümkün değil ve araç bunu hata sayıyordu; gate
> F5-01'den **önce** de kırmızıydı. `--profile node16` ile node10
> bilerek yok sayılıyor — paketler zaten `node >= 18` istiyor.

### F5-02 · `@kalem/vue` `[M]` ✅
- [x] `<KalemEditor v-model />`, `defineComponent`, `peerDependencies: { vue: "^3" }`
- [x] Nuxt SSR uyumu — **`<ClientOnly>` gerekmiyor**, belge sunucuda çiziliyor
- [x] `useKalem()` ile imperatif erişim (provide/inject)
- [x] **Kabul:** `examples/vue-vite` ve `examples/nuxt` çalışıyor (11 tarayıcı testi)

**Sunucu belgeyi gerçekten çiziyor.** İş listesinin bu maddeyi ayrıca
yazmasının sebebi, Vue dünyasında editör sarmalayıcılarının neredeyse
hepsinin `<ClientOnly>` istemesi; bedeli görünür — sunucu boş bir kutu
gönderiyor, içerik sonradan beliriyor, arama motoru metni hiç görmüyor.
Burada `@kalem/viewer.renderToString` ile üretilen HTML sunucudan geliyor;
bir test, ham yanıtta `<h1>Işık ve Gölge</h1>` ve `<li>` olduğunu
doğruluyor.

**Hidrasyon uyuşmazlığı `innerHTML`i dondurarak engelleniyor.** Dize bir
kez hesaplanıyor ve bileşen yaşadığı sürece değişmiyor:

- Sunucu ile istemcinin ilk render'ı aynı çıktıyı veriyor → uyuşmazlık yok
  (test konsolda tek bir uyarı bile olmadığını sabitliyor).
- `v-model` sonradan değişince `innerHTML` prop'u **güncellenmiyor**;
  güncellenseydi Vue elemanın içini silip yeniden yazardı ve editörün
  DOM'u, imleci, geçmişi onunla birlikte giderdi. Değişiklikler editöre
  `setValue` ile iniyor.

**`v-model` döngüsü React'teki gibi kırılıyor:** editörün kendi yaydığı
metin bir değişkende tutuluyor, geri geldiğinde hiçbir şey yapılmıyor.
Art arda yazılan harflerin aynı yere gittiği testle sabit.

> **Öznitelikler sessizce düşüyordu.** Bileşenin kökü tek bir eleman
> değil — düzenlenebilir kutu ve yuva içeriği kardeş. Vue böyle bir
> bileşende `class`, `style`, `id` gibi öznitelikleri kendiliğinden
> aktaramıyor ve **uyarı da vermiyor**: `<KalemEditor class="editor" />`
> yazan kullanıcı stilsiz bir kutu görüyordu. `inheritAttrs: false` +
> elle aktarma ile düzeltildi; bir test `.editor` sınıfının kutuya
> indiğini sabitliyor.

**Yuva içeriği kutunun yanında, içinde değil.** Düzenlenebilir alanın içi
modelden çiziliyor; Vue'nun oraya koyduğu her düğüm editörün ilk
çiziminde silinirdi.

**Nuxt sürümü:** örnek, güncel ana sürüm olan **Nuxt 4**'ü sabitliyor
(madde Nuxt 3 güncelken yazılmıştı). Sarmalayıcıda Nuxt'a özel tek satır
yok; ölçülen şey Vue 3 SSR davranışı ve ikisinde de aynı.

Boyut: 662 B (gzip; Vue, editör ve görüntüleyici hariç).

> **Yan düzeltme — Biome yapılandırması.** `.nuxt` ve `.output` tarama
> dışına alındı: Biome üretilmiş dosyaları düzeltmeye kalkıyordu.
> `noUnusedImports` / `noUnusedVariables` `*.vue` dosyalarında kapatıldı —
> Biome SFC'nin `<template>` bloğunu ayrıştırmıyor, yani yalnızca şablonda
> kullanılan her import'u "kullanılmamış" sayıyor ve `--unsafe` bir
> düzeltmede onları silerdi.

### F5-03 · `@kalem/wc` `[M]` ✅
- [x] `<kalem-editor>` Custom Element; sınıf tembel kuruluyor, paket sunucuda import edilebiliyor
- [x] Shadow DOM **opsiyonel, varsayılan kapalı** — `shadow` özniteliği
- [x] Öznitelik / özellik / olay köprüsü; `input`, `change`, `kalem-ready`
- [x] `ElementInternals` ile form entegrasyonu: `name`, `required`, sıfırlama, `disabled`, durum geri yükleme
- [x] **Kabul:** `examples/svelte` ve `examples/angular` çalışıyor (20 tarayıcı testi)

**Çerçeve başına bir paket yazmanın sonu yok.** React ve Vue sarmalayıcıları
hâlâ değerli — kancalar, `v-model`, SSR — ama Svelte, Angular, Astro,
Rails ve düz HTML için aynı şeyi tekrar etmek yerine tarayıcının kendi
bileşen modeli kullanılıyor. Bu maddenin kabul kriteri de onu ölçüyor:
iki farklı çerçevede **sarmalayıcı olmadan** çalışması.

**Sınıf bir fonksiyonun içinde kuruluyor.** `class X extends HTMLElement`
değerlendirildiği anda `HTMLElement` globalini okuyor; modül gövdesinde
dursaydı `import "@kalem/wc"` yazan bir Next.js/Nuxt sunucusu daha ilk
satırda düşerdi — eleman o sayfada hiç kullanılmasa bile. Sınıf
`kalemEditorElement()` ilk çağrıldığında üretiliyor ve saklanıyor; DOM'a
dokunan tek şey `defineKalemEditor()`.

**Kayıt otomatik değil.** `customElements.define` global bir isim alanına
yazıyor ve aynı adı iki kez kaydetmek **hata atıyor**: import edilir
edilmez kaydeden bir kütüphane, aynı sayfada iki sürümü bulunan bir
uygulamayı (mikro-ön uç, iki bağımlılığın farklı sürümleri) açılışta
patlatırdı. Çağrı açık ve tekrarlanabilir — ad zaten kayıtlıysa `false`
dönüyor. Tek satır isteyenler için `import "@kalem/wc/define"`; ayrı giriş
olmasının sebebi `sideEffects` beyanı, yoksa paketleyici kaydı atardı.

> **Olay başına iki `input` sorunu.** `contenteditable`ın kendi `input`
> olayı zaten elemanın dışına kabarıyor, yani hiçbir şey yapmasan da
> dinleyiciye ulaşıyor — ama `event.target` içerideki blok elemanı oluyor
> ve `event.target.value` diye okuyan herkes `undefined` alıyor. Kendi
> olayımızı da yaysaydık her tuşta **iki** olay görülürdü. Yerli olay
> kapsayıcıda kesiliyor, yerine metni taşıyan bir `CustomEvent`
> yayılıyor. Bir test tuş başına tam bir olay sayıyor.

**`kalem-ready` bir mikrogörev geciktiriliyor.** `customElements.define`
sayfada duran elemanları **o anda** yükseltiyor: `connectedCallback`
define çağrısının içinde, senkron çalışıyor. Olay hemen yayılsaydı, hemen
ardından `el.addEventListener("kalem-ready", …)` yazan sayfa onu
kaçırırdı — yani en doğal kullanım hiç çalışmazdı. İmperatif erişimin
senkron yolu duruyor: `el.editor` define döndüğünde dolu.

**Söküm de bir mikrogörev geciktiriliyor.** `parent.append(el)` bir elemanı
taşırken önce söküyor sonra takıyor, ikisi de aynı görevde. Hemen
yıkılsaydı DOM'da yer değiştirmek geçmişi ve imleci silerdi. Bir test
elemanı taşıyıp yazmaya devam ediyor ve `kalem-ready` sayacının 1'de
kaldığını doğruluyor.

> **Erken atanmış özellikler kurtarılıyor.** Klasik özel eleman tuzağı:
> çerçeve `el.value = "…"` diyor, sınıf henüz tanımlı değil, atama
> elemanın **kendi** özelliği olarak yapışıyor ve sonradan gelen prototip
> erişimcisini gölgeliyor. Setter hiç çalışmıyor ve hata da yok. Angular
> ve Svelte'nin özellik bağlamaları tam olarak bu sırayla işliyor;
> `connectedCallback` her birini silip yeniden atıyor.

**Başlangıç metni elemanın içinden okunabiliyor.** Çok satırlı Markdown'ı
bir özniteliğe sıkıştırmak zorunda değilsiniz:

    <kalem-editor>
        # Başlık
    </kalem-editor>

Buradaki girinti sayfanın, yazarın değil — ama Markdown onu **kod bloğu**
sayar. Ortak önek sökülüyor (göreli girintiler duruyor), yoksa sayfasını
düzgün biçimlendiren herkesin belgesi sessizce koda dönerdi.
`<script type="text/markdown">` çocuğu da aynı yoldan okunuyor: tarayıcı
bilmediği tipi çalıştırmıyor ama metni `textContent`e katıyor, yani
yükselmeden önce ham Markdown ekranda görünmüyor.

**`value` özniteliği `<input>`ten bilerek ayrılıyor.** Platformda o
öznitelik yalnızca başlangıç değeri; kullanıcı yazdıktan sonra
değiştirmek hiçbir şey yapmıyor. Burada yapıyor, çünkü çerçevelerin özel
elemanlara bağlanma yolu çoğu zaman öznitelik ve bağlamanın sessizce
çalışmaması en kötü sonuç. Form sıfırlamasının ihtiyaç duyduğu ilk değer
ayrı tutuluyor: `defaultValue`.

**Shadow DOM neden varsayılan kapalı.** Gölge kök stilleri dışarıda
bırakıyor: `@kalem/themes` sayfanın genelinde tanımlı ve gölgeye
girmiyor. Varsayılan açık olsaydı editör her kurulumda stilsiz açılır,
herkes bir geçici çözüm arardı. Açık olması gereken durum da gerçek —
yabancı bir sayfaya gömülen widget'ta sayfanın `p { margin: 0 }` kuralı
belgeyi bozuyor. Bir test tam olarak bunu ölçüyor: sayfaya
`p { color: red }` ekleniyor, gölgedeki belge etkilenmiyor, ışık DOM'daki
belge kırmızıya dönüyor.

> **Gölge kipinde editör kullanıcının yazdığını görmüyordu.** `@kalem/editor`
> değişen bloğu `document.activeElement` üzerinden buluyordu; gölge kökün
> içinde bu, düzenlenen bloğu değil gölgeyi taşıyan ana makineyi veriyor.
> Sonuç sessiz ve tam: DOM'da harfler beliriyor, model hiç güncellenmiyor,
> `getValue()` eski metni dönüyor. `getRootNode()` belgede belgeyi,
> gölgede gölge kökü veriyor. Editör paketinde düzeltildi — F5-03'ün
> ortaya çıkardığı bir çekirdek hatası.

**Form entegrasyonu platformun kendi akışı.** `ElementInternals` ile
`setFormValue`, `formResetCallback`, `formDisabledCallback` ve
`formStateRestoreCallback`; `required` boş belgede `valueMissing`
kuruyor. Doğrulama mesajı tek kullanıcı metni ve eklentilerdeki kalıbı
izliyor: belge diline göre seçiliyor, `required-message` ile eziliyor.
`disabled` ayrı bir kip getirmiyor — salt okunur yeterli ve doğrusu da o,
içerik görünür kalıyor.

**Öznitelik listesinde `lang` yok** ve bu bir eksiklik değil: düzenlenebilir
alan elemanın çocuğu, `lang` DOM'da kalıtımla iniyor ve tarayıcının yazım
denetimi sözlüğünü zaten o seçiyor. Kopyalamak aynı gerçeğin iki kaynağı
olurdu.

**Örnekler.** `examples/svelte` (Vite + Svelte 5) ve `examples/angular`
(Angular 21, zonesiz) — ikisinde de bağlama deyimsel. Svelte özel
elemanlarda özellik varsa özelliği yazıyor (`value`, `readOnly`), Angular
`CUSTOM_ELEMENTS_SCHEMA` ile aynısını yapıyor. Sonsuz döngü hiçbirinde
elle kırılmıyor: elemanın `value` setter'ı gelen metin güncel metinle
aynıysa duruyor.

> **Angular kendi TypeScript'ini çekiyor.** Angular derleyicisi sürüme
> kilitli (`>=5.9 <6.0`) ve deponun geri kalanı TypeScript 7 kullanıyor.
> Örnek `catalogs.ng` üzerinden `~5.9` alıyor; başka hiçbir paket o
> girdiye dokunmuyor. Angular 22 de denendi ama geliştirme makinesindeki
> Node'dan yenisini istiyor (`^22.22.3`); 21 hem CI'da hem masada
> çalışıyor.

> **Yan düzeltme — `pnpm e2e` örnek testlerini de koşturuyordu.**
> Ana yapılandırmanın `testDir`i `./e2e` ve örnek testleri onun alt
> klasöründe; sunucuları ayrı yapılandırmada ayağa kalktığı için her
> koşuda bağlantı hatasıyla düşüyorlardı. `testIgnore: "examples/**"`
> eklendi.

Boyut: 1.98 kB (gzip; editör hariç). 8 birim + 48 tarayıcı testi
(3 motor) + 20 örnek testi.

### F5-04 · Örnek uygulamalar `[M]` ✅
- [x] `react-vite` · `nextjs` · `vue-vite` · `nuxt` · `svelte` · `angular` · `cdn-vanilla`
- [x] Her biri minimal ve kopyalanabilir; kendi README'si var
- [x] **Kabul:** CI her örneği ayrı bir adımda derliyor; `cdn-vanilla` tek `<script>` ile çalışıyor (47 tarayıcı testi)

Altısı F5-01…F5-03 ile birlikte yazılmıştı; bu madde yedinciyi ve
kapsamayı tamamlıyor.

**`cdn-vanilla`'da yalnızca tek script değil, hiç yazılmış JavaScript de
yok.** Kabul kriteri "tek `<script>`" diyor ve sayfanın kendi mantığı için
ikinci bir satır yazmak onu zaten bozardı — ama asıl nokta o değil: özel
eleman bildirimsel olduğu için yazacak bir şey kalmıyor. Metin elemanın
içinde duruyor, form alanının `name`'i var, Gönder'e basınca metin adres
çubuğunda görünüyor. Arada JavaScript yok, `ElementInternals` var. Bir
test sayfadaki script etiketlerini sayıyor ve listenin tam olarak tek
elemanlı olduğunu doğruluyor.

**IIFE derlemesi bir zorunluluktan doğdu.** ESM çıktısı `@kalem/core` ve
`@kalem/editor`i **dışarıda** bırakıyor; paketleyici kullanan uygulamada
doğrusu bu, yoksa aynı kod iki kez paketlenirdi. Ama CDN kullanıcısının
paketleyicisi yok ve çıplak `import "@kalem/editor"` satırı tarayıcıda
çözülmez. `kalem-editor.iife.js` hepsini içine alıyor: **26,7 kB** gzip,
tek istek, `type="module"` bile gerekmiyor. Bir test dosyada `@kalem/`
geçmediğini doğruluyor — dışarıda kalan tek bir import bu sözü sessizce
bozardı.

**Bu derlemede eleman kendiliğinden kaydoluyor.** Modül girişlerinde kayıt
açık bir çağrı, çünkü aynı sayfada iki sürümü bulunan bir uygulamayı
açılışta patlatmamak gerekiyor (F5-03). Script etiketi düşen kişinin
beklentisi ise tersine. Çelişki yok: çağrı zaten **tekrarlanabilir** — ad
kayıtlıysa sessizce geçiliyor — yani script sayfaya iki kez eklenirse hata
vermiyor.

> **`exports` haritasına konmadı.** `./global` girişi eklendiğinde tip
> yayın denetimi (`attw`) haklı olarak "tipsiz giriş" dedi: bu dosya bir
> modül değil, `import` edilecek bir yüzeyi ve dolayısıyla tip bildirimi
> yok. Uydurma bir `.d.ts` yazmak yerine giriş kaldırıldı; jsDelivr ve
> unpkg dosyayı `exports`a bakmadan, tarball'daki yolundan servis ediyor.

**Stil ayrı bir `<link>` ve öyle kalıyor.** Kriter "tek `<script>`" diyor,
"tek etiket" değil. CSS'i JavaScript'in içine gömmek üç şeyi bozardı:
tarayıcı stili paralel indiremezdi, katı bir CSP `<style>` enjeksiyonunu
engelleyebilirdi ve tema seçmek (`dark.css`, `minimal.css`) imkânsız
hâle gelirdi.

> **Örnekler artık bir kez derleniyor.** Derleme her sunucu komutunun
> içindeydi (`pnpm --filter … build && … preview`) ve amacı "derleme
> kırılırsa test hiç başlamasın"dı. CI'a ayrı bir derleme adımı eklenince
> yedi uygulama **iki kez** derlenecekti. Derleme `e2e:examples`
> script'inin başına taşındı: güvence aynı (`&&`), süre yarıya indi —
> test koşusu 1,2 dakikadan 27 saniyeye.

**CI'da kendi adımı var:** `pnpm build:examples`. Tarayıcı testlerinin
arasında kaybolan bir derleme hatası yerine, rapor doğrudan hangi örneğin
kırıldığını gösteriyor.

Yedi örneğin her birinin kendi README'si var: ne gösterdiği, hangi paketi
kullandığı ve o örneğe özgü karar. `examples/README.md` hepsini bir
tabloda topluyor.

Boyut: `kalem-editor.iife.js` 26,7 kB (gzip; çekirdek ve editör dâhil).
47 örnek testi.

### F5-05 · Dogfooding ⭐ `[M]` 🟡
- [x] Gerçek bir uygulama yazıldı: **`apps/notlar`** — yerel not defteri
- [x] Kütüphanenin neredeyse tamamı kullanımda: `@kalem/react`, `@kalem/ui` ve altı eklenti
- [x] Kullanım sırasında bulunan üç sorun düzeltildi (aşağıda); ikisi kütüphanenin kendisindeydi
- [x] 24 birim + 11 tarayıcı testi; CI'da derleniyor ve sınanıyor
- [ ] **Kabul:** en az 2 hafta günlük kullanım — bu adım bir insanın masasında

**Uygulama neden not defteri.** Dogfooding'in işe yaraması için yazılan
şeyin gerçekten kullanılması gerekiyor; "editörün yüzeyini sergileyen"
bir sayfa (demo) zaten vardı ve on iki görev boyunca hiçbir şey
bulmamıştı. Not defteri ise yazmak için açılıyor: çoklu belge, arama,
kalıcılık, tema — hepsi kütüphaneyi köşelerinden zorluyor.

Kullanımda olanlar: `<KalemEditor>` (kontrolsüz kip, `useKalem`),
`mountUi` (sabit çubuk + balon, slash menü, bağlantı balonu), kod
vurgulama, ara-değiştir, içindekiler, kelime sayacı, kaynak kipi,
otomatik kaydetme. Not listesinin arama kutusu bile kütüphaneden:
`@kalem/ui`nin `matches`/`score` yardımcıları slash menüsü için
yazılmıştı ama işi genel — Türkçe kasa ve aksan katlaması.

> **Bulgu 1 — `[data-theme]` atadan gelince çalışmıyordu.** Kütüphanenin
> koyu tema seçicisi yalnızca **bileşik** hâlde yazılıydı:
> `:where(.kalem-theme, …)[data-theme="dark"]`. Yani öznitelik,
> `kalem-theme` sınıfıyla **aynı** elemanda olmak zorundaydı. Olağan
> kullanım ise `<html data-theme="dark">` — sınıf editörün üstünde, ikisi
> ayrı eleman. Sonuç: uygulamanın kabuğu koyuya dönüyor, belge açık
> kalıyordu.
>
> Var olan tarayıcı testi durumu kapsamıyordu çünkü özniteliği editörün
> **kendisine** koyuyordu. Dört tema dosyasında düzeltildi
> (`tokens.css`, `plugin-code`, `plugin-find`, `plugin-autosave`) ve iki
> test eklendi: biri atadaki `data-theme="dark"`ı, öteki atadaki
> `light`ın sistem tercihini ezdiğini sabitliyor.

> **Bulgu 2 — `dark.css`i koşulsuz yüklemek tema düğmesini öldürüyor.**
> Uygulama onu "koyu tema dosyası" sanıp yükledi; editör `data-theme`
> ne olursa olsun koyu kaldı. Dosya aslında "sayfanın tamamı koyu,
> kullanıcıya seçim sunulmuyor" senaryosu için ve `tokens.css` zaten üç
> durumu da karşılıyor. Kütüphane hatası değil ama **adın yanılttığı**
> bir durum; uygulamanın `main.tsx`i artık sebebini yazıyor.

> **Bulgu 3 — yeni not açınca odak düğmede kalıyordu.** Uygulama hatası
> ama kütüphanenin şeklinden doğuyor: yeni not `key`i değiştiriyor, yani
> düğmenin tıklama işleyicisi çalışırken editör **henüz yok** ve
> `focus()` çağırmak boşa gidiyor. Odak, kurulumu bildiren geri çağırmada
> veriliyor.

**Sözlük `:root`a inmiyor ve bu doğru.** Uygulamanın kabuğu ilk denemede
renksiz çıktı: `--kalem-*` değişkenleri yalnızca `.kalem-theme` ve
kardeşlerinin altında tanımlı, `:root`ta değil. Karar belgeli ve haklı —
bir Markdown kütüphanesi, gömüldüğü uygulamanın düğmelerini boyamamalı.
Uygulama kendi paletini yazıyor ve aynı `<html data-theme>`e bakıyor;
tek düğme iki tarafı birden çeviriyor.

**Editör not başına yeniden kuruluyor** (`key={not.id}`). `setValue`
geçmişi zaten sıfırlıyor, yani kazandıracağı bir şey yok; yeniden
kurmak ayrıca otomatik kaydetmenin kurtarma anahtarını nota bağlıyor.
Bir test not değiştirdikten sonra tek editör ve tek araç çubuğu kaldığını
sabitliyor.

**İki ayrı kalıcılık yolu, bilerek:** `onChange` React durumunu
güncelliyor (liste başlığı yazarken değişiyor), otomatik kaydetme
eklentisi 800 ms sessizlikten sonra `localStorage`a yazıyor. Kota
dolduğunda kaydetme kancası **hata fırlatıyor** ve gösterge
"Kaydedilemedi" diyor — bir not uygulamasında sessizce yutmak
yapılabilecek en kötü şey.

> **Yan düzeltme — Biome `./stil.css`i `./stil.js`e çevirdi.** Aynı kural
> örneklerde F5-01'de kapatılmıştı; `apps/notlar` kapsam dışındaydı ve
> uygulama stil dosyasını sessizce kaybetmek üzereydi (Vite tesadüfen
> çözdü). Kural artık bu uygulamada da kapalı. Ayrıca uygulamanın
> derlemesi `tsc --noEmit` çalıştırıyor: Vite yalnızca dönüştürüyor ve
> uygulama depo genelindeki `pnpm typecheck`e dâhil değil.

Boyut: 383 kB ham / 119 kB gzip (React, editör, arayüz ve altı eklenti
dâhil; sekiz dil paketi ayrı parçalarda). 24 birim + 11 tarayıcı testi.

> **FAZ 5 ÇIKIŞ KRİTERİ:** Bir Vue projesine kurulduğunda `node_modules`'da React yok. Saflık kapısı (F0-07) bunu otomatik doğruluyor.

---

# FAZ 6 — Cila, Dokümantasyon, Yayın
**Amaç:** Tek atışlık duyuru. **Süre: ~4–6 hafta**

> Sessiz geliştirme seçildiği için bu faz **pazarlık konusu değil**. Duyuru günü ilk izlenim tek seferliktir; eksik doküman = kaybedilmiş fırsat.

## 6A · Dokümantasyon Sitesi (Astro Starlight)

### F6-01 · Site kurulumu `[M]` ✅
- [x] Astro 7 + Starlight 0.42, Pagefind araması (27 sayfa, iki dil indeksli)
- [x] Marka teması — renkler `@kalem/themes/tokens.css` paletinin aynısı
- [x] TR + EN i18n iskeleti; kenar çubuğu iki dilde
- [x] Site CI'da derleniyor (`dokuman` işi)
- [x] **Kabul:** `pnpm docs:dev` ve `pnpm docs:build` çalışıyor

**Site zaten vardı ama iki ana sürüm geride kalmıştı** (Astro 5 /
Starlight 0.30; güncel olanlar 7 ve 0.42). Yükseltme iki kırıcı değişiklik
getirdi: `social` artık nesne değil **dizi**, `tagline` kök seçenek
olmaktan çıkıp giriş sayfasının hero'suna taşınmış. İkisi de düzeltildi.

**Renkler uydurulmuyor.** `kalem.css`, `@kalem/themes/tokens.css`teki
paletin aynısını kullanıyor: açık temada `#22201d` metin / `#fbfaf8`
zemin / `#0f4e4a` vurgu, koyu temada `#e8e6e1` / `#16151a` / `#6fd3c6`.
Starlight'ın varsayılan gri merdiveni soğuk (maviye kaçık) olduğu için o
da baştan yazıldı — Kalem'in nötrleri hafifçe sıcak, çünkü saf gri
"seçilmemiş" duruyor. Okuyucunun ekran görüntüsündeki editörle sayfanın
kendisi arasında kopukluk görmemesi gerekiyor.

**Belge gövdesi serif.** Başlıklar ve arayüz IBM Plex Sans, kod IBM Plex
Mono, akıcı metin Source Serif 4. Kalem bir yazma aracı; dokümanının da
okunmak için yazılmış bir metin gibi görünmesi mesajın parçası.

**İki dil iskeleti, yarım çeviriye dayanıklı.** Starlight çevrilmemiş bir
sayfayı varsayılan dile **düşürüyor** ve okuyucuya "bu içerik henüz sizin
dilinizde yok" diyor; yani `/en/` bölümü boşken bile site kırılmıyor.
Kenar çubuğu etiketleri iki dilde de yazılı — dil değiştiren okuyucu
Türkçe bir menüyle karşılaşmıyor. İçerik çevirisi F6-10'un işi.

> **Site CI'da hiç derlenmiyordu.** Kütüphane on beş görev boyunca
> değişirken doküman sitesi sessizce çürüyebilirdi; yükseltmenin kırdığı
> yapılandırma da kimseye görünmezdi. Artık kendi işi var (`dokuman`).
> Ayrı iş olmasının sebebi sürüm: Astro 7 **Node 22.12+** istiyor, deponun
> geri kalanı 20'de de koşuyor.

**İçeriğin kendisi hâlâ planlanan API'yi anlatıyor** (`toolbar()`,
`slashMenu()` gibi hiç var olmayan çağrılar dâhil). Yenilenmesi F6-02'nin
işi ve bu madde onu kapsamıyor.

### F6-02 · İçerik yazımı `[L]` ✅
- [x] Başlangıç, yedi rehber, dokuz framework sayfası, beş tarif, mimari — 24 sayfa
- [x] Her örnek depodaki gerçek API'den yazıldı ve makineyle doğrulanıyor
- [x] **Kabul:** hiçbir sayfada "TODO" yok; iç bağlantıların hepsi sağlam

> **Site yanlış API'yi anlatıyordu ve kimse fark etmemişti.** Sayfalar
> Faz 0'da, kütüphane yazılmadan önce yazılmıştı; aradan on beş görev
> geçti ve içerik hiç güncellenmedi. "Beş satırda ilk editör" örneği
> `toolbar()`, `slashMenu()` ve `dragHandle()` çağırıyordu — **üçü de hiç
> var olmadı**, gerçek API `mountUi(editor)`. Editör sayfası `autofocus`
> ve `placeholder` diye iki seçenek listeliyordu; `EditorOptions`ta ikisi
> de yok. Bir okuyucu o satırı kopyalasa `is not a function` alır ve
> kütüphaneyi bir daha denemezdi.

**Bunun bir daha olmaması makineye bağlandı.** `pnpm guard:docs`
(dördüncü koruyucu kapı) her `import { … } from "@kalem/…"` satırındaki
her adı, o paketin **kaynak dosyasındaki gerçek dışa aktarmalarıyla**
karşılaştırıyor. Tip denetimi değil — örnekler kısaltılmış ve bağlamsız
olduğu için derlenmeleri beklenmiyor — ama yazılan adların var olması
beklenebilir. Kapı, yazıldıktan sonra eski hatayla sınandı: `toolbar` ve
`slashMenu` importu geri konunca ikisini de yakaladı.

Şu an 24 sayfada 67 import adı doğrulanıyor. Kapı `pnpm verify`nin ve
CI'ın doküman işinin içinde.

**Her sayı ölçümden geldi.** Boyutlar `size-limit` çıktısından
kopyalandı, tahmin edilmedi: çekirdek 11,5 kB, görüntüleyici 2,7 kB,
editör 26,1 kB, Word deneyiminin tamamı 34,6 kB, tek `<script>` derlemesi
26,7 kB. Giriş sayfasındaki karşılaştırma tablosunda Kalem'in sütunu
ölçülen değer; rakiplerinkinin yaklaşık olduğu ayrıca yazıyor.

**Yeni sayfalar.** Erişilebilirlik (rehberde eksikti), Web Components
(`<kalem-editor>`in tam yüzeyi), Svelte, Angular, Next.js, Nuxt ve beş
tariflik bir bölüm: otomatik kaydetme, görsel yükleme, salt okunur mod,
kontrollü bileşen, sunucuda Markdown.

**Giriş sayfası dört sekmeli.** Vanilla, React, Vue ve düz HTML aynı
editörü kuruyor; sonuncusunda derleme adımı, paketleyici ve yazılmış
JavaScript yok. Ürünün ana iddiası, iddianın yazıldığı sayfada görünüyor.

**Bilinen kısıtlar gizlenmiyor.** Tablo hücrelerinin düzenlenebilir
görünüp çıktıya girmemesi hem Markdown uyumu hem erişilebilirlik
sayfasında yazıyor; ekran okuyucularla elle testin tamamlanmadığı da.
Duyuru günü bunları saklamak, ilk issue'da ortaya çıkmaktan kötü.

**İngilizce hâlâ yok** ve iskelet bunu taşıyabiliyor: Starlight
çevrilmemiş sayfayı Türkçe'ye düşürüp okuyucuya "bu içerik henüz sizin
dilinizde yok" diyor. Çeviri F6-10.

> **Yan düzeltme — YAML frontmatter.** Bir açıklama satırındaki iki
> nokta (`Çerçeve gerektirmeyen yol: …`) derlemeyi kırdı; YAML onu
> eşleme ayracı sanıyor. Başlığı tırnakladım, açıklamada uzun tire
> kullandım.

24 sayfa, 49 üretilen rota (iki dil), Pagefind iki dili de indeksliyor.
Bir bağlantı denetimi tüm iç bağlantıların hedefinin gerçekten
üretildiğini doğruladı.

### F6-03 · Canlı gömülü örnekler ⭐ `[M]` ✅
- [x] `/canli/` sayfasında vanilla, React ve Vue örnekleri **aynı anda** çalışıyor
- [x] Üçü de aynı belgeyle açılıyor; fark yalnızca montaj kodunda
- [x] React ve Vue adaları `client:load` — Vue örneği sunucuda çiziliyor
- [x] **Kabul:** ürünün ana iddiası sitenin kendisiyle kanıtlanıyor (9 tarayıcı testi)

**Site artık kütüphaneyi gerçekten gömüyor.** Astro'ya hem React hem Vue
ada motoru kuruldu ve `/canli/` sayfasında üç editör aynı anda yaşıyor:
biri `new Editor(el)` ile, biri `<KalemEditor />` ile, biri
`<KalemEditor v-model />` ile. Üçü de aynı `@kalem/editor` motorunu
kullanıyor ve aynı başlangıç belgesini tek bir modülden alıyor — fark
yalnızca montaj kodunda olsun diye.

Vue tabanlı VitePress ya da React tabanlı Docusaurus ile bu sayfa
yazılamazdı. Dokümantasyon aracının seçimi de mesajın parçası ve bu
madde onu görünür kılıyor.

**Vue örneği sunucuda çiziliyor.** Ada `client:load` ile kurulu, yani
bileşen önce sunucuda render ediliyor; bir test ham HTTP yanıtında
belgenin `<h1>`ini ve liste öğesini arıyor. Nuxt sayfasındaki
"`<ClientOnly>` gerekmiyor" iddiası artık sitenin **kendi HTML'inde**
duruyor.

> **Doküman sitesi Kalem'in CSS'ini hiç yüklemiyormuş.** Canlı örnekler
> ilk denemede stilsiz çıktı — ama tuhaf bir şekilde belge içeriği düzgün
> görünüyordu: Starlight'ın kendi element kuralları `h1`, `ul`, `blockquote`
> için devreye giriyor ve editörü **tesadüfen** biçimlendiriyordu. Araç
> çubuğu ise düz bir `<div>` yığınıydı; `display: flex` uygulanmadığı için
> beş düğme grubu alt alta diziliyordu. `@kalem/themes` dosyaları
> `customCss`e eklendi.

> **Araç çubuğu grid'e üçüncü hücre olarak giriyordu.** `mountUi` sabit
> çubuğu editörün **önceki kardeşi** olarak ekliyor (`element.before`),
> yani kutunun çocukları rozet, çubuk, editör ve çıktı oluyor. İki sütunlu
> grid bunları sırayla dağıtınca çubuk, editörün yanındaki dar sütuna
> dikey olarak sıkıştı. `grid-template-areas` yerleşimi DOM sırasından
> bağımsız kıldı ve aynı CSS üç çerçevede de çalışıyor — çünkü üçünde de
> bu dört eleman kutunun doğrudan çocuğu.

**İddia testle sabit.** Dokuz tarayıcı testi: üç editörün de kurulduğu,
rozetlerin üç çerçeveyi adlandırdığı, her sekmede gerçekten
düzenlenebildiği, yazım tercihinin (`*` listesi, `1)` ayracı) üçünde de
korunduğu, araç çubuğundan `Ctrl+B`nin `**kalın**` ürettiği, Vue adasının
sunucuda çizildiği ve konsola tek bir hata bile düşmediği. Bu testler
olmasa bir ada kurulmayı bıraktığında sayfa yine derlenir, yalnızca
kutulardan biri boş kalırdı.

> **Yan düzeltme — Biome üçüncü kez CSS importunu bozdu.**
> `useImportExtensions` kuralı `import "./canli.css"` satırını
> `./canli.js`e çevirdi ve doküman derlemesi kırıldı. Aynı tuzak
> F5-01'de örneklerde, F5-05'te `apps/notlar`da yaşanmıştı; kural artık
> `apps/**` altında da kapalı. Üç kez tekrarlayan bir şey tesadüf değil:
> kuralın CSS'e hiç dokunmaması gerekiyor.

Site 51 rota üretiyor (iki dil). CI'ın doküman işi artık önce `pnpm build`
çalıştırıyor — site paketlerin derlenmiş çıktısına ihtiyaç duyuyor.

### F6-04 · API referansı `[M]` ✅
- [x] TypeDoc → Starlight; on altı genel giriş, her derlemede yeniden üretiliyor
- [x] Çıktı depoya girmiyor; "Defined in" satırları GitHub'da kaynağa bağlanıyor
- [x] **Kabul:** her genel API tipi dokümante — **395 ad** doküman kapısıyla ölçülüyor

**Elle yazılan referans sapıyor; üretilen sapamaz.** F6-02 sitenin on beş
görev boyunca var olmayan bir API'yi anlattığını gösterdi. Referans artık
paketlerin **kaynağından** üretiliyor: her tip, her fonksiyon ve her
açıklama JSDoc yorumlarından geliyor.

Kaynak okunuyor, `.d.ts` değil — derlenmiş bildirimlerde yorumların bir
kısmı kayboluyor ve referansın değerli yanı tam olarak o yorumlar.
TypeDoc'un okuduğu program ayrı bir `tsconfig.typedoc.json`da ve
`customConditions: ["kalem-source"]` taşıyor, yani paketler arası
`@kalem/*` import'ları da kaynağa çözülüyor.

**Kabul kriteri ölçülebilir hâle getirildi.** Doküman kapısına ikinci bir
denetim eklendi: her genel girişin dışa aktardığı her ad, üretilen
markdown'da geçiyor mu. Şu an 395 ad doğrulanıyor. Kapı yazıldıktan sonra
sınandı — üretilen bir modül dosyası silinince on iki eksiği tek tek
saydı.

Bu denetimin yakaladığı asıl şey sapma değil, **düşme**: yeni bir paket
eklenip `astro.config.mjs`teki giriş listesine yazılmazsa referans
sessizce eksik kalırdı ve kimse fark etmezdi.

> **396 sayfa yerine 17.** Varsayılan çıktı her dışa aktarma için ayrı bir
> dosya üretiyor: 396 sayfa, iki dille 792 rota ve yirmi saniyelik bir
> Pagefind indeksi. Okuyucunun sorusu ise "`@kalem/editor` neler veriyor" —
> ve onun cevabı tek sayfada, sayfa içi içindekilerle daha iyi duruyor.
> `outputFileStrategy: "modules"` ile giriş başına tek sayfa; site 51
> rotadan 87'ye çıktı, 843'e değil.

> **`@kalem/wc` referansı 140 kB'tı — çekirdeğinkinden büyük.**
> `KalemEditorElement` `HTMLElement`i genişletiyor ve TypeDoc onun bütün
> miras alınan DOM üyelerini sayfaya döküyordu. Okuyucunun aradığı şey
> Kalem'in **eklediği** yüzey; `HTMLElement`i MDN anlatıyor.
> `excludeExternals` ile kesildi.

**Modül adları paket adlarıyla aynı.** Her genel giriş dosyasının baş
yorumuna `@module @kalem/…` eklendi; yoksa TypeDoc modülleri dosya
yoluna göre adlandırıyor ve kenar çubuğunda "src" yazıyordu. Artık
başlık, kenar çubuğu ve adres `npm i` ile yazdığınız adla aynı.

> **Tek pürüz: `@kalem/core/html` sayfası `html-1` adresinde.** TypeDoc'un
> dosya kaydı büyük/küçük harfe duyarsız ve `@kalem/core` zaten `Html`
> adlı bir AST tipi dışa aktarıyor; çakışan ada son ek veriliyor. Başlık,
> kenar çubuğu ve modül listesi doğru; yalnızca adres tuhaf. Elle
> `/html/` yazan okuyucu için yönlendirme eklendi.

**Bölüm başlıkları İngilizce kaldı.** "Interfaces", "Properties",
"Defined in" gibi yapısal etiketler TypeDoc ve eklentisinden geliyor;
bir kısmını çevirip bir kısmını bırakmak yarım bir sonuç verirdi.
Açıklamaların tamamı Türkçe. Referansın giriş sayfası bunu söylüyor ve
çeviri F6-10'a bırakıldı.

**CI'da sıra önemli:** `pnpm build` → `pnpm docs:build` (referans burada
üretiliyor) → `pnpm guard:docs`. Kapı derlemeden sonra koşuyor çünkü
ikinci denetimi üretilen çıktıya bakıyor; referans yoksa o denetim
atlanıyor ve rapor bunu açıkça yazıyor.

Çıktı `.gitignore`da: her derlemede yeniden üretilen bir şeyi depoda
tutmak, kaynakla arasına fark girmesine davetiye.

### F6-05 · Landing sayfası `[M]` ✅
- [x] Canlı editör sayfanın **ilk ekranında** — okumadan önce yazılabiliyor
- [x] Kurulum tek satırda; boyut rozetleri ölçülen değerler
- [x] Rakip karşılaştırma tablosu
- [x] **Kabul:** ilk 5 saniyede "bu ne" anlaşılıyor (6 tarayıcı testi)
- [x] 30 saniyelik GIF — araç eksiği yüzünden F6-11'e bırakıldı, orada yapıldı

**GIF yerine çalışan editör.** Maddenin istediği şey bir tanıtım; ama bir
GIF "bu ne" sorusunu *anlatıyor*, çalışan bir editör **gösteriyor**.
Ziyaretçi sayfayı okumadan önce yazmaya başlayabiliyor ve yazdığı her şey
sağ tarafta Markdown olarak beliriyor — ürünün ayırt edici iddiası
("çıktı Markdown, JSON değil") böylece iddia olmaktan çıkıyor.

Balon araç çubuğu, slash menüsü ve blok tutamağı da orada; "Word gibi mi"
sorusunun cevabı üç saniyede alınıyor.

> **Editör katlamanın altında kalıyordu.** Starlight'ın splash hero'su bir
> hero **resmi** için yer ayırıyor; bizde resim yok ama boşluk duruyordu.
> Ölçüldüğünde editör 1280×800'lük bir ekranda **555 piksel** aşağıdan
> başlıyordu — yani ziyaretçi ürünü hiç görmeden karar veriyordu. Hero'nun
> dikey boşluğu ve başlık ölçeği kısıldı; şimdi 379 piksel, yani editörün
> 414 pikseli ilk ekranda. Bir test bunu 450 piksel sınırıyla sabitliyor,
> çünkü "ilk 5 saniye" kriteri tam olarak buna bağlı.

**Rozetler tahmin değil.** `editör + arayüz 34,6 kB`, `çekirdek 11,5 kB`,
`görüntüleyici 2,7 kB`, `bağımlılık 0` — hepsi `size-limit` çıktısından.
Bir test ilk rozetin gerçekten "34,6 kB" yazdığını doğruluyor; sayı
değiştiğinde sayfanın sessizce eskimemesi için.

**Kurulum tek satır:** `npm i @kalem/editor @kalem/ui @kalem/themes`.

**Üst uyarı aşağı taşındı.** "Henüz npm'de değil" notu sayfanın en
üstündeydi ve ilk okunan şey oydu — bir ürün sayfasının ilk cümlesi
"bunu kullanamazsınız" olmamalı. Not hâlâ duruyor ve dürüst, ama
karşılaştırma tablosundan sonra.

> **30 saniyelik GIF yapılamadı.** Makinede ffmpeg, ImageMagick ve gifski
> yok; Playwright'ın `.webm` kaydı da imleci çizmiyor, yani sürükle-bırak
> gibi işaretçiyle yapılan şeyler anlaşılmaz görünüyor. GIF'in asıl yeri
> zaten README ve sosyal önizleme (F6-11) — JavaScript'in çalışmadığı
> yerler. Landing sayfasında canlı editör ondan güçlü olduğu için bu madde
> onsuz kapandı; F6-11 açık iş olarak taşıyor.

> **Yan düzeltme — `notlar` testlerinde yarış.** "Yeni not" düğmesine
> basıp hemen yazmaya başlayan üç test, tam paket tek işçiyle koşarken
> harfleri boşluğa gönderiyordu: odak, editörün kurulumunu bildiren geri
> çağırmada veriliyor ve o çağrı bir mikrogörev gecikiyor. Testler artık
> odağın düzenlenebilir bir bloğa gelmesini bekliyor.

Site 87 rota üretiyor; 73 örnek/uygulama testi yeşil.

## 6B · Demo / Playground

### F6-06 · Playground `[M]` ✅
- [x] Vite vanilla TS; sol editör / sağ canlı Markdown çıktısı
- [x] Özellik anahtarları, tema seçici, örnek belge yükleyici
- [x] "Word'den yapıştır" senaryosu — tek düğme, gerçek Word HTML'i
- [x] **Kabul:** kütüphanenin gücü 30 saniyede anlaşılıyor (11 tarayıcı testi)

> **`apps/demo` değil, `apps/playground`.** Madde bu uygulamayı
> `apps/demo` diye adlandırıyor ama `apps/demo` bu arada başka bir işe
> sahip oldu: **on yedi tarayıcı test dosyasının zemini**. `editor.html`,
> `viewer.html` ve `wc.html` sayfalarındaki eleman kimlikleri 1100 testin
> bağlı olduğu bir sözleşme ve üstlerindeki hata ayıklama göstergeleri
> (blok sayısı, seçim durumu, geçmiş, etkin biçimler) geliştirici için.
>
> Orayı ürün demosuna çevirmek ikisini de bozardı: vitrinin içinde hata
> ayıklama tabloları, testlerin altında kayan bir zemin. Ayrı uygulama
> hem daha ucuz hem daha dürüst — ve F6-07'nin (paylaşılabilir
> playground) adıyla da örtüşüyor.

**Sayfa bir özellik listesi değil, beş iddianın kanıtı:**

1. **Word deneyimi** — `mountUi(editor)` tek satır; balon çubuk, sabit
   çubuk, slash menüsü, blok tutamağı, bağlantı balonu.
2. **Çıktı Markdown** — sağ panel her tuşta güncelleniyor, JSON yok.
3. **Kayıpsız gidiş-dönüş** — rozet `serialize(parse(v)) === v` ölçümünü
   gösteriyor. Bir kütüphane bunu söyleyebilir; burada okuyucu kendi
   yazdığı metinde görüyor ve bozulunca rozet kırmızıya dönüyor.
4. **Word'den yapıştırma** — tek düğme. `mso-list` ile sahte liste yapan,
   iç içe boş `<span>` döşeyen Word HTML'i başlığa, listeye, bağlantıya
   ve kalın metne dönüşüyor.
5. **Büyük belge** — bin bloklu örnek. "Akıcı mı" sorusu okunarak değil
   yazarak cevaplanıyor.

Ayrıca tema seçici (açık / koyu / yalın), araç çubuğu kipi, giriş
kuralları anahtarı, salt okunur, içindekiler, ham Markdown kaynağı,
kelime sayacı ve otomatik kaydetme göstergesi.

**Word yapıştırması panoya dokunmuyor.** Tarayıcı, kullanıcının izni
olmadan panoya yazdırmıyor — ve izin istese bile kullanıcının kendi
panosunu ezmek kaba olurdu. Düğme, Word'ün panoya koyduğu veriyi
doğrudan bir `paste` olayı olarak editöre gönderiyor: editörün gördüğü
şey gerçek bir yapıştırmadakinin aynısı.

> **Word örneği ilk denemede yanlış biçimdeydi.** Başlıkları
> `mso-outline-level` ile yazmıştım ve editör onları kalın paragraf
> yapıyordu — **doğru davranış, yanlış örnek**: o biçimi Word, elle anahat
> seviyesi verilmiş gövde metni için üretiyor. Başlık **stili** uygulanmış
> paragrafları ise gerçek `<h1>`/`<h2>` olarak yazıyor. Örnek düzeltildi;
> artık `# Çeyrek Raporu` ve `## Sonraki adımlar` çıkıyor.

**Görsel yükleme sunucusuz çalışıyor.** Yüklenen dosya `FileReader` ile
`data:` adresine çevriliyor — uçtan uca gerçek ve çevrimdışı. Beyaz liste
`png`, `jpeg`, `gif`, `webp`, `avif`e izin veriyor; SVG kasten dışarıda.

**Tema seçicisi iki farklı mekanizmayı gösteriyor:** açık/koyu
`<html data-theme>` ile (fazladan dosya gerekmiyor), yalın ise
`minimal.css` yüklenerek. Ayrım kütüphanenin kendi kararından geliyor ve
bir test ikisini de sabitliyor.

Boyut: 165 kB ham / 51 kB gzip (editör, arayüz ve altı eklenti dâhil;
sekiz dil paketi ayrı parçalarda). 11 tarayıcı testi.

### F6-07 · Paylaşılabilir playground `[M]` ✅
- [x] Durum URL'de kodlanıyor — karma parçasında, `deflate-raw` + base64url
- [x] "Bağlantıyı kopyala" düğmesi
- [x] **Kabul:** paylaşılan bağlantı aynı içeriği açıyor (tarayıcı testi)

> **`lz-string` yazılmadı.** Madde "LZ sıkıştırma" diyor ve akla ilk gelen
> paket `lz-string`. Ama tarayıcı bunu zaten yapıyor:
> `CompressionStream("deflate-raw")` — LZ77 + Huffman, daha iyi oran ve
> uygulamaya **tek bayt eklemiyor**. Desteklemeyen tarayıcıda sıkıştırma
> atlanıyor ve bağlantı yine çalışıyor, sadece uzun oluyor; ön ek
> (`1` / `0`) hangi biçim olduğunu söylüyor, yani biçim değişirse eski
> bağlantılar açılmaya devam ediyor.

**Belge karma parçasında, sorgu dizesinde değil.** Karma sunucuya **hiç
gönderilmiyor**: paylaşılan bir belgenin metni, bağlantıyı barındıran
sunucunun günlüklerine düşmüyor ve bir ara vekil onu göremiyor. Bir yazma
aracında bu, gizlilik açısından en ucuz doğru karar — ve tarayıcı testi
düğmeye basıldıktan sonra giden isteklerin hiçbirinde karma olmadığını
sabitliyor. Yan fayda: sunucuların sorgu dizesine uyguladığı uzunluk
sınırları (çoğu 8 kB) karmayı bağlamıyor.

**Ölçüm iki ucu da gösteriyor** ve küçük belgede beklediğim gibi çıkmadı:

| Belge | Ham | Bağlantıda |
| --- | --- | --- |
| Tanıtım (890 karakter) | 890 | 857 (%96) |
| 200 blok | 20.122 | 1.096 (%5) |
| 1.000 blok | 100.825 | 4.600 (%5) |

Küçük belgede kazanç neredeyse yok: base64 taşımayı %33 şişiriyor ve
deflate'in kazandırdığını geri alıyor. Sıkıştırma **kısa belge için değil,
uzun belge için** var — onsuz bin bloklu belge 134 bin karakterlik bir
bağlantı üretirdi ve hiçbir sohbet uygulaması onu taşımazdı. Birim testi
oranı değil, kazancın var olduğunu sabitliyor (`< belge.length / 4`).

**Yalnızca belge paylaşılıyor.** Tema, araç çubuğu kipi ve özellik
anahtarları **okuyucunun tercihi**, yazarın içeriği değil; bir bağlantının
karşı tarafın temasını değiştirmesi beklenmedik olurdu. Kabul kriteri de
"aynı **içeriği** açıyor" diyor.

> **Geri tuşu kullanıcıyı belgesinden çıkarıyordu.** İlk sürüm adres
> çubuğunu `location.hash = …` ile güncelliyordu ve bu geçmişe bir kayıt
> ekliyor: paylaşan kişi geri tuşuna basınca karma kalkıyor, uygulama
> baştan kuruluyor ve yazdığı belge yerine örnek belge açılıyordu.
> `history.replaceState` bunu önlüyor; bir test de geri tuşunun karmayı
> geri getirmediğini sabitliyor.

Bozuk bağlantı **atmıyor**: kullanıcının eline kırpılmış bir bağlantı
geçmiş olabilir ve uygulamanın hiç açılmaması bundan kötü — çözücü `null`
dönüyor, playground örnek belgeyle açılıyor. Pano yazması başarısız olsa da
(güvensiz köken, izin reddi) bağlantı adres çubuğunda duruyor. 12.000
karakteri aşan adreste bağlantı yine üretiliyor, kullanıcı yalnızca
uyarılıyor: tarayıcılar çok daha uzununu taşıyor ama araya giren araçlar
(sohbet, e-posta, kısaltıcılar) taşımıyor.

12 birim + 4 tarayıcı testi.

## 6C · Yayın Hazırlığı

### F6-08 · Performans geçişi `[M]` ✅
- [x] Büyük doküman testi (5.000+ blok) — 10.000'e kadar ölçüldü
- [x] Sanal kaydırma gerekli mi — **hayır**, gerekçesi aşağıda
- [x] Giriş gecikmesi < 16 ms
- [x] Bellek sızıntısı kontrolü (`destroy()` sonrası) — **bir sızıntı bulundu**
- [x] **Kabul:** 1.000 bloklu dokümanda yazmak akıcı (p50 1,9 ms)

**Ölçüm tezgâhı:** `apps/demo/olcum.html` + `scripts/olcum.mjs`
(`pnpm olcum`). Tezgâh ayrı bir sayfa çünkü `editor.html` her `onChange`de
dokuz DOM göstergesi güncelliyor — orada ölçülen şey kütüphanenin değil,
demo sayfasının hızı olurdu.

#### Sanal kaydırma gerekmiyor — ama maliyet gerçekten doğrusaldı

İlk ölçüm maddenin şüphesini doğruladı: blok sayısı 100× büyürken tuş
başına maliyet **37× büyüyordu**.

| Blok | Eleman | Kuruluş | Tuş p50 | Tuş p95 | Uzun görev |
| --- | --- | --- | --- | --- | --- |
| 100 | 258 | 14,8 ms | 1,5 ms | 2,1 ms | 0 |
| 1.000 | 2.573 | 59,9 ms | 4,9 ms | 8,2 ms | 0 |
| 5.000 | 12.858 | 199,7 ms | **27,5 ms** | 41,8 ms | 1 |
| 10.000 | 25.716 | 350,7 ms | **55,5 ms** | 69,4 ms | **60** |

Ama darboğaz **DOM değildi**. Tuş başına yapılan işi tek tek ölçünce
tamamı tek satırda çıktı: `#emit()` içindeki `serialize(this.#doc)`. Her
tuş vuruşunda belgenin tamamı yeniden Markdown'a yazılıyordu — saf Node
ölçümünde 1.000 blokta 4,6 ms, 5.000'de 18,9 ms, 10.000'de 39,7 ms.

Sanal kaydırma ekrandaki DOM düğümünü azaltır. Bu maliyeti **hiç
azaltmazdı** — ve karşılığında seçimin sanallaştırılmış sınırlar arasında
taşınması, bul-değiştir, içindekiler ve yazdırma gibi her şeyi
karmaşıklaştırırdı. Maddenin ima ettiği çözüm, ölçülen soruna çözüm
değildi.

#### Yapılan: blok başına serileştirme önbelleği

Bir tuş vuruşu **tek bir bloğu** değiştiriyor ve model kalıcı: `replaceAt`
yalnızca dokunulan bloğu yeni nesneyle değiştiriyor, geri kalan bloklar
aynı nesne olarak kalıyor. Nesne kimliği bu yüzden kusursuz bir anahtar.
`serialize` artık `WeakMap` üstünde blok başına çıktı saklayabiliyor
(`createSerializeCache()`), editör de kendi belgesi için bunu açıyor.

| Blok | Tuş p50 önce | Tuş p50 sonra | p95 sonra | Uzun görev |
| --- | --- | --- | --- | --- |
| 1.000 | 4,9 ms | **1,9 ms** | 3,0 ms | 0 |
| 2.500 | 8,8 ms | **3,7 ms** | 5,9 ms | 0 |
| 5.000 | 27,5 ms | **7,3 ms** | 9,0 ms | 0 → 0 |
| 10.000 | 55,5 ms | **13,0 ms** | 15,7 ms | 60 → 1 |

10.000 bloklu, 440 bin karakterlik bir belgede bile tuş başına maliyet
artık bir karenin (16,7 ms) altında.

> **Önbellek `@kalem/core`'da varsayılan olarak kapalı.** Düğümlerin
> yerinde değiştirilmediği varsayımına dayanıyor; Kalem'in kendi kodu bu
> sözü tutuyor ama AST herkese açık — `onChange` ikinci argümanda belgeyi
> veriyor ve bir kullanıcı onu yerinde değiştirirse önbellek **sessizce**
> bayat çıktı verir. Açma kararını, belgesinin değişmezliğinden emin olan
> çağıran veriyor. Editör kendi belgesini kendi ürettiği için açıyor.

Kalan doğrusal maliyet 440 kB'lık çıktı dizesini kurmanın kendisi ve o
`onChange(value: string)` sözleşmesinin doğal sonucu — kaldırılabilmesi
için API'nin değişmesi gerekirdi.

#### `destroy()` bir dinleyici bırakıyordu

Sızıntı testini yazmadan önce bulundu: kurucu `paste` dinleyicisini
ekliyor, `destroy()` onu kaldırmıyordu. Sekiz dinleyicinin yedisi
listedeydi, biri unutulmuştu. Playground ve `apps/notlar` editörü **aynı
elemanın üstünde** yeniden kuruyor (tema ya da araç çubuğu kipi
değişince), yani her turda bir dinleyici daha birikiyordu.

> **İlk yazdığım test yanlış şeyi ölçtü.** `addEventListener` ve
> `removeEventListener` çağrılarını sayıp simetriye bakıyordu ve dokuz
> "sızıntı" buldu — dokuzu da yanlış alarmdı: `mountUi` düğmelerine
> dinleyici takıyor ve sökerken düğmeleri DOM'dan çıkarıyor. Ulaşılamayan
> bir elemanın dinleyicisi elemanla birlikte toplanıyor; o sızıntı değil,
> geçerli bir temizleme yöntemi. Doğru ölçüt tek: dinleyici sökme
> bittikten sonra hâlâ **ulaşılabilir** bir hedefte mi — `document`,
> `window` ya da belgeye bağlı bir eleman.

Ayrıca `WeakRef` + CDP `HeapProfiler.collectGarbage` ile otuz kur/sök
turunun ardından sökülen editörlerin toplandığı, ve aynı elemanın üstünde
beş kez yeniden kurmanın DOM'u büyütmediği sabitlendi.

> **Kontrol karakteri kapısı ikinci kez işe yaradı.** Önbellek imzası
> alanları ayırmak için araya ham bir U+0001 koyuyordu ve `guard:purity`
> bunu reddetti (F5-03'te konan kural). İmza artık `JSON.stringify` ile
> üretiliyor: hem belirsizlik yok hem de yalnızca yazdırılabilir karakter.

#### Mutlak süreler kapıda değil

`e2e/performans.spec.ts` on iki test taşıyor ama büyük belgelerde **oran**
ölçüyor, mutlak süre değil. Sebep ölçüldü: tek başına 7,3 ms çıkan 5.000
bloklu ölçüm, tüm takım sekiz işçiyle koşarken 17,8 ms'ye çıkıyor — yanı
başında yedi tarayıcı varken alınan süre kütüphaneyi değil makinenin o
anki yükünü ölçüyor. Oran çekişmeye dayanıklı, çünkü iki ölçüm de aynı
koşullarda alınıyor. Mutlak sayılar `pnpm olcum` raporunda.

Boyut etkisi: `@kalem/core` 11,67 kB (sınır 12 kB), `@kalem/editor`
26,21 kB (sınır 38 kB).

### F6-09 · Tarayıcı ve mobil geçişi `[M]` ✅
- [x] Chrome / Firefox / Safari — üç motor zaten her koşuda
- [x] **Edge** — gerçek kurulumda (`channel: "msedge"`, Edge 153)
- [x] iOS Safari + Android Chrome — cihaz benzetimiyle
- [x] Bilinen mobil kısıtlar dokümante edildi
- [x] **Kabul:** mobilde doküman yazılabiliyor; kısıtlar
      [`/bilinen-kisitlar/`](../apps/docs/src/content/docs/bilinen-kisitlar.md)
      sayfasında

İki yeni dosya: `e2e/tarayici.spec.ts` (dört motorda uçtan uca bir yazma
oturumu) ve `e2e/mobil.spec.ts` (iPhone 15 + Pixel 7 benzetimi).

> **Edge tüm testleri koşmuyor, koşmamalı da.** Edge Chrome'la **aynı
> motoru** kullanıyor (Blink + V8): ayrıştırıcı, `contenteditable` ve
> seçim davranışı `chromium` projesinde zaten ölçülüyor. 1.130 testi
> ikinci kez koşturmak altı dakika ekleyip yeni bilgi vermezdi. Farklı
> olan kabuk — sürüm takvimi, eklentileri, varsayılanları — ve geçiş
> testi tam olarak onu yokluyor. Ayrıca `channel: "msedge"` kurulu Edge
> yoksa tüm koşuyu düşürüyor, o yüzden proje yalnızca Windows'ta (ya da
> `KALEM_EDGE=1` ile) ekleniyor.

#### Demo sayfalarında `<meta name="viewport">` yokmuş

Mobil testleri ilk koşuşta iPhone'da yedi kere düştü: dokunma hedefe
ulaşmıyor, "`#cikti` işaretçi olaylarını yutuyor" diyordu. Sebep
sayfanın kendisiydi — görünüm alanı **980×1643** ölçülüyordu. Mobil
tarayıcılar `viewport` meta etiketi olmayan sayfayı masaüstü genişliğinde
kurup uzaklaştırıyor; yani demo sayfaları hiçbir zaman telefon
genişliğinde çizilmemişti. Beş sayfaya (`core`, `editor`, `index`,
`olcum`, `viewer`) etiket eklendi; `wc.html`de zaten vardı.

Bu, mobil geçişinin ilk gerçek bulgusu: kütüphane değil ama
kütüphaneyi gösteren sayfalar mobilde bozuk duruyordu.

#### `touch-action: none` eklendi

Blok tutamacının sürüklemesi `setPointerCapture` ile yürüyor ama
varsayılan `touch-action` altında tarayıcı parmağı **önce kaydırma jesti
sayıp** yakalamayı `pointercancel` ile iptal ediyor: blok taşınmıyor,
sayfa kayıyor. Tutamacın üstünde jest kapatıldı — metnin dışında durduğu
için sayfanın geri kalanı etkilenmiyor.

Dürüst olmak gerekirse bu düzeltme **gerçek cihazda doğrulanmadı**: cihaz
benzetimi yerel dokunmatik sürükleme jestini üretemiyor. Kısıtlar sayfası
bunu böyle söylüyor.

> **"Mobilde blok tutamacı çıkmaz" diye test yazdım, ölçüm aksini
> gösterdi.** 393 px'lik iPhone'da çıkmıyor ama 412 px'lik Pixel'de
> **çıkıyor** — çünkü kural ekranın mobil olması değil, bloğun solunda
> tutamaca yer kalıp kalmaması. Test artık kuralın kendisini tutuyor:
> tutamaç ya metnin soluna sığıyor ya da hiç görünmüyor, üstüne asla
> binmiyor.

#### Mobilde ölçülenler

Ölçüm, tahmin değil: sabit araç çubuğu dar ekranda satırlara sarıyor ve
taşmıyor (349 px genişlik, 61 px yükseklik, yatay kaydırma yok), balon
çubuk ve bul-değiştir paneli görünüm alanının içinde kalıyor, düğmeler
WCAG 2.2'nin istediği 24×24 CSS pikselinin üstünde, 300 karakterlik kod
bloğu ve bağlantı sayfayı yana kaydırmıyor.

> **Proje düzeyindeki `testIgnore` üst düzeydekini eziyor, genişletmiyor.**
> Masaüstü projelerine yalnızca `mobil.spec.ts`i dışla yazınca örnek
> uygulama testleri üç motora birden sızdı ve sunucusuz koşup düştüler.
> İki desen tek listede birleştirildi.

#### Kırılgan bir birim testi de düzeltildi

Birim testlerini e2e koşusuyla aynı anda çalıştırdığımda
`plugin-find-replace`in "100 sayfalık belge" testi iki kez düştü — kodda
hiçbir şey değişmeden. Sebep eşiğin payının olmamasıydı: `createIndex`
500 paragrafta gerçekten **1.405 ms** sürüyor ve eşik 2.000 ms'ti, yani
1,4×. Makinede ikinci bir koşu varken aşılıyordu.

Eşiğin amacı zaten mutlak hız değil, **büyüme biçimi**: doğrusal olmayan
bir tarama oraya saniyeler getirirdi. Test artık onu ölçüyor — 250 ve
1.000 paragraf, oran 8×'in altında (karesel olsa 16× olurdu; ölçülen
4,8×). F6-08'de öğrenilenin aynısı: oran çekişmeye dayanıklı, mutlak süre
değil.

> **Bu arada bir yanlış alarm da elendi.** Aynı ölçümde `findMatches`
> doğrusalın çok üstünde görünüyordu (125 paragrafta 5,6 ms, 1.000'de
> 161 ms). Isıtma turu ekleyip tekrarlı ölçünce gerçek tablo çıktı:
> 250→2.000 paragrafta 1,4→5,6 ms, yani temiz doğrusal. İlk sayı JIT ve
> çöp toplama gürültüsüydü. Tek bir soğuk ölçüme bakıp "performans hatası
> buldum" demek buydu.

### F6-10 · i18n ve locale `[M]` ✅

**a) Çeviri**
- [x] Tüm UI metinleri sözlükten — F3-03'ten beri; F6-10'da **tarandı ve doğrulandı**
- [x] TR + EN; `dir="rtl"` temel desteği
- [x] Sözlük eklentiler tarafından genişletilebilir — `PluginContext.getLang()` + belgelendi

**b) Locale duyarlı davranış ⭐**
- [x] Editörün `lang`'i tek kaynak — `resolveLang` / `editor.getLang()`
- [x] Harf dönüşümü — F0-04 kapısı zaten zorluyordu
- [x] Sıralama — **sıralanan bir şey yok**, gerekçesi aşağıda
- [x] Sayı biçimi — `Intl.NumberFormat`, kapıya da eklendi
- [x] `lang` → `<html lang>` → `navigator.language` zinciri

- [x] **Kabul:** dil değişimi çalışıyor (tarayıcı testi, üç motor)
- [x] **Kabul:** sözlükte eksik anahtar kalmamış (sekiz sözlük, test)
- [x] **Kabul (locale):** Türkçe `i/İ` ve `ı/I` test seti — slash araması,
      bul-değiştir ve içindekiler dâhil

#### Dil yedi yerde ayrı ayrı çözülüyordu

Arayüz, özel eleman ve beş eklenti aynı satırı kopyalamıştı:

```ts
element.closest("[lang]")?.getAttribute("lang") ?? "en"
```

Kopyalar aynı cevabı verdiği sürece zararsız görünüyor. Ama maddenin
istediği zincirin son halkası — tarayıcının dili — **hiçbirinde yoktu**:
dil beyan etmeyen bir sayfada Türk kullanıcı İngilizce arayüz görüyordu.
Eklemek yedi dosyaya dokunmak demekti ve bir sonraki değişiklikte
kopyalardan birinin geride kalması an meselesiydi — o gün arayüz Türkçe
konuşurken bul-değiştir İngilizce kasa kuralıyla arardı.

Artık tek fonksiyon (`@kalem/editor` → `resolveLang`), editörde
`getLang()`, eklenti bağlamında `context.getLang()`. Yedi kopyanın yedisi
de ona bağlandı.

> **Boş `lang` sessizce yanlış cevap veriyordu.** HTML'de `lang=""` "dil
> bilinmiyor" demek. `closest("[lang]")` onu da buluyor ve zincir boş
> dizeyle bitiyordu; `labelsFor("")` İngilizce'ye düşüyordu, oysa
> `<html lang="tr">` oradaydı. Seçici artık `[lang]:not([lang=""])`.

#### Kelime sayacı sayıları biçimlemiyordu

440 bin karakterlik belgede "439689 karakter" yazıyordu. Binlik ayırıcı
Türkçe'de nokta, İngilizce'de virgül — ve **ters** olanı başka bir sayı
gibi okunuyor: İngiliz okur "12.345"i on iki virgül üç dört beş sanar.

Biçimleyici her sözlüğün **kendi dilinde** sabit. Sözlüğe dışarıdan
locale geçirmek hem imzayı değiştirirdi (kendi sözlüğünü yazan kullanıcıyı
kırardı) hem de "Türkçe metin, İngilizce sayı" gibi kendi içinde tutarsız
bir sonuca kapı açardı.

**Aynı hata sınıfı kapıya eklendi.** `guard:locale` locale'siz
`Intl.Collator`ı yakalıyordu ama `Intl.NumberFormat()`,
`Intl.DateTimeFormat(undefined, …)` ve argümansız `toLocaleString()`i
yakalamıyordu — üçü de belgenin değil **çalışma ortamının** dilini
kullanıyor ve İngilizce bir CI makinesinde testten geçiyor. Dört yeni
öz-test kuralın hem temiz kodu geçirdiğini hem kirliyi yakaladığını
kanıtlıyor.

#### Maddenin "TOC için Collator" önerisi yanlış araç

İçindekiler **belge sırasında** olmalı, alfabetik değil: okur "Giriş"ten
sonra belgedeki bir sonraki başlığı görmek istiyor. İçindekilerde
harmanlanan hiçbir şey yok; slash menüsü de sabit, özenle dizilmiş bir
sırada. Kodda sıralama yapılan tek yer yok, yani `Intl.Collator`ın
girebileceği yer yok.

Test bu yüzden Collator'u değil **Collator'un yokluğunu** sabitliyor:
`ılık`, `İstanbul`, `Işık`, `istasyon` — Türkçe harmanlamayla da kod
noktası sırasıyla da yer değiştiren dört başlık belge sırasında kalıyor.
İkinci bir test o dört sözcüğün sıralanınca gerçekten yer değiştirdiğini
kanıtlıyor; yoksa ilk test boşa geçerdi.

#### Slash araması ile bul-değiştir kasıtlı olarak farklı

| | Slash araması | Bul-değiştir |
| --- | --- | --- |
| `IŞIK` ↔ `ışık` | eşleşiyor | eşleşiyor |
| `ılık` ↔ `ilik` | **eşleşiyor** | **eşleşmiyor** |
| `bas` ↔ `Başlık` | eşleşiyor | eşleşmiyor |

Slash menüsü bir **komut** arıyor ve klavyesinde `ı` olmayan kullanıcı
`/bas` yazıp "Başlık"ı bulmalı. Bul-değiştir **metin değiştiriyor**:
"ılık"ı değiştiren kullanıcının belgesindeki "ilik" de değişirse bu veri
kaybı. İkisini "tutarlı olsun" diye birleştirmek birini bozar — iki
pakette de karşı dosyayı adıyla anan bir test bunu tutuyor. Tablonun her
hücresi test edilmiş; kullanıcı rehberindeki aynı tablo buna dayanıyor.

#### Sağdan sola

Tarama CSS'te 24 fiziksel yön özelliği buldu. **On dokuzu mantıksal
özelliğe** geçti (`padding-inline-start`, `border-inline-start`,
`text-align: start`): alıntı çizgisi, liste girintisi, içindekiler
girintisi, tablo hücresi hizası, tutamaç boşluğu. Taramanın deseni
yakalamayan bir köşe yuvarlatması da (`border-radius: 0 6px 6px 0`)
mantıksal köşelere çevrildi — o olmasa RTL'de içindekiler öğesinin çizgisi
bir tarafta, yuvarlatması aynı tarafta kalırdı. Soldan sağa yazıda
mantıksal özellik fizikselle aynı değeri veriyor — 18 görsel regresyon
testi referanslara karşı birebir geçti.

**Beşi kasıtlı olarak fiziksel kaldı:** JS'in `getBoundingClientRect`
pikselini yazdığı sabit katmanların üç `left: 0` orijini, ve yazarın
Markdown'da `:---` / `---:` ile **açıkça** sol ve sağ dediği iki tablo
sütun hizası.

Tutamaç yönü `dir` özniteliğinden değil **hesaplanmış stilden** okuyor —
ataya konmuş `dir` ve CSS `direction` da çalışıyor. RTL ve LTR testleri
tutamaç için zıt konum iddia ediyor ve ikisi de geçiyor; yani konum
gerçekten yöne bağlı, test boşa geçmiyor.

#### Taranan ama değişmeyen

**Son kullanıcıya görünen her metin zaten sözlükteydi.** Tarama sözlük
dışında 60'tan fazla Türkçe dize buldu; hepsi geliştiriciye dönük —
ayrıştırıcının iç tutarlılık etiketleri ve API yanlış kullanımında
fırlatılan hatalar (`replaceAt: 3. çocuk yok`, `Eklenti adı zaten
kayıtlı`).

> **Karar bekliyor:** bu hatalar uluslararası yayımlanacak bir
> kütüphanede İngilizce konuşan geliştiricinin konsoluna Türkçe düşecek.
> Projenin kuralı "kod ve yorumlar Türkçe, kullanıcıya görünmüyor" — ama
> fırlatılan hata geliştiriciye görünüyor. Sözlükten geçirmek yanlış
> (bunlar arayüz metni değil); seçenekler İngilizce'ye çevirmek ya da
> olduğu gibi bırakmak. v1.0'dan (F6-13) önce verilmesi gereken bir karar.
>
> **Karar verildi ve uygulandı: İngilizce.** 22 `throw` mesajı ve
> `blocks.ts`teki 52 `must()` etiketi çevrildi; kod yorumları Türkçe kaldı.
> Kural `CONTRIBUTING.md`de (İngilizce ve Türkçe): "geliştiricinin konsoluna düşen her şey
> İngilizce". 24 test beklentisi İngilizce desenlere güncellendi.

> **Kendi yanlış alarmım.** Sözlüklerin dışa aktarımına bakarken dar bir
> aramayla "`plugin-outline` sözlüklerini dışa aktarmıyor" sonucuna
> vardım. Sekiz paketi tek tek kontrol eden bir betik hepsinin tam
> olduğunu gösterdi; aramam yalnızca birkaç adı içeriyordu. Hiçbir şey
> değiştirilmedi.

Kullanıcı rehberi: [`/rehber/dil-ve-yon/`](../apps/docs/src/content/docs/rehber/dil-ve-yon.md).
Başka bir dil eklemek, eklenti metinleri, sayılar, kasa kuralları ve RTL.

64 birim testi (dil zinciri, sekiz sözlük, sayı biçimi, içindekiler sırası,
kasıtlı fark) + 14 tarayıcı testi × 3 motor + 4 kapı öz-testi.

### F6-11 · README ve duyuru varlıkları `[M]` ✅
- [x] İngilizce README — GIF, rozet, kurulum, karşılaştırma tablosu, kısıtlar
- [x] Sosyal önizleme görseli — 1280×640, `docs/duyuru/onizleme.png`
- [x] Demo videosu — 23 sn, 1280×720 H.264; GIF'i de aynı kayıttan
- [x] "Show HN" ve dev.to taslakları — `docs/duyuru/`
- [x] **Kabul:** materyaller hazır ve gözden geçirildi — gözden geçirme
      iddiaları **ölçmek** demekti ve üç iddia ölçümü geçemedi (aşağıda)

Varlıklar ve nasıl yeniden üretildikleri: [`docs/duyuru/`](duyuru/README.md).
Türkçe README `README.tr.md`ye taşındı ve güncellendi (hâlâ "55/72, sırada
Faz 3" diyordu).

#### GIF bu sefer neden yapılabildi

F6-05'te iki engel vardı: ffmpeg yok ve Playwright'ın video kaydı imleci
çizmiyor. İmleç artık **sahnenin içinde** — `scripts/duyuru/sahne.html` fare
olaylarını dinleyip bir SVG ok çiziyor, basılı tutarken halkası büyüyor.
Kareler CDP'nin `Page.startScreencast`inden zaman damgalarıyla geliyor ve
ffmpeg'e gerçek süreleriyle veriliyor. ffmpeg için makineye bir şey
kurulmadı; betik `FFMPEG` ortam değişkenine bakıyor.

Sahne playground değil: playground'un arayüzü Türkçe ve üstünde on bir
denetim var. Sahnede yalnızca editör (`lang: "en"`) ve Markdown çıktısı.

> **JPEG kareler beyazda bant yaptı.** İlk GIF'te editörün beyaz zemini
> yatay şeritlere bölünmüştü; palet ayarlarıyla uğraşmak düzeltmedi, çünkü
> bant kaynaktaydı — screencast'in JPEG sıkıştırması. PNG karelerle GIF hem
> temiz hem küçük: 272 kB → 185 kB.

#### Gözden geçirme: üç iddia ölçümü geçemedi

**1. "Her belge için byte-birebir" doğru değil.** README'nin ve Show HN
metninin ilk taslağı `serialize(parse(md)) === md`nin **her** belge için
geçerli olduğunu söylüyordu. Gidiş-dönüş testleri 17 altın dosyada
byte-birebir; özellik testleri ise yalnızca idempotansı sınıyor (bilerek —
bkz. `property.test.ts`). Rastgele Markdown parçalarıyla 5000 denemenin
3724'ü farklı döndü; çoğu bozuk sözdizimi, ama gerçekçi 28 örnekten 7'si de
farklı:

| Girdi | Çıktı |
|---|---|
| `1. bir` / `1. bir daha` | `2.` diye yeniden numaralanıyor |
| dört boşlukla iç içe liste | iki boşluğa çekiliyor |
| satır sonunda tek boşluk | siliniyor |
| belge başında boş satırlar | siliniyor |
| setext başlığın `---` çizgisi | başlık uzunluğuna getiriliyor |
| alıntıda tembel devam satırı | başına `> ` ekleniyor |
| kelime sonunda `_` (`under_score_`) | `\_` diye kaçırılıyor |

İlk üçü gerçek belgelerde **çok yaygın** — `1.` `1.` `1.` listesi birçok
yazarın alışkanlığı, dört boşluk girinti de öyle. Çıktı eşdeğer Markdown ama
aynı baytlar değil; kullanıcı o satırlara dokunmasa da ilk kaydetmede
değişiyorlar. Metinler şimdi bunu söylüyor: "test korpusunda byte-birebir,
şu kalıplar hâlâ normalleşiyor, her biri bir hata". README'de yedisi de
listeli.

#### Gidiş-dönüş boşlukları kapatıldı

Karar: v1.0'dan önce düzelt. Yedisi de düzeldi; ölçerken beş yaygın kalıp
daha çıktı, onlar da:

| Kalıp | Neydi | Çözüm |
|---|---|---|
| `1.` `1.` `1.` | `numbering: "repeated"` alanı vardı ama ayrıştırıcı hiç yazmıyordu | iki+ madde hepsi aynı numaraysa `repeated` |
| `    - iç` (4 boşluk) | işaret öncesi girinti kaydedilmiyordu | `ListSyntax.indent` |
| `1.  metin` | işaret sonrası boşluk teke iniyordu | `ListSyntax.spacing` |
| `satır \n` | yumuşak satır sonundan önceki boşluk atılıyordu | metinde kalıyor (HTML'de görünmez) |
| paragraf sonunda boşluk | atılıyordu | paragrafta kalıyor, setext başlıkta atılıyor |
| `   \n` (3+ boşluk) | iki boşluğa iniyordu | `BreakSyntax.width` |
| baştaki / sondaki boş satırlar | kaybediliyordu | `RootSyntax.leadingBlankLines` / `trailingBlankLines` |
| `Başlık\n---` | çizgi başlık boyuna uzatılıyordu | farklıysa `HeadingSyntax.underlineLength` |
| tembel alıntı satırı | `> ` ekleniyordu | `BlockquoteSyntax.lazy` |
| `>metin` | `> metin` oluyordu | `BlockquoteSyntax.compact` |
| `under_score_` | `\_` kaçırılıyordu | kelime içi `_` eş sayılmıyor |
| `C:\Users` | ters bölü ikiye katlanıyordu | yalnızca noktalama önünde kaçırılıyor |
| `***kalın italik***` | `_**…**_` oluyordu | üç işaret italik(kalın) okunduğu için korunuyor |

Ölçüm (gerçekçi 72 örnek; CommonMark'ın 652 örneği; 20.000 rastgele girdi):

| | Önce | Sonra |
|---|---|---|
| Gerçekçi örnekte farklı dönen | 24 | 6 |
| CommonMark byte-birebir | 391 | 420 |
| CommonMark idempotan | 644 | 648 |
| Rastgele girdide idempotans kaybı (dört tohum) | 25 · 28 · 27 · 21 | 10 · 12 · 11 · 6 |

**Bayat alan kuralı.** Editör içerik değişince düğümü yeniden kuruyor ama
`syntax`'ı taşıyabiliyor. Her yeni alan bu yüzden bayatladığında da geçerli
Markdown üretecek şekilde tasarlandı: tembel kayıt yalnızca paragraf
çocuğun ilk satırından sonrasına uygulanıyor, boşluksuz `>` girintili
satırda boşluğa dönüyor, `spacing` girintili kodla başlayan maddede teke
iniyor, ilk çocuk listenin `indent`'i işaret satırında yok sayılıyor.
Testleri `serialize.test.ts` → "yazım alışkanlıkları korunuyor".

> **İlk sürüm idempotansı geriletmişti.** Rastgele girdide kayıp 25'ten
> 64'e çıktı; eski ve yeni kodun başarısız girdileri karşılaştırılınca
> dört sebep çıktı: `>` sonrası sekme boşluksuz sayılıyordu, `> ` içindeki
> boşluk işaret sanılıyordu, boş alıntı `>` yerine boş metin yazılıyordu ve
> satır başındaki `*    ` kaçırılmıyordu (bu sonuncusu eski bir hataydı,
> sondaki boşluk korununca görünür oldu). `__` dizilerinde yeni alt çizgi
> kuralı eski temkinli kurala dönüyor. Son hâlde eski kodda geçip yeni
> kodda bozulan girdi yok — dört tohumun birinde kalan tek örnek (`* *`,
> iç içe boş madde) ilk turda zaten yapıyı kaybediyordu.

**Bilerek bırakılanlar** (nadir; README'de listeli): paragraf içinde
girintili devam satırı, `#  Başlık` (iki boşluk), yalnızca boşluktan oluşan
ara satır, liste maddesinde tembel devam satırı, paragrafın ilk satırındaki
1–3 boşluk, setext başlık metninin sonundaki boşluk.

**Boyut:** `@kalem/core` 11,7 → 12,6 kB. Kullanıcının kararıyla bütçe
12 → 13 kB (izin 15 kB'a kadardı; bütçe sıkı tutuldu ki sonraki büyüme
görünsün). Belgelerdeki 25 sayı `guard:sizes`in raporuyla güncellendi —
kapının ilk gerçek işi.

Yeni korpus dosyası: `packages/core/fixtures/08-yazim-aliskanliklari.md`.

> **Tarayıcı testlerinde iki kırmızı — bu değişiklikten değil.** Tam paket
> iki kez koşuldu; `performans.spec.ts`teki oran testleri (`5.000/1.000 < 5`,
> `10.000/1.000 < 10`) birinde bir, ötekinde iki kez düştü, tek başına her
> seferinde geçti. Eski ve yeni kod aynı makinede, sessizken, üçer ölçümle
> karşılaştırıldı (medyan p50):
>
> | | 1.000 | 5.000 | 10.000 | 5k/1k | 10k/1k |
> |---|---|---|---|---|---|
> | Eski | 1,5 ms | 7,0 ms | 13,0 ms | 4,7× | 8,7× |
> | Yeni | 1,8 ms | 6,6 ms | 13,0 ms | 3,7× | 7,2× |
>
> Büyük belgede maliyet aynı; önbellek sağlam. Sorun testin kendisinde:
> payda 1.000 bloğun 1,5 ms'lik p50'si ve 0,1 ms'lik oynama oranı bir tam
> kat kaydırıyor — eski kod bile sessiz koşuda 5× eşiğine 4,7× ile
> yaklaşıyor (F6-08'de 3,8× ölçülmüştü).
>
> **Düzeltildi — ölçüt değişti, eşik gevşetilmedi.** Tuş maliyeti artık
> aynı sayfada aynı anda ölçülen bir cetvele bölünüyor: belgeyi önbelleksiz
> bir kez serileştirmenin süresi. Yük ikisini birden büyütüyor, oran
> sabit kalıyor. Önbellekli tuş cetvelin 0,66–0,70'i, önbelleksiz tuş
> 1,55–1,9'u (1.000–10.000 blok, üçer ölçüm); eşik 1,0 — "bir tuş belgeyi
> yeniden yazmaktan ucuz olmalı". Önbellek kaldırılınca iki test de
> 1,6–1,7 ile kırmızı (denendi). Eski ölçüt önbelleği 4,3× / 5,1× gibi dar
> bir payla ayırıyordu, çünkü önbellek maliyeti sabite değil yarı eğime
> indiriyor.

**2. Belgelerdeki boyutlar eskimişti — 16 yerde.** Giriş sayfası "editör +
arayüz 34,6 kB" diyordu; ölçüm 35,0 kB. F6-05'te bunu sabitleyen test
geçmeye devam ediyordu, çünkü sınadığı şey sayfanın **kendi metniydi**,
ölçüm değil. Aynı anda on beş yerde daha eski sayı vardı (`core` 11,5 →
11,7; `find-replace` 4,4 → 4,3; tek `<script>` derlemesi 26,7 → 27,0).

Yeni kapı: **`pnpm guard:sizes`**. Her iddia bir dosya, bir desen ve bir
`size-limit` girdisi; yazılan sayı ölçümle **yazarın seçtiği hassasiyette**
karşılaştırılıyor ("26 kB" tam sayı, "35,0 kB" tek hane, "903 B" bayt) ve
ondalık ayırıcı metinden okunuyor. Bir desen hiç eşleşmezse de kırmızı —
iddia denetimden sessizce düşmesin. Bugün 47 sayı: README, iki duyuru
metni, sosyal önizleme ve doküman sitesinin on sayfası. `verify`a ve CI'a
eklendi. Giriş sayfası testi artık sayıyı değil biçimi sınıyor.

**3. "Docs are in English" yazmıştım — değiller.** Show HN taslağının ilk
hâli dokümanın İngilizce olduğunu söylüyordu. Starlight'ın `en` yerel ayarı
F6-01'den beri kurulu ama **içeriği yok**; API referansı da Türkçe JSDoc'tan
üretiliyor. Metinler şimdi bugünkü durumu söylüyor.

> **Karar bekliyor:** İngilizce bir duyuruda doküman sitesinin Türkçe olması
> büyük bir engel. Seçenekler: (a) F6-14'ten önce en azından başlangıç,
> çerçeveler, editör rehberi ve bilinen kısıtlar sayfalarını çevirmek;
> (b) Türkçe siteyle duyurmak ve İngilizce README'ye yaslanmak. Öneri (a).
>
> **Karar: sitenin tamamı. Uygulandı.** 28 sayfanın 28'i `en/` altında
> (giriş, başlangıç, canlı örnekler, mimari, bilinen kısıtlar, 9 rehber,
> 9 çerçeve, 5 tarif). Üretilen API referansı Türkçe kaldı — kaynak
> yorumlarından geliyor. Canlı bileşenler (`HeroDeneme`, `CanliVanilla`,
> `CanliReact`, `CanliVue`) `dil` alıyor; İngilizce sayfalardaki editörler
> İngilizce belgeyle ve İngilizce arayüzle (`lang: "en"`) açılıyor.
>
> Çeviri sırasında Türkçe sayfalarda eskimiş şeyler de düzeltildi: test
> sayıları (1284 → "1.400'ün üstünde"), `markdown-uyumu`nun "dokunulmamış
> belgede her zaman" iddiası, performans testinin anlatımı, eklenti
> bağlamında eksik `getLang()`, boyut kapısının kapsamadığı üç sayı
> ("editörün 26 kB'ı", `wc` 1,98 kB). Boyut kapısı artık iki dilde 89
> sayıyı denetliyor — çeviride tahminle yazdığım "28 kB"leri de yakaladı
> (ölçüm 27). Doküman kapısı 56 sayfada 180 import adını doğruluyor.
>
> Yeni tarayıcı testi `e2e/examples/docs-en.spec.ts`: sayfa `lang="en"`,
> canlı editör İngilizce belgeyle ve İngilizce arayüzle açılıyor, iç
> bağlantılar `/en/` dışına çıkmıyor, konsol temiz.

#### Bulunan ve düzeltilen: CI `main`de hiç koşmuyordu

`.github/workflows/ci.yml` `push: branches: [master]` diyordu; depo dalı
`main`. Yani CI yalnızca pull request'lerde koşuyordu, `main`e doğrudan
gelen commit'lerde hiç. `main` yapıldı.

#### Gönderimden önce açık kalanlar

Taslakların başındaki yorum bloklarında listeli; özetle:

- **Playground hiçbir yerde barındırılmıyor.** Taslaklarda `<PLAYGROUND_URL>`
  yer tutucusu duruyor.
- **`kalem.dev` 403 dönüyor.** `astro.config.mjs`in `site`ı bu alan adı;
  bize ait olup olmadığı belli değil.
- **Depo private.** README'deki CI rozeti ve göreli bağlantılar açıldığında
  çalışır.
- README'deki "Status: not on npm yet" notu F6-13'te kalkacak.

### F6-12 · Yayın provası `[M]` ✅
- [x] `npm publish --dry-run` tüm paketler (15/15)
- [x] Boş bir projeye tarball'dan kurup dene — depo dışında, yalnızca arşivlerden
- [x] `exports` haritası doğrulama — her hedef arşivde var mı
- [x] Provenance imzası — önkoşul (`repository` alanı) tamam; imzanın kendisi
      GitHub Actions'ta OIDC ile F6-13'te
- [x] **Kabul:** temiz makinede sıfırdan kurulum çalışıyor — yerelde ve CI'da
      (Linux, Playwright imajı), `pnpm yayin:prova`

**Prova, gidecek olanın kendisiyle.** Depodaki her test paketlere
`workspace:` bağlantısıyla ulaşıyor; yayımlanan paket ise `files`
listesinin süzdüğü, `workspace:` yerine sürüm yazılmış, `exports` haritası
bir yabancının `node_modules`unda çözülen bir arşiv. `scripts/yayin-provasi.mjs`
yedi adım: `pnpm pack` → arşiv içeriği (README, LICENSE, çıktı var; `src/`,
test, `workspace:`, `catalog:` yok; `exports`un gösterdiği her dosya
arşivde) → `npm publish --dry-run` → geçici bir dizinde yalnızca
arşivlerden kurulum → Node'da 17 ESM ve 16 CJS girişi → kullanıcının
paketleyicisiyle (npm'den `esbuild`) derlenen bir uygulamada tarayıcıda
yazma → `<script>` etiketiyle IIFE. CI'da her push'ta koşuyor.

**Bulunanlar — hepsi yayından önce kapandı:**

- **`@kalem/wc/define` sunucuyu çökertiyordu.** Node'da içe aktarılınca
  `customElements is not defined`. SvelteKit, Astro ve Nuxt bileşen
  betiğini sunucuda da çalıştırıyor ve belgelerdeki Svelte örneği tam
  olarak bu satırı kullanıyordu. `defineKalemEditor` artık
  `customElements` yoksa `false` dönüyor; Node'da koşan bir birim testiyle
  sabit. Depodaki hiçbir test bunu göremezdi: tarayıcı testleri
  tarayıcıda, Svelte örneği yalnızca istemci derlemesiyle koşuyordu.
- **npm sayfaları boş olacaktı.** Paketlerde README ve LICENSE yoktu
  (npm kök dizindekileri pakete katmıyor); MIT, lisans metninin kopyayla
  dağıtılmasını istiyor. 15 İngilizce README ve LICENSE kopyası eklendi.
  README'lerin kod örnekleri doküman kapısına bağlandı — kapı artık kök
  README'yi de tarıyor (73 sayfa, 205 import adı).
- **Açıklamalar Türkçe'ydi**, `repository` / `homepage` / `bugs` /
  `keywords` yoktu. `repository` provenance imzasının önkoşulu: npm, imzayı
  paketin beyan ettiği depoyla eşleştiriyor.
- **Changesets `baseBranch: "master"`** diyordu (CI'daki hatanın ikizi).

### F6-13 · v1.0.0 yayını 🚀 `[S]` 🟡 — hazır, `npm publish` onayını bekliyor
- [x] Changesets ile sürüm — 15 paket `1.0.0`, İngilizce CHANGELOG
- [x] GitHub Actions ile npm yayını — `.github/workflows/release.yml`, provenance imzalı
- [x] GitHub release + changelog + git tag — iş akışında tek `v1.0.0` release'i
- [ ] **`npm publish`** — kullanıcının adımı (aşağıda); geri alınamaz
- [ ] **Kabul:** `npm i @kalem/editor` çalışıyor

**Karar kullanıcının: her şey hazırlandı, son adımda durdu.** npm'e yayın
geri alınamıyor (72 saatten sonra silinemiyor, aynı sürüm numarası bir
daha kullanılamıyor) ve kullanıcının hesabıyla yapılıyor.

**Sürüm notu yeniden yazıldı.** Depodaki 14 changeset Faz 1'in iç
notlarıydı — Türkçe ve yalnızca `@kalem/core` için `minor`. Olduğu gibi
kalsalardı sürüm **0.1.0** olurdu ve changelog v1.0'ın yalnızca ayrıştırıcı
kısmını anlatırdı. Yerine 15 paketi kapsayan tek bir İngilizce `major`
changeset yazıldı; eskiler git geçmişinde.

**İş akışı yalnızca elle tetikleniyor** (`workflow_dispatch`): önce
`pnpm verify` ve yayın provası, biri kırmızıysa hiçbir şey yayımlanmıyor;
sonra `changeset publish` (provenance ile), sonra tek bir `vX.Y.Z` etiketi
ve release — changesets'in paket başına 15 ayrı release'i yerine.

**Yayın için yapılacaklar (sırasıyla):**

1. **`@kalem` kapsamı sende mi?** Paket adları npm'de boş (404), ama
   kapsamın sahibi buradan doğrulanamadı (npm oturumu yok, npmjs.com
   otomatik isteğe 403). `npm login`, sonra `npm org create kalem` ya da
   npm'de "kalem" adlı bir kuruluş oluştur. Kapsam başkasınınsa bütün
   paket adları değişmeli (ör. `@kalemjs/*`) — o durumda söyle, adlar tek
   komutla değiştirilebilir ama belgelerde çok yerde geçiyor.
2. **Depoyu herkese açık yap.** Provenance imzası özel depolarda çalışmıyor;
   README'deki CI rozeti de ancak o zaman görünüyor.
3. **`NPM_TOKEN` sırrı:** npm → Access Tokens → "Automation" (ya da
   yalnızca `@kalem` kapsamına yazabilen granular token) → GitHub → depo →
   Settings → Secrets and variables → Actions → `NPM_TOKEN`.
4. **`main`i GitHub'a gönder** ve CI'ın yeşil olduğunu gör (yerel `main`,
   `origin/main`in önünde; bu oturumdaki commit'ler henüz gönderilmedi).
5. **Actions → "Yayın" → Run workflow.**
6. Yayından sonra: README'deki "Status: … not on npm yet" satırı ve
   sitedeki "Henüz npm'de değil / Not on npm yet" notları kaldırılmalı;
   `SECURITY.md` zaten `1.x` diyor (topluluk dosyaları İngilizceye çevrildi).

**Topluluk dosyaları İngilizce** (duyurudan gelecek ilk ziyaretçinin
göreceği sayfalar): `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
İngilizce; Türkçe asılları `.tr.md`. Issue şablonları İngilizce ve bir
**round-trip** şablonu eklendi — duyuru metinleri okuyucudan tam olarak bu
bildirimi istiyor. Eski şablonlar "v1.0 öncesi" ve "`@kalem/editor
0.0.0`" diyordu; "Soru" bağlantısı depoya değil GitHub'ın genel
`/discussions` sayfasına gidiyordu.

`SECURITY.md` gerçek koddan sapmıştı: var olmayan bir `allowDangerousHtml`
seçeneğini anlatıyor, `ftp:`'yi izin listesinde göstermiyor ve görsellerin
izin verilen `data:image` türlerini "reddedilir" diye yazıyordu. İngilizce
metin koda karşı doğrulandı (`sanitizeUrl` çıktıları).

### F6-14 · Duyuru `[S]` ⬜
Show HN, r/webdev, X, dev.to, Bluesky. İlk 48 saat issue'lara aktif yanıt.

> **FAZ 6 ÇIKIŞ KRİTERİ:** v1.0.0 npm'de, doküman sitesi canlı, duyuru yapılmış.

---

# v1.1 ve Sonrası (v1.0 kapsamı dışı — bilinçli)

| Öncelik | İş | Not |
|---|---|---|
| 1 | `plugin-table` | **Karar #5 gereği v1 dışı.** Blok motorunun en pahalı parçası. Parser tabloyu zaten koruyor, sadece UI eksik. v1 sonrası ilk iş. |
| 2 | Mobil/dokunmatik cila | **Karar #6 gereği.** Dokunmatik drag-drop, mobil araç çubuğu, sanal klavye yönetimi |
| 3 | `plugin-katex`, `plugin-mermaid` | Tembel yüklenen |
| 4 | Sanal kaydırma | F6-08 ölçümü gerektirdiyse |
| 5 | `plugin-collab` (Yjs) | En büyük tek özellik; ayrı bir proje ölçeğinde |
| 6 | `plugin-export-docx` | Segment A için değerli |
| 7 | Yorumlar / öneri modu | Word paritesinin son parçası |
| 8 | AI eklenti yuvası | Kullanıcının kendi sağlayıcısı; "yeniden yaz / özetle / çevir" |

---

# Özet Zaman Çizelgesi

| Faz | Süre | Kümülatif |
|---|---|---|
| 0 · Temel | 1 hafta | 1 hafta |
| 1 · Core | 5–7 hafta | 6–8 hafta |
| 1.5 · Spike ⚠️ | 1 hafta | 7–9 hafta |
| 2 · Viewer + Editör | 7–9 hafta | 14–18 hafta |
| 3 · Word Deneyimi | 6–8 hafta | 20–26 hafta |
| 4 · Eklentiler | 4–5 hafta | 24–31 hafta |
| 5 · Sarmalayıcılar | 2–3 hafta | *(Faz 3 ile paralel)* |
| 6 · Cila + Yayın | 4–6 hafta | **28–37 hafta ≈ 7–9 ay** |

**Kritik yol:** F1-03/04 (ayrıştırıcı) → F1.5 (spike) → F2-05/06/07 (blok motoru) → F3-01/04 (Word UX)

**En riskli üç görev:** F1-04 (satır içi ayrıştırıcı — CommonMark vurgu algoritması), F2-06 (seçim modeli), F2-09 (geçmiş)

---

# Sonraki Adım

Faz 0'ı başlatmaya hazırız. Onay verdiğinde `F0-01` → `F0-08` arasını kurarım (monorepo, TS, build, CI, iki koruyucu kapı, proje hijyeni) — kütüphane kodu yazmadan, sadece iskelet.
