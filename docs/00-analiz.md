# Markdown Editör Kütüphanesi — Teknik Analiz ve Mimari Karar Dokümanı

> Durum: **Onaylandı — kararlar alındı (2026-09-08)**
> Ürün adı: **Kalem** · npm scope: `@kalem/*`
> Devamı: [01-is-listesi.md](./01-is-listesi.md)
> Tarih: 2026-09-08
> Kapsam: Ürün tanımı, rakip analizi, mimari kararlar, risk analizi, yol haritası

---

## 1. Yönetici Özeti

Hedef: **yazılım bilmeyen son kullanıcının Word rahatlığıyla kullanabileceği, framework-bağımsız, küçük ve modüler bir Markdown editör kütüphanesi.**

Üç temel gereksinim birbiriyle çelişiyor ve mimarinin tamamı bu üç kısıtın dengelenmesi üzerine kurulu:

| Gereksinim | Doğal çözümü | Çatıştığı yer |
|---|---|---|
| Word benzeri WYSIWYG + sürükle-bırak | Olgun rich-text motoru (ProseMirror/Lexical) | Paket boyutu + 3rd party bağımlılık |
| Küçük paket, az bağımlılık, özgün | Kendi motorunu yaz | Geliştirme süresi + contenteditable riski |
| Framework bağımsızlığı | Vanilla DOM çekirdek | React/Vue ergonomisi |

**Önerilen çözüm:** Markdown'ın *sınırlı* düğüm kümesinden faydalanan **kendi blok-tabanlı editör motoru** + **sıfır bağımlılıklı vanilla TS çekirdek** + **ayrı paketlerde ince framework sarmalayıcıları**.

Bu doküman bu önerinin neden savunulabilir olduğunu, alternatiflerini ve maliyetini açıklar.

---

## 2. Problem Tanımı

### 2.1 Neden şimdi?

- LLM'lerin çıktı formatı fiilen Markdown oldu. Doküman üretim akışı `docx -> md` yönünde kayıyor.
- Markdown'ın kazandığı yerler: versiyonlanabilirlik (git), taşınabilirlik, LLM dostu, statik site/wiki altyapıları.
- Kaybettiği yer: **son kullanıcı ergonomisi.** `**kalın**` yazmak, tablo hizalamak, resim eklemek teknik olmayan kullanıcı için Word'e göre büyük gerileme.

### 2.2 Hedef kullanıcı segmentleri

| Segment | İhtiyaç | Öncelik |
|---|---|---|
| **A. Son kullanıcı** (İK uzmanı, editör, öğretmen, avukat) | Markdown'ı hiç görmeden doküman yazmak | **Birincil** |
| **B. Entegre eden geliştirici** | Küçük, tip güvenli, framework'üne uyan, kolay gömülen lib | **Birincil** |
| C. Teknik yazar / geliştirici son kullanıcı | Kaynak modu, kısayollar, hız | İkincil |

Segment A, ürünün farklılaşma noktası. Segment B, dağıtım kanalı. İkisini aynı anda memnun etmek = **"varsayılan olarak Word, isteğe bağlı olarak Markdown"** ilkesi.

### 2.3 Ürün ilkeleri (tasarım kararlarında hakem olarak kullanılacak)

1. **Markdown kullanıcıya sızmaz.** Varsayılan modda kullanıcı hiçbir zaman `##` veya `**` görmez. Kaynak modu opt-in bir özelliktir, varsayılan değil.
2. **Kayıpsız gidiş-dönüş.** `md -> AST -> md` idempotent olmalı. Kullanıcının dokunmadığı satır byte düzeyinde değişmemeli (git diff gürültüsü = ürünün ölümü).
3. **Ödemediğin şeyi indirmezsin.** Sadece viewer isteyen, editör kodunu indirmez. Tablo kullanmayan, tablo UI'ını indirmez.
4. **Çekirdek hiçbir framework'ü bilmez.** Ne React, ne Vue, ne de bir sanal DOM.
5. **Güvenlik varsayılan.** AST'den render = enjeksiyon yüzeyi yok.

---

## 3. Rakip Analizi

Boyutlar yaklaşık, min+gzip; kendi ölçümümüzle doğrulanacak.

| Çözüm | Yaklaşık boyut | Framework | WYSIWYG | Neden yetmiyor |
|---|---|---|---|---|
| **Tiptap** (+ProseMirror) | ~90–120 kB | Vanilla çekirdek, resmi React/Vue sarmalayıcı | Evet, çok iyi | Ağır; Markdown *birinci sınıf değil* (HTML odaklı, md serileştirme ekstra iş); Pro özellikler ücretli |
| **ProseMirror** (ham) | ~45–55 kB | Vanilla | Evet | Düşük seviye, çok fazla iskele kodu; ~10 ayrı paket bağımlılığı |
| **Lexical** | ~24 kB çekirdek | Vanilla çekirdek + React sarmalayıcı | Evet | Markdown transform'ları sınırlı; gidiş-dönüş sadakati zayıf; ekosistem React ağırlıklı |
| **Editor.js** | ~30 kB + eklentiler | Vanilla | Blok tabanlı | Çıktısı JSON, Markdown değil; md dönüşümü kayıplı |
| **BlockNote** | ~150 kB+ | React'e sıkı bağlı | Evet, çok iyi UX | React zorunlu — kullanıcının tam olarak kaçındığı senaryo |
| **Milkdown** | ~100 kB+ | Vanilla, ProseMirror üstü | Evet | Markdown odaklı ama ağır ve dik öğrenme eğrisi |
| **TOAST UI Editor** | ~250 kB+ | Vanilla | Split/WYSIWYG | Çok ağır, eski mimari, tema kısıtlı |
| **EasyMDE / SimpleMDE** | ~80 kB (CodeMirror 5) | Vanilla | Hayır — kaynak + önizleme | Hedef kitle A için uygun değil |
| **CodeMirror 6 + live preview** | ~130 kB | Vanilla | Yarı (Obsidian tarzı) | Markdown sözdizimi hâlâ görünür; segment A'ya uygun değil |

### 3.1 Pazar boşluğu

> **"Markdown-native, WYSIWYG-first, framework-agnostic, < 60 kB, modüler"** kombinasyonunu sunan bir kütüphane yok.

En yakın rakip BlockNote (UX olarak) ama React'e bağlı ve JSON tabanlı. Milkdown Markdown-native ama ağır. Bu boşluk gerçek ve savunulabilir bir konumlandırma.

### 3.2 Farklılaşma cümlesi (taslak)

> *"Word kadar kolay, Markdown kadar taşınabilir. Herhangi bir framework ile — ya da framework olmadan."*

---

## 4. Gereksinimler (MoSCoW)

### Must (v1.0)
- Blok tipleri: paragraf, H1–H6, kalın/italik/üstü çizili/kod, bağlantı, sırasız/sıralı/görev listesi, alıntı, kod bloğu, yatay çizgi, görsel
- Seçim üzerine çıkan **balon araç çubuğu** (bubble toolbar)
- **Slash menü** (`/` ile blok ekleme)
- **Sürükle-bırak blok yeniden sıralama** (drag handle)
- Undo/redo, standart kısayollar (Ctrl+B/I/K/Z/Y)
- Word/Google Docs/Web'den **yapıştırma normalizasyonu** (HTML -> AST)
- Kayıpsız `md <-> AST` gidiş-dönüş
- Salt-okunur viewer + SSR string render
- Erişilebilirlik: klavye ile tam kullanım, ARIA, odak yönetimi
- TypeScript tipleri, ESM + CJS + IIFE (CDN) çıktıları

### Should (v1.x)
- Tablo — **KARAR: v1 dışı.** `@kalem/plugin-table` olarak v1.1'de. Parser tabloyu v1'de de kayıpsız korur, sadece düzenleme UI'ı ertelendi.
- Görsel yükleme/sürükleme + yer tutucu + ilerleme
- İçindekiler (outline) paneli, kelime sayacı
- Bul & değiştir
- Kaynak (Markdown) modu geçişi
- i18n, karanlık tema
- Mobil/dokunmatik cila — **KARAR: v1'de "çalışır ama optimize değil".** Tam dokunmatik deneyim v1.1.

### Could (v2)
- Kod bloğu sözdizimi vurgulama (tembel yüklenen eklenti)
- Matematik (KaTeX), Mermaid diyagram (tembel eklenti)
- Yorumlar / öneri modu
- Gerçek zamanlı işbirliği (CRDT — Yjs eklentisi)
- `docx` / `pdf` dışa aktarma eklentisi
- AI eklenti yuvası (metin dönüştür/özetle) — kullanıcının kendi sağlayıcısıyla

### Won't (bilinçli kapsam dışı)
- Sayfa düzeni / sayfa kırılımı (Markdown'ın kavramı değil)
- Karmaşık yerleşim: metin sarmalı, çok sütun, dipnot düzeni
- WYSIWYG içinde ham HTML düzenleme (sadece korunur/gösterilir)

---

## 5. Mimari Kararlar

### 5.1 KARAR 1 — Editör motoru

Dört seçenek değerlendirildi:

**Seçenek A — Tek dev `contenteditable` + kendi motor**
Klasik yaklaşım (ProseMirror'ın yaptığı). Tüm doküman tek bir contenteditable.
- Artı: en küçük boyut, tam kontrol.
- Eksi: contenteditable'ın *tüm* cehennemi bize kalır — IME (Çince/Japonca/Korece), tarayıcı otomatik düzeltmeleri, seçim eşleme, mobil klavye, kopyala-yapıştır. Tek başına 12–18 ay.

**Seçenek B — Olgun motor üstüne inşa (ProseMirror veya Lexical)**
- Artı: 3–4 ayda v1, savaş testinden geçmiş.
- Eksi: bağımlılık + boyut hedefi ölür (sadece motor ~45 kB). "Özgün olsun" hedefi ölür. Milkdown/Tiptap'in n'inci klonu oluruz.

**Seçenek C — Blok-tabanlı hibrit motor (kendi yazımımız) — ÖNERİLEN**
Notion / Editor.js / BlockNote'un mimari fikri: **her blok kendi küçük `contenteditable` elemanı.**
- Blok *içi* seçim, imleç, IME, otomatik düzeltme -> **tarayıcı halleder.** contenteditable acısının büyük kısmı buharlaşır.
- Blok *arası* seçim, sürükle-bırak, ekleme/silme -> bizim basit, deterministik JS mantığımız.
- Sürükle-bırak blok yeniden sıralama bu mimaride **neredeyse bedava gelir** — A/B'de ekstra iştir.
- Markdown'ın düğüm kümesi zaten *bloklara* karşılık geliyor (paragraf, başlık, liste öğesi, kod bloğu…). Model, formatın doğal yapısıyla birebir örtüşüyor.
- Boyut: satır içi formatlama + blok yöneticisi + geçmiş ≈ **25–35 kB** hedeflenebilir.

**Seçenek D — CodeMirror 6 + dekorasyon (Obsidian tarzı canlı önizleme)**
- Markdown sözdizimi kısmen görünür kalır -> **hedef kitle A elenir.** Reddedildi.

> **Öneri: Seçenek C.** Gerekçe: üç hedefi (Word UX + küçük boyut + özgünlük) aynı anda karşılayan tek seçenek. Risk, "blok içi zenginlik"i sınırlı tutarak (satır içi format = kalın/italik/kod/link/üstü çizili; iç içe karmaşık blok yok) yönetilebilir.

**Seçenek C'nin bilinen zayıflığı:** bloklar arası sürükleyerek çoklu seçim ve o seçim üzerinde tek seferde işlem (ör. 3 paragrafı birden kalın yapmak) el ile yazılmalı. Bu, planlanmış ve bütçelenmiş bir iş kalemidir (Faz 3).

---

### 5.2 KARAR 2 — Doküman modeli

**`mdast` uyumlu ama bağımsız bir AST.** (unified/remark'ın mdast şemasıyla *şekil olarak* uyumlu, ama `unified` bağımlılığı yok.)

```ts
type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; depth: 1|2|3|4|5|6; children: Inline[] }
  | { type: 'list'; ordered: boolean; start?: number; tight: boolean; children: ListItem[] }
  | { type: 'code'; lang?: string; value: string }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'table'; align: (Align|null)[]; children: TableRow[] }
  | { type: 'thematicBreak' }
  | { type: 'html'; value: string }          // korunur, çalıştırılmaz
  | { type: 'image'; url: string; alt?: string; title?: string };

type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'emphasis' | 'delete'; children: Inline[] }
  | { type: 'inlineCode'; value: string }
  | { type: 'link'; url: string; title?: string; children: Inline[] }
  | { type: 'break' };
```

Her düğümde kararlılık için `id` (editör içi, serileştirilmez) ve orijinal kaynağa `position` (gidiş-dönüş sadakati için) tutulur.

**mdast şekil uyumluluğunun stratejik değeri:** kullanıcı isterse remark/rehype ekosistemindeki yüzlerce eklentiyi *kendi tarafında* bize bağlayabilir; ama biz onlara bağımlı olmayız. Düşük maliyet, yüksek getiri.

**Neden JSON değil, Markdown kaynak-doğru (source of truth)?** Editor.js'in hatası JSON'u doğru kabul edip md'yi türetmesi — sonuç kayıplı. Bizde doğru kaynak **her zaman Markdown metni**; AST onun bellek içi temsili.

---

### 5.3 KARAR 3 — Ayrıştırıcı (parser) ve serileştirici

**Kendi ayrıştırıcımız.** Gerekçeler:

1. **Ayrıştırma sıcak yolda değil.** Editör AST üzerinde çalışır; ayrıştırma sadece *içe aktarmada* çalışır. Parser ayrı modül olarak **tembel yüklenebilir**, editör bundle'ına girmesi zorunlu değil.
2. Kendi parser'ımız `position` bilgisini ve **orijinal sözdizimi tercihlerini** (`*` mi `_` mi, `-` mi `*` mi, ATX mi setext mi) saklayabilir -> **gidiş-dönüş sadakati.** marked/markdown-it bunu vermez. Bu, İlke #2'nin teknik zorunluluğu.
3. Boyut: CommonMark + GFM alt kümesi için blok + satır içi ayrıştırıcı ≈ 8–12 kB.

**Kapsam:** CommonMark çekirdeği + GFM (tablo, görev listesi, üstü çizili, otomatik link) + YAML frontmatter. CommonMark'ın uç durumları (referanslı linkler, derin iç içe alıntı, HTML blok tipleri 1–7) **spec test seti ile** ölçülür; %100 uyum v1 hedefi değil — *ölçülen ve şeffaf yayımlanan* bir uyum oranı hedeftir.

**Kaçış planı:** parser bir arayüz arkasında (`MarkdownParser`). Kendi parser'ımız beklenenden zorlanırsa `micromark` adaptörü opsiyonel paket olarak takılabilir. Mimari bu kararı geri alınabilir tutuyor.

---

### 5.4 KARAR 4 — Framework bağımsızlığı (birincil kaygı)

Sorun: *"Vue projem var; kütüphane React ile yazılmışsa projeme React de giriyor."*

| Yaklaşım | Nasıl | Artı | Eksi |
|---|---|---|---|
| **1. Vanilla çekirdek + ayrı sarmalayıcı paketler** (önerilen) | `@kalem/editor` sıfır framework; `@kalem/react`, `@kalem/vue` ayrı yayımlanır, framework `peerDependency` | Sıfır sızıntı; her framework idiomatik; en küçük boyut | Her sarmalayıcı ayrı bakım (ama her biri ~60 satır) |
| **2. Web Component (`<md-editor>`)** | Custom Element + Shadow DOM | Tek build her yerde | Vue'da `isCustomElement` yapılandırması; React 19 öncesi prop/event sancısı; Shadow DOM, CSS-değişkeni tabanlı temalarımızla çatışır; SSR zayıf; form entegrasyonu ek iş |
| **3. Sadece imperatif API** | `new Editor(el, opts)` | En basit | React/Vue'da her kullanıcı aynı boilerplate'i yeniden yazar -> benimseme düşer |

> **Öneri: Yaklaşım 1; Yaklaşım 2 ayrı, opsiyonel paket olarak sunulur.**

**Somut kural seti:**
- `@kalem/core`, `@kalem/viewer`, `@kalem/editor` paketlerinde `dependencies` **boş**, `peerDependencies` **boş**.
- Framework yok, JSX yok, sanal DOM yok. Kendi ~40 satırlık `h()` DOM yardımcımız.
- `@kalem/react` -> `peerDependencies: { react: ">=17" }`, ~1 kB. `useSyncExternalStore` ile kontrollü/kontrolsüz bileşen.
- `@kalem/vue` -> `peerDependencies: { vue: "^3" }`, `defineComponent` + `v-model` desteği.
- `@kalem/wc` -> Custom Element (Shadow DOM **opsiyonel, varsayılan kapalı** — tema için Light DOM daha iyi). Angular/Svelte/Astro/vanilla için tek çözüm.
- **CI kapısı:** çekirdek paketlerin bağımlılık ağacını doğrulayan test — `dependencies` boş mu, üretim bundle'ında `react`/`vue` izi var mı.

Bu tasarımda Vue kullanıcısı `npm i @kalem/editor @kalem/vue` kurar; `node_modules`'a React'in adı bile geçmez.

---

### 5.5 KARAR 5 — Paket / modül yapısı

Monorepo (pnpm workspaces), tek `@scope/*` altında çok paket.

```
packages/
  core/        # AST tipleri, parser, serializer, transform, komutlar (saf, DOM'suz, 0 dep)
  viewer/      # AST -> DOM render + AST -> HTML string (SSR). Salt okunur.
  editor/      # Blok motoru, seçim, geçmiş, giriş kuralları, klavye
  ui/          # Balon araç çubuğu, slash menü, drag handle, üst araç çubuğu
  themes/      # CSS değişkeni tabanlı temalar (default / dark / minimal)
  react/  vue/  wc/            # sarmalayıcılar
  plugin-*/    # table, highlight, katex, mermaid, upload, collab, docx-export, find-replace
apps/
  demo/        # Vite vanilla TS playground
  docs/        # dokümantasyon sitesi
examples/
  react-vite/  vue-vite/  nextjs/  nuxt/  svelte/  cdn-vanilla/
```

**Bağımlılık yönü (tek yönlü, döngüsüz):**

```
core  <-  viewer  <-  editor  <-  ui  <-  { react, vue, wc }
                          ^
                          +-- plugin-*
```

`core` hiçbir şeye bağlı değil. `viewer` sadece `core`'a. Bu sıralama, "sadece viewer isteyen" kullanıcının editör kodunu asla indirmemesini **yapısal olarak** garanti eder.

**Alt yol dışa aktarımları (subpath exports)** ile ince taneli import:

```jsonc
"exports": {
  ".":            "./dist/index.js",
  "./parser":     "./dist/parser.js",
  "./serializer": "./dist/serializer.js",
  "./commands/*": "./dist/commands/*.js"
}
```
+ `"sideEffects": false` -> agresif tree-shaking.

**Kullanım katmanları (kullanıcı ne kadar isterse o kadar öder):**

| Katman | Import | Tahmini boyut | Senaryo |
|---|---|---|---|
| L0 | `@kalem/core` | ~10 kB | Sunucuda md işleme, AST dönüşümü |
| L1 | `@kalem/viewer` | ~12 kB | Blog/dokümantasyon render, salt okunur |
| L2 | `@kalem/editor` (başsız) | ~35 kB | Kendi UI'ını yazan geliştirici |
| L3 | `@kalem/editor` + `@kalem/ui` | ~55 kB | **Word benzeri tam deneyim** (hedef) |
| L4 | + eklentiler | ihtiyaca göre, tembel | Kod vurgulama, matematik, diyagram |

---

### 5.6 KARAR 6 — Boyut bütçesi (CI ile zorlanır)

`size-limit` ile her PR'da kontrol; bütçe aşımı = **build kırmızı.**

| Paket | Bütçe (min+gzip) |
|---|---|
| `core` | 14 kB (F6-11 sonrası; önce 12 kB) |
| `viewer` | 14 kB |
| `editor` (core dahil) | 38 kB |
| `editor + ui` | 58 kB |
| `react` / `vue` sarmalayıcı | 1.5 kB |

Hedef rakamlar; ilk gerçek ölçümden sonra revize edilebilir ama **yukarı revizyon açık gerekçe ister.**

---

### 5.7 KARAR 7 — Güvenlik

**Mimari avantaj:** render ham HTML string'den değil, **AST'den DOM API ile** yapılır (`createElement` + `textContent`). XSS yüzeyinin büyük kısmı **yapısal olarak** yok olur — DOMPurify (~9 kB) gerekmez.

Kalan üç yüzey ve önlemi:
1. **Link/görsel URL'leri** -> protokol beyaz listesi (`http`, `https`, `mailto`, `tel`, göreli). `javascript:` ve `data:` (görsel istisnası hariç) engellenir.
2. **Ham HTML düğümleri** (`type: 'html'`) -> **varsayılan olarak escape edilip metin gösterilir.** `allowHtml: true` opt-in; o modda kullanıcının kendi sanitizer'ını takması için `sanitizeHtml` kancası.
3. **Yapıştırma** -> gelen HTML doğrudan DOM'a konmaz; parse edilip AST'ye çevrilir, beyaz listede olmayan her şey atılır.

`SECURITY.md` + sorumlu açıklama süreci v1'de yayımlanır.

---

### 5.8 KARAR 8 — SSR / statik render

`@kalem/viewer` iki API sunar:
- `renderToDOM(ast, element)` — tarayıcı
- `renderToString(ast): string` — **DOM'suz, saf fonksiyon.** Node, Deno, Workers, Next.js RSC, Nuxt/Nitro'da çalışır.

Bu, kütüphaneyi statik site jeneratörleri için de kullanışlı kılar ve **kendi dokümantasyon sitemizi kendi kütüphanemizle render etmemizi** sağlar (dogfooding + en iyi pazarlama).

---

### 5.9 KARAR 9 — Eklenti API'si

Minimal ama yeterli sözleşme; eklentiler sadece bu yüzeye dokunur:

```ts
interface Plugin {
  name: string;
  nodes?: NodeSpec[];                   // yeni blok / satır içi tipi
  commands?: Record<string, Command>;
  keymap?: Record<string, string>;      // 'Mod-b' -> komut adı
  inputRules?: InputRule[];             // yazarken dönüşüm: '## ' -> heading
  toolbar?: ToolbarItem[];              // @kalem/ui'a katkı
  parse?(token, ctx): Node;             // md -> AST
  serialize?(node, ctx): string;        // AST -> md
  view?(node, ctx): NodeView;           // özel DOM davranışı (ör. mermaid)
  onDestroy?(): void;
}
```

Kural: **çekirdekteki her özellik kendi eklenti API'sini kullanarak yazılır.** Tablo, görev listesi, kod bloğu = birinci sınıf eklentiler. Bu, API'nin gerçekten yeterli olduğunu kanıtlar ve kullanıcının çekirdek özellikleri *çıkarabilmesini* sağlar.

---

### 5.10 KARAR 10 — Tema ve stil

- **CSS Custom Properties** tabanlı token sistemi (`--mdx-color-bg`, `--mdx-radius`, `--mdx-font-body`…). Kullanıcı tek değişken bloğuyla markasına uydurur.
- Sınıf ön eki `mdx-`. Tailwind/Bootstrap ile çakışma yok.
- CSS-in-JS **yok** (bağımlılık + runtime maliyeti). Tek `.css` dosyası, opsiyonel import.
- `prefers-color-scheme` ve `[data-theme]` ikisi de desteklenir.
- Shadow DOM varsayılan **kapalı** — kullanıcının fontları ve temaları geçebilsin.

---

## 6. "Word Benzeri" UX — Somut Özellik Tablosu

| Word'deki davranış | Bizdeki karşılığı | Faz |
|---|---|---|
| Metni seç -> araç çubuğu | Balon araç çubuğu (seçimin üstünde belirir) | 3 |
| Üstteki şerit (ribbon) | Opsiyonel sabit üst araç çubuğu | 3 |
| Ctrl+B / Ctrl+I / Ctrl+K | Aynısı | 2 |
| Paragrafı sürükleyip taşı | Blok drag handle ile sürükle-bırak | 3 |
| Stil galerisi ("Başlık 1") | Slash menü + blok tipi açılır listesi | 3 |
| Resmi sürükleyip bırak | Dosya bırakma + yükleme + yer tutucu | 4 |
| Word'den kopyala-yapıştır | HTML -> AST normalizasyonu (Word/GDocs/Excel) | 3 |
| Yazım denetimi | Tarayıcının kendi `spellcheck`'i (bedava, contenteditable) | — |
| Bul & değiştir (Ctrl+H) | Eklenti | 4 |
| Gezinti bölmesi | İçindekiler paneli | 4 |
| Kelime sayacı | Durum çubuğu | 4 |
| Geri al / yinele | Kendi geçmiş yığınımız (işlem tabanlı) | 2 |
| Otomatik kaydet | `onChange` debounce + `plugin-autosave` | 4 |

**Kritik ayrım:** Word kullanıcısı "Enter yeni paragraf, Shift+Enter yeni satır" bekler. Markdown'ın "iki boşluk = satır sonu" kuralı kullanıcıya asla gösterilmez; serileştiricinin iç detayı olur.

**Ayrıca:** Markdown bilen kullanıcı için giriş kuralları da çalışır (`# ` yazınca başlık, `- ` yazınca liste). Segment C bedavaya kazanılır.

---

## 7. Riskler ve Azaltma

| # | Risk | Olasılık | Etki | Azaltma |
|---|---|---|---|---|
| R1 | contenteditable/IME uç durumları tahminden zor | Yüksek | Yüksek | Blok-tabanlı mimari; Faz 1.5'te **IME + mobil spike'ı**, mimari kararı kod yazmadan doğrula |
| R2 | Gidiş-dönüş sadakati bozulur, git diff gürültüsü | Orta | Yüksek | `position` + sözdizimi tercihi saklama; **golden-file testleri** (gerçek md korpusu, `parse->serialize` birebir) |
| R3 | Kapsam kayması (v1 hiç bitmez) | Yüksek | Yüksek | MoSCoW katı; tablo/matematik/collab eklentiye itilir; v1 = Must listesi, nokta |
| R4 | Boyut hedefi kayar | Orta | Orta | CI'da `size-limit` kapısı, gün 1'den itibaren |
| R5 | Tek geliştirici, bakım yükü | Yüksek | Orta | Yüzey alanını küçük tut; sarmalayıcılar minimal; sıkı test |
| R6 | Rakipler aynı boşluğu doldurur | Düşük-Orta | Orta | Farklılaşma "Markdown-native + boyut"; rakiplerin mimarisi bunu ucuza yapamaz |
| R7 | CommonMark uç durum şikayetleri | Orta | Düşük | Uyum oranı şeffaf yayımlanır; `micromark` adaptörü kaçış yolu |
| R8 | Erişilebilirlik borcu sonradan pahalıya patlar | Orta | Orta | A11y Faz 2'den itibaren kabul kriteri; `axe` CI'da |
| R9 | Locale hataları (Türkçe `i/İ`, `ı/I`) sessizce yayılır | Yüksek | Orta | Çıplak `toLowerCase`/`toUpperCase`/`localeCompare` **F0-04 lint kuralıyla yasak**; editör `lang`'i tek kaynak; F6-10'da locale test seti. İngilizce test edilen kod Türkçe'de patlamaz, sadece yanlış sonuç verir — bu yüzden derleme zamanında engellenmeli |

---

## 8. Test Stratejisi

Contenteditable tabanlı bir editörde test opsiyonel değil, **hayati.**

| Katman | Araç | Kapsam |
|---|---|---|
| Birim | Vitest | Parser, serializer, AST transform, komutlar (saf fonksiyonlar -> hızlı) |
| Uyum | CommonMark + GFM spec suite | Ayrıştırıcı doğruluğu, yayımlanan uyum yüzdesi |
| **Gidiş-dönüş** | Özel golden-file koşucusu | `serialize(parse(md)) === md` (mümkün olan her yerde) |
| Property-based | fast-check (dev-only) | Rastgele AST -> serialize -> parse -> eşitlik |
| Tarayıcı / E2E | **Playwright** | Yazma, seçim, kısayol, sürükle-bırak, yapıştırma, IME (CDP composition event) |
| Görsel regresyon | Playwright screenshot | UI bileşenleri, temalar |
| Erişilebilirlik | axe-core (Playwright içinde) | Her demo sayfası |
| Boyut | size-limit | Bütçe kapısı |
| Framework entegrasyonu | `examples/*` build + smoke test | Sarmalayıcıların gerçekten çalıştığı |

**Kritik test yatırımı:** gerçek dünya Markdown korpusu toplamak (CommonMark spec, popüler README'ler, Obsidian vault örnekleri) -> gidiş-dönüş regresyon seti.

---

## 9. Build, Sürümleme, Yayın

| Konu | Karar | Gerekçe |
|---|---|---|
| Paket yöneticisi | **pnpm workspaces** | Hızlı, disk verimli, katı bağımlılık izolasyonu (yanlışlıkla framework sızmasını engeller) |
| Görev koşucu | pnpm scripts (gerekirse Turborepo) | Basit başla |
| Bundler | **tsdown** veya **tsup** | Sıfıra yakın yapılandırma, `.d.ts` üretir, ESM+CJS+IIFE |
| Dil | TypeScript `strict` | Kütüphane için pazarlık konusu değil |
| Lint / Format | **Biome** | Tek bağımlılık (ESLint+Prettier yerine), hızlı |
| Sürümleme | **Changesets** | Monorepo'da doğru semver + otomatik changelog |
| Yayın | GitHub Actions -> npm (provenance ile) | Tedarik zinciri güveni |
| CDN | jsDelivr / unpkg üzerinden IIFE build | `<script>` ile tek satırda kullanım |
| Tarayıcı hedefi | ES2020, son 2 sürüm + Safari 15+ | Polyfill maliyetinden kaçın |
| Node hedefi | 18+ | SSR render için |

---

## 10. Demo ve Dokümantasyon Sitesi

### 10.1 Dokümantasyon aracı seçimi

| Araç | Artı | Eksi | Uygunluk |
|---|---|---|---|
| **Astro Starlight** (önerilen) | Framework-agnostik — vanilla/React/Vue demolarını *aynı sayfada* gömebilir; hızlı ve erişilebilir varsayılanlar; arama (Pagefind) yerleşik; karanlık tema; i18n | Astro öğrenme eğrisi (küçük) | **En uygun** — ürünün "framework-agnostik" iddiasını sitenin kendisi kanıtlar |
| VitePress | Çok hızlı, basit, minimal | Vue tabanlı -> interaktif demolar Vue'ya çekilir, mesajla çelişir | İyi, ikinci sırada |
| Docusaurus | Olgun, versiyonlama/i18n güçlü | React tabanlı ve ağır -> mesajla çelişir | Uygun değil |
| Nextra | Şık | React zorunlu | Uygun değil |

### 10.2 Doküman bilgi mimarisi

```
/                        Landing — canlı editör, "hemen dene", boyut rozeti
/docs/baslangic          Kurulum, 5 satırda ilk editör
/docs/rehber/
   viewer                Sadece görüntüleme
   editor                Düzenleme
   temalar               CSS değişkenleriyle markalama
   eklentiler            Eklenti kurulumu / yazımı
   markdown-uyumu        Desteklenen sözdizimi, uyum oranı
   guvenlik              HTML, sanitizasyon, URL politikası
   erisilebilirlik
/docs/frameworkler/      vanilla · react · vue · svelte · angular · nextjs · nuxt · cdn
/docs/api/               TypeDoc'tan otomatik üretilen referans
/docs/tarifler/          Otomatik kaydet · Görsel yükleme · Salt okunur · Kontrollü bileşen · Sunucuda md -> HTML
/playground              Tam ekran interaktif oyun alanı (durum URL'de paylaşılabilir)
/docs/mimari/            Bu dokümanın halka açık özeti (katkıcı çekmek için)
```

### 10.3 Demo uygulaması

`apps/demo` — Vite + vanilla TS:
- Sol: editör, sağ: canlı Markdown çıktısı (kütüphanenin gücünü anında gösterir)
- Üstte özellik anahtarları (araç çubuğu aç/kapa, salt okunur, tema, eklentiler)
- "Word'den yapıştır" örneği ve hazır doküman yükleyici
- Köşede canlı bundle boyutu rozeti
- `examples/*` her framework için ayrı, minimal, kopyalanabilir

---

## 11. Lisans, Marka, Topluluk

- **Lisans:** MIT (benimseme için en düşük sürtünme). Ticari niyet varsa "open-core": çekirdek MIT, ileri eklentiler (collab, docx-export, AI) ayrı lisans. **Karar v1'den önce verilmeli** — lisans değişimi geriye dönük zordur.
- **İsim:** **Kalem** · `@kalem/*`. Scoped paket olduğu için npm isim çakışma riski yok.
- **Topluluk:** README (İngilizce, GIF'li), CONTRIBUTING, CODE_OF_CONDUCT, issue şablonları. İlk duyuru: Hacker News "Show HN", r/webdev, X, dev.to. **Duyuru öncesi doküman sitesi ve demo hazır olmalı** — ilk izlenim tek seferliktir.

---

## 12. Yol Haritası (özet — detaylı iş listesi ayrı dokümanda)

| Faz | İçerik | Çıktı |
|---|---|---|
| **0. Temel** | Monorepo, build, CI, boyut kapısı, test iskeleti | Boş ama sağlam altyapı |
| **1. Core** | AST, parser, serializer, gidiş-dönüş testleri, `renderToString` | `@kalem/core` yayımlanabilir |
| **1.5 Spike** | contenteditable / IME / mobil doğrulama | **Karar noktası: mimari onayı** |
| **2. Viewer + Başsız Editör** | Render, blok motoru, seçim, geçmiş, kısayollar, giriş kuralları | `@kalem/viewer`, `@kalem/editor` |
| **3. Word Deneyimi** | Balon araç çubuğu, slash menü, sürükle-bırak, yapıştırma normalizasyonu | `@kalem/ui` — **ürünün kalbi** |
| **4. Eklentiler** | Tablo, görsel yükleme, bul-değiştir, TOC, kod vurgulama | Eklenti ekosistemi |
| **5. Sarmalayıcılar** | React, Vue, Web Component + `examples/*` | Framework kanıtı |
| **6. Cila ve Yayın** | A11y, mobil, i18n, doküman sitesi, demo, duyuru | **v1.0** |

Faz 5 teknik olarak Faz 2'den sonra herhangi bir anda yapılabilir; erken yapılması API'yi framework'lere karşı erken sınadığı için **Faz 3 ile paralel** önerilir.

---

## 13. Kararlar — Alındı

| # | Konu | Karar | Gerekçe / Sonucu |
|---|---|---|---|
| 1 | **Editör motoru** | **Seçenek C — kendi blok-tabanlı motorumuz** | Boyut + özgünlük + Word UX hedeflerini aynı anda karşılayan tek yol. Risk, F1.5 spike'ı ile kod yazmadan doğrulanır. |
| 2 | **Marka / scope** | **Kalem** · `@kalem/*` | Kısa, telaffuz edilebilir, hikayesi var, scoped paket. |
| 3 | **Lisans** | **MIT** *(F0-08'de nihai onay)* | Benimseme için en düşük sürtünme. Open-core'a geçiş her zaman mümkün; tersi değil. |
| 4 | **Dokümantasyon** | **Astro Starlight** | Vanilla/React/Vue demolarını aynı sayfada gömebilmesi, ürünün framework-agnostik iddiasını sitenin kendisiyle kanıtlar. |
| 5 | **Tablo** | **v1 dışı** -> `@kalem/plugin-table` (v1.1) | Blok motorunun en pahalı parçası. **Ancak parser/serializer tabloyu v1'de de kayıpsız korur** — kullanıcının dosyasını bozmamak zorunlu. |
| 6 | **Mobil** | **v1'de "çalışır ama optimize değil"** | Dokunmatik sürükle-bırak ve mobil araç çubuğu v1.1'e. v1'de sadece *bozuk olmadığı* doğrulanır (F6-09). |
| 7 | **Yayın stratejisi** | **Sessiz geliştirme, tam üründe çık** | Tek ve güçlü duyuru. Bedeli aşağıda. |

### 13.1 Sessiz geliştirmenin bedeli ve telafisi

Bu kararın tek gerçek riski var: **v1.0'a kadar dış geri bildirim yok.** Yanlış bir varsayım aylarca fark edilmeyebilir. Plana üç telafi mekanizması koyuldu:

1. **F1.5 doğrulama spike'ı** — mimari riski 7. haftada, 6. ayda değil, yakalar. Çıkışı yazılı bir git/dön kararıdır.
2. **F5-05 dogfooding** — Kalem, v1.0'dan önce en az 2 hafta boyunca kendi gerçek projelerinden birinde günlük kullanılır. Sessiz stratejide elde edilebilecek tek gerçek kullanım verisi budur.
3. **F3 çıkış kriteri** — yazılım bilmeyen gerçek bir kişiye izlettirilir. Hedef kitle A'nın tek doğrulama noktası.

Ayrıca duyuru tek atış olduğu için **Faz 6 pazarlık konusu değildir**: doküman sitesi, demo ve README v1.0'ın parçasıdır, sonraya bırakılamaz.
