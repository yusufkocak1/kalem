# Kalem Asistanı — Analiz Öncelikli Ajan, Merkezî Ayarlar ve Uygulama Araçları

> Tarih: 2026-11-10 · Kapsam: `apps/desktop` · Durum: **plan — kararlar alındı (bkz. §0)**, geliştirme başlamadı
>
> Hedef: Asistanın 1. işi kod yazmak değil; **yazılım analiz dokümanı üretmek,
> var olan analizi okuyup anlamak, sorunlu yerleri bulup düzeltmek ve
> geliştirme için prompt hazırlamak**. Bunu yaparken uygulamanın içinde
> olduğunu bilmeli, uygulamanın özelliklerini (ayarlar, paneller, Jira,
> Confluence, belge, dosyalar) **izin isteyerek** kullanabilmeli ve bunu
> **az token harcayarak** — her şeyi bağlama yüklemeden, gerektiğinde
> bakarak — yapmalı.

---

## 0. Karar Özeti (istişare sonucu)

| # | Konu | Karar |
|---|---|---|
| 1 | Ayarlar menüsü | **Ayarlar… yalnız Dosya menüsünde** (Ctrl+,). Görünüm menüsündeki "Ayarlar" girişi kalkar; ama menülerdeki **hızlı erişim ayarları** (tema, dil, otomatik kaydet, yazım denetimi, tam genişlik, sayfa düzeni…) **olduğu gibi kalır**. Hepsi aynı ayar şemasından beslenir, iki yerden değiştirmek tutarlıdır. |
| 2 | İzin seçenekleri | Ayar/görünüm (`ui`) değişikliklerinde **"Her zaman sor" / "Bu oturumda izin ver" / "Her zaman izin ver"** üçü de var. Dış sistemler (`external`) için "her zaman izin ver" **yok**. |
| 3 | Asistan paneli | **Taşınabilir**: diğer paneller gibi sol / sağ / alt dock'a ya da ayrı pencereye. |
| 4 | Analiz şablonu | **Sabit şablon yok.** Kurumun şablonu kullanılır; şablonlar **özelleştirilebilir**, **birden fazla şablon** oluşturulabilir; yanında bir tane **"best practice" örnek şablon** gelir (silinemez ama kopyalanıp uyarlanabilir). |
| 5 | Copilot | **İkisi de**: Copilot CLI MCP destekliyorsa MCP, desteklemiyorsa ` ```kalem-tool ` blok yolu. **Otomatik algılama**, biri çalışmazsa diğerine düşer. |
| 6 | Jira/Confluence'a yazma | **İlk sürümde var**, ama **onaysız hiçbir online işlem yapılamaz** (her işlem için önizlemeli onay kartı; kalıcı izin seçeneği yok). |
| 7 | Kod modu | **Gerekli.** Okuma + `propose_edit` diff kartları; yazma her zaman onaylı, Bash/komut çalıştırma yok. |
| 8 | İnceleme bulguları | **Oturum boyunca** belgede işaretlenir; kullanıcı isterse **tek tıkla Markdown'a eklenir**. |

---

## 0.1 Uygulama Durumu (Masaüstü 2.10.0)

| Faz | Durum | Not |
|---|---|---|
| A — Ayar şeması, Dosya → Ayarlar | ✅ | `shared/settings-schema.ts`, kategoriler + arama + varsayılana dön |
| B — Araç kayıt defteri, izin kapısı, MCP, Copilot | ✅ | `main/assistant-tools.ts`, `main/assistant-permissions.ts`; MCP her soruya özel çalıştırma; Copilot MCP/blok otomatik |
| C — Uygulama araçları, token diyeti | ✅ | Kısa kimlik + `kalem_help`; uzun belge ana hattıyla; token sayacı |
| D — Şablonlar, modlar, inceleme, prompt, kod | ✅ | `shared/templates.ts`, `shared/analysis-lint.ts`, inceleme kartı, oturumluk vurgu |
| E — Jira/Confluence'a yazma | ✅ | Her seferinde onay; story seçimi kartta |
| F — Agent UI | ✅ (kısmen) | Panel sol/sağ/alt, `@` bölüm çipleri, tümünü geri al, `/compact`. **Ayrı pencere** ve `assistant-pane.ts`'nin tamamen bölünmesi yapılmadı: yeni parçalar ayrı modüllerde (`assistant-agent.ts`, `assistant-review.ts`, `document-marks.ts`) |

Testler: birim + e2e (masaüstü e2e'ye `e2e/agent.spec.ts` eklendi: onay kartları, Copilot blok/MCP düşmesi, inceleme, şablonlar, Jira'ya onaysız istek gitmemesi, panel yeri ve `@`).

## 1. Bugünkü Durum (kodda ne var)

| Alan | Bugün | Dosya |
|---|---|---|
| Sağlayıcılar | Claude Code CLI, Copilot CLI, Anthropic, OpenAI uyumlu (Gemini, OpenRouter, Ollama, LM Studio…) | `shared/providers.ts`, `main/llm.ts`, `main/cli.ts` |
| Sistem promptu | Her soruda tamamı gider: kimlik + Markdown kuralları + **Kalem diyagram şeması** + **menü rehberi** (`capabilities`) + **actions şeması** + Confluence + Jira talimatları ≈ **15–17 bin karakter (~4–5 bin token)** | `shared/claude.ts`, `shared/actions.ts`, `shared/confluence-tool.ts`, `shared/jira-tool.ts` |
| Araçlar (API) | `list_files`, `search`, `read_file`, `propose_edit`, `confluence_search`, `confluence_read_page`, `jira_get_issue`, `jira_search` | `main/workspace-tools.ts`, `main/assistant-confluence.ts`, `main/assistant-jira.ts` |
| MCP (Claude Code) | Yalnız Confluence + Jira **okuma** araçları; stdio köprü → `127.0.0.1` HTTP + token | `main/assistant-mcp.ts` |
| Uygulamayı kullanma | `kalem-actions` bloğu: belgeye `replace/insert/document` + 25 komut (`save`, `export-docx`…). Kullanıcı karttaki **Uygula** ile çalıştırır | `shared/actions.ts` |
| Ayarlar | `Settings` tipi (~30 alan), `SettingsStore` (JSON, doğrulamalı). Ayar penceresi **Görünüm → Ayarlar (Ctrl+,)**: paneller, bağlantılar, genel. Tema/dil/sayfa vb. menülerde ayrıca | `shared/bridge.ts`, `main/settings.ts`, `renderer/settings-dialog.ts`, `main/menu.ts` |
| Paneller | Outline / Files / Confluence / Jira → sol, sağ, alt dock ya da gizli (`movePane`, `revealPane`) | `shared/panes.ts`, `renderer/docks.ts` |
| Asistan UI | Sağ kenarda sabit panel; sohbet listesi, model seçici, `/` komutları, kaynak çipleri, adım listesi, öneri kartları | `renderer/assistant-pane.ts` (2058 satır) |

**Güçlü yanlar:** çalışma alanı araçları zaten "tembel" (özet gider, model gerekince okur),
Anthropic prompt cache var, belge değişmediyse yeniden gönderilmiyor, yazma işlemleri
zaten kullanıcı onaylı kartlarla yapılıyor, MCP köprüsü güvenli ve genişletilebilir.

**Eksikler:**
1. Asistan uygulamayı **yalnız 25 komutla** ve **metin bloğu** üzerinden kullanabiliyor; ayar okuyamıyor/değiştiremiyor, panel taşıyamıyor, Jira/Confluence'a yazamıyor.
2. Uygulama bilgisinin tamamı (diyagram şeması, menü rehberi) **her soruda** bağlamda — kimlik için gereksiz, ihtiyaç anında bakılabilir.
3. Araçlar üç yerde üç biçimde tanımlı (API tool, MCP listesi, Copilot blok talimatı) — yeni araç eklemek pahalı.
4. Analiz işine özel hiçbir şey yok: şablon, inceleme (lint), izlenebilirlik, prompt üretimi yok.
5. Ayarlar dağınık (menüler + diyalog + asistan ayarları ayrı pencere), tek bir şema yok; asistan ve arama için "makine okunur" ayar tanımı yok.

---

## 2. Hedef Mimari — Tek Bakışta

```
                ┌──────────────────────────────────────────────┐
                │           Kalem Araç Kayıt Defteri            │  shared/tools/registry.ts
                │  (tek tanım: ad, kategori, şema, izin, run)   │
                └───────┬───────────────┬───────────────┬──────┘
          API tool-call │      MCP (stdio→HTTP)        │  Copilot (MCP ya da blok)
                ┌───────▼───┐   ┌───────▼────────┐   ┌──▼─────────┐
                │ Anthropic │   │  Claude Code   │   │ Copilot CLI│
                │ OpenAI…   │   │  mcp__kalem__* │   │            │
                └───────────┘   └────────────────┘   └────────────┘
                        │ her çağrı main süreçte toplanır
                ┌───────▼──────────────────────────────────────┐
                │  İzin Kapısı (Permission Gate)                │  main/assistant-permissions.ts
                │  okuma → serbest · UI/ayar → onay kartı       │
                │  belge → diff kartı · dış sistem → her zaman  │
                └───────┬──────────────────────────────────────┘
                        │ pencereye RPC (renderer'da çalışan araçlar)
                ┌───────▼──────────────────────────────────────┐
                │  Renderer: belge, seçim, imleç, paneller,     │
                │  ayar uygulama, komut çalıştırma, onay kartı  │
                └──────────────────────────────────────────────┘
```

Üç temel fikir:

1. **Tek araç kayıt defteri** — bir araç bir kez yazılır, üç taşımada (API, MCP, Copilot) otomatik sunulur.
2. **İzin kapısı uygulamada** — Claude Code'un kendi izin sistemine değil Kalem'e güvenilir: MCP çağrısı Kalem'e gelir, Kalem kullanıcıya kartı gösterir, onay gelene kadar çağrı bekler. Böylece **tüm sağlayıcılarda aynı izin deneyimi** olur.
3. **Tembel bilgi (progressive disclosure)** — sistem promptunda yalnız kısa bir "kimlik kartı" kalır; diyagram şeması, menü rehberi, ayar listesi, şablonlar **araçla istenince** gelir.

---

## 3. Token Ekonomisi — "Kendini Tanısın ama Şişmesin"

### 3.1 Kimlik kartı (her soruda, hedef ≤ 400 token)

```text
Sen Kalem masaüstü uygulamasının içindeki asistansın. Kullanıcı Markdown
belgeleri (çoğunlukla yazılım analiz dokümanları) yazar; Jira ve Confluence'a
bağlı olabilir. Önceliğin: analiz yazmak, incelemek, düzeltmek, geliştirme
promptu hazırlamak; kod yazmak nadirdir.
Bağlam: <app-state> (etkin belge adı, başlık sayısı, seçim var/yok, bağlı
sistemler, mod). Belgenin tamamı sende değil: document_outline / document_read.
Uygulamayı kullanmak için kalem_* araçların var. Ne yapabileceğini bilmiyorsan
kalem_help(konu) ya da kalem_tools(kategori) çağır; tahmin etme.
Değişiklik yapan her araç kullanıcıdan onay ister; reddedilirse ısrar etme.
Kullanıcının dilinde yanıt ver.
```

`<app-state>` küçük ve yapılandırılmış (~100 token):

```xml
<app-state lang="tr" theme="dark" doc="Siparis-Analizi.md" headings="14"
  selection="false" workspace="2 klasör" jira="bağlı:PRJ" confluence="bağlı"
  mode="analysis-review" />
```

### 3.2 İstendiğinde gelen bilgi ("rehberler")

Bugün sistem promptundaki büyük bölümler `kalem_help(topic)` aracına taşınır:

| Konu (`topic`) | Bugün nerede | Yaklaşık boyut |
|---|---|---|
| `diagram` — Kalem diyagram JSON şeması | `SYSTEM_PROMPT` | ~2.5k karakter |
| `markdown` — Kalem'in gösterdiği Markdown/Mermaid/KaTeX | `SYSTEM_PROMPT` | ~1k |
| `menus` — menü ve kısayol rehberi | `capabilities()` | ~4.4k |
| `actions` — belge değişiklik biçimi (blok yolu için) | `ACTIONS_PROMPT` | ~3k |
| `confluence-search` — arama ipuçları | `confluenceInstructions` | ~1.5k |
| `analysis-template`, `review-checklist`, `prompt-recipe` | yeni | — |
| `settings` — ayar şeması (filtreli, bkz. §5) | yeni | — |

**Ölçüt:** basit bir soru ("şu paragrafı kısalt") için giden ilk mesaj bugünkünün **~%20'si**
olmalı. Diyagram isteyen soru `kalem_help("diagram")` ile +1 araç turu öder — kabul edilebilir.

> Not: Copilot CLI gibi araç çağıramayan yol için `help` bloğu (` ```kalem-help ` isteği)
> ya da mevcut tam prompt "eski mod" olarak kalır. Araç çağıramayan API modelleri için de
> mevcut geri dönüş (tam prompt) korunur.

### 3.3 Araç listesinin kendisi de token yer

- **Moda göre araç seti:** `Sor` modunda yalnız okuma; `Analiz Yaz` modunda belge + şablon + Jira okuma; `Ayarlar` vb. kategoriler yalnız `kalem_tools(kategori)` çağrılınca "etkinleşir" (API'de bir sonraki turda tanımlara eklenir; MCP'de `notifications/tools/list_changed` ile).
- **Kısa açıklamalar:** her araç açıklaması tek cümle; ayrıntı `kalem_help`'te.
- **Meta araç:** `kalem_tools(query?)` → eşleşen araçların adı + tek satır açıklaması. Model tam şemayı yalnız kullanacağı araç için görür.

### 3.4 Belgeyi bütün göndermemek

Bugün "Belgeyi paylaş" açıksa tüm Markdown gider. Yeni araçlar:

- `document_outline()` → başlık ağacı + her bölümün kimliği ve satır/karakter sayısı.
- `document_read(section_id | heading | line_range)` → yalnız istenen bölüm.
- `document_search(query)` → eşleşen satırlar ve bölümleri.
- `document_selection()` → seçili metin ve konumu.

Küçük belgelerde (örn. < 6k karakter) eskisi gibi tamamı gönderilebilir; eşik ayarlanabilir.

### 3.5 Diğer tasarruflar

- **Sohbet sıkıştırma:** API sohbetlerinde 40 mesaj sınırı yerine, belirli token eşiğinde eski turların özeti (`/compact` komutu ve otomatik).
- **Okunanları hatırlama** (var) → bölüm kimliğiyle genişletilir: "bu bölümü zaten okudun, değişmedi" işareti.
- **Token sayacı:** her yanıtın altında giriş/çıkış/önbellek tokenı (Anthropic `usage`, Claude Code `result.usage`, OpenAI `usage`). Kullanıcı neyin pahalı olduğunu görür.
- **Ucuz model ile ön işler:** başlık önerme, sohbet adı, sınıflandırma gibi işler için ayarlanabilir "yardımcı model" (örn. haiku sınıfı).

---

## 4. Tek Araç Kayıt Defteri ve MCP'nin Geliştirilmesi

### 4.1 Araç tanımı

```ts
// shared/tools/types.ts
export type ToolRisk =
  | "read"        // okuma: onaysız
  | "ui"          // görünüm/ayar: onay kartı, "bu oturumda hep izin ver" seçeneği
  | "document"    // belgeyi değiştirir: diff kartı, geri alınabilir
  | "workspace"   // diskteki dosya: diff kartı (bugünkü propose_edit)
  | "external";   // Jira/Confluence'a yazar: her seferinde açık onay

export interface KalemTool<I = unknown> {
  readonly name: string;              // "settings_set"
  readonly category: ToolCategory;    // "settings" | "panes" | "document" | "jira" | ...
  readonly summary: string;           // tek cümle (listede görünen)
  readonly schema: JsonSchema;        // giriş şeması
  readonly risk: ToolRisk;
  readonly where: "main" | "renderer";// nerede çalışır
  available(ctx: ToolContext): boolean;          // örn. Jira bağlı mı
  describe?(input: I, t: Strings): ApprovalCard; // onay kartında ne yazacak
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}
```

- `main/assistant-tools.ts`: kayıt defteri + `runTool(name, input, ctx)` → izin kapısı → çalıştır.
- `main/assistant-mcp.ts`: `MCP_TOOLS` sabiti yerine kayıt defterinden üretilir; `tools/list` mod/bağlantıya göre filtreli; `isError` ve ilerleme bildirimleri korunur.
- `main/assistant-ipc.ts` içindeki üç ayrı dal (`isJiraTool`, `isConfluenceTool`, workspace) tek `runTool` çağrısına iner.
- **Renderer araçları:** main, aracı çalıştıran pencereye `assistant-tool-call` (id, ad, giriş) gönderir; renderer çalıştırıp `assistant-tool-result` ile yanıtlar. Zaman aşımı + pencere kapandı durumları ele alınır.

### 4.2 Claude Code için MCP ayrıntıları

- Bugün `--allowedTools` ile tüm `mcp__kalem__*` araçları sormadan çalışıyor. Bu kalır, çünkü **onay Kalem'in içinde** veriliyor: MCP çağrısı HTTP'de bekler, kullanıcı karta tıklayınca yanıt döner. Claude Code'un kendi izin istemi (headless `-p` modunda zaten gösterilemez) devre dışı kalır.
- Uzun bekleyen onaylar için MCP isteğinin zaman aşımı: `MCP_TOOL_TIMEOUT` ortam değişkeni ile yükseltilir; kullanıcı yanıt vermezse "kullanıcı yanıt vermedi" sonucu döner.
- MCP **resources** (opsiyonel): `kalem://help/diagram`, `kalem://settings/schema`, `kalem://document/outline`. Claude Code kaynakları `@` ile okuyabildiği için rehberler hem araç hem kaynak olarak sunulabilir.
- MCP **prompts** (opsiyonel): `analysis-review`, `prepare-dev-prompt` gibi hazır iş akışları Claude Code'un `/mcp__kalem__…` komutlarıyla da çağrılabilir.
- `DENIED_TOOLS` (Bash/Edit/Write) aynen kalır — "nadiren kod" kararıyla uyumlu. Kod modu açıkça seçilirse (bkz. §6.1) yazma yine yalnız `propose_edit` kartıyla olur.

### 4.3 Copilot CLI

**Karar: iki yol birlikte, otomatik seçim.**

- **MCP yolu:** kurulu Copilot CLI ek MCP yapılandırmasını destekliyorsa aynı `mcp.json` (Kalem araçları) verilir; araçlar gerçek araç olarak çağrılır.
- **Blok yolu:** desteklemiyorsa bugünkü yöntem (` ```kalem-jira `) genelleştirilir: ` ```kalem-tool ` bloğu içinde `{ "tool": "settings_set", "input": {…} }`; Kalem çalıştırır, sonucu `<tool-results>` ile aynı oturuma geri yollar (bugünkü tur döngüsü).
- **Algılama:** CLI bulunduğunda `--help` çıktısında MCP seçeneği aranır (bugün model listesi de `--help`'ten okunuyor: `modelsFromHelp`). Sonuç sürüm numarasıyla önbelleğe alınır.
- **Düşme (fallback):** MCP ile başlatma hata verirse ya da ilk turda MCP sunucusu hiç bağlanmazsa o oturum blok yoluna geçer ve bu sürüm için "MCP yok" olarak işaretlenir. Ayarlar → Asistan'da "Copilot araç yolu: Otomatik / MCP / Blok" seçimi de bulunur.
- Aynı mekanizma Claude Code için de yedek olarak kullanılabilir (MCP sunucusu başlatılamazsa blok yolu).

### 4.4 Önerilen araç seti

**Uygulama / kendini tanıma**

| Araç | Risk | Açıklama |
|---|---|---|
| `kalem_help(topic)` | read | Rehber metinleri (§3.2) |
| `kalem_tools(query?)` | read | Araç keşfi |
| `app_state()` | read | Açık sekmeler, etkin belge, docklar, bağlantılar, tema, dil |

**Ayarlar ve görünüm** (bkz. §5)

| Araç | Risk | Örnek |
|---|---|---|
| `settings_find(query)` | read | "koyu" → `theme` ayarı, olası değerleri, şimdiki değeri |
| `settings_get(keys[])` | read | |
| `settings_set(changes[], reason)` | ui | `[{key:"theme", value:"dark"}]` |
| `pane_move(pane, place)` | ui | "Jira'yı alta taşı" → `movePane(settings,"jira","bottom")` |
| `pane_show(pane)` / `dock_toggle(dock)` | ui | |
| `app_command(command)` | ui/document | Bugünkü `ASSISTANT_COMMANDS` + tamamı `COMMANDS` (risk tabloda) |

**Belge**

| Araç | Risk |
|---|---|
| `document_outline`, `document_read`, `document_search`, `document_selection` | read |
| `document_edit(edits[], reason)` — replace/insert (bugünkü actions) | document |
| `document_insert_diagram(diagram, at)` | document |
| `document_annotate(findings[])` — inceleme bulgularını kenar notu olarak işaretle (§6.3) | ui |
| `tabs_list`, `tab_open(path)`, `document_new(title, template?)` | read / ui |

**Çalışma alanı** — mevcut `list_files`, `search`, `read_file`, `propose_edit` (kayıt defterine taşınır).

**Jira** — mevcut okuma araçlarına ek:

| Araç | Risk |
|---|---|
| `jira_create_issue(project, type, summary, description, parent?)` | external |
| `jira_add_comment(key, body)` | external |
| `jira_link_issues`, `jira_transition` (dialogda zaten var) | external |
| `jira_log_work` (Tempo dahil, zaten var) | external |

**Confluence** — mevcut okumaya ek: `confluence_publish(page_id | parent, title, markdown)` (external), `confluence_comment`.

**Analiz** (§6)

| Araç | Risk |
|---|---|
| `analysis_templates()` / `analysis_template(id)` | read |
| `analysis_lint(scope?)` — kural tabanlı ön tarama, sıfır LLM tokenı | read |
| `analysis_save_prompt(title, body)` → `.kalem/prompts/` | workspace |
| `plan_update(steps[])` — ajanın görev listesini UI'da güncellemesi | read (yalnız UI) |

---

## 5. Merkezî Ayarlar (Dosya → Ayarlar) ve Asistanın Ayar Değiştirmesi

### 5.1 Ayar şeması (tek kaynak)

```ts
// shared/settings-schema.ts
export interface SettingDef<K extends keyof Settings = keyof Settings> {
  readonly key: K;
  readonly category: "appearance" | "editor" | "panes" | "assistant"
                   | "connections" | "page" | "files" | "updates" | "advanced";
  readonly type: "boolean" | "enum" | "number" | "string" | "custom";
  readonly values?: readonly Settings[K][];   // enum
  readonly range?: { min: number; max: number; step?: number };
  readonly label: keyof Strings;              // i18n
  readonly help?: keyof Strings;
  readonly keywords?: readonly string[];      // "koyu", "dark", "gece" → theme
  readonly assistant: "read" | "write" | "hidden"; // asistan erişimi
  readonly restart?: boolean;                 // yeniden başlatma ister mi
}
```

- `parseStoredState` doğrulaması şemadan beslenir (bugün elle yazılı; şema + özel ayrıştırıcılar).
- **Gizli/korunan alanlar** `assistant: "hidden"`: `claudePath`, `copilotPath` (çalıştırılabilir yol — asistan değiştirirse komut çalıştırma riski), API anahtarları (zaten ayrı depoda, `AssistantStore`), favori listeleri ham veri olarak. Bağlantı/oturum açma **asla** asistanla yapılmaz.
- `panePlaces` gibi bileşik ayarlar için `custom` tip + özel araç (`pane_move`).

### 5.2 Ayarlar penceresi

- **Dosya → Ayarlar… (Ctrl+,)** — macOS'ta ayrıca uygulama menüsünde "Settings…". Görünüm menüsündeki "Ayarlar" girişi kaldırılır; **menülerdeki hızlı erişim ayarları kalır** (Görünüm → Tema, Dil, Tam genişlik, Yazım denetimi, Otomatik kaydet; Dosya → Sayfa Düzeni; Yardım → Güncellemeleri otomatik denetle; şeritteki düğmeler). Hepsi aynı `changeSettings` + şema doğrulamasından geçer.
- Sol kategori listesi + sağda form (IntelliJ ayar penceresi gibi), üstte **arama kutusu** (etiket + `keywords` + açıklama; Türkçe büyük/küçük harf duyarsız — projede zaten Türkçe katlama var).
- Kategoriler: **Görünüm** (tema, dil, yakınlaştırma, tam genişlik), **Düzenleyici** (otomatik kaydet, yazım denetimi), **Paneller** (bugünkü yerleşim ızgarası + boyutlar), **Asistan** (bugünkü `assistant-settings.ts` diyaloğu buraya taşınır: sağlayıcı, model, belge paylaşımı, mod varsayılanı, izin tercihleri, token bütçesi), **Bağlantılar** (Confluence, Jira), **Sayfa düzeni** (kâğıt, kenar boşluğu, sayfa numarası), **Dosyalar ve Git** (git otomatik fetch), **Güncellemeler ve Sistem** (güncelleme, tepsi).
- Form elemanları şemadan üretilir; özel olanlar (paneller, bağlantılar, asistan sağlayıcısı) kendi bileşenleriyle.
- "Varsayılana dön" (kategori bazında), "Ayarları dışa/içe aktar" (anahtarlar hariç JSON).
- Bir ayarın asistan tarafından son değiştirildiği bilgisi küçük bir rozetle gösterilir ("✦ asistan değiştirdi · geri al").

### 5.3 Akış: "koyu temaya geç"

1. Model `settings_find("koyu tema")` → `{key:"theme", current:"system", values:["system","light","dark"]}` (≈60 token).
2. Model `settings_set([{key:"theme", value:"dark"}], "Kullanıcı koyu tema istedi")`.
3. İzin kapısı (`ui` riski) → asistan panelinde kart:
   > **Ayar değişikliği** · Tema: *Sistem* → **Koyu**  [Uygula] [Reddet] ☐ Bu oturumda görünüm ayarları için sorma
4. Uygula → `changeSettings` (main) → tüm pencerelere yayılır; araç sonucu `{"applied":true}`.
5. Kart "Uygulandı · Geri al" durumuna geçer; değişiklik **Asistan Değişiklik Günlüğü**'ne yazılır.

"Jira tabını alta taşı" → `pane_move("jira","bottom")` → kart: *Jira paneli: Sol → **Alt*** → `movePane` yaması.

### 5.4 İzin modeli

| Risk | Varsayılan | Kullanıcı seçenekleri (Ayarlar → Asistan → İzinler) |
|---|---|---|
| read | Sormaz | — |
| ui (ayar, panel, görünüm komutu) | Kartla sorar | "Her zaman sor" / "Bu oturumda izin ver" / **"Her zaman izin ver"** (kart üzerinden de seçilebilir; Ayarlar → Asistan → İzinler'den geri alınır) |
| document | Diff kartı | "Her zaman sor" / "Küçük düzeltmeleri otomatik uygula (geri alınabilir)" |
| workspace (disk, Kod modu) | Diff kartı | Her zaman sor (değiştirilemez) |
| external (Jira/Confluence yazma) | **Her seferinde** açık onay, gönderilecek içerik önizlemeli | Değiştirilemez — **onaysız online işlem yok** |

İzin tercihleri kategori bazında tutulur (ör. "görünüm ayarları", "panel yerleşimi", "sayfa düzeni"),
böylece "temayı her zaman değiştirebilirsin" demek "bağlantı ayarlarını değiştir" anlamına gelmez.
"Her zaman izin ver" ile yapılan değişiklikler de günlüğe yazılır ve kartta "Geri al" ile görünür.

Ek kurallar:
- Jira/Confluence'tan okunan içerik **güvenilmez veri** sayılır (prompt injection). Bu içerik geldikten sonra aynı turda istenen `external` işlemlerin kartında uyarı gösterilir.
- Tek turda en çok N değişiklik (örn. 10); fazlası tek bir "toplu değişiklik" kartında listelenir.
- Her uygulanan işlem geri alınabilir: ayarlar için önceki değer saklanır; belge için editörün undo yığını + bir "checkpoint".

---

## 6. Analiz Öncelikli Özellikler

### 6.1 Modlar (asistan panelinin üstünde seçici)

| Mod | Ne yapar | Varsayılan araçlar |
|---|---|---|
| **Sor** | Genel soru-cevap, uygulama yardımı | okuma + `kalem_help` |
| **Analiz Yaz** | Şablondan ya da kaynaklardan (kod klasörü, Jira epic, Confluence sayfası, toplantı notu) analiz dokümanı üretir, bölüm bölüm | belge, şablon, workspace okuma, Jira/Confluence okuma |
| **Analizi İncele** | Var olan analizi okur, sorunları bulgular olarak çıkarır, düzeltme önerir | belge okuma, `analysis_lint`, `document_annotate`, `document_edit` |
| **Prompt Hazırla** | Analizden (veya seçili bölümden) geliştirme promptu üretir | belge okuma, workspace okuma, `analysis_save_prompt` |
| **Kod** | Kod okuma, açıklama, analiz ↔ kod karşılaştırması, değişiklik önerisi (`propose_edit` diff kartları; birden çok dosyaya toplu öneri). Yazma her zaman onaylı; Bash/komut çalıştırma yok | workspace araçları, belge okuma |
| **Uygulama** | Ayarlar/paneller/komutlar | settings, panes, app_command |

Her mod = kısa bir mod talimatı (≤ 200 token) + araç alt kümesi. Mod, `<app-state mode=…>` ile bildirilir.

### 6.2 Analiz Yaz

- **Şablonlar — kararla:** sabit bir analiz şablonu dayatılmaz; **kurumun şablonu** esas alınır.
  - **Birden fazla şablon:** kullanıcı istediği kadar şablon oluşturur, kopyalar, yeniden adlandırır, siler. "Varsayılan şablon" seçilebilir.
  - **Nerede durur:** kişisel şablonlar uygulama veri klasöründe (`templates/`), ekip şablonları çalışma alanında `.kalem/templates/*.md` (Git ile paylaşılır). Liste ikisini birlikte, kaynağını belirterek gösterir.
  - **Biçim:** şablon sıradan bir Kalem Markdown belgesidir, Kalem'in kendi editöründe düzenlenir. Başında küçük bir ön bilgi (front matter) olur — Markdown çıktısı temiz kalır:
    ```markdown
    ---
    kalem-template: Kurum Analiz Şablonu v3
    required: [Amaç, Kapsam, Fonksiyonel Gereksinimler, Kabul Kriterleri, Açık Sorular]
    ids: { FR: "FR-", BR: "BR-", NFR: "NFR-" }
    ---
    # {{başlık}}
    ## Amaç
    <!-- yönerge: İşin neden yapıldığını 2-3 cümleyle yazın. -->
    ```
    `<!-- yönerge: … -->` yorumları hem kullanıcıya hem asistana bölümün nasıl doldurulacağını söyler; belge oluşturulurken korunur ya da isteğe göre silinir.
  - **İçe aktarma:** kurumun mevcut şablonu `.docx` (Kalem zaten Word okuyor), Confluence sayfası ya da `.md` olarak içe aktarılıp şablona çevrilir; asistan başlıklardan `required` listesini ve yönergeleri önerebilir (onaylı).
  - **Best practice şablonu:** yerleşik tek bir örnek gelir — Amaç ve Kapsam, Paydaşlar, Terimler Sözlüğü, Mevcut/İstenen Durum, İş Kuralları (`BR-xx`), Fonksiyonel Gereksinimler (`FR-xx` + Given/When/Then kabul kriterleri), NFR, Veri Modeli, Akışlar, Ekranlar, Entegrasyonlar, Hata Senaryoları, Yetkilendirme, Veri Taşıma, Riskler, Açık Sorular, Kapsam Dışı, İzlenebilirlik. Salt okunurdur; "Kopyala ve uyarla" ile kişisel şablona dönüşür.
  - **İnceleme şablona bağlıdır:** `analysis_lint` zorunlu bölümleri ve kimlik öneklerini belgenin şablonundan alır (belgede `kalem-template` bilgisi yoksa kullanıcıya şablon seçtirilir ya da varsayılan kullanılır).
  - Menü: `Dosya → Yeni → Şablondan…` ve `Dosya → Ayarlar → Şablonlar` (şablon yöneticisi).
- **Bölüm bölüm üretim:** asistan önce `plan_update` ile bölüm planını gösterir, kullanıcı onaylayınca her bölümü ayrı yazar ve `document_edit` ile ekler — tek dev yanıt yerine kontrollü ilerleme, yarıda kesilebilir.
- **Kaynaktan analiz:** "PRJ-123 epic'inden analiz çıkar" → Jira epic + alt işler + bağlı Confluence sayfaları okunur; kaynaklar dokümanın sonunda listelenir.

### 6.3 Analizi İncele (çekirdek özellik)

İki katman:

1. **Kural tabanlı ön tarama — `analysis_lint` (LLM yok, sıfır token):**
   - Muğlak ifadeler: "hızlı", "kullanıcı dostu", "uygun şekilde", "vb.", "gerekirse", "mümkün olduğunca", "TBD/TODO/??"
   - Kabul kriteri olmayan `FR-xx`, numarası tekrarlanan/atlanan gereksinimler
   - Sözlükte tanımlı olmayan ama sık geçen terimler; aynı kavramın farklı adları
   - Boş/çok kısa bölümler, şablondaki zorunlu bölümlerin eksikliği
   - Kırık iç bağlantılar, Jira anahtarı geçen ama erişilemeyen kayıtlar
   - Hata senaryosu olmayan akış adımları (diyagramda "decision" sonrası tek dal vb.)
2. **LLM incelemesi:** lint çıktısı + bölüm bölüm okuma ile mantıksal çelişki, eksik senaryo, ölçülemeyen NFR, iş kuralı ↔ akış uyumsuzluğu, güvenlik/KVKK eksikleri, kodla uyumsuzluk (çalışma alanı varsa "bu FR kodda nerede?").

**Bulgu formatı** (yapılandırılmış, araç sonucu olarak):

```json
{ "id": "F-07", "severity": "high", "kind": "ambiguity",
  "section": "4.2 Sipariş İptali", "quote": "iptal işlemi hızlı yapılmalı",
  "problem": "Ölçülebilir değil", "suggestion": "İptal 2 sn içinde onaylanmalı (p95)",
  "question": "Kargoya verilmiş siparişte iptal mümkün mü?" }
```

**UI:** asistan panelinde "İnceleme" sekmesi — bulgular önem derecesine göre gruplu; her bulguda
[Belgede göster] [Düzelt] (→ `document_edit` diff kartı) [Açık Sorulara ekle] [Yoksay].
`document_annotate` ile belgede ilgili metin **oturum boyunca** vurgulanır (editör dekorasyonu, Markdown'a yazılmaz; belge kapanınca ya da yeniden incelenince yenilenir).
**Tek tıkla Markdown'a ekle:** bulgu kartında ve vurgunun üzerindeki menüde iki seçenek:
- **Açık Sorular'a ekle** — şablondaki "Açık Sorular" bölümüne madde olarak (`- [ ] F-07 — Kargoya verilmiş siparişte iptal mümkün mü? (§4.2)`).
- **Yerine not ekle** — ilgili paragrafın altına Kalem'in bilgi paneli biçiminde bir not (`> 📝 **İnceleme F-07:** …`), Confluence'a da panel olarak gider.
Toplu seçenek: "Seçili bulguların hepsini ekle". Eklenenler belge değişikliği olarak geri alınabilir.
"Geliştirmeye hazırlık" puanı: zorunlu bölüm, kabul kriteri oranı, açık soru sayısı.

### 6.4 Prompt Hazırla

Analizden (tüm belge ya da seçili FR'ler) kodlama ajanı için prompt üretir. Tarif (`kalem_help("prompt-recipe")`):

- **Bağlam:** amaç, ilgili iş kuralları, terimler (yalnız ilgili olanlar).
- **Kapsam:** yapılacaklar / yapılmayacaklar.
- **Kod tabanı:** çalışma alanından bulunan ilgili dosya yolları (asistan `search` ile bulur), mevcut kalıplar.
- **Kabul kriterleri** → test senaryoları listesi.
- **Kısıtlar:** NFR'ler, güvenlik, geriye uyumluluk.
- **Çıktı beklentisi:** adım adım plan, önce test, PR açıklaması biçimi.
- Hedef seçici: Claude Code / Copilot / Junie / genel; uzunluk bütçesi.

Çıktı ayrı bir sekmede açılır; [Kopyala] [.kalem/prompts/ altına kaydet] [Jira kaydına yorum olarak ekle].
İsteğe bağlı: "Promptu incele" — üretilen promptun da lint'ten geçmesi (belirsiz fiil, eksik kabul kriteri).

### 6.5 İzlenebilirlik ve Jira

- FR/BR kimliklerinden **izlenebilirlik tablosu** (FR ↔ Jira ↔ test ↔ Confluence) üretme.
- "FR'lerden story oluştur" → her FR için `jira_create_issue` önizlemesi tek toplu kartta; onaylananlar oluşturulur ve anahtarları belgeye geri yazılır.
- Jira kaydındaki değişiklikle analiz arasındaki farkı gösterme ("PRJ-45'in kabul kriterleri analizden farklı").

---

## 7. Agent UI — IntelliJ'den Esinlenip Kalem'e Uyarlama

IntelliJ'in AI Assistant / Junie ajan arayüzündeki iyi fikirler ve Kalem karşılığı:

| IntelliJ fikri | Kalem uyarlaması |
|---|---|
| Ajanın **plan / görev listesi**, adımlar ilerledikçe işaretlenir | Panelin üstünde katlanır "Plan" kartı; `plan_update` aracı ile güncellenir. Analiz yazarken bölümler = adımlar |
| **Araç çağrısı zaman çizelgesi** (okudu, aradı, düzenledi) | Bugünkü "Çalışma alanına bakıldı (3)" listesi genelleştirilir: her araç ikonlu satır, tıklayınca girdi/çıktı özeti |
| **Değişiklik önizleme / diff**, tek tek kabul-red | Belge değişikliklerinde blok bazlı diff (bugün `lineDiff` var), "Tümünü uygula / Seçileni uygula" |
| **Bağlam çipleri** ve `@` ile ekleme | `@belge`, `@seçim`, `@bölüm:4.2`, `@dosya`, `@jira:PRJ-12`, `@confluence:…` — yazarken öneri listesi (bugünkü `/` menüsü altyapısı) |
| **Modlar** (Chat / Edit / Agent) | §6.1 modları |
| **Checkpoint / geri al** | Ajan çalışmaya başlamadan belge ve ayar anlık görüntüsü; "Bu çalışmayı geri al" |
| **Onay istemleri** (komut çalıştırma vb.) | İzin kapısı kartları (§5.4) |
| Ayrı **araç penceresi**, istenen yere taşınabilir | **Karar: taşınabilir.** `TOOL_PANES`'e `assistant` eklenir; sol/sağ/alt dock ya da ayrı pencere. Bugünkü `assistant`/`assistantWidth` ayarları yeni yerleşime taşınır (eski ayar dosyası bozulmadan okunur); `pane_move("assistant", …)` ile asistan kendi yerini de değiştirebilir |

Ek olarak Kalem'e özel:
- **İnceleme sekmesi** (bulgular), **Prompt sekmesi** (üretilen promptlar), **Günlük sekmesi** (asistanın uyguladığı tüm değişiklikler + geri al).
- **Token/maliyet göstergesi** ve bağlam doluluk çubuğu.
- Panel sohbeti **belgeye bağlı** olabilir: bir analiz belgesi açılınca o belgenin son sohbeti önerilir.

`renderer/assistant-pane.ts` 2000+ satır; bu iş için bölünmesi önerilir:
`assistant/pane.ts` (iskelet), `assistant/composer.ts` (giriş, `@`, `/`), `assistant/timeline.ts`
(mesaj + araç adımları), `assistant/approvals.ts` (izin kartları), `assistant/review.ts`,
`assistant/plan.ts`, `assistant/prompts.ts`.

---

## 8. Yol Haritası (Fazlar)

Her faz kendi başına değer üretir ve ayrı PR olur. Boyut: S (≤1 gün), M (2–3 gün), L (1 hafta).
Kararlar (§0) gereği Jira/Confluence'a yazma ve Kod modu **ilk sürüm kapsamındadır**.

### Faz A — Ayar şeması ve Dosya → Ayarlar *(ilk iş; her şey buna dayanıyor)*

> **Durum: tamamlandı** — `shared/settings-schema.ts`, yeni `renderer/settings-dialog.ts`, Dosya → Ayarlar; birim testleri ve e2e (masaüstü e2e 91/91) yeşil.

| # | İş | Boyut | Dosyalar |
|---|---|---|---|
| A1 | `shared/settings-schema.ts`: tüm `Settings` alanları için tanım, i18n anahtarları, `keywords`, `assistant` erişimi | M | yeni + `i18n.ts` |
| A2 | `parseStoredState`'in şemayı kullanması (davranış aynı, testler korunur) | S | `main/settings.ts`, `settings.test.ts` |
| A3 | Ayarlar penceresinin kategori + arama + şemadan form olarak yeniden yazılması; asistan bağlantı ayarlarının içine taşınması | L | `renderer/settings-dialog.ts`, `assistant-settings.ts`, `style.css` |
| A4 | Menü: **Ayarlar… yalnız Dosya menüsünde** (Ctrl+,; macOS uygulama menüsünde de), Görünüm'deki giriş kalkar; hızlı erişim ayarları menülerde kalır | S | `main/menu.ts` |
| A5 | e2e: arama, kategori, menüden ve pencereden değişikliğin tutarlılığı, pencerelere yayılma | M | `e2e/app.spec.ts` |

### Faz B — Araç kayıt defteri + izin kapısı

| # | İş | Boyut |
|---|---|---|
| B1 | `KalemTool` tipi, kayıt defteri; mevcut 8 aracın taşınması (davranış aynı) | M |
| B2 | MCP sunucusunun kayıt defterinden beslenmesi, `tools/list` filtreleme, `list_changed` | M |
| B3 | Main↔renderer araç RPC'si (`assistant-tool-call/result`) | M |
| B4 | İzin kapısı + onay kartı + "sor / bu oturum / her zaman" (kategori bazlı) + Ayarlar → Asistan → İzinler + değişiklik günlüğü | L |
| B5 | Copilot: MCP algılama + `kalem-tool` blok yolu + otomatik düşme | M |
| B6 | Testler: izin reddi, zaman aşımı, pencere kapanması, MCP'de onay bekleme, Copilot düşme senaryosu (fake CLI'lar genişletilir) | M |

### Faz C — Uygulamayı kullanma + token diyeti *("koyu temaya geç", "Jira'yı alta taşı" burada çalışır)*

| # | İş | Boyut |
|---|---|---|
| C1 | `settings_find/get/set`, `pane_move/show`, `dock_toggle`, `app_command`, `app_state` | M |
| C2 | Kimlik kartı + `<app-state>`; `kalem_help` rehberlerinin bugünkü prompttan ayrılması; `kalem_tools` | M |
| C3 | `document_outline/read/search/selection`, `document_edit` (actions bloğunun araç hâli; blok yolu araçsız modeller için kalır) | L |
| C4 | Token sayacı (usage okuma, yanıt altında gösterim) ve önce/sonra ölçümü | S |

### Faz D — Şablonlar ve analiz

| # | İş | Boyut |
|---|---|---|
| D1 | Şablon yöneticisi: çoklu şablon (kişisel + `.kalem/templates`), oluştur/kopyala/sil/varsayılan, front matter, best practice örneği | L |
| D2 | Şablon içe aktarma (.docx / Confluence / .md) ve `Dosya → Yeni → Şablondan…` | M |
| D3 | Mod seçici (Sor, Analiz Yaz, Analizi İncele, Prompt Hazırla, Kod, Uygulama) + mod talimatları + araç setleri | M |
| D4 | `analysis_lint` (saf, `shared/analysis-lint.ts`, şablona bağlı kurallar, TR/EN muğlak ifade listeleri, kapsamlı birim testi) | M |
| D5 | İnceleme sekmesi, bulgu kartları, oturumluk vurgular, **tek tıkla Markdown'a ekle** (Açık Sorular / yerine not) | L |
| D6 | Prompt Hazırla akışı + Prompt sekmesi + `.kalem/prompts` | M |
| D7 | Plan kartı (`plan_update`), bölüm bölüm analiz yazımı | M |
| D8 | Kod modu: çok dosyalı `propose_edit` önerileri, analiz ↔ kod karşılaştırması | M |

### Faz E — Jira/Confluence'a yazma *(ilk sürümde; hepsi onaylı)*

| # | İş | Boyut |
|---|---|---|
| E1 | `jira_create_issue/add_comment/link/transition/log_work` araçları (`external`, her seferinde önizlemeli onay) | M |
| E2 | FR → story toplu oluşturma (tek kartta liste, tek tek seçilebilir), anahtarların belgeye yazılması | M |
| E3 | İzlenebilirlik tablosu üretimi | S |
| E4 | `confluence_publish`, `confluence_comment` (önizlemeli) | M |
| E5 | e2e: onay verilmeden hiçbir istek siteye gitmez (sahte Jira/Confluence sunucusunda istek sayımı) | S |

### Faz F — Agent UI

| # | İş | Boyut |
|---|---|---|
| F1 | `assistant-pane.ts`'nin modüllere bölünmesi | M |
| F2 | **Asistan panelinin dock sistemine alınması** (sol/sağ/alt/ayrı pencere, eski ayarların taşınması) | M |
| F3 | `@` bağlam çipleri | M |
| F4 | Checkpoint / çalışmayı geri al | M |
| F5 | Sohbet sıkıştırma (`/compact` + otomatik) | M |

**Sıra:** A → B → C → D (D1–D5 önce) → E → F. F1 (panel bölme), B4 ve D5'ten önce yapılırsa
UI işleri kolaylaşır; bu yüzden F1 Faz B'nin başına çekilebilir.

---

## 9. Başarı Ölçütleri

- "Koyu temaya geç", "Jira panelini alta taşı", "otomatik kaydetmeyi aç", "sayfa yatay olsun" gibi 30 komutluk bir test setinde: doğru araç, tek onay, ≤ 3 araç turu.
- Basit sorularda ilk istek boyutu bugüne göre **≥ %70 küçük**; diyagram/menü sorularında doğru rehberin çağrılması.
- 3 örnek analiz dokümanında (biri bilerek hatalı) incelemenin bilinen sorunların ≥ %80'ini bulması.
- Hiçbir `external` işlemin onaysız çalışmaması (e2e ile zorlanır); gizli ayarların araç çıktısında hiç görünmemesi (birim testi).

---

## 10. Kalan Küçük Sorular

1. Kişisel şablonlar ile çalışma alanındaki `.kalem/templates` aynı adda olursa hangisi öne geçsin? (Öneri: çalışma alanı — ekip standardı.)
2. "Yerine not ekle" ile eklenen inceleme notları Confluence'a yayınlanırken de gitsin mi, yoksa yayın öncesi uyarı mı verilsin? (Öneri: uyarı.)
