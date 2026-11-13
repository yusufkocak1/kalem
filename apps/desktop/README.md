# Kalem Masaüstü

Electron ile yazılmış, **Word rahatlığında** bir Markdown editörü. `.md`
belgeleriyle çalışır; diğer metin dosyalarını (`.txt`, `.java`, `.json`…)
Markdown'a çevirmeden kendi sekmesinde, **düz metin** olarak açar. Düzenleme
motoru bu depodaki Kalem (`@kalem-editor/*`) paketleridir.

```bash
pnpm install
pnpm build                          # önce Kalem paketleri (depo kökünde)
pnpm --filter kalem-desktop dev     # geliştirme kipi
```

| Komut (`pnpm --filter kalem-desktop …`) | Ne yapar |
|---|---|
| `dev` | Vite sunucusu + Electron; arayüz kaydedince yenilenir |
| `build` | Tip denetimi, arayüz (Vite) ve ana süreç (esbuild) derlemesi → `dist/` |
| `start` | Derlenmiş uygulamayı açar |
| `e2e` | Derler ve uygulamayı gerçekten açan uçtan uca testleri koşar |
| `package:dir` | Kurulumsuz uygulama klasörü → `release/win-unpacked/` |
| `package` | Kurulum paketi (Windows: NSIS + taşınabilir, macOS: dmg, Linux: AppImage + deb) |

Birim testleri depo kökünden: `pnpm test`.

## İndirme

Hazır Windows sürümleri [GitHub Releases](https://github.com/yusufkocak1/kalem/releases)
sayfasında: kurulum paketi (`Kalem-Setup-<sürüm>.exe`) ve taşınabilir exe
(`Kalem-<sürüm>.exe`). Exe'ler depoda tutulmuyor.

Yeni sürüm: `package.json`'daki `version` artırılıp `main`'e alınır, sonra
aynı sürümün etiketi push edilir:

```sh
git tag desktop-v<sürüm> && git push origin desktop-v<sürüm>
```

**Masaüstü yayını** iş akışı (`.github/workflows/masaustu.yml`) Windows'ta
`package`'ı çalıştırır, `desktop-v<sürüm>` release'ini açar ve dört dosyayı
ona ekler: iki exe, `latest.yml` ve `Kalem-Setup-<sürüm>.exe.blockmap`.
Etiket `package.json`'daki sürümle uyuşmazsa hiçbir şey yayımlanmaz.
Etiketi push etmek yerine iş akışı GitHub'dan da başlatılabilir (Actions →
**Masaüstü yayını** → Run workflow → `main`); etiketi o zaman kendisi açar.
`latest.yml` olmadan kurulu sürümler yeni sürümü kendileri kuramaz, yalnızca
indirme sayfasını gösterir.

## Güncellemeler

Uygulama açıldıktan ~10 sn sonra, günde en çok bir kez, GitHub'dan
`desktop-v` ile başlayan en yeni kararlı sürümü sorar (**Yardım →
Güncellemeleri Otomatik Denetle** ile kapatılır; **Güncellemeleri
Denetle…** elle sorar). Yeni sürüm varsa:

- **Kurulu sürüm** sorar, onay verilirse yükleyiciyi o sürümün
  `latest.yml`'ına göre indirir (sha512 doğrulanır) ve yeniden başlatınca
  ya da bir sonraki kapanışta kurar. Kaydedilmemiş belgeler her zamanki gibi
  sorulur.
- **Taşınabilir exe** kendini değiştiremez; yalnızca indirme sayfasını açar.

Geliştirme kipinde (`dev`, `start`) otomatik denetim yapılmaz.

## `.md` dosyalarının varsayılan uygulaması yapmak

Bunu **kurulum paketi** (`release/Kalem-Setup-<sürüm>.exe`) yapar; taşınabilir
`Kalem-<sürüm>.exe` kayıt defterine hiçbir şey yazmaz.

1. `pnpm --filter kalem-desktop package` ile kurulum paketini üretin ve kurun.
   Kurulum `.md` ve `.markdown` uzantılarını Kalem'e bağlar
   (`HKCU\Software\Classes\Kalem.Markdown`); kaldırınca bağ da silinir.
2. Uzantı için daha önce başka bir uygulama seçilmişse Windows o seçimi korur;
   uygulamalar bunu kendileri değiştiremez. Bir `.md` dosyasına sağ tıklayıp
   **Birlikte aç → Başka bir uygulama seç → Kalem → Her zaman** deyin ya da
   **Ayarlar → Uygulamalar → Varsayılan uygulamalar → Kalem** yolunu izleyin.

Taşınabilir sürümde aynı menüden **Bilgisayarda bir uygulama seçin** ile exe
gösterilebilir; exe taşınırsa bağ kopar.

## Paket boyutu

Boyutun neredeyse tamamı Electron'un kendisi (`Kalem.exe` ~235 MB); uygulama
kodu `app.asar` içinde ~3 MB. Küçültmek için yapılanlar:

- Yalnızca `en-US` ve `tr` Chromium dil dosyaları paketlenir.
- `scripts/after-pack.cjs` Windows'ta `dxcompiler.dll` ve `dxil.dll`'i
  (~26 MB) siler: yalnızca WebGPU gölgelendiricilerini derlerler, Kalem
  WebGPU kullanmaz. WebGL'in kullandığı `d3dcompiler_47.dll`, yazılım GPU
  yedeği (SwiftShader) ve Chromium lisans dosyası yerinde kalır.
- Yükleyiciler en yüksek sıkıştırmayla üretilir (`compression: maximum`):
  kurulum paketi ~103 MB'tan ~96 MB'a indi; derleme biraz uzar.

## Taşınabilir exe neden ilk açılışta bekliyor

Taşınabilir exe, içindeki uygulamayı (~300 MB) çalıştırmadan önce diske açmak
zorunda. Bu açma işlemi **her yeni exe için bir kez** yapılıyor (~7 sn,
bu sırada açılış görseli görünür) ve sonuç
`%LOCALAPPDATA%\kalem-desktop-portable\` altında saklanıyor. Sonraki
açılışlar ~0,7 sn sürüyor. Yeni bir exe ilk açıldığında eski sürümün klasörü
silinir; klasörü elle silmek de güvenlidir, yalnızca bir sonraki açılış yine
bekler. Kurulu sürüm (`Kalem Setup`) hiç beklemez.

Bu davranış electron-builder'ın taşınabilir başlatıcısına yapılan bir yamadan
geliyor (`patches/app-builder-lib@26.15.3.patch`); özgün başlatıcı her
açılışta yeniden açıp kapanınca siliyordu. electron-builder sürümü
yükseltilirken yamanın da taşınması gerekir — uymazsa `pnpm install` hata
verir.

## Özellikler

**Belgeler**

- `.md` / `.markdown` açma, kaydetme, farklı kaydetme; son kullanılanlar;
  dosyayı pencereye sürükleyerek ya da çift tıklayarak açma.
- **Kalem paketi (`.kmd`)** — isteğe bağlı. Varsayılan kayıt her zaman
  `.md`'dir. **Dosya → Paket Olarak Kaydet…** belgeyi, bağlantı verdiği
  görsel ve dosyalarla birlikte tek bir dosyaya toplar; böylece e-postayla ya
  da USB bellekle taşınınca hiçbir şey kopmaz. Özgün `.md` ve `.assets`
  klasörü olduğu gibi kalır. Paket açılınca normal belge gibi düzenlenir;
  eklenen görsel ve dosyalar pakete girer.
  - İçi [TextBundle](https://textbundle.org/spec/) düzeninde bir zip:
    `text.md` + `assets/` + `info.json`. Uzantı `.textpack` yapılırsa Bear,
    Ulysses gibi TextBundle destekleyen uygulamalar da açar; Kalem de
    onların `.textpack` paketlerini açar.
  - Paket açıkken içeriği `%APPDATA%\kalem-desktop\packages\` altında geçici
    bir klasörde durur; sekme kapanınca silinir.
  - Paketten tekrar `.md`'ye dönmek için **Farklı Kaydet** ve
    "Markdown belgeleri" yeterli: görseller yeni belgenin `.assets`
    klasörüne çıkarılır.
- **Dosyalar bölmesi** (gezinti bölmesinde **Başlıklar / Dosyalar**):
  **Dosya → Klasör Aç…** ile seçilen klasörlerin, klasör açılmamışsa etkin
  belgenin klasörünün **tüm dosyaları** ağaç olarak listelenir. Birden çok
  klasör açılabilir (diyalogda birkaç klasör seçilebilir, ya da Klasör Aç
  tekrar kullanılır); her klasör kendi başlığıyla görünür ve başlığın
  üstüne gelince çıkan ✕ ile tek başına kapatılır. Araç çubuğundaki ✕
  (**Dosya → Tüm Klasörleri Kapat**) hepsini kapatır. Açık klasörler
  uygulama yeniden başlayınca da açık kalır. Boş klasörler, gizli
  klasörler, `node_modules`/`target`/`build` gibi araç klasörleri ve
  `.assets` klasörleri gösterilmez.
  - Tıklanan dosya türüne göre açılır: `.md`/`.kmd` belgeler sekmede
    Markdown editöründe, Word belgeleri içe aktarılarak; diğer **metin
    dosyaları** (`.txt`, `.java`, `.json`, `.xml`, `.sql`…) yine **bir
    sekmede, düz metin olarak**; resim, PDF gibi metin olmayan dosyalar sistemdeki
    uygulamalarıyla (soluk gösterilir). Program dosyaları (`.exe`, `.bat`,
    `.ps1`…) çalıştırılmaz, yalnızca klasörde gösterilir.
  - **Görünüm:** dosya türleri renkli simgelerle ayrılır (Markdown, Word,
    JSON/XML/YAML, kod, tablo, resim, PDF…), klasörler açık/kapalı simgesi
    ve dönen okla gösterilir, her seviyenin girinti çizgisi vardır. Açık
    belge vurgulanır ve kenarında bir çizgi olur.
  - **Klasörler kapalı başlar**; hangilerinin açık olduğu hatırlanır. Etkin
    belgenin üstündeki klasörler kendiliğinden açılır ve belge görünür
    yere kaydırılır. **Tümünü Daralt** hepsini kapatır.
  - **Klavye:** arama kutusunda `↓` ağaca iner; `↑`/`↓` gezinir, `→`
    klasörü açar ya da içine girer, `←` kapatır ya da üst klasöre çıkar,
    `Enter` açar, `F2` yeniden adlandırır, `Delete` siler, `Shift+F10` (ya
    da menü tuşu) sağ tık menüsünü açar.
  - **Sağ tık menüsü:** Aç, Sistem Uygulamasıyla Aç, Yeni Dosya…, Yeni
    Klasör…, Yeniden Adlandır…, Sil, Yolu Kopyala, Göreli Yolu Kopyala,
    Klasörde Göster (kök klasörde Klasörü Kapat). Yeni dosya/klasör ve
    yeniden adlandırma ağaçta yerinde yazılır (`Enter` onaylar, `Esc`
    vazgeçer); yeni dosya hemen açılır. Açık bir dosya ya da içinde açık
    dosya olan bir klasör yeniden adlandırılınca sekmeleri yeni yola
    kaydetmeye devam eder. Silmek, onaydan sonra dosyayı **Geri Dönüşüm
    Kutusu'na** taşır. Bu işlemler yalnızca bölmede görünen klasörlerin
    içinde yapılabilir. Yeni dosya, yeni klasör, daralt ve yenile düğmeleri
    bölmenin üzerine gelince görünür.
  - **Kendiliğinden yenilenir:** açık klasörlerde başka bir programın
    eklediği, sildiği ya da yeniden adlandırdığı dosyalar ağaca kendiliğinden
    yansır.
  - **Arama** önce adı eşleşen dosyaları (**Dosya adları**), sonra
    dosyaların içindeki satırları gösterir.
  - **Git:** açılan klasör bir Git deposundaysa (içinde `.git` varsa)
    kendiliğinden tanınır; arama kutusunun üstünde **dal adı**, izlediği
    uzak dal ve bekleyenler (`2 gönderilecek · 1 çekilecek · 3 değişiklik`)
    görünür. Yanındaki düğmeler **Çek (Pull)**, **Gönder (Push)** ve **Getir
    (Fetch)**; `⌄` menüsünde ayrıca **Dal Değiştir…** (yerel ve uzak dallar
    aranabilir listede; yalnızca uzakta olan dal seçilince onu izleyen yerel
    dal açılır), **Yeni Dal…** ve **Değişiklikleri Commit Et…** var.
    Dal adına tıklamak da dal değiştirir. Aynı işlemler dosyaların sağ tık
    menüsünde de bulunur; birden çok klasör açıkken her deponun dalı kendi
    başlığında görünür. Git deposu olmayan klasör, sağ tık menüsündeki
    **Git Deposu Yap** ile depo yapılır.
  - **Değişen dosyalar ağaçta görünür:** değişen dosyanın adı renklenir ve
    yanında bir harf çıkar (**M** değişti, **A** eklendi, **D** silindi,
    **R** yeniden adlandırıldı, **U** yeni/izlenmiyor, **!** çakışma);
    içinde değişiklik olan klasörlerin yanında bir nokta olur. Değişen
    dosyanın sağ tık menüsünde **Son Commit ile Karşılaştır** (renkli fark
    penceresi) ve **Değişiklikleri Geri Al…** (onaydan sonra dosya son
    commit'teki hâline döner; yeni dosya Geri Dönüşüm Kutusu'na gider) var.
  - **Seçerek commit:** **Değişiklikleri Commit Et…** değişen dosyaları
    işaret kutularıyla listeler; yalnızca işaretlenenler commit edilir
    (önceden stage'lenmiş başka dosya olsa da). **✨ Öner**, seçilen
    dosyaların farkından ve deponun son commit başlıklarının üslubundan
    asistana (Claude Code, Copilot ya da bağlı API) bir commit mesajı
    yazdırır; mesaj düzenlenebilir. `Ctrl+Enter` commit eder.
  - **Çakışmalar:** pull ya da birleştirme çakışmayla durursa çubukta
    "Birleştirme sürüyor · 2 çakışma" yazar, çakışan dosyalar **!** ile
    işaretlenir; menüde **Devam Et** (çözdükten sonra) ve **İptal Et** çıkar.
    Dallar ayrıştığında ve Git'te bunun için bir ayar yoksa pull,
    **Birleştir (Merge)** mi **Rebase** mi yapılacağını sorar.
  - **Kendiliğinden güncellenir:** terminalden dal değiştirmek, commit ya da
    fetch yapmak ve dosyaları başka bir programda düzenlemek bölmeye
    kendiliğinden yansır (`.git` içindeki HEAD, index ve ref değişiklikleri
    izlenir; Kalem'in kendi `git status`'u index'e yazmaz). **Klasör Aç**
    ile açılan depolar 10 dakikada bir arka planda fetch edilir; bu sırada
    giriş penceresi açılmaz, giriş isteyen fetch sessizce atlanır. `⌄`
    menüsündeki **Otomatik Getir (Fetch)** ile kapatılır.
  - **Depo klonlama:** araç çubuğundaki dal simgesi (**Git Deposu
    Klonla…**) bir adres sorar (https, SSH ya da `file://`), sonra
    klonlanacağı klasörü; klonlanan depo açık klasörlere eklenir.
  - İşleri sistemdeki `git` yapar, giriş için de sizin ayarlarınız
    (Git Credential Manager, SSH anahtarı) kullanılır; Git kurulu değilse
    bölme bunu söyler. Git'in hata mesajı olduğu gibi gösterilir. Kalem
    terminal açmadığı için parola soran bir giriş beklemez, hata verir.
- **Metin sekmesi:** Markdown olmayan metin dosyaları (Dosyalar bölmesinden,
  **Dosya → Aç…**'tan, Hızlı Aç'tan ya da bir belgedeki bağlantıdan) aynı
  penceredeki bir sekmede açılır. Dosya **olduğu gibi** gösterilir ve
  kaydedilir: Markdown'a çevrilmez, kodlaması (UTF-8, UTF-16, BOM) ve satır
  sonları (CRLF/LF) korunur, sona satır sonu eklenmez. Sekmenin adı dosyanın
  uzantısıyla birlikte tam adıdır. Satır numaraları, eş genişlikli yazı,
  `Tab` ile sekme karakteri, **Satırları kaydır** seçeneği; durum çubuğunda
  satır/sütun ve kodlama.
  - Kaydetme, otomatik kayıt, kurtarma, sürüm geçmişi, başka bir programın
    değiştirdiği dosyayı yeniden yükleme ve **Farklı Kaydet** (aynı uzantı
    önerilir, başka ad da yazılabilir) belgelerdeki gibi çalışır.
  - **Bul** (`Ctrl+F` ya da sekmenin araç çubuğundaki büyüteç): `Enter`/`F3`
    sonraki, `Shift+Enter` önceki eşleşme.
  - **Biçimlendir** (sekmenin araç çubuğu, **Kod** sekmesindeki **Kodu
    Biçimlendir** ya da `Shift+Alt+F`): JSON, XML (SVG, plist… dâhil), HTML
    ve YAML dosyası iki boşluk girintiyle düzenlenir. Tür uzantıdan, uzantı
    bilinmiyorsa içerikten anlaşılır. Biçimlendirme tek adımdır, `Ctrl+Z`
    geri alır. Geçersiz bir dosya olduğu gibi bırakılır ve hatası gösterilir.
  - Şeritteki biçim düğmeleri (kalın, başlık, tablo…) metin sekmesinde
    kapalıdır. Asistanın yanıtı **Ekle** ile imlecin olduğu yere düz metin
    olarak girer.
  - 20 MB'tan büyük dosyalar sekmede açılmaz. Eski tek baytlık kodlamalar
    (Windows-1254/1252) kaydederken UTF-8'e çevrilir.
- **Klasörde arama** (`Ctrl+Shift+E` ya da bölmedeki arama kutusu): açık
  klasörlerdeki tüm metin dosyalarının satırları arayüz dilinin
  büyük/küçük harf kurallarıyla (İ/ı) aranır, sonuçlar dosyaya göre
  gruplanır (birden çok klasörde yol klasör adıyla başlar). Bir sonuca
  tıklamak dosyayı açar; belgede bul panelini aynı sözcükle doldurur.
  Paketlerin (`.kmd`), Word belgelerinin ve metin olmayan dosyaların
  içinde arama yapılmaz.
- **Hızlı Aç** (`Ctrl+Shift+P`): açık klasörlerdeki dosyaları adla bulup
  açar; yazılan her sözcük yolda geçmeli, adı sözcükle başlayanlar öne
  gelir.
- **Farklı Kaydet** belgeyi başka bir klasöre taşırsa bağlantı verdiği
  görsel ve dosyalar da yeni yerin `.assets` klasörüne kopyalanır ve
  bağlantılar güncellenir (yeni yerden zaten ulaşılabilen dosyalara
  dokunulmaz).
- `.txt` dosyaları (2.0'dan beri) Markdown editöründe değil, metin
  düzenleyicide açılır; içerikleri Markdown'a çevrilmez.
- **Sekmeler:** bir pencerede birden çok belge. `Ctrl+N` yeni sekme,
  `Ctrl+Shift+N` yeni pencere, `Ctrl+W` sekmeyi kapatır, `Ctrl+Tab` sekmeler
  arasında gezer. Her sekmenin kendi geri alma geçmişi, kayıt durumu ve
  kurtarma taslağı vardır. Zaten açık olan belge yeniden açılmaz, sekmesi
  öne gelir. Son sekme kapanınca pencere kapanır.
- **Hızlı Not** (**Dosya → Hızlı Not**, `Ctrl+Shift+Alt+N`): açık
  klasörde, klasör yoksa `Belgeler\Kalem Notları` içinde
  `Not 2026-10-05 14.30.md` gibi tarihli bir not açar. Dosya ancak bir şey
  yazılıp kaydedilince oluşur; `Ctrl+S` kaydetme kutusu sormaz, boş
  bırakılan not hiçbir iz bırakmaz.
- **Sistem tepsisi** (**Görünüm → Sistem Tepsisinde Çalış**, Windows ve
  Linux): bildirim alanına bir simge konur ve hızlı not kısayolu sistem
  genelinde çalışır; uygulama başka bir penceredeyken de not açılır. Bu
  kipte son pencere kapanınca uygulama kapanmaz, tepside bekler; tepsi
  menüsündeki **Çıkış** kapatır. Kısayolu başka bir uygulama tutuyorsa
  tepsi menüsü yine çalışır.
- **Sekmeyi yeni pencereye taşıma**: sekmeye sağ tıklayıp **Sekmeyi Yeni
  Pencereye Taşı**, **Görünüm** menüsündeki aynı komut ya da sekmeyi
  pencerenin dışına sürükleyip bırakmak. Kaydedilmemiş değişiklikler de
  taşınır; geri alma geçmişi taşınmaz.
- Dosyanın kodlaması ve satır sonu korunur: UTF-8 (BOM'lu/BOM'suz),
  UTF-16, CRLF/LF. UTF-8 olmayan eski dosyalar (Windows-1254/1252) bozuk
  karaktere dönüşmeden okunur ve kaydederken UTF-8'e çevrilir.
- Kaydetme atomiktir: yazma yarıda kesilirse eski belge yerinde kalır.
- **Sürüm geçmişi** (**Dosya → Sürüm Geçmişi…**): her kayıtta belgenin bir
  kopyası `%APPDATA%\kalem-desktop\history\` altında saklanır. 10 dakika
  içindeki kayıtlar tek sürümde birleşir (otomatik kaydetme geçmişi
  doldurmasın diye); belge başına en yeni 50 sürüm tutulur. Listeden seçilen
  sürüm önizlenir; **Bu Sürümü Geri Yükle** metni editöre tek bir düzenleme
  olarak koyar, Ctrl+Z önceki metne döndürür. Geçmiş belgenin yoluna
  bağlıdır: taşınan ya da yeniden adlandırılan belge yeni bir geçmişle
  başlar.
- **Notlarım** (Word'ün açıklamaları gibi; **Gözden Geçir → Yeni Not**,
  **Ekle → Yeni Not**, sağ tık ya da `Ctrl+Alt+M`): seçili sözcüklere (seçim
  yoksa imlecin olduğu ya da hemen solundaki sözcüğe) kendinize bir not
  bırakırsınız. Sözcükler notun rengine boyanır, not **Notlarım panelinde**
  bir kart olarak durur. Panel varsayılan olarak sağ yuvadadır, sola
  taşınabilir; alta taşınamaz, çünkü kartlar alt alta okunur. Not eklemek
  sayfanın genişliğini değiştirmez. Notun dört türü vardır: **Anlamadım**,
  **Dikkat**, **Sonra bak** ve **Not**. Karta tıklayınca sözcükler, boyalı
  sözcüklere tıklayınca kart gösterilir. Bir not **Çözüldü** ile kenara
  alınır (*Çözülenler* ile yine görünür) ya da silinir; silme geri alınabilir.
  **Önceki / Sonraki Not** notlar arasında gezer. Gözden Geçir şeridindeki
  **Notlarım** paneli açıp kapatır; **Görünüm → Notlarımın sözcüklerini
  metinde boya** boyamayı kapatır.
  - Notlar **yalnızca bu bilgisayarda** saklanır
    (`%APPDATA%\kalem-desktop\local-notes.json`, belge yoluna ya da
    Confluence sayfasına göre). Markdown'a, Confluence'a, dışa aktarmaya ve
    yazdırmaya hiç girmez; not eklemek belgeyi "kaydedilmemiş" yapmaz.
  - Not, sözcüklerine ve onların çevresine bağlıdır. Belgenin başka bir
    yeri değişince yerini bulur, sözcükleri biraz değişince onları izler.
    Sözcükler silinirse not "Sözcükleri artık yok" diye listenin sonunda
    kalır.
  - Kaydedilmemiş yeni bir belgedeki notlar, belge ilk kez kaydedilince
    onunla birlikte saklanır.
- **Okunan yer korunur:** tam genişlik, yakınlaştırma, odak modu, panel
  açıp kapama ve pencere boyutu satırları yeniden kırar. Uygulama okunan
  bloğu (imlecin olduğu blok, imleç görünmüyorsa ekranın üçte birindeki
  blok) aynı yerde tutar. Pencere açık yan panellere ve okunabilir bir
  sayfaya yetmeyecek kadar darsa önce sol, gerekirse sağ yuva geçici olarak
  gizlenir; pencere genişleyince geri gelir, ayar değişmez.
- **Kaldığım yerden devam** (Notepad++ gibi; Ayarlar → Sistem, varsayılan
  açık): uygulama kapanırken hiçbir şey sorulmaz. Açık sekmeler sırasıyla,
  etkin sekme, her sekmenin kaydırma yeri ve pencerenin konumu/boyutu
  `session.json`'a yazılır. **Kaydedilmemiş metin taslak olarak saklanır,
  silinmez.** Sonraki açılışta hepsi aynen geri gelir: dosyalar diskten,
  Confluence sayfaları Confluence'tan yeniden okunur, kaydedilmemiş sekmeler
  "Kaydedilmedi" durumunda taslaklarıyla açılır.
  - Bu davranış yalnızca uygulamanın kendisi kapanırken geçerlidir.
    Birden çok pencere varken tek bir pencereyi kapatmak, bir sekmeyi
    kapatmak ya da tepsi simgesi açıkken son pencereyi kapatmak eskisi
    gibi kaydedilmemiş değişiklikleri sorar.
  - Ayar kapatılırsa kapanışta yine "Kaydet / Kaydetme" sorulur ve
    sekmeler geri gelmez.
- Kaydedilmemiş değişiklikler kurtarma taslağına yazılır; uygulama
  çökerse sonraki açılışta belge geri gelir.
- Dosya başka bir programda değişirse pencereye dönünce fark edilir.
- İsteğe bağlı otomatik kaydetme.
- HTML ve PDF olarak dışa aktarma, yazdırma. **Dosya → Sayfa Yapısı**:
  sayfa boyutu (A4, A3, A5, Letter, Legal), dikey/yatay, kenar boşlukları
  (Word'ün Normal / Dar / Geniş ön ayarları) ve PDF'te sayfa numarası.
  Ayarlar kalıcıdır ve hem PDF'e hem yazdırmaya uygulanır (sayfa numarası
  yalnızca PDF'te; yazdırma kutusunun kendi üst/alt bilgi seçeneği var).

**Word'e dışa aktarma**

- **Dosya → Dışa Aktar → Word (.docx)**: başlıklar, kalın/italik/üstü
  çizili, satır içi kod, yazı rengi, bağlantılar, iç içe madde ve numaralı
  listeler (her numaralı liste kendi başlangıcından sayar), görev
  kutuları (☑/☐), alıntılar, kod blokları, yatay çizgi ve tablolar
  (hizalama, renk ve sütun genişliğiyle) Word öğelerine çevrilir.
- Belgenin yanındaki ve pakete gömülü PNG, JPEG, GIF ve BMP görseller
  dosyaya gömülür, sayfaya sığacak şekilde küçültülür; web'deki görseller
  indirilmez, yerlerine alt metinleri yazılır.
- Sayfa boyutu, yönlendirme, kenar boşlukları ve sayfa numarası
  **Sayfa Yapısı** ayarlarından alınır.
- **Dipnotlar** (GFM söz dizimi: metinde `[^1]`, ayrı paragrafta
  `[^1]: açıklama`) gerçek Word dipnotu olur; tanım paragrafları gövdeden
  çıkar. HTML dışa aktarmada referanslar üst simge numaraya, tanımlar
  belgenin sonunda geri bağlantılı bir listeye dönüşür. Numaralar ilk
  referans sırasına göre verilir.

**Görselleri büyük görmek**

- Belgedeki bir görsele tıklamak onu pencereyi kaplayan bir görüntüleyicide
  açar. ← / → (ya da kenarlardaki oklar) belgedeki diğer görsellere geçer;
  görsele tıklamak gerçek boyutuna büyütür (kaydırılarak gezilir), bir daha
  tıklamak pencereye sığdırır. Esc, ✕ ya da görselin dışına tıklamak kapatır.
- Görselin açıklaması (alt metni) görüntüleyicideki **Açıklamayı düzenle**
  ile ya da **Alt+tıklama** ile düzenlenir. Diyagramlar tıklamayla değil,
  çift tıklamayla diyagram düzenleyicide açılır.

**Word'den içe aktarma**

- **Dosya → Word'den İçe Aktar** (`.docx`): başlıklar, kalın/italik/üstü
  çizili, bağlantılar, iç içe ve numaralı listeler, alıntılar, tablolar ve
  görseller Markdown'a çevrilir.
- Belgedeki görseller ilk kayıtta belgenin yanındaki `<belge>.assets/`
  klasörüne çıkarılır.
- Word'den **yapıştırma** da çalışır (Kalem'in kendi yapıştırma boru hattı);
  içe aktarma ile aynı dönüştürücüyü kullanır.
- Eski `.doc` biçimi desteklenmez; Word'de `.docx` olarak kaydedilmelidir.

**Confluence**

- **Confluence paneli** (bağlıyken; varsayılan olarak sol yuvada): bağlı sitenin alanları ve sayfa
  ağacı. Ağaç ok simgeleri, girinti çizgileri ve açık sayfayı gösteren bir
  vurguyla çizilir; satırın üzerine gelince **Bu sayfada ve altındaki
  sayfalarda ara**, **Alt sayfa ekle** ve **Favorilere ekle** çıkar.
  Klavyeyle gezilir (`↑`/`↓`, `→` açar ya da ilk alt sayfaya gider, `←`
  kapatır ya da üst sayfaya döner, `Home`/`End`; arama kutusunda `↓` listeye
  iner). Araç çubuğunda **Açık sayfayı ağaçta göster** (etkin sekmenin
  sayfasının üst sayfalarını sorup ağacı oraya kadar açar) ve **Tümünü
  daralt** vardır. Satır düğmeleri satırın sağında yüzer; başlık bölmenin
  tüm genişliğini kullanır. Gezinme bölmesi sağ kenarından sürüklenerek
  genişletilir (ok tuşları da çalışır, çift tık varsayılana döndürür);
  genişlik hatırlanır.
- **Favori grupları:** favoriler adlandırılmış gruplara ayrılabilir. Bir
  favorinin satırındaki klasör düğmesi (**Bir gruba koy…**) mevcut
  grupları, **Grupsuz**'u ve yeni grup adı kutusunu gösterir (adı yazıp
  `Enter`). Favoriler sürüklenip bir grubun başlığına bırakılabilir;
  **Favoriler** başlığına bırakılan favori gruptan çıkar. Grup başlıkları
  açılıp kapanır, sayfa sayısını gösterir; üzerine gelince **Grubu yeniden
  adlandır** (var olan bir adı verince iki grup birleşir) ve **Grubu dağıt**
  (sayfaları favorilerde kalır) çıkar. Önce grupsuz favoriler, sonra
  gruplar listelenir; gruplar ayarlarla saklanır ve her pencerede aynıdır.
- **Confluence öğeleri ve bağlantılar:** sayfadaki korunan öğeler (🔒 ile
  gösterilen bahsetmeler, sayfa/blog/alan bağlantıları, tarihler, Jira
  kayıtları, durumlar, çapalar ve diğer satır içi makrolar) **tıklayınca
  tarayıcıda açılır**. Üzerine gelip bekleyince bir kart açılır:
  - öğenin türü ve başlığı (Jira anahtarı ve sunucusu; bahsedilen kişinin
    adı, kullanıcı adı ve e-postası — sunucudan sorulur; bağlantılı
    sayfanın alanı; durumun renkli etiketi; tarihin uzun yazılışı),
  - makronun ayarları (ör. `toc` için `maxLevel`),
  - tarayıcıdaki adresi ve **Tarayıcıda Aç**, **Kopyala**, **Bağlantıyı
    Kopyala** düğmeleri; bağlantılı sayfalar için **Kalem'de Aç** (sayfayı
    bir sekmede açar).
  - Jira'nın adresi sayfada yazmaz: Cloud'da sitenin kendi adresi
    (`/browse/ANAHTAR`), Server'da önce Jira makrosunun sunucu listesinden
    (`/rest/jiraanywhere/1.0/servers`, her kullanıcı okuyabilir), sonra
    Confluence'ın uygulama bağlantılarından (`/rest/applinks/…`, çoğu sitede
    yönetici ister) makronun sunucu kimliğiyle bulunur; o da olmazsa Kalem'in
    Jira bağlantısının adresi kullanılır.
  - Jira kaydının kartında her zaman **Aç** vardır: kaydı Kalem'de açar (bkz.
    **Jira**). Jira bağlıysa kart kaydın özetini, durumunu, türünü ve atananı
    da gösterir. Kayda **tıklamak** da onu Kalem'de açar; JQL'li Jira
    makroları aramayı açar.
  - Yalnızca Confluence'ta görünen makrolar (ör. `toc`) sayfanın kendisini
    tarayıcıda açar.
  Sıradan bağlantılarda da aynı kart adresi gösterir ve **Tarayıcıda Aç**
  sunar; bağlantı metni düzenlenebilsin diye onlarda tek tıklama imleci
  koyar, `Ctrl+tıklama` açar.
- Server / Data Center'da bir sayfanın alt sayfaları istenirken sunucu 500
  hatası verirse (bazı sayfalarda `expand=children.page` isteği düşer)
  Kalem daha basit isteklerle, en son da aramayla (`parent=ID`) yeniden
  dener; yine olmazsa hatanın yanında **Yeniden dene** çıkar, dalı kapatıp
  açmak da yeniden ister.
- **Arama:** kutunun altındaki **Başlıklar / İçerik** seçimi.
  - **Başlıklar:** başlığı yazılanla başlayan sayfalar (yeniden eskiye),
    eşleşen kelimeler işaretlenir; sayfa ID'si ve adresi de kabul edilir.
  - **İçerik:** sayfaların başlığında, metninde ve etiketlerinde arar
    (CQL `text~`). Her kelime aranır, son kelime yazılırken önek olarak da
    (`onay` → `onaylama`); `"tam ifade"` ifadeyi olduğu gibi, `-kelime` ya da
    `-"ifade"` dışarıda bırakır. Sonuçlarda bulunan kelimenin geçtiği metin
    parçası vurgulu, sayfanın yeri (alan › üst sayfalar) ve ne zaman
    değiştiği (“3 gün önce”) görünür; sıralama Confluence'ın ilgililiğine
    göredir. 25'er sonuç gelir, **Daha fazla sonuç göster** devamını ekler
    ("25 / 140 sonuç").
  - **Filtreler** (huni düğmesi; etkin filtre sayısını gösterir):
    değiştirilme zamanı (son 1 gün / hafta / ay / yıl), sıralama (ilgililik,
    son değişiklik, başlık), etiket, **Yalnızca üzerinde çalıştığım
    sayfalar** (`contributor = currentUser()`) ve ağaçtan seçilen bir
    sayfanın altı (`ancestor`). Yalnız bir filtre de arama sayılır (ör. "son
    bir haftada değişen sayfalarım").

- **Bahsetme ve Jira kaydı eklemek:** Confluence bağlıyken metnin içinde
  bir kelimenin başına **`@`** yazınca kişi arama kutusu açılır; yazdıkça
  sitenin kullanıcıları adlarına göre aranır (Cloud'da `/rest/api/search/user`,
  Server / Data Center'da o, CQL kullanıcı araması ya da eski
  `/rest/prototype/1/search/user.json`). `↑`/`↓`, `Enter` (ya da tıklama) seçer,
  `Esc` kapatır. Seçilen kişi satırın içine **@Ad Soyad** olarak girer ve
  kaydedince Confluence'ta gerçek bir bahsetme (`ri:user`) olur — kişiye
  Confluence'ın bildirimi gider.
  - **`/` menüsünde** de **Bir kişiden bahset** ve **Jira kaydı** vardır. Bu
    ikisi bloğu değiştirmez: `/jira` yazıp seçince `/jira` silinir ve kutu
    **imlecin olduğu yerde, satırın içinde** açılır; ardından yazılan arama
    olur. Jira bağlıysa anahtar (`ABC-12`), kelime ya da JQL ile Jira'da
    aranır ve kayıtlar özetleriyle listelenir; bağlı değilse yazılan anahtar
    olduğu gibi eklenir.
  - Jira kaydı Confluence'a `jira` makrosu olarak yazılır; makronun sunucusu
    sitenin Jira listesinden (`/rest/jiraanywhere/1.0/servers`) Kalem'in
    bağlı olduğu Jira'ya göre, yoksa varsayılan Jira olarak seçilir.
    Confluence bağlı değil, yalnızca Jira bağlıysa kayıt `…/browse/ANAHTAR`
    bağlantısı olarak eklenir.
  - Eklenenler sayfadaki diğer korunan öğeler gibi görünür, üzerine gelince
    kartı açılır; yerel bir belgede de yazılabilir, **Confluence'ta yayımla**
    ile sayfaya gerçek bahsetme ve makro olarak gider.
- **Confluence'ta yayımla:** yerel bir belge (ör. bir `.md` dosyası)
  Confluence'ta **yeni bir sayfa** olarak açılır. Düğme, Confluence bağlıyken
  şeridin sağ üstünde, kayıt durumunun yanındadır (her şerit sekmesinde
  görünür); **Dosya → Confluence'ta Yayımla…** de aynı işi yapar. Pencerede:
  - **Sayfa başlığı:** belge bir 1. düzey başlıkla açılıyorsa o, değilse
    dosyanın adı. Başlık o başlıksa sayfada tekrarlanmaz (seçenek).
  - **Alan** ve **konum:** alanın en üstü ya da ağaçta gezilerek (▸ ile alt
    sayfalar açılır) veya başlığıyla aranarak bulunan bir sayfanın altı;
    seçilen yer "Geliştirme › Ana Sayfa" gibi gösterilir. Seçilen alan
    hatırlanır.
  - Belgenin yerel **resimleri** ve göreli bağlantılarla verilen
    **dosyaları** (ör. `images/akis.png`, `ekler/rapor.pdf`; yapıştırılmış
    resimler de) sayfaya **ek** olarak yüklenir ve sayfa onları gösterir.
    Farklı klasörlerdeki aynı adlı dosyalar ayrı adlar alır (`akis-2.png`);
    okunamayan dosyalar yayımlandıktan sonra listelenir. Web adresleri ve
    başka belgelere bağlantılar olduğu gibi kalır.
  - **Yeni sayfayı Kalem'de aç** (varsayılan): sayfa bir sekmede açılır;
    sonuç penceresinden tarayıcıda da açılabilir.
  Zaten bir Confluence sayfası olan sekme yayımlanmaz; o **Kaydet** ile
  kaydedilir.

- **Dosya → Confluence'tan Aç** (ya da Ekle → İçe Aktar → **Confluence**):
  bir Confluence sitesine bağlanır, sayfaları başlığa ve alana göre arar.
  Arama kutusuna sayfa ID'si (`123456`) ya da tarayıcıdaki adresi de
  yapıştırılabilir: Cloud'un `…/pages/123456/…`, Server'ın
  `viewpage.action?pageId=…` ve `/display/ALAN/Başlık` adresleri ile kısa
  bağlantılar (`/x/…`). Adres bağlı sitenin değilse sonuç gelmez; yalnızca
  rakamlar yazılırsa o ID'li sayfa ile başlığında o rakamlar geçenler listelenir.
  Seçilen sayfa bir sekmede açılır; **Kaydet** (`Ctrl+S`) sayfayı
  Confluence'a yeni bir sürüm olarak yazar. Farklı Kaydet sayfayı yerel bir
  Markdown dosyasına çevirir.
  - **Confluence Cloud**: site adresi (`https://şirket.atlassian.net`),
    Atlassian e-postası ve bir API jetonu (id.atlassian.com → Güvenlik →
    API jetonları). **Server / Data Center**: site adresi ve kişisel erişim
    jetonu; kullanıcı adı boş bırakılır (kullanıcı adı girilirse jeton parola
    olarak gönderilir).
  - Jeton işletim sisteminin şifrelemesiyle (`safeStorage`) saklanır,
    arayüze hiç dönmez. Şifreleme yoksa yalnızca uygulama açıkken bellekte
    tutulur.
  - Sayfanın ekli görselleri editörde görünür. Sayfaya eklenen yeni
    görseller kaydederken sayfaya ek olarak yüklenir.
  - **Değişiklikler** (kaydedilmemiş değişiklik varken kaydetme durumunun
    yanındaki düğme ya da **Dosya → Confluence Değişiklikleri…**): sayfanın
    açıldığı ya da son kaydedildiği hâline göre neyin değiştiğini `git diff`
    gibi gösterir — silinen satırlar kırmızı, eklenenler yeşil, satır içinde
    değişen sözcükler vurgulu; **Birleşik** ya da **Yan yana** görünüm. Her
    değişiklik **Bu değişikliği geri al** ile tek başına, ya da **Tümünü
    Geri Al** ile hepsi birden geri alınır (editörde tek adım: `Ctrl+Z` geri
    getirir). **Confluence'a Kaydet** buradan kaydeder ve ayrıca sormaz.
    Varsayılan olarak **Kaydet** önce bu ekranı açar; Ayarlar → Düzenleyici →
    *Confluence'a kaydetmeden önce değişiklikleri göster* ile kapatılır.
  - Siz açtıktan sonra sayfa Confluence'ta değiştiyse kaydetme durur;
    **Confluence Sürümünü Yükle** ya da **Üzerine Yaz** seçilir.
  - Sayfada Markdown karşılığı olmayan içerik varsa (makrolar, sayfa düzeni,
    bahsetmeler, satır içi yorumlar, birleştirilmiş hücreler…) açılışta
    uyarı çıkar ve ilk kayıttan önce onay istenir: kaydetmek bu içeriği
    sayfadan kaldırır. Önceki sürüm Confluence'ın sayfa geçmişinde kalır.
- **Dosya → Confluence'tan İçe Aktar** (ya da Ekle → İçe Aktar → Confluence
  Sayfası): Confluence'ın iki metin biçimini de okur, hangisi olduğunu
  içerikten anlar. **Depolama biçimi** (storage format; Confluence'ın kaynak
  düzenleyicisinde ve REST API'sinde görünen XHTML, `.xml`/`.xhtml`/`.html`)
  ve eski **wiki biçimlendirmesi** (`h1.`, `*kalın*`, `{code}`; `.txt`/`.wiki`).
  Confluence'ın dışa aktardığı HTML sayfası da açılır.
- **Dosya → Dışa Aktar → Confluence (depolama biçimi)** ya da **Confluence
  (wiki biçimlendirmesi)**: başlıklar, kalın/italik/üstü çizili, satır içi
  kod, bağlantılar, görseller, listeler, görev listeleri, tablolar, alıntılar,
  renkli metin ve kod blokları karşılıklarına çevrilir.
- Kod blokları `code` makrosu olur, dil adı Confluence'ınkine çevrilir
  (`javascript` ↔ `js`, `python` ↔ `py`…). Görev listeleri depolama
  biçiminde Confluence görevleri, wiki'de `(/)` / `( )` ile başlayan
  maddeler olur.
- Markdown'da panel yok: **info/note/warning/tip** panelleri simgesiyle
  (ℹ️ 📝 ⚠️ 💡) başlayan alıntılara dönüşür, panel başlığı kalın ilk satır
  olur. Böyle başlayan bir alıntı dışa aktarılırken yeniden panel olur.
- Göreli görseller ve dosya bağlantıları Confluence ekine (`ri:attachment`)
  çevrilir; dosyaların sayfaya ayrıca eklenmesi gerekir.

**Jira**

- **Dosya → Jira…** Jira'yı Kalem'de açar. Bağlı değilse önce giriş ister:
  **Jira Cloud**'da Atlassian e-postası ve API jetonu (aynı Atlassian
  sitesinde Confluence Cloud bağlıysa onun oturumu sormadan kullanılır),
  **Server / Data Center**'da kişisel erişim jetonu (kullanıcı adı boş).
  Adres, Confluence'ın bildiği Jira'dan ya da tıklanan kaydın adresinden
  doldurulur. Jeton Confluence'ınki gibi şifrelenerek saklanır (`jira.json`).
- Confluence sayfasındaki Jira kayıtları (`jira` makrosu) ve belgelerdeki
  `…/browse/ANAHTAR` bağlantıları **Kalem'de açılır**: tür, durum (Jira'nın
  renkleriyle), öncelik, atanan, raporlayan, tarihler, etiketler, bileşenler,
  sürümler, açıklama ve yorumlar (Markdown olarak), üst kayıt, alt görevler ve
  bağlantılı kayıtlar. Bir alt göreve ya da bağlantılı kayda tıklamak onu aynı
  pencerede açar, **Geri** (`Alt+←`) döner; açıklamadaki Jira bağlantıları da
  orada açılır. **Tarayıcıda Aç**, **Efor gir**, **Favorilere ekle**,
  **Anahtarı Kopyala**, **Bağlantıyı Kopyala**.
- **Statü:** başlıktaki statü etiketine tıklamak kaydın o statüden
  geçebileceği adımları listeler (Jira'nın geçişleri); birini seçmek kaydı
  ilerletir. Çözüm (Resolution) isteyen adıma Done, Fixed, Tamamlandı ya da
  sunulan ilk çözüm verilir; ekranı başka zorunlu alan isteyen adım 🔗 ile
  işaretlidir ve kaydı Jira'da açar. Adım göndermeden önce Jira'dan yeniden
  okunur; sonra kayıt ve Jira paneli yenilenir.
- **Geliştirme:** kaydın dalları, commit'leri ve pull request'leri Jira'nın
  "Development" bölümündeki gibi sayılır ("2 dal · geçen hafta güncellendi",
  "1 pull request MERGED"); her satır açılınca listesi gelir (dal ve depo,
  commit kimliği ve mesajı, PR'ın dalları ve durumu), öğe tarayıcıda açılır.
  Bilgi Jira'nın `dev-status` API'sinden, bağlı tüm araçlardan (Bitbucket,
  GitHub, GitLab…) okunur; bilgi yoksa bölüm görünmez.
- **Efor gir:** süre **1h, 2h, 3h, 5h, 8h** düğmeleriyle ya da yazılarak
  (`2h`, `1h 30m`, `90m`, `1,5`, `2s 15dk`); tarih (Bugün / Dün), kalan
  tahmin (süre değiştikçe kendisi düşer) ve açıklama (boşsa "Working on
  issue ANAHTAR"). **Tempo Timesheets** kuruluysa efor Tempo'ya
  (`/rest/tempo-timesheets/4/worklogs`) iş özellikleriyle (ör.
  "Faturalandırılacak Şirket", "Servis") gider; zorunlu olanlar
  doldurulmadan gönderilmez. Liste seçenekleri Tempo'nun kendi penceresinin
  sorduğu yerden gelir: özelliğin `externalUrl` adresi (ör. hesabın
  `…/billingKeyList/{IssueKey}`'i ya da ScriptRunner'daki bir dinamik liste;
  JSONP yanıtı da okunur), yoksa statik liste ya da projenin hesapları; son
  4 ayda Tempo'ya girdiğin değerler de eklenir ve hiçbir şey hatırlanmamışsa
  formu en son girdiğin değerler başlatır. Listeler **yazarak seçilir**: kutuya
  yazılan her harf listeyi daraltır (`s` → `sa` → "Satış…"; önce adı yazılanla
  başlayanlar, sonra bir kelimesi başlayanlar, sonra içinde geçenler; büyük/küçük
  harf ve Türkçe harfler fark etmez). `↑`/`↓` gezer, `Enter` ya da tıklama seçer,
  `Esc` kapatır; kutuyu boşaltmak seçimi kaldırır. Kullanıcı bilgisi yalnızca aynı
  Jira'daki adreslere gönderilir. Bir liste boş gelirse **Tempo
  ayrıntıları** Tempo'nun yanıtını kopyalanabilir biçimde gösterir. Seçilen
  özellikler Jira sitesi başına hatırlanır (`jira-worklog.json`) ve form bir
  dahaki sefere onlarla açılır.
  Tempo yoksa (ve Cloud'da) efor Jira'nın kendi iş kaydına girilir. Formda
  harcanan/kalan süre ve kayda girdiğin son eforlar da görünür.
- Açıklaması ve yorumları **HTML** olarak saklayan Jira'larda (ör. JEditor
  eklentisi) metin kod gibi değil, sayfa gibi çizilir: Jira'nın kendi
  çizimi (`expand=renderedFields`) kullanılır; uyarı/bilgi/fikir kutuları
  simgeli alıntı olur. HTML güvenli biçimde (çalıştırılmadan) Markdown'a
  çevrilerek gösterilir; asistana düz metni gider.
- Bölümler (açıklama, alt görevler, bağlantılar, yorumlar) Jira'daki gibi
  katlanır. Bağlantılar ilişkisine göre gruplanır ("blocks", "mentioned in"…);
  Jira dışı bağlantılar da (`/remotelink`) listelenir. **Confluence sayfası**
  bağlı Confluence sitesindeyse tıklamak onu Kalem'de bir sekmede açar
  (adresteki sayfa kimliğiyle ya da `/display/ALAN/Başlık` adresinden
  aranarak); değilse tarayıcıda açılır.
- **İstek sınırı:** Jira Data Center jetonla ya da şifreyle gelen REST
  çağrılarını sayar (tarayıcının kendi istekleri sayılmaz) ve hak bitince
  HTTP 429 ("rate limit exceeded") ile geri çevirir. Kalem bu yüzden bir
  Jira sitesine aynı anda en çok 2 istek gönderir; Jira'nın
  `X-RateLimit-*` başlıklarından kalan hakkı okur ve hak azalınca
  istekleri dolma hızına göre aralıklar. 429 gelince o siteye giden
  **bütün** istekler Jira'nın istediği süre (`Retry-After`, en çok 2 dk)
  kadar durur: o sırada arka plan okumaları (kartlar, Geliştirme paneli,
  Tempo liste seçenekleri) hiç gönderilmez, senin istediğin bir kez
  bekleyip yeniden dener (en çok 1 dk). Efor formu beklemeyi geri sayımla
  gösterir; hiçbir şey kaydedilmemişse bunu söyler. Kim olduğun, Tempo'nun
  alanları ve seçenekleri, son değerlerin yarım saat; Confluence'taki Jira
  kartlarının bilgisi 2 dk, Geliştirme paneli 5 dk hatırlanır.
- Arama: anahtar (`QR-123`), kelimeler (`text ~`) ya da JQL; 25'er sonuç,
  **Daha fazla sonuç göster**. Cloud'da `/rest/api/2/search/jql`, Server'da
  `/rest/api/2/search` kullanılır.
- **Jira paneli** (bağlıyken): bana atanan açık kayıtlar, raporladıklarım,
  izlediklerim, son güncellenenler, **★ Favoriler** ya da bir arama; kayda
  tıklamak onu açar. Kayıtlar kart olarak çizilir: türün renkli simgesi,
  anahtar, statü, iki satırlık özet ve atananın baş harfleri. Alt görevler
  üst kayıtlarının altında **ağaç** olarak gruplanır (sonuç sırası korunur);
  üst kart alt görevlerinden kaçının bittiğini gösterir ve ▸ düğmesi onları
  katlar. Aramada bulunmayan bir üst kayıt da alt görevlerinin başında soluk
  görünür. Ağaçta ↑/↓, Home/End gezinir; ← katlar, → açar.
  - **Tür süzgeci:** listenin üstünde her kayıt türü için bir çip (kaçar
    tane olduğuyla); birkaçı birlikte seçilebilir. Yüklenmiş sonuçları süzer.
  - **Sağ tık** (ya da Menü tuşu / Shift+F10): **1h / 2h / 3h / 5h / 8h**
    düğmeleri formda hatırlanan seçimlerle **bugüne** efor girer (sonuç
    satırda görünür; zorunlu bir Tempo özelliği hiç seçilmemişse kayıt efor
    formuyla açılır), **Efor gir…**, favorilere ekle/çıkar, **Aç**,
    **Anahtarı kopyala**.
  - **Favoriler:** satırdaki ☆ (üstüne gelince görünür), sağ tık menüsü ya
    da kayıt penceresindeki düğmeyle eklenir; Jira sitesi başına ayarlarda
    saklanır ve eklenme sırasıyla listelenir. Artık okunamayan bir favori
    saklandığı haliyle görünür.
- Kalem Jira'ya kendiliğinden yazmaz: efor girişi ve statü değişikliği
  yalnızca senin tıklamanla yapılır; asistanın Jira'ya yazmaları (kayıt
  açma, yorum, statü) her seferinde onay ister.

**Paneller ve Ayarlar**

- Başlıklar, Dosyalar, Confluence ve Jira panelleri IDE'lerdeki araç
  pencereleri gibi **sol**, **sağ** ya da **alt** (belgenin altı) yuvaya
  yerleştirilir ya da gizlenir. Bir yuva aynı anda bir paneli gösterir ve
  başlığında, asistan paneli gibi, o panelin simgesi ve adı yazar. Panellerin
  sekmeleri pencerenin kenarındadır: sol ve sağ yuvanınkiler asistanın düğmesi
  gibi **dikey** (solda kendi şeridi, sağda asistanın üstü), alt yuvanınkiler
  durum çubuğunda **yatay**. Sekme paneli açar; o panel zaten açıksa yuvayı
  kapatır.
- Bir panelin sekmesine ya da yuvanın başlığına sağ tıklamak (ya da yuvanın
  **⋯** düğmesi) onu **Sola / Sağa / Alta Taşı** ya da **Gizle** seçeneklerini
  verir. Sağ ve alt yuvalar da kenarlarından sürüklenerek boyutlandırılır
  (çift tık varsayılana döner); yerler ve boyutlar hatırlanır.
- **Confluence ve Jira panelleri yalnızca bağlantı kurulunca görünür**;
  bağlantı kesilince kaybolur.
- **Dosya → Ayarlar…** (`Ctrl+,`; macOS'ta uygulama menüsünde de): bütün
  ayarlar tek pencerede, solda kategoriler — **Görünüm** (tema, dil,
  yakınlık, tam genişlik), **Düzenleyici** (otomatik kaydetme, yazım
  denetimi), **Paneller** (panellerin yeri, yuvaların açıklığı ve
  boyutları), **Asistan** (hizmet ve model, panel, belgeyi paylaşma),
  **Bağlantılar** (Confluence ve Jira: bağlan / bağlantıyı kes), **Sayfa
  Düzeni** (kâğıt, yönlendirme, kenar boşlukları, sayfa numarası) ve
  **Sistem** (güncelleme denetimi, bildirim alanı, Git'i otomatik getirme).
  Üstteki arama kutusu bütün kategorilerde arar; Türkçe ya da İngilizce
  yazılabilir, harf ayrımı ve şapka/nokta farkı gözetmez ("koyu", "dark",
  "kagit"). Her kategoride **Varsayılanlara Dön** düğmesi vardır. Menülerdeki
  ve şeritteki hızlı ayarlar (tema, dil, sayfa düzeni…) yerinde durur;
  oradan yapılan değişiklik açık pencerede hemen görünür.

**Diyagramlar**

- **Ekle → Diyagram** akış diyagramı düzenleyicisini ayrı bir panelde açar:
  soldaki şekiller (Başla/Bitir, Adım, Karar, Girdi/Çıktı, Belge,
  Veritabanı, Alt süreç, Bağlayıcı, Metin, Çoklayıcı, Grup) kanvasa sürüklenir ya da
  tıklanır — bir şekil seçiliyken tıklanan yenisi altına, ona bağlı olarak
  eklenir. Şekillerin kenarındaki noktalardan sürükleyerek ok çizilir; şekle
  ya da oka çift tıklayınca yazılır (Shift+Enter yeni satır). Bir kararın
  ilk çıkışı **Evet**, ikincisi **Hayır** etiketini kendiliğinden alır; yana
  giden dal elmasın köşesinden çıkar.
  - **Metin şekle sığar:** uzun metin şeklin içinde satırlara bölünür;
    yine sığmazsa yazı, kelimeler bölünmeden ve satırlar şeklin dışına
    taşmadan sığana kadar küçülür (en az 6 punto). Elmas, daire ve belgenin
    dalgalı alt kenarı gibi daralan yerler hesaba katılır. Küçülen yazı
    yakınlaştırılarak okunur; şekli büyütmek yazıyı yeniden büyütür.
    - Satırlar gerçek yazı tipiyle ölçülerek bölünür; resim başka bir
      bilgisayarda ya da Confluence'ta açıldığında da taşmasın diye
      Segoe UI, Arial ve sistemin yazı tipinden en genişi esas alınır.
    - Yazısı 10 puntonun altına inen şeklin köşesinde turuncu bir nokta
      çıkar (yalnızca düzenleyicide). Böyle bir şekil seçiliyken araç
      çubuğundaki **Şekli metne göre büyüt** şekli önce en uzun kelimeye
      yetecek kadar genişletir, sonra metin 14 puntoda sığana kadar
      uzatır (daire iki yönde büyür); grubu da onunla büyür, Ctrl+Z
      geri alır.
    - Şekle yazarken kutudaki yazı, şeklin çizeceği boyutta görünür.
  - **Seçim:** tıklama, Shift/Ctrl+tıklama (seçime ekler/çıkarır), boş
    kanvasta sürükleyerek seçim kutusu, Ctrl+A. Seçilenler birlikte taşınır,
    silinir, renklendirilir, ok tuşlarıyla kaydırılır.
  - **Kopyala / kes / yapıştır / çoğalt** (Ctrl+C / X / V / D): aradaki
    oklarla birlikte; başka bir diyagrama da yapıştırılır.
  - **Hizalama:** birden fazla şekil seçiliyken sola/ortaya/sağa,
    üste/ortaya/alta hizalama ve yatay/dikey eşit aralıkla dizme. Taşırken
    başka bir şeklin kenarı ya da ortasıyla hizalanınca kılavuz çizgisi
    çıkar ve şekil oraya oturur (Alt basılıyken kılavuz yok).
  - **Otomatik yerleşim:** akışı yukarıdan aşağıya katmanlara dizer; geri
    dönen oklar düzeni bozmaz. Gruplar tek bir şekil gibi yerleşir, içleri
    korunur.
  - **Gruplar:** paletteki **Grup** bir kap çizer (ör. "Backend servisi").
    İçine bırakılan şekil o grubun olur; Ctrl+G seçilenleri yeni bir gruba
    alır, Ctrl+Shift+G grubu çözer. Grup taşınınca, kopyalanınca ya da
    silinince içindekiler de gelir; grup içindekileri sığacak kadar büyür.
    Grubun içindeki şekiller birbirine, grubun kendisi de içindekilere
    bağlanabilir (kenarından içeri çizgi); **dışarıdan içerideki bir şekle
    bağlanılamaz** — dışarısı gruba bağlanır. Dışarıya bağlı bir şekil gruba
    taşınırsa o bağlantı gruba aktarılır. Grubun gövdesine çift tıklamak
    içine yeni bir adım ekler, başlığına çift tıklamak adını değiştirir.
  - **Çoklayıcı (MUX):** gelen oklar uzun kenarında, kaynaklarının sırasına
    göre aralıklı girer; çıkış kısa kenardan çıkar. **Döndür** ile dört yöne
    çevrilir.
  - Oklar: tek uç / çift uç / uçsuz, düz ya da kesikli. Taşıma, köşeden
    boyutlandırma, geri al/yinele (Ctrl+Z / Ctrl+Y), yakınlaştırma
    (Ctrl+tekerlek); görünüm tekerlek, orta tuş ya da Boşluk+sürükle ile
    kaydırılır.
- Her diyagram **iki dosyadır**: belgede görünen resim `<ad>.diagram.png`
  (her yerde açılan sıradan bir PNG) ve diyagramın verisi (şekiller, oklar,
  yazılar, konumlar) `<ad>.diagram.json`. Düzenleyici veriyi JSON'dan okur.
  JSON kaybolursa diye verinin bir kopyası PNG'nin içinde de (`iTXt`,
  `kalem-diagram`) durur; JSON yoksa oradan açılır.
  - `.md` belgesinde iki dosya da `<belge>.assets/` klasörüne yazılır; belge
    kaydedilmemişse önce kaydedilir. Belge başka bir yere kaydedilince ya da
    pakete çevrilince JSON da resimle birlikte taşınır.
  - `.kmd` paketinde iki dosya da paketin `assets/` klasörüne girer;
    düzenlenen bir diyagram paketi kaydedilmemiş yapar.
  - Confluence sayfasında iki dosya da sayfaya **ek olarak yüklenir**; sayfada
    resim görünür. Her düzenleme iki ekin de yeni sürümü olur.
- Diyagram resminin üzerine gelince çıkan **✎ Diyagramı Düzenle** düğmesi ya
  da resme çift tıklamak düzenleyiciyi verisiyle açar; kaydetmek aynı dosyayı
  yeniler.

**Yapay Zekâ Asistanı**

> **3.0'da yeni — analiz öncelikli ajan.** Asistan artık uygulamanın içinde
> olduğunu biliyor ve Kalem'i kendi araçlarıyla, **izin isteyerek** kullanıyor:
>
> - **Uygulamayı kullanma:** "koyu temaya geç", "Jira panelini alta taşı",
>   "asistanı sola al", "sayfayı yatay yap", "dışa aktar" gibi istekler
>   `settings_find`/`settings_set`, `pane_move`, `pane_show`, `app_command`
>   araçlarıyla yapılır. Her değişiklikten önce sohbette bir **onay kartı**
>   çıkar: **Uygula / Reddet**, ve isteğe göre *Her seferinde sor*, *Bu
>   oturumda tekrar sorma* ya da *Her zaman izin ver*. Her zaman izin
>   verilenler **Dosya → Ayarlar → Asistan**'da listelenir ve kaldırılabilir.
>   Yapılan her değişiklik yanıtın altında **Geri al** ile durur (birden
>   fazlaysa **Tüm Değişiklikleri Geri Al**). Program yolları, API
>   anahtarları, izinler ve bağlantılar asistana hiç gösterilmez.
> - **Az token:** her soruda yalnızca kısa bir tanıtım gider; diyagram
>   biçimi, menü rehberi, belge değişikliği biçimi, analiz ve prompt
>   rehberleri `kalem_help` ile gerektiğinde istenir. Uzun belgeler (24 000
>   karakterden uzun) yalnızca **ana hatlarıyla** gider; asistan gereken
>   bölümü `document_read`/`document_search` ile okur. Yanıtın altında
>   harcanan token gösterilir. API sohbetleri `/compact` ile özetlenebilir.
>   Araç çağıramayan modeller eskisi gibi tüm talimatları ve belgeyi alır.
> - **Modlar** (soru kutusunun altındaki seçici): *Otomatik*, *Sor*, *Analiz
>   Yaz*, *Analizi İncele*, *Prompt Hazırla*, *Kod*, *Uygulama*. Seçici her
>   modu simgesi, ne işe yaradığı ve kaç adımı açık olduğuyla gösterir.
>   Mod, modele verilen adımları ve araçları belirler. `/review`, `/write`,
>   `/prompt`, `/trace`, `/stories` modu seçip hazır soruyu sorar.
>   - **Otomatik** (varsayılan): her soru için modu sorunun sözlerinden
>     seçer ("incele", "gözden geçir" → İnceleme; "analiz yaz", "taslak" →
>     Yazma; "prompt", "Claude Code için" → Prompt; "kod", "bug", ".java" →
>     Kod; "ayar", "tema" → Uygulama; açık belge ya da çalışma alanı da
>     hesaba katılır). Model sorulmaz, anında seçer; seçilen mod sorunun
>     üstünde "Mod: Analizi İncele (otomatik seçildi)" diye yazar.
>   - **Dosya → Ayarlar → Asistan Modları** (ya da seçicideki **Modları
>     özelleştir…**): her mod bir **adım listesidir** ve modele bu sırayla
>     söylenir. Örneğin İnceleme: kural denetimi (lint), kapsam kontrolü,
>     çelişkiler, hata ve uç durumlar, test edilebilirlik, güvenlik ve
>     gizlilik, kodla karşılaştırma, bulguları kartta bildirme, kısa özet.
>     Adımlar açılıp kapatılır, sıralanır, adı ve modele söylenen metni
>     değiştirilir (**Kalem'in metnine dön** ile geri alınır); **Adım ekle**
>     ile kendi adımlarınız eklenir. Bir araca bağlı adım kapatılınca araç da
>     modele verilmez (ör. lint kapalıysa `analysis_lint` yok). Mod başına:
>     seçicide/otomatikte sunulsun mu, **ayrıntı** (kısa/normal/ayrıntılı),
>     **yanıt dili**, İncelemede **en düşük önem** ve **en çok bulgu**,
>     otomatik seçtiren **ek kelimeler**, **ek talimat**; **Asistana
>     söylenen** önizlemesi değiştikçe güncellenir; **Varsayılana döndür**.
>     Ayarlar yalnızca varsayılandan farkı saklar (`assistantModes`).
>   - **Yan yana inceleme** (Claude Code ve Copilot CLI; İnceleme modunda
>     **Kontrolleri yan yana çalıştır**, varsayılan açık): inceleme
>     istendiğinde Kalem kural denetimini kendisi çalıştırır, sonra her
>     kontrol adımını (kapsam, çelişkiler, uç durumlar, test edilebilirlik,
>     güvenlik, varsa kodla karşılaştırma ve kendi adımlarınız) ayrı bir
>     **inceleyiciye** verir; hepsi aynı anda çalışır (en çok 6, fazlası
>     paylaştırılır). Her inceleyici belgenin tamamını alır, yalnızca okuyan
>     araçları kullanır ve sohbeti sürdürmez. Bulgular geldikçe tek listede
>     toplanır (yeniden numaralanır, aynı cümle iki kez bildirilmez).
>     **Kontroller kartı** çalışırken aşamaları (Kurallar › Kontroller n/m ›
>     Özet), bir ilerleme çubuğu ve her kontrol için ne yaptığını, kaç bulgu
>     bulduğunu ve ne kadar sürdüğünü (canlı) gösterir. Bitemeyen bir
>     kontrol nedeniyle birlikte kırmızı görünür ve **Yeniden Dene** ile tek
>     başına tekrar çalıştırılır (yanıt bittikten sonra da); bulguları aynı
>     listeye eklenir. Her şey bitince kart tek satıra iner ("5 kontrol · 11
>     bulgu · 0:42"); açılınca kontrol başına süre ve token görünür, başarısız
>     bir kontrol varken açık kalır. Sohbetin kendisi sonda yalnızca özetler. Süre adımların toplamı yerine en uzun kontrol kadar
>     olur, token harcaması artar. Önceki incelemeyle ilgili bir soru (yeni
>     inceleme istemeyen) tek yanıt olarak kalır; hiçbir inceleyici
>     çalışamazsa inceleme eskisi gibi tek yanıtta yapılır.
>   - **Kendi modlarınız** (Asistan Modları → **Yeni mod**): ad, simge ve
>     tek satırlık açıklama; asistana söylenen **talimat** (prompt); kendi
>     **adımlarınız**; Kalem'in **araçlarından** hepsi ya da yalnızca
>     seçilenler (aranabilir liste); ve **MCP sunucuları**: bu bilgisayarda
>     çalışan bir program (stdio: komut, her satıra bir argüman,
>     `ANAHTAR=değer` ortam değişkenleri) ya da bir adres (HTTP: adres ve
>     başlıklar), her biri açılıp kapatılabilir ve kullanabileceği araçlar
>     seçilebilir. Mod seçiliyken bu sunucular Claude Code'un
>     `--mcp-config` ve Copilot CLI'ın `--additional-mcp-config`
>     yapılandırmasına Kalem'in kendi sunucusunun yanına eklenir; Claude
>     Code onları sormadan çağırabilir (`mcp__<ad>`). API hizmetleri MCP
>     sunucusu kullanmaz. Kendi modlarınız seçicide ve otomatik seçimde
>     (adları ve ek kelimeleriyle) görünür; ayrıntı ve yanıt dili de
>     seçilir. Bir MCP sunucusu bu bilgisayarda program çalıştırabildiği
>     için asistan bu ayarı göremez; sunucularını yalnızca
>     `mode_mcp_change` ile ve her seferinde sorarak değiştirir (aşağıda).
>   - **Kalem'in kendi modlarında da MCP sunucuları** (Asistan Modları →
>     ör. **Kod** → **MCP sunucuları**): kendi modlarınızdakiyle aynı kart,
>     ek olarak **Ne için (asistana söylenir)** alanı. Bu metin modele
>     sunucunun adı ve araçlarıyla birlikte söylenir ve "iş bu amaca
>     uyduğunda sorulmadan kullan" talimatı eklenir; böylece örneğin Kod
>     modunda yazılan yeni bir i18n anahtarı veritabanına da eklenir.
>     **Hazır sunucular** listesi tek tıkla dolu bir kart ekler: DBHub
>     (parametre sorgusu ve i18n ekleme, yalnızca sabit sorgular), GitHub,
>     Git, Filesystem, Context7, Playwright, Sentry, Fortify (fcli),
>     Graylog, Fetch, Memory ve Figma; köşeli parantezli yerler
>     (`<GITHUB_TOKEN>`…) kullanıcıya kalır. Asistan mod ayarlarını
>     okuyabilir ama sunucuların yalnızca adını, araçlarını ve amacını
>     görür; komut, argüman, ortam değişkeni, adres ve başlıklar ona
>     gösterilmez (`assistantModes`).
>   - **Asistana söyleyerek bağlamak:** "DBHub'ı Kod moduna bağla, config
>     dosyası şurada" gibi bir istekte asistan `mode_mcp_list` ile modları,
>     bağlı sunucuları ve hazır sunucuları görür; `mode_mcp_change` ile bir
>     moda (Kalem'in ya da sizin) hazır ya da kendi verdiğiniz bir sunucuyu
>     ekler, alanlarını (araçlar, amaç, yol, token, açık/kapalı) değiştirir ya
>     da kaldırır. Program çalıştırabildiği için onay kartı her seferinde
>     çıkar: komutun ya da adresin tamamı, araçlar ve amaç görünür, token'lar
>     yalnızca başıyla (`Bear…`). Bu onay "her zaman izin ver" ile
>     hatırlanmaz; araç Ayarlar'da "sormadan çalıştır" yapılsa da sorulur.
>     Değişiklik o moddaki bir sonraki sorudan itibaren geçerlidir.
>     Ayrıntılı kullanım: [`docs/05-mcp-sunuculari.md`](../../docs/05-mcp-sunuculari.md).
> - **Analiz şablonları:** **Dosya → Şablondan Yeni…** ve **Dosya → Ayarlar →
>   Şablonlar**. Ekip şablonları açık klasörün `.kalem/templates/`
>   klasöründe (Git ile paylaşılır; aynı adlı kişisel şablonun önüne geçer),
>   kişisel şablonlar uygulama verisinde durur; Kalem ile bir *best practice*
>   şablonu gelir (salt okunur, **Kopyala ve Uyarla** ile kişiselleştirilir).
>   Şablon sıradan bir Markdown belgesidir; başındaki kısa ön bilgi
>   (`kalem-template`, `required`, `ids`, `questions`) adını, zorunlu
>   bölümlerini ve gereksinim kimliklerini söyler. Etkin belge şablon olarak
>   kaydedilebilir, `.md` ya da Word dosyası içe aktarılabilir; biri
>   varsayılan seçilir.
> - **Analizi İncele:** önce kural tabanlı, ücretsiz bir denetim
>   (`analysis_lint`: şablonun eksik ya da boş bölümleri, "hızlı", "uygun",
>   "vb." gibi ölçülemez ifadeler, TBD/TODO, tekrarlanan ya da atlanan
>   FR/BR/NFR kimlikleri, kabul kriteri olmayan gereksinimler, kırık
>   başlık bağlantıları), sonra modelin bulguları (çelişki, eksik senaryo,
>   test edilemezlik, güvenlik, kodla uyumsuzluk). Bulgular yanıtta
>   **geliştirmeye hazırlık puanıyla** listelenir. Her bulgu tek satırdır
>   (önem, numara, sorunun ilk cümlesi, türü); tıklayınca açılır, belgedeki
>   yerini gösterir ve **Göster**, **Düzelt**, **Açık Sorulara Ekle**,
>   **Not Ekle** ya da **Yoksay** ile ele alınır. Model bulguları aynı önemdeki
>   kural bulgularından önce gelir. Önem ve tür sayıları **süzgeçtir**
>   (tıklayınca liste daralır, **Tümünü göster** ile açılır). Şablonun
>   eksik bölümleri tek kalemde toplanır ("Şablonun 7 bölümü eksik"):
>   bölümler tek tek ya da **Tüm Bölümleri Ekle** ile belgenin sonuna
>   eklenir (belgede artık olan bölüm yeniden eklenmez), her biri ayrıca geri
>   alınabilir. Ele alınan bulgular açık kaldıkça yerinde durur (Geri Al
>   elinizin altında), kapatılınca sondaki **Ele alınanlar** bölümüne iner. Bulgular belgede yalnızca **oturum boyunca** işaretlenir;
>   Markdown'a ancak kullanıcı bir düğmeye basınca bir şey yazılır.
>   **Not Ekle**, alıntılanan paragrafın hemen altına bir alıntı bloğu
>   (`> 📝 **İnceleme F-01:** …`, Confluence'ta da görünür) koyar ve onu
>   görünür yapar; **Açık Sorulara Ekle** "Açık Sorular" bölümüne bir görev
>   satırı ekler (bölüm yoksa belgenin sonunda açılır). Ele alınmış bir
>   bulgunun **Göster** düğmesi belgeye ne konduysa (düzeltme, not, soru)
>   onu gösterir; **Geri Al** yalnızca o bulgunun değişikliğini geri alır
>   (sonraki düzenlemeler kalır) ve bulguyu yeniden açar, düğmeleri yine
>   çalışır. Değişiklik belgede zaten geri alındıysa (`Ctrl+Z`), Geri Al
>   yalnızca bulguyu yeniden açar.
> - **Prompt Hazırla:** belgeden (ya da seçili kısımdan) kodlama ajanı için
>   prompt; istenirse `.kalem/prompts/` altına kaydedilir (onaylı).
> - **Jira ve Confluence'a yazma:** gereksinimlerden toplu story
>   (`jira_create_issues` — kartta hangilerinin oluşturulacağı seçilir),
>   yorum, durum değiştirme, Confluence sayfasına ekleme/oluşturma. **Bunlar
>   her seferinde sorulur**; çevrim içi işlemler için "oturumda" ya da "her
>   zaman" izni verilemez. Jira/Confluence içeriği okunduktan sonra gelen
>   değişiklik isteklerinde kart ayrıca uyarır.
> - **Agent arayüzü:** modelin planı kart olarak görünür (`plan_update`),
>   araç adımları yanıtın üstünde listelenir, soru kutusunda `@` yazınca
>   belgenin bölümleri listelenir ve seçilen bölüm (belge paylaşılmasa da)
>   soruya eklenir. Asistan paneli **sağda, solda ya da belgenin altında**
>   durabilir (**Dosya → Ayarlar → Asistan** ya da asistana "kendini alta
>   al" demek); **✦ Asistan** düğmesi her zaman sağ kenardadır.
> - **Araçlara erişim:** API'lerde araçlar doğrudan; Claude Code'da her
>   soruya özel açılan Kalem MCP sunucusundan (`mcp__kalem__*`); GitHub
>   Copilot'ta CLI `--additional-mcp-config` destekliyorsa MCP ile, yoksa
>   yanıttaki ` ```kalem-tool ` bloklarıyla — MCP başlatılamazsa otomatik
>   olarak bloklara geçer (**Ayarlar → Asistan → Copilot, Kalem araçlarını
>   nasıl kullansın**).

- Pencerenin sağ kenarında her zaman duran **✦ Asistan** düğmesi,
  **Görünüm → Yapay Zekâ Asistanı** ya da `Ctrl+Shift+L` belgenin sağında bir
  sohbet paneli açar (düğmeye yeniden basmak kapatır). Panelin sol kenarı
  sürüklenerek genişletilip daraltılır (odaktayken ok tuşları da çalışır,
  çift tıklamak varsayılan genişliğe döndürür); genişlik hatırlanır. Paneldeki ⚙ (**Bağlantı ayarları**) asistanın hangi
  hizmeti kullanacağını seçer:

  | Hizmet | Nasıl bağlanır |
  |---|---|
  | **Claude Code (bu bilgisayar)** — varsayılan | Kurulu `claude` komutu, kendi oturumuyla; anahtar gerekmez |
  | **GitHub Copilot (bu bilgisayar)** | Kurulu GitHub Copilot CLI (`copilot`), Copilot aboneliği ve kendi oturumuyla; anahtar gerekmez, model isteğe bağlı |
  | **Anthropic (Claude API)** | API anahtarı; resmi Anthropic SDK'sıyla, varsayılan model `claude-opus-5-5` |
  | **OpenAI**, **Google Gemini**, **OpenRouter** | API anahtarı; OpenAI uyumlu Chat Completions API'si |
  | **GitHub Models** | `models:read` yetkili GitHub kişisel erişim jetonu; model adları `openai/gpt-4.1` gibi |
  | **Ollama**, **LM Studio** | Bu bilgisayarda çalışan yerel model; anahtar gerekmez |
  | **Diğer (OpenAI uyumlu)** | Herhangi bir `…/v1` adresi (Groq, Mistral, DeepSeek, şirket içi sunucu…) |

  Her hizmetin adresi değiştirilebilir; **Modelleri getir** hizmetin
  sunduğu modelleri listeler. Model seçicide modeller okunur adlarıyla
  görünür:
  - **Claude Code** model listelemez; takma adları (`opus`, `sonnet`,
    `haiku`) her yanıtın başında bildirdiği gerçek modelle adlandırılır
    ("opus · Opus 5.5") ve bu, sonraki açılışlar için hatırlanır
    (`assistant-models.json`); her yanıtın altında da yanıtlayan model
    yazar. Ayarlarda bir Anthropic API anahtarı varsa Anthropic'in tam
    listesi de gelir (tam adlar Claude Code'a da verilebilir).
  - **GitHub Copilot CLI:** hesabın modelleri VS Code'daki gibi GitHub'ın
    Copilot sunucusundan alınır (kurumun açtığı modeller dahil). GitHub
    girişi şu sırayla aranır: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
    `GITHUB_TOKEN`, Copilot eklentilerinin kayıtlı girişi
    (`github-copilot/apps.json`), `gh auth token`; yalnızca GitHub'a
    gönderilir. CLI'ın `--help`'i sabit bir model listesi veriyorsa CLI
    yalnızca onları kabul ettiği için liste onunla sınırlanır, adları
    hesabın listesinden gelir. Giriş bulunamazsa CLI'ın kendi listesi
    kalır. Anahtarlar işletim sisteminin şifrelemesiyle
  (`safeStorage`) `%APPDATA%\kalem-desktop\assistant.json` içinde saklanır,
  arayüze hiç dönmez; şifreleme yoksa yalnızca uygulama açıkken bellekte
  tutulur. İstekler Electron'un ağ katmanından gider (sistem vekil sunucusu
  ayarları geçerlidir). API'ler sohbeti hatırlamadığı için önceki mesajlar
  (en çok 40) her soruyla yeniden gönderilir; hizmet ya da model
  değişince yeni sohbet başlar.
- **Sohbetler:** başlıktaki 💬 düğmesi sohbet listesini açar. Her soru
  kendi sohbetinde kalır; listeden eski bir sohbete dönülür, **Yeni sohbet**
  yenisini başlatır, ✕ siler. Bir sohbet yanıt beklerken başkasına
  geçilebilir. Sohbetler `%APPDATA%\kalem-desktop\assistant-chats.json`
  içinde saklanır (en çok 100; soruyla giden belge saklanmaz) ve uygulama
  açılınca en son sohbet geri gelir. Claude Code ve Copilot sohbetleri
  kendi oturumlarıyla, API sohbetleri saklanan mesajlarla sürer.
- **Files bölmesindeki açık klasörler kendiliğinden çalışma alanıdır:**
  **Dosya → Klasör Aç…** ile açılan klasörler her sohbette, eklemeye gerek
  kalmadan, soru kutusunun üstünde klasör simgeli bir çip olarak görünür
  ve aşağıda anlatılan çalışma alanı gibi kullanılır. Çipin ✕'i klasörü
  yalnızca o sohbette dışarıda bırakır (sohbetle saklanır); **+** menüsündeki
  **Açık klasör: …** geri alır. Klasör kapatılınca çalışma alanından da
  çıkar.
- **Kaynak dosya ve klasörler:** soru kutusunun üstündeki **+** düğmesi
  sohbete dosya (**Dosya…**) ya da klasör (**Klasör…**) ekler.
  Yalnızca `.md` değil, her metin dosyası (`.txt`, `.java`, `.ts`, `.sql`,
  `.xml`…) okunur; resim, arşiv, `.class` gibi ikili dosyalar ve gizli,
  `node_modules`, `target`, `build`, `dist` klasörleri atlanır. Eklenenler
  soru kutusunun üstünde birer çip olarak görünür, ✕ ile çıkarılır ve
  sohbetle birlikte saklanır. Örneğin bir kod klasörü ile bir analiz notu
  ekleyip "yazılım analiz dokümanını yaz" denebilir.
  - **Eklenen klasör bir çalışma alanıdır:** dosyaları soruya gömülmez,
    bağlamı şişirmez. Soruyla yalnızca kısa bir özet gider (dosya sayısı,
    türleri, üst klasörler, en üstteki dosyalar); asistan gerek görürse
    dosyalarda **arar**, **listeler** ve istediği dosyayı ya da yalnızca
    istediği satırları **okur**. Klasörün dosya listesi bir kez dizinlenir
    ve bir süre yeniden kullanılır; aramalar klasörü baştan taramaz.
    Asistanın nelere baktığı yanıtın üstünde katlanmış bir listede görünür
    ("Çalışma alanına bakıldı (3)": aranan metinler, okunan dosyalar).
    Asistan yalnızca eklenen klasörlerin içini okuyabilir; dışarı çıkan
    yollar ve klasör dışına giden bağlantılar reddedilir. Kendi başına
    hiçbir dosyaya yazmaz.
  - **Hangi dosyalar:** klasör bir Git deposundaysa Git'in gördükleri
    (`.gitignore` kurallarına uyarak; `.github` gibi izlenen gizli
    klasörler dahil), değilse gizli ve `node_modules`/`target`/`build` gibi
    klasörler dışındakiler.
  - **Hızlı arama:** bilgisayarda `ripgrep` (`rg`) varsa aranacak dosyaları
    o bulur; Türkçe karakterli aramalarda da (kelimenin `i`/`I` içermeyen en
    uzun ASCII parçasıyla; dosya hangi kodlamada olursa olsun) ve sonra
    Türkçe büyük/küçük harf kurallarıyla kesin aranır. Dosyalar aynı anda
    birçoğu okunur, aranan metni hiç içermeyen dosya satır satır taranmaz;
    dosyaların metni bellekte tutulur (en çok 64 MB) ve değişmeyen dosya
    yeniden okunmaz. Dosya listesi biraz eskiyse (en çok 10 dakika) hemen
    kullanılır, yenisi arkada hazırlanır.
  - **Claude Code / Copilot:** klasör `--add-dir` ile okunabilir yapılır;
    asistan kendi araçlarıyla (yalnızca okuma) arar ve okur.
  - **API'ler (Anthropic, OpenAI uyumlu…):** Kalem modele `search`,
    `list_files`, `read_file` ve `propose_edit` araçlarını verir; model bir
    yanıtta en çok 30 tur araç çağırabilir. Modelin aynı turda istediği
    aramalar ve okumalar birlikte çalışır.
    - **Okunanlar hatırlanır:** bir yanıt için okunan dosyalar (en çok
      40 000 karakter) sohbetle birlikte sonraki sorulara da gider; model
      aynı dosyayı yeniden okumaz.
    - **Prompt önbelleği (Anthropic):** sistem mesajı, araçlar ve sohbetin
      o ana kadarki kısmı önbelleğe işaretlenir; sonraki tur ve sorularda
      yeniden işlenmez, daha ucuz ve hızlıdır.
    - **Dosya değişikliği önerisi:** "şunu düzelt" denince model
      değişikliği `propose_edit` ile önerir; yanıtta dosya adı, açıklama
      ve satır farkı (kırmızı çıkan, yeşil giren) olan bir kart çıkar.
      Dosyaya ancak **Dosyaya Uygula** ile yazılır; **Vazgeç** dosyayı
      değiştirmez. Uygulanırken dosya o arada değiştiyse uygulanmaz ve
      nedeni söylenir. Dosyanın satır sonları ve kodlaması korunur; UTF-8
      dışındaki eski kodlamalı (windows-1254) dosyalar için öneri yapılmaz.
      Öneriler uygulamanın o çalışmasında geçerlidir.
    - **Araç kullanamayan modeller:** istek hata verirse ya da model
      araç çağrısını yanıta metin olarak yazarsa (`{"name": "search", …}`),
      o yanıt silinir ve klasörlerin metni eskisi gibi soruyla gönderilir
      (dosya başına en çok 100 000, toplam 300 000 karakter).
  - **Tek tek eklenen dosyaların** metni ise doğrudan soruyla gider.
  Kaynaklar değişmedikçe aynı sohbette yeniden gönderilmez.
- **Model seçimi:** soru kutusunun üstündeki seçici etkin hizmetin
  modellerini listeler: API'lerde hizmetin kendi listesi; Claude Code ve
  GitHub Copilot'ta varsayılan model ile CLI'nin `--help` çıktısında
  `--model` için saydığı modeller (Copilot'ta `claude-sonnet-4.5`, `gpt-5`…;
  Claude Code'da `opus`, `sonnet`, `haiku` ve yardımın örnek verdiği tam
  adlar). Liste, panel ilk açıldığında bir kez sorulur. **Başka model…**
  ayarları açar; listede olmayan bir ad oraya yazılabilir.
  Model değiştirmek sohbeti bölmez, sonraki soru aynı sohbette yeni modelle
  gider. Her yanıtın altında onu hangi modelin verdiği yazar ve bu bilgi
  sohbetle birlikte saklanır. Boş bir sohbette **Son sohbetler** listesi
  önceki sohbetlere tek tıkla döner.
- **Komutlar:** kutuya `/` yazınca komut listesi açılır; yazdıkça hem
  komut adına hem Türkçe adına göre süzülür (`/kayd` → `/save`), ok
  tuşları ve Enter/Tab ile seçilir. Asistan komutları (`/new`, `/chats`,
  `/model <ad>`, `/settings`, `/share`, `/stop`, `/help`), hazır sorular
  (`/summarize`, `/diagram <ne çizilecek>`, `/improve`, `/to-table`) ve
  uygulama komutları (`/save`, `/save-as`, `/export-docx`, `/export-html`,
  `/export-confluence`, `/history`, `/find`, `/replace`, `/table`,
  `/new-diagram`, `/image`, `/source`, `/focus`, `/read-only`, `/open`,
  `/search`, `/format-code`). Uygulama komutları belgede imlecin son
  bulunduğu yerde çalışır. Seçimle çalışan hazır sorular: `/fix` (yazım ve
  dil bilgisi; seçim yoksa belgenin tamamı), `/shorten`, `/explain`,
  `/translate <dil>`; `/apply` son yanıttaki değişiklikleri uygular.
- **Confluence'ta arama:** Confluence'a bağlıyken (Gezinme bölmesi →
  Confluence ya da Dosya → Confluence'tan Aç) asistana "bunu Confluence'tan
  bul" gibi bir şey sorulunca kendisi arar ve okur: sayfaların içinde
  (başlık, metin, etiketler) ve başlıklarda arama yapar, farklı
  kelimelerle (kök, eş anlamlı, İngilizcesi) yeniden dener, uygun 1-4
  sayfayı okur ve yanıtı okuduklarına dayandırıp her sayfaya
  `[Başlık](adres)` bağlantısı verir. Yalnızca okur; hiçbir şeyi
  değiştirmez.
  - API'lerde (Anthropic, OpenAI uyumlu…) `confluence_search` ve
    `confluence_read_page` araçlarıyla; uzun sayfalar 24 000 karakterlik
    parçalar hâlinde okunur.
  - Claude Code'a aynı iki araç Kalem'in kendi **MCP sunucusuyla** gerçek
    araç olarak verilir (`mcp__kalem__confluence_search`,
    `mcp__kalem__confluence_read_page`; `--mcp-config` ve
    `--allowedTools` ile, sormadan kullanılır). Sunucu, uygulamanın kendi
    çalıştırılabilir dosyasıyla Node olarak (`ELECTRON_RUN_AS_NODE`)
    başlar ve her çağrıyı uygulamaya yalnızca `127.0.0.1`'de dinleyen,
    bu çalıştırmaya özel bir anahtarla korunan bir uç noktadan iletir;
    arama uygulamanın Confluence bağlantısıyla yapılır. Anahtar
    kullanıcı veri klasöründe yalnızca kullanıcının okuyabildiği
    `assistant-tools/mcp.json` dosyasında durur, komut satırına yazılmaz.
    Bağlıyken Claude Code'un kendi WebFetch aracı o siteye yasaklanır
    (`WebFetch(domain:…)`): şirket ağındaki, oturum isteyen siteye zaten
    ulaşamaz.
  - Jira'ya bağlıyken asistan Jira kayıtlarını da okur: API'lerde
    `jira_get_issue` ve `jira_search` araçlarıyla, Claude Code'da aynı MCP
    sunucusundan `mcp__kalem__jira_get_issue` ve `mcp__kalem__jira_search`
    olarak (Jira'nın adresine WebFetch yasaklanır), Copilot'ta
    ` ```kalem-jira ` istekleriyle (`<jira-results>`). `/jira <anahtar ya da
    ne aranacak>` hazır sorar. Bakılanlar listesinde "QR-1 Jira kaydı
    okundu", "Jira'da arandı: …" görünür.
  - GitHub Copilot'ta model yanıtına bir ` ```kalem-confluence ` isteği
    yazar; Kalem aramayı/okumayı yapıp sonuçları aynı sohbete
    `<confluence-results>` olarak geri gönderir (en fazla 6 tur, turda 6
    istek). İstek blokları yanıtta görünmez. MCP sunucusu
    başlatılamazsa Claude Code da bu yolu kullanır.
  - Yapılan aramalar ve okunan sayfalar yanıtın üstünde **Bakılanlar**
    listesinde görünür ("Confluence'ta “onay” arandı", "“Sprint Planı”
    Confluence sayfası okundu"). `/confluence <ne aranacak>` aynı soruyu
    hazır sorar. Bağlı değilken model bağlanmayı söyler.
- **Belgede değişiklik ve komut önerileri:** model, belgeyi değiştirmesi
  istendiğinde (düzelt, kısalt, çevir, yeniden adlandır, sil, sona ekle…)
  ya da bir uygulama komutu gerektiğinde (kaydet, Word'e aktar, sürüm
  geçmişi…) yanıtına ` ```kalem-actions ` bloğunda JSON eylemler yazar
  (`src/shared/actions.ts`): `replace` (belgenin Markdown'ındaki metni
  birebir bulup değiştirir; `all` ile her yerde), `insert` (imleç, baş ya
  da son), `document` (belgenin tamamı) ve izin verilen komut listesinden
  `command`. Panel bunları JSON yerine bir **Önerilen değişiklikler**
  kartında silinen/eklenen metin olarak gösterir; hiçbir şey kendiliğinden
  olmaz: **Uygula** metin değişikliklerini tek bir düzenleme olarak yapar
  (bulunamayan ya da birden çok kez geçen metin hata verir, belge
  değişmez), **Geri Al** eski metni getirir; önerilen her komut kendi
  **Çalıştır** düğmesiyle çalışır. Değişiklik öneren bir yanıtta **Belgeye
  Ekle** gösterilmez.
- **Sohbet ekranı:** soru kutusu ile paylaşım, kaynak ekleme ve model
  seçimi tek bir çerçevededir. Belgede metin seçiliyken kutunun üstünde
  **İyileştir, Kısalt, Yazımı düzelt, Çevir, Açıkla** düğmeleri çıkar.
  Yanıt beklenirken "Düşünüyor…", diyagram ya da değişiklik yazılırken
  JSON yerine "Diyagram çiziliyor…" / "Değişiklikler hazırlanıyor…"
  görünür. Kod bloklarının köşesinde **Kodu kopyala**, soruların altında
  **Kopyala** ve **Düzenle ve yeniden sor**, son yanıtın altında **Yanıtı
  yeniden oluştur** (hatada **Yeniden dene**) vardır. Boş kutuda `↑` son
  soruyu geri getirir; yukarı kaydırınca **Son mesaja git** düğmesi çıkar;
  **Sohbetler** listesi başlığa göre aranabilir.
- **Claude Code** ya da **GitHub Copilot** seçiliyken uygulama programı
  (`claude`, `copilot`) kendisi bulur; ayar gerekmez. Sırayla, biri
  `--version`'a yanıt verene kadar şuralara bakar (`src/main/cli-find.ts`):
  1. Daha önce gösterilen ya da bir aramada seçilen program.
  2. `PATH` ve kurulum araçlarının klasörleri: `~/.local/bin`,
     `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`; Windows'ta
     `%APPDATA%\npm`, WinGet bağlantı klasörü, pnpm, Yarn, Volta, Bun, scoop,
     `Program Files\nodejs`. Şirket bilgisayarlarında ev klasörü ağ sürücüsü
     olabildiği için `USERPROFILE`, `HOME` ve `HOMEDRIVE`+`HOMEPATH` üçü de
     denenir.
  3. npm'in genel paket klasörleri. Bağlantı (`claude.cmd`) bir kabukla
     çalıştırılmaz, neyi başlattığı okunur: betikse Node ile, güncel Claude
     Code paketinde olduğu gibi programın kendisiyse (`bin\claude.exe`)
     doğrudan çalıştırılır. Bağlantı yoksa ya da okunamıyorsa paketin içine
     bakılır: önce bu bilgisayar için derlenmiş program
     (`@anthropic-ai/claude-code-win32-x64\claude.exe`,
     `@github/copilot-win32-x64\copilot.exe`; Node gerekmez), sonra paketin
     `bin` alanındaki dosya. `.npmrc`'deki `prefix` ve nvm, fnm, nvs, Volta,
     mise, asdf, nodenv'in sürüm klasörleri de bu gözle taranır.
  4. Kendi kopyasını getirenler: VS Code, Cursor, Windsurf ve benzerlerinin
     eklenti klasörü (`~/.vscode/extensions/anthropic.claude-code-*`; VS
     Code'un `claude` hiçbir `PATH`'te yokken de çalışmasının nedeni bu),
     Copilot eklentisinin paketleri, Claude masaüstü uygulamasının indirdiği
     kopya, kurulum aracının `versions` klasörü, WinGet paket klasörü.
  5. Windows'ta kayıt defterindeki güncel `PATH` ve ortam değişkenleri:
     çalışan bir uygulama açıldığı andaki `PATH`'i taşır, sonradan kurulan
     program yalnızca burada görünür.
  6. npm'in kendi yanıtı (`npm root -g`): npm, `npm.cmd` ile değil Node'la
     betik olarak çalıştırılır; komut istemi yasak olsa da çalışır.
  7. Windows'ta bu oturumda çalışan `claude.exe`/`copilot.exe` (düzenleyici
     onu açık tutuyorsa kurulu olduğu yerden çalışıyordur); diğer
     sistemlerde giriş kabuğunun bulduğu yol (`command -v`).

  Aynı adlı masaüstü uygulaması (`Claude.exe`) program sanılmaz: yanında
  Chromium dosyaları olan klasördeki dosya çalıştırılmaz. `KALEM_CLAUDE` /
  `KALEM_COPILOT` ortam değişkeni verilirse yalnızca o dosya denenir.
- Program yine bulunamazsa panel kurulumu anlatır
  (`npm install -g @anthropic-ai/claude-code`, sonra terminalde bir kez
  `claude` ile oturum açmak), API anahtarıyla bir hizmete bağlanmayı önerir
  ve şunları sunar:
  - **Bilgisayarda Ara:** kullanıcının kendi klasörleri ve kurulu
    programların klasörleri, ardından sabit disklerin geri kalanı klasör
    klasör taranır (ağ sürücüleri hariç, süre sınırlı). Şirket politikasıyla
    gizlenmiş bir sürücüyü dosya penceresi göstermez ama uygulama okuyabilir;
    bu arama onun içindir. Windows'ta kullanıcının kendi klasörleri haftada
    bir kendiliğinden de taranır. Taramada bulunan dosya **çalıştırılmaz**:
    o adı taşıyan bir dosya (bir indirme, örneğin) her şey olabilir. Bulunanlar
    panelde yollarıyla listelenir; **Kullan** denince denenir ve sonraki
    açılışlar için saklanır.
  - **Konumu Seç…** ya da yolu yapıştırmak: programın dosyası ya da içinde
    bulunduğu klasör (Node'un klasörü, `node_modules`, paketin klasörü)
    yeter. Yapıştırılan yol için uygulama önce onay sorar.
  - **Arama ayrıntılarını kopyala:** nerelere bakıldığını ve var olan her
    dosyanın ne yanıt verdiğini panoya koyar; "kurulu ama bulunmuyor"
    durumunda nedeni buradan görülür.
- Copilot'a sistem talimatı verilemediği için Kalem tanıtımı sohbetin ilk
  sorusuyla gider; araçlardan komut çalıştırma ve dosya yazma kapalıdır
  (`--deny-tool shell`, `--deny-tool write`).
- **Belgeyi paylaş** açıkken her soruyla birlikte belgenin Markdown'ı,
  belgedeki Kalem diyagramlarının verisi ve belgede seçili metin gider
  (seçim, giriş kutusunun üstündeki etiketten çıkarılabilir). Belge önceki
  sorudan beri değişmediyse yeniden gönderilmez. Sohbet sürer (Claude Code'da `--resume`, API'lerde geçmiş yeniden gönderilir);
  **Yeni sohbet** baştan başlar. Yanıt geldikçe görünür; **Durdur** ya da
  `Esc` keser.
- Modele, hangi hizmet olursa olsun, sistem talimatıyla Kalem tanıtılır
  (`src/shared/claude.ts`):
  - Kalem'in gösterdiği Markdown: GFM tabloları, görev listeleri, dipnotlar,
    renkli metin (`<span style="color:…">`), `mermaid` ve `math` blokları.
  - **Kalem diyagramlarının biçimi:** şekiller (Başla/Bitir, Adım, Karar,
    Girdi/Çıktı, Belge, Veritabanı, Alt süreç, Bağlayıcı, Metin, Çoklayıcı,
    Grup), renkler, ok etiketleri, kesikli/çift uçlu oklar, gruplar ve
    gruba bağlanma kuralı. Model diyagramı ` ```kalem-diagram ` bloğunda
    JSON olarak yazar; koordinat vermesi gerekmez, Kalem yukarıdan aşağıya
    yerleştirir ve grupları içeriklerine göre boyutlar.
  - **Uygulamanın kabiliyetleri:** dışa/içe aktarma, Confluence, sürüm
    geçmişi, paketler, tablo rengi ve sütun genişliği yorumu
    (`<!-- kalem:table … -->`), kod biçimlendirme, görünüm seçenekleri…
    Menü ve düğme adları arayüzün dilindeki metinlerden alınır; model
    "nasıl yaparım" sorularına ekranda görünen yolu söyler
    (ör. "Dosya" → "Dışa Aktar" → "PDF").
- Yanıtın altında **Belgeye Ekle** yanıtı imlecin olduğu yere koyar
  (diyagramlar resim + JSON olarak `<belge>.assets/` klasörüne, Confluence
  sayfasında ek olarak yazılır; tablo stil yorumları uygulanır) ve
  **Kopyala**. Diyagram kartında **Diyagramı Ekle**, **Düzenleyicide Aç**
  (diyagram düzenleyicisinde açar, kaydedince eklenir) ve model belgedeki
  bir diyagramı değiştirdiyse **Belgede Güncelle** (aynı dosyayı yeniler).
  Mermaid blokları panelde önizlenir.
- Claude Code dosya değiştiren ve komut çalıştıran araçlar kapalı olarak
  (`--disallowedTools Bash Edit Write MultiEdit NotebookEdit`) çalıştırılır;
  yeni bir sohbet etkin belgenin klasöründe başlar.

**Düzenleme**

- Şerit: Giriş / Ekle / Görünüm sekmeleri, stil galerisi, hızlı erişim.
- Tabloda **Tab** sonraki, **Shift+Tab** önceki hücreye geçer ve içeriğini
  seçer (yazınca değişir); son hücrede Tab yeni bir satır ekler.
- İmleç tablodayken **Tablo** sekmesi: satır/sütun ekleme-silme, hizalama,
  bir sütuna göre **sıralama** (A→Z / Z→A; sayılar değerine, metin belgenin
  dilinin alfabesine göre), **sütun genişliği** (sütun kenarını sürükleyerek
  ya da düğmelerle) ve **tablo rengi**.
- Genişlik ve renk Markdown'da karşılığı olmayan şeylerdir; tablonun üstüne
  `<!-- kalem:table color=blue widths=120,,200 -->` biçiminde bir yorum olarak
  yazılır. Editörde bu yorum görünmez; başka Markdown araçları tabloyu düz
  gösterir. Renk ve genişlik değişiklikleri Ctrl+Z ile geri alınır; HTML ve
  PDF dışa aktarmada, yazdırmada ve kopyalamada korunur.
- **Yazı rengi** (Giriş → **A** düğmesi): seçili metin dokuz renkten birine
  ya da **Diğer renkler…** ile sistemin renk seçicisinden herhangi bir renge
  boyanır, **Otomatik** rengi kaldırır. Seçim yokken seçilen renk imleçte
  bundan sonra yazılana uygulanır (imleç başka yere gidince unutulur).
  Markdown'da renk sözdizimi olmadığı
  için dosyaya `<span style="color:#e03131">metin</span>` olarak yazılır;
  HTML/PDF dışa aktarmada ve yazdırmada da görünür.
- **Büyük/küçük harf** (Giriş → **Aa** düğmesi, **Biçim → Büyük/Küçük
  Harf**): BÜYÜK HARF, küçük harf, Her Kelimenin İlk Harfi Büyük, Cümle
  düzeni, bÜYÜK/kÜÇÜK dEĞİŞTİR ve **Fazla Boşlukları Sil**. Seçim yoksa
  imlecin bulunduğu kelimeye uygulanır. `Shift+F3` Word'deki gibi küçük →
  BÜYÜK → Başlık düzeni arasında dolaşır. Dönüşüm belgenin dilinin
  kurallarıyla yapılır (Türkçede i ↔ İ, ı ↔ I); kalın, renk, bağlantı gibi
  biçimler korunur, satır içi koda dokunulmaz. Seçim tek bir paragrafın ya
  da hücrenin içinde olmalıdır.
- **Blokları birleştirme** (Giriş → Paragraf, **Biçim → Blokları Birleştir**,
  `Ctrl+Shift+M`): fareyle sürükleyerek seçilen bloklar ilk blokta toplanır.
  Yalnızca imleç varsa blok bir üsttekiyle birleşir. Paragraf ve başlıklar
  satır satır (satır sonuyla) birleşir; ilk blok kod bloğuysa ötekiler kod
  satırı, listeyse madde, alıntıysa alıntının içeriği olur. Birleştirilmiş
  paragrafı **Kod** stiline çevirmek satırları korur — çok satırlı bir metni
  tek kod bloğuna almanın yolu budur.
- Kod bloğunun içine doğrudan yapıştırılabilir; panodaki metin biçimsiz girer.
- Kalem'in balon araç çubuğu, `/` menüsü, blok tutamağı ve bağlantı balonu.
- Görsel ekleme: dosyadan, yapıştırarak ya da sürükleyerek.
- **Dosya ekleme** (Ekle → Dosya Ekle ya da dosyayı pencereye sürükleyerek):
  PDF, Excel, zip… herhangi bir dosya belgenin yanındaki `<belge>.assets/`
  klasörüne **kopyalanır** ve belgeye bağlantı olarak girer; özgün dosyaya
  dokunulmaz. Kaydedilmemiş belge önce kaydedilir. Bağlantıya `Ctrl+tık`
  dosyayı klasöründe gösterir (hiçbir zaman çalıştırmaz).
- **Mermaid diyagramları ve matematik**: dili `mermaid` olan kod blokları
  diyagram, `math` (ya da `latex`, `katex`, `tex`) olanlar KaTeX ile formül
  olarak kodun altında önizlenir. Kod olduğu gibi kalır ve düzenlenir;
  yazmaya ara verilince önizleme yenilenir, hatalı içerikte hata iletisi
  görünür. Önizlemeler PDF'te ve yazdırmada da çıkar; HTML dışa aktarmada
  kodun yerine satır içi SVG (diyagram) ve MathML (formül) yazılır. Mermaid
  ve KaTeX ilk gerektiklerinde yüklenir, açılışı yavaşlatmaz.
- Bul ve değiştir, Markdown kaynağı kipi, gezinti (içindekiler) bölmesi,
  kelime sayacı, kod vurgulama.
- Kod bloklarındaki **JSON, JSONC, XML, HTML ve YAML'ı biçimlendirme**: imleç kod bloğundayken
  açılan **Kod** sekmesi ya da `Shift+Alt+F`; **Biçim → Tüm Kod Bloklarını
  Biçimlendir** belgedeki hepsini düzenler. Değerler yeniden yazılmaz
  (`1.0`, büyük sayılar, XML'deki metin, YAML'daki `010` / `yes` olduğu
  gibi kalır); geçersiz içerik değiştirilmez ve bildirilir. Dili yazılmamış
  blok içerikten tanınır. JSONC'de yorumlar ve sondaki virgüller, YAML'da
  yorumlar, çapalar ve tırnak biçimi korunur. HTML'de `script`, `style`,
  `pre` içeriği ve metin içeren elemanlar olduğu gibi kalır; `</li>`, `</p>`
  gibi isteğe bağlı kapanış etiketleri eksik olabilir.
- Windows görev çubuğu atlama listesi: son belgeler ve **Yeni Pencere**
  (kurulu ve taşınabilir sürüm). Zaten açıkken çift tıklanan belge açık
  pencerede yeni sekme olur.
- Açık / koyu / sistem teması, yakınlaştırma, tam genişlik, odak modu,
  salt okunur kip, yazım denetimi.
- Arayüz Türkçe ve İngilizce (sistem diline göre; **Görünüm → Dil**).

## Simge

Kaynak `resources/icon.svg`. Değiştirildikten sonra
`node scripts/render-icon.mjs` 1024 px `resources/icon.png` üretir;
electron-builder `.ico` ve `.icns`'i bundan çıkarır.

## Yapı

```
src/main/       ana süreç: pencereler, yerel menü, disk, Word (.docx → HTML)
src/preload/    arayüze açılan tek kapı (window.kalem)
src/renderer/   arayüz: şerit, editör oturumu, Word HTML'i → Markdown
src/shared/     iki sürecin ortak, saf kodu ve IPC sözleşmesi
e2e/            Playwright ile gerçek uygulamayı süren testler
```

- Arayüz süreci yalıtılmıştır (`contextIsolation` + `sandbox`); diske
  yalnızca ana süreç dokunur ve bir pencere yalnızca açtığı ya da
  kullanıcının kaydetme kutusunda seçtiği yola yazabilir.
- Belgeye göre adreslenen görseller `kalem-doc://` şemasıyla sunulur; bu
  şema yalnızca görsel dosyalarını verir.
- Kalem paketleri `apps/notlar` ve `apps/playground` gibi derlenmiş
  çıktıdan (`dist`) tüketilir.
- **Keşif testi** (`e2e/explore.spec.ts`): uygulamayı belgeyi değiştirmemesi
  gereken 40'a yakın eylemden geçirir (paneller, tam genişlik, odak modu,
  kaynak görünümü, yakınlaştırma, diyaloglar, sekmeler, pencere boyutu,
  notlar…). Her adımdan sonra okunan paragrafın yerinden kaymadığını, yana
  taşma olmadığını, belgenin "kaydedilmemiş" olmadığını, Escape ile kapanan
  diyaloglarda odağın belgeye döndüğünü ve hata kaydı düşmediğini denetler.
  `KALEM_EXPLORE_SHOTS=<klasör>` her adımın ekran görüntüsünü,
  `KALEM_EXPLORE_REPORT=<dosya>` bulguları (testi düşürmeden) yazar.

## Bilinen sınırlar

- Tablo rengi ve sütun genişliği yalnızca en üst düzeydeki tablolarda
  çalışır (liste ya da alıntı içindekilerde değil).
- Tablo, yatay çizgi ve ham HTML blokları birleştirilemez; paragraf bir listeyle
  ancak liste **üstteyse** birleşir (madde olur).
- Yazı rengi seçimi tek bir paragrafın/hücrenin içinde olmalıdır. Dosyaya
  elle yazılmış renkler (`red`, `#123456`, `rgb(…)`) korunur ve gösterilir.
- Matematik yalnızca kod bloğu olarak yazılır (` ```math `); satır içi
  `$…$` ve `$$…$$` söz dizimi tanınmaz. Word'e dışa aktarmada diyagram ve
  formüller kod bloğu olarak kalır.
- Kod biçimlendirme JSON, JSONC, XML (SVG, RSS, plist… dâhil), HTML ve
  YAML içindir; JSON5, CSS, JavaScript ve öteki diller biçimlendirilmez.
  YAML'da katlanmış (`>`) metnin satırları birleşebilir (anlamı değişmez).
- Metin sekmesi bir kod editörü değildir: sözdizimi renklendirmesi,
  değiştir (replace) ve çoklu imleç yoktur. `.txt` için "birlikte aç"
  ilişkilendirmesi kurulmaz.
- Paket kaydedilirken yalnızca metinde bağlantısı olan dosyalar pakete girer;
  bağlantısı silinmiş bir görsel bir sonraki kayıtta paketten düşer. Paketin
  içindeki metin her zaman UTF-8 `text.md`'dir; başka bir uygulamanın
  `.textpack`'i açılıp kaydedilirse paket kökünde (sarmalayıcı klasörsüz)
  yazılır.
- Word'deki birleştirilmiş tablo hücreleri boş hücrelere açılır; EMF/WMF
  görseller atlanır ve bildirilir. Dipnotlar `[^1]` ve belgenin sonunda
  `[^1]: …` paragrafları olarak gelir; sonnotlar `[^e1]` olarak.
- Confluence sayfasında başlık değiştirilemez, yeni sayfa oluşturulamaz;
  sayfaya görsel dışında dosya eklenemez. Sayfa sekmesi otomatik kaydetmede
  Confluence'a yazılmaz (her kayıt bir sürüm olur), yalnızca kurtarma taslağı
  tutulur.
- Confluence'ta sayfaya, kullanıcıya ya da başka alana verilen bağlantıların
  Markdown'da adresi olmadığından yalnızca metinleri kalır. Durum (status),
  Jira gibi makrolar metne iner; içeriksiz diğer makrolar (içindekiler,
  çapa…) atlanır. Birleştirilmiş tablo hücreleri boş hücrelere açılır; altı
  çizili, üst/alt simge biçimi düşer.
- Dipnotlar editörde yazıldığı gibi görünür (çekirdekte dipnot söz dizimi
  yok); gerçek dipnota yalnızca Word ve HTML dışa aktarmada dönüşür. PDF ve
  yazdırmada metin olarak kalırlar. Tek kelimelik bir dipnotun referansı
  editörde bağlantı gibi (`^1`) görünür.
- macOS ve Linux'ta denenmedi. Windows kurulum paketi üretiliyor ama
  kurulup denenmedi; çalıştırılanlar `package:dir` çıktısı ve taşınabilir exe.
- Kurulum paketi 100 MB'ı aştığı için depoya konmaz (GitHub sınırı).
