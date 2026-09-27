# Kalem Notlar

Kalem'i **kendi ürünü gibi kullanan** bir uygulama: yerel bir not defteri.
İş listesindeki `F5-05` (dogfooding) için yazıldı.

```bash
pnpm build                        # önce paketler
pnpm --filter kalem-notlar dev    # http://localhost:5173
```

Sunucu yok, hesap yok, kurulum yok: notlar tarayıcıda (`localStorage`)
duruyor ve Markdown olarak saklanıyor. "Dışa aktar" ile aldığınız `.md`
dosyası başka her yerde açılıyor.

## Ne kullanıyor

| Paket | Nerede |
|---|---|
| `@kalem-editor/react` | `<KalemEditor>` — kontrolsüz kip, `useKalem()` |
| `@kalem-editor/ui` | `mountUi(editor, { toolbar: "both" })` — sabit çubuk + balon, slash menü, bağlantı balonu |
| `@kalem-editor/plugin-code-highlight` | kod blokları |
| `@kalem-editor/plugin-find-replace` | Ctrl+F / Ctrl+H |
| `@kalem-editor/plugin-outline` | sağdaki içindekiler paneli |
| `@kalem-editor/plugin-word-count` | durum çubuğu |
| `@kalem-editor/plugin-source-mode` | "Markdown kaynağı" düğmesi, Ctrl+Shift+M |
| `@kalem-editor/plugin-autosave` | 800 ms sessizlikten sonra `localStorage`, göstergesiyle |
| `@kalem-editor/ui` → `matches`, `score` | not listesindeki arama kutusu |

## Neden böyle yazıldı

**Editör not başına yeniden kuruluyor** (`key={secili.id}`). Not
değiştirmek yeni bir belge açmak demek; alternatif `setValue` çağırmaktı
ama o da geçmişi zaten sıfırlıyor. Yeniden kurmak ayrıca otomatik
kaydetmenin kurtarma anahtarını nota bağlıyor.

**İki ayrı kalıcılık yolu var.** `onChange` React durumunu güncelliyor
(liste başlığı yazarken değişiyor), otomatik kaydetme eklentisi ise
`localStorage`a yazıyor. Her tuşta diske yazmak gereksiz; listeyi 800 ms
geciktirmek ise tökezletirdi.

**Kaydedilemeyen değişiklik hata sayılıyor.** Kota dolduğunda kaydetme
kancası fırlatıyor ve gösterge "Kaydedilemedi" diyor. Bir not
uygulamasında sessizce yutmak yapılabilecek en kötü şey.

**Uygulamanın kendi renk paleti var.** `tokens.css` sözlüğü bilerek
`:root`a inmiyor — bir Markdown kütüphanesi, gömüldüğü uygulamanın
düğmelerini boyamamalı. Tek `<html data-theme>` özniteliği hem kabuğu hem
Kalem'i çeviriyor.

**`StrictMode` açık.** React'in geliştirme kipi her etkiyi kurup söküp
yeniden kuruyor; bir editör için en zor yaşam döngüsü sınavı bu ve
dogfooding uygulamasının ondan kaçınması anlamsız olurdu.

## Kullanırken bulunanlar

Dogfooding'in çıktısı bunlar — hepsi düzeltildi:

1. **`[data-theme]` atadan gelince çalışmıyordu.** `@kalem-editor/themes` koyu
   tema seçicisi yalnızca bileşik hâlde yazılıydı
   (`:where(.kalem-theme, …)[data-theme="dark"]`), yani öznitelik
   `kalem-theme` sınıfıyla **aynı** elemanda olmak zorundaydı. Olağan
   kullanım ise `<html data-theme="dark">`: sayfa koyuya dönüyor, belge
   açık kalıyordu. Var olan test özniteliği editörün kendisine koyduğu
   için durumu kapsamıyordu. Dört tema dosyasında düzeltildi, iki tarayıcı
   testi eklendi.
2. **`dark.css` koşulsuz yüklenirse tema düğmesi işlemiyor.** O dosya
   "sayfanın tamamı koyu, seçim yok" senaryosu için; `tokens.css` zaten üç
   durumu da karşılıyor. Uygulama artık onu yüklemiyor.
3. **Yeni not açınca odak düğmede kalıyordu.** Yeni not `key`i
   değiştiriyor, yani tıklama işleyicisi çalışırken editör henüz yok;
   odak, kurulumu bildiren geri çağırmada veriliyor.

## Testler

Saf mantık (not başlığı çıkarma, yerel depo) birim testleriyle, uygulamanın
kendisi `e2e/examples/notlar.spec.ts` ile sınanıyor:

```bash
pnpm vitest run apps/notlar
pnpm e2e:examples --grep notlar
```
