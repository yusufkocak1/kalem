# docs/duyuru — Duyuru varlıkları  (İş listesi: F6-11)

| Dosya | Ne | Nerede kullanılıyor |
|---|---|---|
| `demo.gif` | 23 sn tanıtım, 900 px, 12 kare/sn | README'nin başı, dev.to |
| `demo.mp4` | Aynı sahne, 1280×720, H.264 | X, Bluesky, GitHub release notu |
| `onizleme.png` | 1280×640 sosyal önizleme | GitHub → Settings → Social preview; bağlantı kartları |
| `show-hn.md` | Show HN başlığı ve metni | F6-14 |
| `devto.md` | dev.to yazısı (`published: false`) | F6-14 |
| `sosyal.md` | r/webdev, X ve Bluesky gönderileri; gönderim sırası | F6-14 |

Taslakların başındaki yorum bloğu **gönderimden önce** yapılacakları
listeliyor — boş bırakılan adresler ve bugün doğru olmayan varsayımlar orada.

## Yeniden üretmek

```bash
pnpm build
node scripts/duyuru/kaydet.mjs                 # üçü birden
node scripts/duyuru/kaydet.mjs --yalniz-onizleme
```

Tam bir ffmpeg gerekiyor (PATH'te ya da `FFMPEG=/yol/ffmpeg`). Playwright'ın
kendi ffmpeg'i yetmiyor: yalnızca VP8 yazıyor, H.264 ve GIF kodlayıcısı yok.

Sahne `scripts/duyuru/sahne.html`, senaryo `kaydet.mjs` içinde. Paketler
gerçek `dist/`ten yükleniyor — kayıtta görünen davranış npm'e gidecek kodun
aynısı. Arayüz değişince kaydı yeniden almak bir komut.

### Neden kare kare

F6-05'te GIF iki sebeple yapılamamıştı: makinede ffmpeg yoktu ve
Playwright'ın video kaydı işletim sisteminin imlecini çizmiyor — seçim ve
sürükleme imleçsiz anlaşılmıyor. Şimdi:

- **İmleç sahnenin içinde.** `sahne.html` fare olaylarını dinleyip bir SVG
  ok çiziyor; basılı tutarken halkası büyüyor. Karelere o giriyor.
- **Kareler CDP'den.** `Page.startScreencast` her kareyi zaman damgasıyla
  veriyor ve yalnızca ekran değişince gönderiyor. Kareler ffmpeg'in concat
  listesine **gerçek süreleriyle** yazılıyor; sabit kare hızı varsaymak
  kaydı hızlandırırdı.
- **PNG, JPEG değil.** İlk denemede JPEG kareler beyaz zeminde renk bantları
  üretti ve GIF paleti onları büyüttü. PNG ile GIF hem temiz hem küçük
  (272 kB → 181 kB).

### Neden playground değil

Playground'un arayüzü Türkçe, üstünde on bir denetim var; duyurunun okuyucusu
İngilizce konuşuyor ve GIF'in anlatacağı tek şey "solda Word, sağda
Markdown". Sahne yalnızca bu ikisini gösteriyor, editör `lang: "en"`.

## Sayılar

Metinlerdeki boyutlar (`35.0 kB`, `11.7 kB`) `pnpm guard:sizes` ile ölçüme
karşı denetleniyor; `onizleme.html` de öyle. Paket büyürse kapı kırmızı
olur, sayıyı güncelleyip görseli yeniden üretmek gerekir.
