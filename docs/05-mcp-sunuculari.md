# Asistan modlarında MCP sunucuları — kullanım kılavuzu

Bu kılavuz, Kalem Masaüstü'nde asistanın bir modunu (Kod, Sor, Analiz Yaz…
ya da kendi oluşturduğunuz bir mod) dış sistemlere **MCP sunucularıyla**
bağlamayı anlatır: veritabanınız, GitHub, Fortify, Graylog, Sentry ve
diğerleri.

Kısaca: bir moda bir MCP sunucusu eklersiniz, sunucunun **ne için**
olduğunu bir iki cümleyle yazarsınız; asistan o moddayken bu sunucunun
araçlarını gerektiğinde **kendiliğinden** kullanır. Örneğin Kod modunda
kod yazarken yeni bir i18n anahtarı oluşturursa, siz istemeden anahtarı
veritabanına da ekler.

---

## 1. Ne gerekir?

| Gereken | Neden |
|---|---|
| Asistan bağlantısı olarak **Claude Code** ya da **GitHub Copilot CLI** | MCP sunucularını bu iki program çalıştırır. API hizmetleri (Anthropic API, OpenAI vb.) MCP sunucusu kullanmaz; o bağlantılarda bu ayarlar yok sayılır. Copilot CLI'ın `--additional-mcp-config` seçeneğini destekleyen bir sürümü olmalı. |
| **Node.js** (`npx` ile çalışan sunucular için) | DBHub, Context7, Playwright, Sentry, Filesystem, Memory. |
| **uv** (`uvx` ile çalışan sunucular için) | Git ve Fetch. Kurulum: <https://docs.astral.sh/uv/> |
| Sunucunun kendi gereksinimleri | Örneğin Fortify için `fcli`, Graylog için Graylog 7.0 veya sonrası, GitHub için bir token. |

---

## 2. Bir moda MCP sunucusu eklemek

1. **Dosya → Ayarlar → Asistan Modları** sayfasını açın. Asistan panelindeki
   mod seçicinin en altındaki **Modları özelleştir…** de aynı yere gider.
2. Sunucuyu ekleyeceğiniz modun sekmesine tıklayın, örneğin **Kod**.
3. Sayfayı **MCP sunucuları** bölümüne kadar aşağı kaydırın.
4. İki yolunuz var:
   - **Hazır sunucular**'ı açıp bir karta tıklayın. Sunucu, yaygın
     kullanıldığı ayarlarla ve "ne için" metniyle dolu olarak eklenir.
     Size kalan, köşeli parantezli yerleri (`<GITHUB_TOKEN>`, `<path>`,
     `<folder>`, `<graylog-host>` …) kendi değerlerinizle değiştirmek.
   - Ya da **MCP sunucusu ekle** ile boş bir kart açıp her şeyi kendiniz
     doldurun.
5. Kartın solundaki anahtarla sunucuyu istediğiniz zaman kapatıp
   açabilirsiniz; kapalı sunucu modele hiç verilmez.
6. Ayarlar her değişiklikte hemen kaydedilir. **Tamam** pencereyi kapatır.

Sayfanın en altındaki **Asistana söylenen** bölümünü açarak modelin bu modda
ne talimat aldığını görebilirsiniz. Eklediğiniz sunucular orada, her biri
"ne için" metniyle listelenir.

### Kartın alanları

| Alan | Ne yazılır |
|---|---|
| **Ad** | Sunucunun adı; araçlar modelde `mcp__<ad>__<araç>` diye görünür. Harf, rakam, `_` ve `-`. Aynı modda iki sunucu aynı adı alamaz, `kalem` adı ayrılmıştır. |
| **Bağlantı** | **Program (stdio):** bu bilgisayarda çalışan bir komut. **Adres (HTTP):** ağda çalışan bir sunucu. |
| **Komut** (stdio) | Çalıştırılacak program: `npx`, `uvx`, `fcli`, `docker`… |
| **Argümanlar** (stdio) | Her satıra **bir** argüman. Boşluk içeren bir değer de tek satırda kalır. |
| **Ortam değişkenleri** (stdio) | Her satıra `ANAHTAR=değer`. Token'lar genelde buraya yazılır. |
| **Adres** (HTTP) | `https://…/mcp` gibi tam adres. |
| **Başlıklar** (HTTP) | Her satıra `Ad: değer`, örneğin `Authorization: Bearer …`. |
| **Kullanabileceği araçlar** | Virgülle ayrılmış araç adları. **Boş bırakılırsa sunucunun bütün araçları açılır.** Veri değiştirebilen sunucularda burayı mutlaka doldurun. |
| **Ne için (asistana söylenir)** | Sunucunun ne olduğu ve **ne zaman** kullanılacağı. Bir sonraki bölüme bakın. |

---

## 3. "Ne için" metni nasıl yazılır?

Bu metin modele aynen gider ve modelin sunucuyu **kendi kararıyla**
kullanmasını sağlar. Kalem metnin başına şu talimatı ekler: *"İş, bir
sunucunun amacına uyduğunda araçlarını kendiliğinden kullan; sorulmasını
bekleme ve ne yaptığını söyle."*

İyi bir "ne için" metni üç şey söyler:

1. **Ne olduğu:** "Projenin i18n veritabanı."
2. **Ne zaman kullanılacağı:** "Kodda yeni bir i18n anahtarı eklediğinde…"
3. **Nasıl kullanılacağı:** "…add_i18n_key ile tr ve en metinleriyle ekle,
   eklediğin anahtarları söyle."

| Zayıf | İyi |
|---|---|
| `Veritabanı` | `Uygulamanın parametre tablosu. Kullanıcı bir parametrenin değerini sorduğunda get_parameter'ı parametre koduyla çağır; 1 "açık", 0 "kapalı" demektir; süreler saniyedir. Kayıt dönmezse tahmin etme, "bulunamadı" de.` |
| `Loglar` | `Uygulamanın Graylog logları. Kullanıcı bir hatadan ya da yavaşlıktan bahsederse, nedeni tahmin etmeden önce önce dar bir zaman aralığında logları ara.` |

İpuçları:

- **Araç adını metinde geçirin** (`get_parameter`, `add_i18n_key`). Model hangi
  aracı çağıracağını daha kolay bulur.
- **Değerlerin anlamını yazın.** Tablo yapısını anlatmanıza gerek yok; "bu
  değer gelirse şöyle yorumla" demeniz yeterli.
- **Ne yapmaması gerektiğini de yazın:** "Veritabanı, tablo ya da SQL
  hakkında bilgi verme", "tahmin yürütme" gibi.
- Metin Türkçe ya da İngilizce olabilir; hazır sunucularınki İngilizce gelir,
  dilediğiniz gibi değiştirebilirsiniz.

---

## 4. Sunucu hangi modda çalışır?

Bir sunucu **yalnızca eklendiği modda** kullanılır. Asistan **Otomatik**
moddayken her soru için bir mod seçer; sunucu, o soru için seçilen modda
varsa kullanılır.

Bu yüzden:

- "Bu parametrenin değeri ne?" gibi bir soru Otomatik modda genellikle
  **Sor** moduna düşer. Parametre sorularını da istiyorsanız DBHub'ı
  **hem Sor hem Kod** moduna ekleyin, ya da soruyu sormadan önce modu elle
  seçin.
- Kod yazdırırken **Kod** modunu seçin (ya da Otomatik'in seçmesine
  bırakın); i18n eklemesi orada çalışır.
- Kendi modunuzu (**Yeni mod**) yalnızca bu iş için oluşturup sunucuyu ona
  da ekleyebilirsiniz; kendi modlarınızda Kalem araçlarını da
  kısıtlayabilirsiniz.

---

## 5. Örnek: tek DBHub sunucusuyla parametre sorgusu ve i18n ekleme

[DBHub](https://github.com/bytebase/dbhub) PostgreSQL, MySQL, SQL Server,
MariaDB ve SQLite'a bağlanan bir MCP sunucusudur. Burada önemli olan,
DBHub'a **serbest SQL yazdırmamak** ve yalnızca sizin önceden yazdığınız
iki sorguyu araç olarak açmaktır.

### 5.1 Veritabanını hazırlayın

Asistanın göreceği her şeyi bir görünümle sınırlayın ve ona özel bir
kullanıcı açın (PostgreSQL örneği):

```sql
-- Asistanın görebileceği kolonlar
CREATE VIEW v_parametre AS
  SELECT kod, deger, aciklama FROM parametre_tablosu;

-- Yalnızca gereken yetkiler
CREATE USER kalem_asistan WITH PASSWORD 'güçlü-bir-şifre';
GRANT SELECT ON v_parametre TO kalem_asistan;
GRANT SELECT, INSERT ON i18n TO kalem_asistan;   -- UPDATE / DELETE yok
```

Asıl güvenlik bu katmandadır: model bir şekilde başka bir araca ulaşsa bile
bu kullanıcıyla göreceği ve yapabileceği şey bundan ibarettir.

### 5.2 `dbhub.toml` dosyasını yazın

Dosyayı **reponun dışında** tutun (içinde şifre var), örneğin
`C:\Users\<siz>\.kalem\dbhub.toml` ya da `~/.kalem/dbhub.toml`.

```toml
[[sources]]
id  = "ana"
dsn = "postgres://kalem_asistan:güçlü-bir-şifre@db-host:5432/uygulama?sslmode=require"

# 1) Parametre sorgusu — salt okunur
[[tools]]
name        = "get_parameter"
source      = "ana"
description = "Bir parametrenin değerini ve açıklamasını getirir. Parametre kodunu verin."
statement   = "SELECT kod, deger, aciklama FROM v_parametre WHERE kod = $1"
readonly    = true
max_rows    = 5

[[tools.parameters]]
name        = "kod"
type        = "string"
description = "Parametre kodu, örn. MAX_LOGIN_DENEME"

# 2) i18n anahtarı ekleme — varsa dokunmaz
[[tools]]
name        = "add_i18n_key"
source      = "ana"
description = "Yeni bir i18n anahtarını Türkçe ve İngilizce metinleriyle ekler; anahtar zaten varsa değiştirmez."
statement   = "INSERT INTO i18n (key, tr, en) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING"

[[tools.parameters]]
name        = "key"
type        = "string"
description = "Anahtar, örn. login.error.wrongPassword"

[[tools.parameters]]
name        = "tr"
type        = "string"
description = "Türkçe metin"

[[tools.parameters]]
name        = "en"
type        = "string"
description = "İngilizce metin"
```

Notlar:

- Sorgular `$1, $2…` ile parametrelidir: model SQL yazmaz, yalnızca değer
  verir; SQL enjeksiyonu olmaz. MySQL / SQL Server'da yer tutucular `?` /
  `@p1` biçimindedir.
- `ON CONFLICT … DO NOTHING` PostgreSQL sözdizimidir; MySQL'de
  `INSERT IGNORE`, SQL Server'da `IF NOT EXISTS (…) INSERT …` kullanın.
- DBHub'ın TOML anahtar adları sürümler arasında değişebilir; kurduğunuz
  sürümün README'sini kontrol edin.

### 5.3 Kalem'de ekleyin

1. **Ayarlar → Asistan Modları → Kod → MCP sunucuları → Hazır sunucular →
   DBHub**.
2. Kart `db` adıyla gelir. **Argümanlar**'daki son satırı (`<path>/dbhub.toml`)
   dosyanızın tam yoluyla değiştirin.
3. **Kullanabileceği araçlar**: `get_parameter, add_i18n_key` — böyle kalsın.
   DBHub'ın genel SQL aracı (`execute_sql`) bu listede olmadığı için model
   onu kullanamaz.
4. **Ne için** metnini kendi kurallarınıza göre düzenleyin (anahtar
   adlandırması, değerlerin anlamı…).
5. Parametre sorularını Sor modunda da istiyorsanız aynı kartı **Sor**
   moduna da ekleyin.

### 5.4 Kullanım

- **Kod modunda:** *"Giriş ekranına 'şifre yanlış' hata mesajı ekle."*
  Asistan kodu yazarken `login.error.wrongPassword` gibi bir anahtar
  oluşturur, `mcp__db__add_i18n_key` aracını çağırır (panelde bir adım
  olarak görünür) ve cevabında hangi anahtarları eklediğini söyler.
- **Sor modunda:** *"MAX_LOGIN_DENEME kaç?"* Asistan `get_parameter`'ı
  çağırır ve değeri sizin "ne için" metninizdeki kurallara göre yorumlar:
  *"MAX_LOGIN_DENEME: 5 — art arda en çok 5 hatalı giriş."*

---

## 6. Örnek: Fortify (güvenlik bulguları)

OpenText'in komut satırı aracı **fcli**, MCP sunucusu olarak çalışabilir.

1. `fcli`'ı kurun ve **bir kez** oturum açın (model bu komutu kendisi
   çalıştıramaz):
   ```bash
   fcli ssc session login --url https://ssc.sirket.local --user <kullanıcı>
   ```
2. **Hazır sunucular → Fortify (fcli)**. Kart şu ayarlarla gelir:
   - Komut: `fcli`
   - Argümanlar: `util`, `mcp-server`, `start`, `--module=ssc`
3. Fortify on Demand kullanıyorsanız `--module=fod` yazın.
4. Yeni fcli sürümlerinde komut değişti: argümanları `ai`, `assist`, `mcp`,
   `start`, `stdio` yapın. Hangisinin geçerli olduğunu `fcli --version` ve
   `fcli --help` ile görebilirsiniz.

Kullanım: *"Bu sınıftaki açık güvenlik bulguları neler, düzeltir misin?"*

---

## 7. Örnek: Graylog (loglar)

Graylog **7.0 ve sonrası** MCP sunucusunu kendi içinde sunar
(`/api/mcp`). Daha eski bir Graylog'unuz varsa topluluğun yazdığı npm
paketleri vardır (örneğin `mcp-server-graylog`); resmî değildir, kaynağını
inceledikten sonra kullanın.

1. Graylog'da **salt okunur** bir kullanıcı açın ve ona bir **API token**
   oluşturun. Yönetici token'ı kullanmayın: model, token'ın sahibinin
   yetkileriyle çalışır.
2. Token'ı Basic başlığı için base64'e çevirin:
   ```bash
   # Linux / macOS
   echo -n "TOKEN_DEĞERİ:token" | base64
   ```
   ```powershell
   # Windows PowerShell
   [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("TOKEN_DEĞERİ:token"))
   ```
3. **Hazır sunucular → Graylog**. Kartta:
   - Adres: `http://<graylog-host>:9000/api/mcp` → kendi adresiniz.
   - Başlıklar: `Authorization: Basic <base64 of API_TOKEN:token>` →
     `Authorization: Basic` ve ardından 2. adımdaki çıktı.
4. 401 hatası alırsanız base64'ü `kullanıcı:token` biçimiyle deneyin;
   kaynaklarda iki biçim de geçiyor.

Kullanım: *"Dün 14:00 civarında ödeme servisinde hata var mı?"*

---

## 8. Diğer hazır sunucular

| Sunucu | Bağlantı | Doldurmanız gereken | Örnek istek |
|---|---|---|---|
| **GitHub** | HTTP | `<GITHUB_TOKEN>` (salt okunur bir token). `X-MCP-Readonly: true` başlığı yazma araçlarını kapatır. | "#142 numaralı issue'da ne isteniyor?" |
| **Git** | uvx | `<repository folder>`: deponun klasörü. Yalnızca okuma araçları açık. | "Bu dosya son hangi commit'te değişti, neden?" |
| **Filesystem** | npx | `<folder>`: okunacak klasör (birden fazla klasör için her satıra bir klasör). | "Ortak klasördeki API sözleşmesine göre yaz." |
| **Context7** | npx | — | "Spring Boot 3'te bunu nasıl yaparım?" (güncel dokümana bakar) |
| **Playwright** | npx | — (ilk çalışmada tarayıcı indirebilir) | "Giriş sayfasını aç, hata mesajı görünüyor mu?" |
| **Sentry** | npx | `SENTRY_ACCESS_TOKEN`; kendi sunucunuz varsa `SENTRY_HOST` | "Son 24 saatteki en sık hata ne?" |
| **Fetch** | uvx | — | "Şu adresteki sürüm notlarını özetle." |
| **Memory** | npx | `MEMORY_FILE_PATH`: hafızanın tutulacağı dosya | "Bundan sonra servis adlarını hep kebab-case yazacağız, hatırla." |
| **Figma** | HTTP | Figma masaüstü uygulamasında **Dev Mode MCP sunucusu** açık olmalı | "Figma'da seçili ekranı bileşen olarak yaz." |

Listede olmayan bir sunucuyu **MCP sunucusu ekle** ile elle ekleyebilirsiniz.
Sunucunun belgesindeki Claude Code / Claude Desktop yapılandırması genelde
şu biçimdedir; alanlar karttakilerle bire bir eşleşir:

```json
{ "command": "npx", "args": ["-y", "paket-adı"], "env": { "API_KEY": "…" } }
```

---

## 9. Güvenlik

- **İzin verilen araçlar sorulmadan çalışır.** Claude Code, karttaki
  "Kullanabileceği araçlar" listesindeki araçları her seferinde onay
  istemeden çağırır. Bu yüzden:
  - Veri değiştirebilen sunucularda araç listesini **mutlaka** doldurun.
  - Yazma işlemlerini dar tutun (yalnızca `INSERT … ON CONFLICT DO NOTHING`
    gibi); `UPDATE` / `DELETE` açan bir araç tanımlamayın.
  - Veritabanı ve servis kullanıcılarına yalnızca gereken yetkileri verin.
- **Token'lar ayar dosyasında düz metin durur** (uygulama verisindeki
  `settings.json`). Salt okunur, kısa ömürlü token'lar kullanın;
  `dbhub.toml` gibi şifre içeren dosyaları repoya koymayın.
- **Asistan bu ayarları değiştiremez.** Bir MCP sunucusu bilgisayarınızda
  program çalıştırabildiği için mod ayarlarındaki sunucuları yalnızca siz
  Ayarlar penceresinden ekleyip değiştirebilirsiniz. Asistan mod ayarlarını
  okuduğunda sunucuların yalnızca **adını, araçlarını ve "ne için"
  metnini** görür; komut, argüman, ortam değişkeni, adres ve başlıklar
  (dolayısıyla token'lar) ona gösterilmez.
- Topluluk sunucularını (resmî olmayan npm / PyPI paketleri) kullanmadan
  önce kaynağına bakın; bilgisayarınızda sizin yetkilerinizle çalışırlar.

---

## 10. Sorun giderme

| Belirti | Olası neden ve çözüm |
|---|---|
| Asistan sunucuyu hiç kullanmıyor | Sunucu o soru için seçilen modda değil (4. bölüm). Kartın anahtarı kapalı. "Ne için" metni ne zaman kullanılacağını söylemiyor; araç adını metinde geçirin. **Asistana söylenen** önizlemesinde sunucunun göründüğünü kontrol edin. |
| Sunucu var ama araç çağrılamıyor | "Kullanabileceği araçlar"daki ad sunucunun gerçek araç adıyla aynı değil (büyük/küçük harf dahil). Emin değilseniz alanı geçici olarak boşaltın, asistana *"db sunucusunun araçlarını listele"* deyin, sonra doğru adları yazın. |
| Program başlamıyor (stdio) | Komut PATH'te yok: terminalde `npx --version`, `uvx --version`, `fcli --version` çalışıyor mu bakın. Gerekirse komuta tam yol yazın. **Windows'ta** `npx` ile çalışan sunucular için Komut'a `cmd`, Argümanlar'ın başına `/c` ve `npx` yazın (Claude Code'un Windows'ta beklediği biçim). |
| `<path>` / `<token>` hatası | Köşeli parantezli yer tutucular değiştirilmemiş. |
| HTTP 401 / 403 | Token yanlış ya da süresi dolmuş; Graylog'da base64 biçimi (7. bölüm). |
| Copilot'ta sunucu yok | Copilot CLI sürümü `--additional-mcp-config` desteklemiyor; güncelleyin. Kalem bu durumda kendi araçlarını yanıt içindeki bloklarla kullanır ama sizin sunucularınızı kullanamaz. |
| API bağlantısında çalışmıyor | Beklenen durum: MCP sunucuları yalnızca Claude Code ve Copilot CLI ile çalışır. |

---

## 11. Hızlı kontrol listesi

- [ ] Asistan bağlantısı Claude Code ya da Copilot CLI.
- [ ] Sunucu doğru moda (gerekirse birden fazla moda) eklendi, anahtarı açık.
- [ ] Köşeli parantezli yerler dolduruldu.
- [ ] "Kullanabileceği araçlar" dolu (veri değiştiren sunucularda şart).
- [ ] "Ne için" metni ne olduğunu, ne zaman ve nasıl kullanılacağını söylüyor.
- [ ] Veritabanı / servis kullanıcısı yalnızca gereken yetkilere sahip.
- [ ] **Asistana söylenen** önizlemesinde sunucu görünüyor.
- [ ] Bir deneme sorusuyla panelde `mcp__<ad>__<araç>` adımı görüldü.
