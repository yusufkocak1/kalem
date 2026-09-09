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

> Son güncelleme: 2026-09-09 · `master` · `pnpm verify` yeşil · Playwright 345/345

| Faz | Görev | Durum |
|---|---|---|
| **Faz 0** — Temel altyapı | 8 / 8 | ✅ **Tamamlandı** |
| **Faz 1** — `@kalem/core` | 11 / 11 | ✅ **Tamamlandı** |
| **Faz 1.5** — Doğrulama spike'ı | 0 / 3 | ⏭️ Atlandı (Faz 2'ye geçildi) |
| **Faz 2** — Viewer + başsız editör | 11 / 13 | 🔵 2B sürüyor |
| **Faz 3** — Word deneyimi | 0 / 11 | ⬜ Başlanmadı |
| **Faz 4** — Eklentiler | 0 / 7 | ⬜ Başlanmadı |
| **Faz 5** — Sarmalayıcılar | 0 / 5 | ⬜ Başlanmadı |
| **Faz 6** — Cila ve yayın | 0 / 14 | ⬜ Başlanmadı |
| | **30 / 72** | **%42** |

**İşaretler:** ✅ bitti · 🔵 devam ediyor · 🟡 kısmen · ⬜ başlanmadı · ⏭️ atlandı

### 👉 Şu an buradayız

**Bitenler:** `F0-01` … `F0-08` · `F1-01` … `F1-11` · **`F2-01` … `F2-04` (2A tamam)** · `F2-05` … `F2-11`

**Sıradaki:** `F2-12` eklenti sistemi, ardından `F2-13` editör E2E paketi
— ikisiyle birlikte Faz 2 kapanıyor.

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
> | `@kalem/editor` (core + viewer dâhil) | 21.2 kB | 38 kB |
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
geri al/yinele, giriş kuralları, pano.
**870 birim testi** + **345 tarayıcı testi** (Chromium · Firefox · WebKit),
axe ile WCAG 2.1 A/AA taraması dâhil.
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

# FAZ 2 — Viewer + Başsız Editör
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

## 2B · `@kalem/editor` — blok motoru (~6–8 hafta) 🔵 SÜRÜYOR

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

### F2-12 · Eklenti sistemi `[M]` ⬜
Analiz §5.9'daki `Plugin` arayüzü; kayıt, yaşam döngüsü, çakışma çözümü
- **Dogfooding kuralı:** görev listesi ve kod bloğu bu API üzerinden yeniden yazılır
- **Kabul:** çekirdek bir özellik eklenti olarak çıkarılıp tekrar takılabiliyor

### F2-13 · Editör E2E test paketi `[L]` ⬜
Playwright ile: yazma, seçim, kısayollar, giriş kuralları, undo/redo, kopyala-yapıştır, IME (CDP `Input.imeSetComposition`)
- **Kabul:** Chromium + Firefox + WebKit'te yeşil

> **FAZ 2 ÇIKIŞ KRİTERİ:** UI olmadan, sadece klavyeyle tam işlevli bir Markdown editörü. `@kalem/editor` ≤ 38 kB.

---

# FAZ 3 — Word Deneyimi (`@kalem/ui`)
**Amaç:** Ürünün kalbi. Segment A'nın (yazılım bilmeyen kullanıcı) tüm değeri burada. **Süre: ~6–8 hafta**

### F3-01 · Balon araç çubuğu (bubble toolbar) `[L]` ⬜
Metin seçilince seçimin üstünde beliren araç çubuğu
- Butonlar: kalın, italik, üstü çizili, kod, link, blok tipi açılır listesi
- Konumlandırma: viewport sınırı farkındalığı, kaydırmada takip, seçim değişince güncelle (küçük kendi popper mantığımız — Floating UI bağımlılığı **eklenmez**)
- Aktif durum yansıması (seçili metin kalınsa buton basılı görünür)
- **Kabul:** Word'deki mini araç çubuğu kadar akıcı

### F3-02 · Link düzenleme akışı `[M]` ⬜
Link ekleme popover'ı, URL doğrulama, mevcut linki düzenle/kaldır, Ctrl+K
- **Kabul:** URL yapıştırırken seçili metin otomatik linkleniyor

### F3-03 · Slash menü `[L]` ⬜
`/` yazınca açılan blok ekleme menüsü
- Aranabilir liste, klavye ile gezinme, ikonlar, kategori grupları, i18n'e hazır etiketler
- Eklentiler bu menüye öğe ekleyebilmeli
- Arama, editörün `lang`'ine göre locale duyarlı karşılaştırma yapar
- **Kabul:** `/bas` yazınca "Başlık 1" filtreleniyor, Enter ile ekleniyor
- **Kabul (locale):** `lang="tr"` iken `/ba**ş**` ve `/BAŞ` aynı sonucu veriyor; `/ıst` ile "İstatistik" gibi bir öğe eşleşiyor

### F3-04 · Blok drag handle + sürükle-bırak ⭐ `[L]` ⬜
Kullanıcının açıkça istediği özellik.
- Blok hover'ında sol kenarda tutamaç (⠿) + artı butonu
- Sürükleme sırasında: bırakma göstergesi çizgisi, hayalet önizleme, otomatik kaydırma
- Çoklu blok seçimini birlikte sürükleme
- **Kabul:** 5 paragraflık dokümanda 3. paragraf 1. sıraya sürüklenebiliyor, undo ile geri alınıyor

### F3-05 · Blok bağlam menüsü `[M]` ⬜
Tutamaca tıklayınca: sil, çoğalt, blok tipini değiştir, yukarı/aşağı taşı, kopyala
- **Kabul:** menü klavyeyle de kullanılabiliyor

### F3-06 · Üst araç çubuğu (opsiyonel ribbon) `[M]` ⬜
Word'e alışkın kullanıcı için sabit araç çubuğu; yapılandırılabilir buton grupları
- **Kabul:** `toolbar: 'fixed' | 'bubble' | 'both' | false` seçeneğiyle çalışıyor

### F3-07 · Yapıştırma boru hattı `[L]` ⬜
F1-09'daki HTML→AST dönüştürücüyü editöre bağla
- Yapıştırma anında kaynak tespiti (Word / GDocs / düz metin / Markdown metni)
- Düz metin yapıştırılırken Markdown olarak ayrıştırma seçeneği
- Ctrl+Shift+V = biçimsiz yapıştır
- **Kabul:** Word'den kopyalanan 3 sayfalık biçimli doküman doğru yapıya dönüşüyor

### F3-08 · Yer tutucu ve boş durumlar `[S]` ⬜
Boş dokümanda "Yazmaya başlayın veya `/` ile komut çalıştırın" ipucu
- **Kabul:** ipucu odaklanınca kaybolmuyor, yazınca kayboluyor

### F3-09 · Tema sistemi `[M]` ⬜
`@kalem/themes`: CSS değişkeni token seti, `default` + `dark` + `minimal`; `prefers-color-scheme` + `[data-theme]`
- **Kabul:** tek CSS bloğuyla marka rengi değiştirilebiliyor

### F3-10 · Erişilebilirlik geçişi `[L]` ⬜
- ARIA rolleri (`role="textbox"`, `aria-multiline`), menüler için `role="menu"` + `aria-activedescendant`
- Odak tuzağı yönetimi, odak halkaları, canlı bölge duyuruları ("Blok yukarı taşındı")
- Sürükle-bırak için klavye alternatifi (Ctrl+Shift+↑/↓) — **sürükle-bırak tek yol olamaz**
- NVDA ve VoiceOver ile elle test
- **Kabul:** axe sıfır ihlal; ekran okuyucuyla doküman yazılıp düzenlenebiliyor

### F3-11 · UI E2E + görsel regresyon `[M]` ⬜
Playwright: balon araç çubuğu, slash menü, sürükle-bırak, yapıştırma; her tema için ekran görüntüsü karşılaştırması
- **Kabul:** CI'da yeşil, `editor + ui` ≤ 58 kB

> **FAZ 3 ÇIKIŞ KRİTERİ:** Yazılım bilmeyen bir kişiye verildiğinde, açıklama yapmadan doküman yazabiliyor. **Bunu gerçek bir kişiyle test et** (sessiz geliştirmede bu tek gerçek kullanıcı sinyalin).

---

# FAZ 4 — Eklentiler
**Amaç:** Modülerlik vaadini kanıtlamak. **Süre: ~4–5 hafta**

> Tümü ayrı paket, tümü halka açık eklenti API'sini kullanır, tümü isteğe bağlı.

### F4-01 · `plugin-image-upload` `[L]` ⬜
Sürükle-bırak / yapıştırarak görsel, yükleme kancası (`onUpload`), yer tutucu + ilerleme + hata durumu, alt metin düzenleme, yeniden boyutlandırma
- **Kabul:** sahte bir S3 yükleyiciyle uçtan uca çalışıyor

### F4-02 · `plugin-code-highlight` `[M]` ⬜
Kod bloğu vurgulama; **tembel yüklenir**, dil paketleri ayrı chunk. Shiki/Prism kullanıcının kendi tercihi olarak takılabilir (bizim bağımlılığımız değil)
- **Kabul:** vurgulama kullanılmadığında ana bundle'a 0 byte ekliyor

### F4-03 · `plugin-find-replace` `[M]` ⬜
Ctrl+F / Ctrl+H, eşleşme vurgulama, tümünü değiştir, büyük/küçük harf + tam kelime seçenekleri
- "Büyük/küçük harf duyarsız" arama, editörün `lang`'ine göre çalışır — aksi halde Türkçe'de `İSTANBUL` araması `istanbul`'u bulamaz
- **Kabul:** 100 sayfalık dokümanda takılmadan çalışıyor
- **Kabul (locale):** `lang="tr"` iken `ışık` ↔ `IŞIK` ve `iyi` ↔ `İYİ` çiftleri eşleşiyor, `ışık` ↔ `İŞİK` eşleşmiyor

### F4-04 · `plugin-outline` `[S]` ⬜
İçindekiler paneli, başlıklara tıklayarak atlama, aktif başlık takibi

### F4-05 · `plugin-word-count` `[S]` ⬜
Kelime / karakter / okuma süresi; durum çubuğu bileşeni

### F4-06 · `plugin-source-mode` `[M]` ⬜
WYSIWYG ↔ ham Markdown geçişi; basit metin alanı (CodeMirror bağımlılığı **yok**)
- **Kabul:** iki mod arası geçişte içerik kaybı yok

### F4-07 · `plugin-autosave` `[S]` ⬜
Debounce'lu `onSave`, "kaydediliyor / kaydedildi" durumu, localStorage kurtarma

> **FAZ 4 ÇIKIŞ KRİTERİ:** 7 eklenti, tümü halka açık API ile yazılmış. Eklenti API'si kendi kullanımıyla doğrulanmış.

---

# FAZ 5 — Framework Sarmalayıcıları
**Amaç:** "Framework bağımsız" vaadinin kanıtı. **Süre: ~2–3 hafta**
**Not:** Faz 3 ile paralel yürütülebilir ve yürütülmeli — API'yi erken sınar.

### F5-01 · `@kalem/react` `[M]` ⬜
- `<KalemEditor value onChange />` — hem kontrollü hem kontrolsüz
- `useSyncExternalStore` ile abonelik, `useKalem()` hook'u ile imperatif erişim
- `peerDependencies: { react: ">=17" }`, kendi boyutu ≤ 1.5 kB
- React 19 + Strict Mode + Next.js App Router (`'use client'`) uyumu
- **Kabul:** `examples/react-vite` ve `examples/nextjs` çalışıyor

### F5-02 · `@kalem/vue` `[M]` ⬜
- `<KalemEditor v-model />`, `defineComponent`, `peerDependencies: { vue: "^3" }`
- Nuxt 3 SSR uyumu (`<ClientOnly>` gereksiz olmalı — viewer SSR'de render edebilmeli)
- **Kabul:** `examples/vue-vite` ve `examples/nuxt` çalışıyor

### F5-03 · `@kalem/wc` `[M]` ⬜
`<kalem-editor>` Custom Element; Shadow DOM **opsiyonel, varsayılan kapalı**; attribute/property/event köprüsü; `ElementInternals` ile form entegrasyonu
- **Kabul:** `examples/svelte` ve `examples/angular` çalışıyor

### F5-04 · Örnek uygulamalar `[M]` ⬜
`examples/`: `react-vite`, `vue-vite`, `nextjs`, `nuxt`, `svelte`, `angular`, `cdn-vanilla`
- Her biri minimal, kopyalanabilir, CI'da build ediliyor
- **Kabul:** CI her örneği build ediyor; `cdn-vanilla` tek `<script>` ile çalışıyor

### F5-05 · Dogfooding ⭐ `[M]` ⬜
**Kalem'i kendi gerçek projelerinden birine entegre et ve gerçekten kullan.**
- Sessiz geliştirme stratejisinde bu, v1.0 öncesi elde edeceğin tek gerçek kullanım verisi. Atlanamaz.
- **Çıktı:** kullanım sırasında bulunan sorunların listesi → v1.0 backlog'una alınır
- **Kabul:** en az 2 hafta günlük kullanım

> **FAZ 5 ÇIKIŞ KRİTERİ:** Bir Vue projesine kurulduğunda `node_modules`'da React yok. Saflık kapısı (F0-07) bunu otomatik doğruluyor.

---

# FAZ 6 — Cila, Dokümantasyon, Yayın
**Amaç:** Tek atışlık duyuru. **Süre: ~4–6 hafta**

> Sessiz geliştirme seçildiği için bu faz **pazarlık konusu değil**. Duyuru günü ilk izlenim tek seferliktir; eksik doküman = kaybedilmiş fırsat.

## 6A · Dokümantasyon Sitesi (Astro Starlight)

### F6-01 · Site kurulumu `[M]` ⬜
`apps/docs`: Astro + Starlight, marka teması, Pagefind arama, TR + EN i18n iskeleti
- **Kabul:** `pnpm --filter docs dev` çalışıyor

### F6-02 · İçerik yazımı `[L]` ⬜
Analiz §10.2'deki bilgi mimarisi:
- Başlangıç (5 satırda ilk editör), Rehberler (viewer, editor, temalar, eklentiler, markdown uyumu, güvenlik, erişilebilirlik)
- Framework rehberleri: vanilla, react, vue, svelte, angular, nextjs, nuxt, cdn
- Tarifler (cookbook): otomatik kaydet, görsel yükleme, salt okunur, kontrollü bileşen, sunucuda md→HTML
- Mimari sayfası (bu dokümanın halka açık özeti — katkıcı çeker)
- **Kabul:** hiçbir sayfada "TODO" yok

### F6-03 · Canlı gömülü örnekler ⭐ `[M]` ⬜
Starlight'ın framework-agnostikliğinden faydalan: **aynı sayfada** vanilla, React ve Vue sekmeli canlı örnek
- **Kabul:** ürünün ana iddiası doküman sitesinin kendisiyle kanıtlanıyor

### F6-04 · API referansı `[M]` ⬜
TypeDoc → Starlight entegrasyonu, otomatik üretim CI'da
- **Kabul:** her genel API tipi dokümante

### F6-05 · Landing sayfası `[M]` ⬜
Canlı editör (hemen dene), boyut rozeti, rakip karşılaştırma tablosu, 30 saniyelik GIF, kurulum tek satırı
- **Kabul:** ilk 5 saniyede "bu ne" anlaşılıyor

## 6B · Demo / Playground

### F6-06 · `apps/demo` `[M]` ⬜
Vite vanilla TS: sol editör / sağ canlı Markdown çıktısı, özellik anahtarları, tema seçici, örnek doküman yükleyici, "Word'den yapıştır" senaryosu
- **Kabul:** kütüphanenin gücü 30 saniyede anlaşılıyor

### F6-07 · Paylaşılabilir playground `[M]` ⬜
Durum URL'de kodlanır (LZ sıkıştırma), "bağlantıyı kopyala"
- **Kabul:** paylaşılan bağlantı aynı içeriği açıyor

## 6C · Yayın Hazırlığı

### F6-08 · Performans geçişi `[M]` ⬜
Büyük doküman testi (5.000+ blok): sanal kaydırma gerekli mi ölç; giriş gecikmesi < 16 ms; bellek sızıntısı kontrolü (editör `destroy()` sonrası)
- **Kabul:** 1.000 bloklu dokümanda yazmak akıcı

### F6-09 · Tarayıcı ve mobil geçişi `[M]` ⬜
Chrome/Firefox/Safari/Edge son 2 sürüm + iOS Safari + Android Chrome
- **Karar gereği:** mobil "çalışır ama optimize değil" — **çalıştığı doğrulanmalı**, bozuk olmamalı. Bilinen mobil kısıtları dokümante et.
- **Kabul:** mobilde doküman yazılabiliyor; kısıtlar `docs/bilinen-kisitlar` sayfasında

### F6-10 · i18n ve locale `[M]` ⬜
İki ayrı iş; ikincisi genelde unutulur ve sessiz hatalara yol açar.

**a) Çeviri**
- Tüm UI metinleri sözlükten (araç çubuğu ipuçları, slash menü etiketleri, menüler, ekran okuyucu duyuruları, hata mesajları)
- TR + EN; `dir="rtl"` temel desteği
- Sözlük eklentiler tarafından genişletilebilir

**b) Locale duyarlı davranış ⭐**
- Editörün `lang`'i tek kaynak; tüm karşılaştırma ve sıralama onu kullanır
- Harf dönüşümü: `toLocaleLowerCase(lang)` / `toLocaleUpperCase(lang)` — F0-04 lint kuralı bunu zaten zorluyor
- Sıralama: `Intl.Collator(lang)` — TOC ve otomatik tamamlama listelerinde
- Tarih/sayı biçimi kullanılıyorsa `Intl.DateTimeFormat` / `Intl.NumberFormat`
- `lang` verilmezse `document.documentElement.lang`, o da yoksa `navigator.language`

- **Kabul:** dil değişimi çalışıyor; sözlükte eksik anahtar kalmamış
- **Kabul (locale):** Türkçe `i/İ` ve `ı/I` çiftleri için birim test seti geçiyor — slash menü araması, bul-değiştir ve TOC sıralaması dahil

### F6-11 · README ve duyuru varlıkları `[M]` ⬜
İngilizce README (GIF, rozet, kurulum, karşılaştırma tablosu), sosyal önizleme görseli, 30 sn demo videosu, "Show HN" ve dev.to yazı taslakları
- **Kabul:** duyuru materyalleri hazır ve gözden geçirilmiş

### F6-12 · Yayın provası `[M]` ⬜
`npm publish --dry-run` tüm paketler; boş bir projeye tarball'dan kurup dene; `exports` haritası doğrulama; provenance imzası
- **Kabul:** temiz makinede sıfırdan kurulum çalışıyor

### F6-13 · v1.0.0 yayını 🚀 `[S]` ⬜
Changesets ile sürüm, GitHub Actions ile npm yayını, GitHub release + changelog, git tag
- **Kabul:** `npm i @kalem/editor` çalışıyor

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
