# Kalem Masaüstü

Electron ile yazılmış, **Word rahatlığında** bir Markdown editörü. `.md`
belgeleriyle çalışır; diğer metin dosyalarını (`.txt`, `.java`, `.json`…)
Markdown'a çevirmeden ayrı bir **metin düzenleyicide** açar. Düzenleme
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
    dosyaları** (`.txt`, `.java`, `.json`, `.xml`, `.sql`…) **metin
    düzenleyicide**; resim, PDF gibi metin olmayan dosyalar sistemdeki
    uygulamalarıyla (soluk gösterilir). Program dosyaları (`.exe`, `.bat`,
    `.ps1`…) çalıştırılmaz, yalnızca klasörde gösterilir.
- **Metin düzenleyici:** Markdown olmayan metin dosyaları için ayrı bir
  pencere. Dosya **olduğu gibi** gösterilir ve kaydedilir: Markdown'a
  çevrilmez, kodlaması (UTF-8, UTF-16, BOM) ve satır sonları (CRLF/LF)
  korunur. Sekmeler, satır numaraları, eş genişlikli yazı, `Tab` ile sekme
  karakteri, **Satırları kaydır** seçeneği, durum çubuğunda satır/sütun
  ve kodlama. Kısayollar: `Ctrl+S` kaydet, `Ctrl+O` aç, `Ctrl+W` sekmeyi
  kapat, `Ctrl+Tab` sekmeler arası, `Ctrl+F` bul (`Enter`/`F3` sonraki,
  `Shift+Enter` önceki). Dosya açıldıktan sonra başka bir programca
  değiştirildiyse kaydederken üzerine yazmadan önce sorulur; kaydedilmemiş
  değişiklikle kapatırken de sorulur. 20 MB'tan büyük dosyalar metin
  düzenleyicide açılmaz. Eski tek baytlık kodlamalar (Windows-1254/1252)
  kaydederken UTF-8'e çevrilir.
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

**Diyagramlar**

- **Ekle → Diyagram** akış diyagramı düzenleyicisini ayrı bir panelde açar:
  soldaki şekiller (Başla/Bitir, Adım, Karar, Girdi/Çıktı, Belge,
  Veritabanı, Alt süreç, Bağlayıcı, Metin, Çoklayıcı, Grup) kanvasa sürüklenir ya da
  tıklanır — bir şekil seçiliyken tıklanan yenisi altına, ona bağlı olarak
  eklenir. Şekillerin kenarındaki noktalardan sürükleyerek ok çizilir; şekle
  ya da oka çift tıklayınca yazılır (Shift+Enter yeni satır). Bir kararın
  ilk çıkışı **Evet**, ikincisi **Hayır** etiketini kendiliğinden alır; yana
  giden dal elmasın köşesinden çıkar.
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
  sunduğu modelleri listeler. Anahtarlar işletim sisteminin şifrelemesiyle
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
- **Kaynak dosya ve klasörler:** soru kutusunun üstündeki **+** düğmesi
  sohbete dosya (**Dosya…**) ya da klasör (**Klasör…**) ekler; bir klasör
  açıksa (**Dosya → Klasör Aç…**) **Açık klasör** ile o da eklenebilir.
  Yalnızca `.md` değil, her metin dosyası (`.txt`, `.java`, `.ts`, `.sql`,
  `.xml`…) okunur; resim, arşiv, `.class` gibi ikili dosyalar ve gizli,
  `node_modules`, `target`, `build`, `dist` klasörleri atlanır. Eklenenler
  soru kutusunun üstünde birer çip olarak görünür, ✕ ile çıkarılır ve
  sohbetle birlikte saklanır. Örneğin bir kod klasörü ile bir analiz notu
  ekleyip "yazılım analiz dokümanını yaz" denebilir.
  - **Claude Code / Copilot:** klasörün dosya listesi gönderilir ve klasör
    `--add-dir` ile okunabilir yapılır; asistan gerek duyduğu dosyaları
    kendi araçlarıyla (yalnızca okuma) okur. Tek tek eklenen dosyaların
    metni doğrudan gider.
  - **API'ler:** dosyaların metni soruyla gider (dosya başına en çok
    100 000, toplam 300 000 karakter; sığmayanlar sayıyla belirtilir).
  Kaynaklar değişmedikçe aynı sohbette yeniden gönderilmez.
- **Model seçimi:** soru kutusunun üstündeki seçici etkin hizmetin
  modellerini listeler (API'lerde hizmetin kendi listesi; Claude Code'da
  varsayılan, `opus`, `sonnet`, `haiku`; **Başka model…** ayarları açar).
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
  bulunduğu yerde çalışır.
- **GitHub Copilot** seçiliyken uygulama `copilot`'ı aynı yerlerde (ayrıca
  WinGet bağlantı klasöründe) arar; `KALEM_COPILOT` ortam değişkeni
  verilirse yalnızca o dosya denenir. Copilot'a sistem talimatı
  verilemediği için Kalem tanıtımı sohbetin ilk sorusuyla gider; araçlardan
  komut çalıştırma ve dosya yazma kapalıdır (`--deny-tool shell`,
  `--deny-tool write`).
- **Claude Code** seçiliyken uygulama `claude`'u kendisi arar. Yoksa panel
  kurulumu anlatır (`npm install -g @anthropic-ai/claude-code`, sonra
  terminalde bir kez `claude` ile oturum açmak) ve API anahtarıyla bir
  hizmete bağlanmayı önerir; alışılmadık bir yere kuruluysa **Konumu Seç…**
  ile programı gösterilir. Aranan yerler: `PATH`, `~/.local/bin`,
  `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`, Windows'ta
  `%APPDATA%\npm`. `KALEM_CLAUDE` ortam değişkeni verilirse yalnızca o
  dosya denenir.
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
- Metin düzenleyici bir kod editörü değildir: sözdizimi renklendirmesi,
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
