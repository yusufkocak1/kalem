# Kalem Masaüstü

Electron ile yazılmış, **Word rahatlığında** bir Markdown editörü. `.md`
ve `.txt` dosyalarıyla çalışır; düzenleme motoru bu depodaki Kalem
(`@kalem-editor/*`) paketleridir.

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
sayfasında: kurulum paketi (`Kalem Setup <sürüm>.exe`) ve taşınabilir exe
(`Kalem <sürüm>.exe`). Exe'ler depoda tutulmuyor.

Yeni sürüm: `package.json`'daki `version` artırılır, `package` çalıştırılır,
`desktop-v<sürüm>` etiketiyle bir release açılıp iki exe ona eklenir.

## `.md` dosyalarının varsayılan uygulaması yapmak

Bunu **kurulum paketi** (`release/Kalem Setup <sürüm>.exe`) yapar; taşınabilir
`Kalem <sürüm>.exe` kayıt defterine hiçbir şey yazmaz.

1. `pnpm --filter kalem-desktop package` ile kurulum paketini üretin ve kurun.
   Kurulum `.md` ve `.markdown` uzantılarını Kalem'e bağlar
   (`HKCU\Software\Classes\Kalem.Markdown`); kaldırınca bağ da silinir.
2. Uzantı için daha önce başka bir uygulama seçilmişse Windows o seçimi korur;
   uygulamalar bunu kendileri değiştiremez. Bir `.md` dosyasına sağ tıklayıp
   **Birlikte aç → Başka bir uygulama seç → Kalem → Her zaman** deyin ya da
   **Ayarlar → Uygulamalar → Varsayılan uygulamalar → Kalem** yolunu izleyin.

Taşınabilir sürümde aynı menüden **Bilgisayarda bir uygulama seçin** ile exe
gösterilebilir; exe taşınırsa bağ kopar.

## Taşınabilir exe neden ilk açılışta bekliyor

Taşınabilir exe, içindeki uygulamayı (~320 MB) çalıştırmadan önce diske açmak
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
- **Farklı Kaydet** belgeyi başka bir klasöre taşırsa bağlantı verdiği
  görsel ve dosyalar da yeni yerin `.assets` klasörüne kopyalanır ve
  bağlantılar güncellenir (yeni yerden zaten ulaşılabilen dosyalara
  dokunulmaz).
- `.txt` dosyaları da açılır ve kendi uzantısıyla kaydedilir. İçerik
  **Markdown olarak** okunur; satırlar dosyada yazıldığı gibi alt alta
  gösterilir (bkz. bilinen sınırlar).
- **Sekmeler:** bir pencerede birden çok belge. `Ctrl+N` yeni sekme,
  `Ctrl+Shift+N` yeni pencere, `Ctrl+W` sekmeyi kapatır, `Ctrl+Tab` sekmeler
  arasında gezer. Her sekmenin kendi geri alma geçmişi, kayıt durumu ve
  kurtarma taslağı vardır. Zaten açık olan belge yeniden açılmaz, sekmesi
  öne gelir. Son sekme kapanınca pencere kapanır.
- Dosyanın kodlaması ve satır sonu korunur: UTF-8 (BOM'lu/BOM'suz),
  UTF-16, CRLF/LF. UTF-8 olmayan eski dosyalar (Windows-1254/1252) bozuk
  karaktere dönüşmeden okunur ve kaydederken UTF-8'e çevrilir.
- Kaydetme atomiktir: yazma yarıda kesilirse eski belge yerinde kalır.
- Kaydedilmemiş değişiklikler kurtarma taslağına yazılır; uygulama
  çökerse sonraki açılışta belge geri gelir.
- Dosya başka bir programda değişirse pencereye dönünce fark edilir.
- İsteğe bağlı otomatik kaydetme.
- HTML ve PDF olarak dışa aktarma, yazdırma. **Dosya → Sayfa Yapısı**:
  sayfa boyutu (A4, A3, A5, Letter, Legal), dikey/yatay, kenar boşlukları
  (Word'ün Normal / Dar / Geniş ön ayarları) ve PDF'te sayfa numarası.
  Ayarlar kalıcıdır ve hem PDF'e hem yazdırmaya uygulanır (sayfa numarası
  yalnızca PDF'te; yazdırma kutusunun kendi üst/alt bilgi seçeneği var).

**Word'den içe aktarma**

- **Dosya → Word'den İçe Aktar** (`.docx`): başlıklar, kalın/italik/üstü
  çizili, bağlantılar, iç içe ve numaralı listeler, alıntılar, tablolar ve
  görseller Markdown'a çevrilir.
- Belgedeki görseller ilk kayıtta belgenin yanındaki `<belge>.assets/`
  klasörüne çıkarılır.
- Word'den **yapıştırma** da çalışır (Kalem'in kendi yapıştırma boru hattı);
  içe aktarma ile aynı dönüştürücüyü kullanır.
- Eski `.doc` biçimi desteklenmez; Word'de `.docx` olarak kaydedilmelidir.

**Düzenleme**

- Şerit: Giriş / Ekle / Görünüm sekmeleri, stil galerisi, hızlı erişim.
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
  boyanır, **Otomatik** rengi kaldırır. Markdown'da renk sözdizimi olmadığı
  için dosyaya `<span style="color:#e03131">metin</span>` olarak yazılır;
  HTML/PDF dışa aktarmada ve yazdırmada da görünür.
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
- Kod biçimlendirme JSON, JSONC, XML (SVG, RSS, plist… dâhil), HTML ve
  YAML içindir; JSON5, CSS, JavaScript ve öteki diller biçimlendirilmez.
  YAML'da katlanmış (`>`) metnin satırları birleşebilir (anlamı değişmez).
- `.txt` dosyası düz metin olarak değil Markdown olarak yorumlanır: `#` ile
  başlayan satır başlık, `- ` ile başlayan satır liste olur. Kaydederken
  paragraf başındaki boşluklar (girinti) düşer. `.txt` için "birlikte aç"
  ilişkilendirmesi kurulmaz; Not Defteri'nin yerini almaz.
- Paket kaydedilirken yalnızca metinde bağlantısı olan dosyalar pakete girer;
  bağlantısı silinmiş bir görsel bir sonraki kayıtta paketten düşer. Paketin
  içindeki metin her zaman UTF-8 `text.md`'dir; başka bir uygulamanın
  `.textpack`'i açılıp kaydedilirse paket kökünde (sarmalayıcı klasörsüz)
  yazılır.
- Word'deki birleştirilmiş tablo hücreleri boş hücrelere açılır; dipnot
  bağlantıları düz metne iner; EMF/WMF görseller atlanır ve bildirilir.
- macOS ve Linux'ta denenmedi. Windows kurulum paketi üretiliyor ama
  kurulup denenmedi; çalıştırılanlar `package:dir` çıktısı ve taşınabilir exe.
- Kurulum paketi 100 MB'ı aştığı için depoya konmaz (GitHub sınırı).
