# Güvenlik Politikası

## Desteklenen sürümler

Kalem henüz yayımlanmadı (v1.0 öncesi). İlk kararlı sürüm çıktığında bu bölüm
desteklenen sürüm aralığıyla güncellenecek.

## Açık bildirimi

Güvenlik açıklarını **herkese açık issue olarak açma.**

GitHub üzerinden özel bildirim kullan:
**Security → Report a vulnerability** (private vulnerability reporting).

Yanıt hedefi: 72 saat içinde ilk dönüş, 90 gün içinde düzeltme veya
gerekçeli açıklama.

## Tehdit modeli

Kalem, **güvenilmeyen Markdown'ı** güvenilir bir sayfada render edebilmelidir.
Aşağıdakiler açık kabul edilir:

| Senaryo | Beklenen davranış |
|---|---|
| Markdown içinde `<script>` | Metin olarak kaçırılır, çalıştırılmaz |
| `[t](javascript:alert(1))` | Bağlantı reddedilir veya etkisizleştirilir |
| `<img onerror=...>` | Öznitelik render edilmez |
| Word'den yapıştırma | Temizlenir; stil/script taşınmaz |
| SSR (`renderToString`) | İstemci tarafıyla aynı kaçışlama garantisi |

### Mimari savunma

Render **AST'den DOM API ile** yapılır (`createElement` + `textContent`),
ham HTML string'den değil. `innerHTML` üretim yolunda kullanılmaz. Bu, XSS
yüzeyinin büyük kısmını *yapısal olarak* ortadan kaldırır — DOMPurify gibi
bir sanitizer bağımlılığı gerekmez.

Geriye kalan yüzeyler ve savunmaları:

- **URL protokolleri** — izin listesi (`http`, `https`, `mailto`, `tel`,
  göreli yollar). `javascript:`, `data:`, `vbscript:` reddedilir.
- **Ham HTML blokları** — varsayılan olarak kaçırılır. `allowDangerousHtml`
  seçeneği açıkça açılmadıkça render edilmez; açıldığında sorumluluk
  çağıranındır ve bu dokümante edilir.
- **Yapıştırma** — gelen HTML kendi normalleştiricimizden geçer, izin verilen
  yapı dışındaki her şey düşer.

## Kapsam dışı

- Bağımlılık zinciri açıkları — çekirdek paketlerin 3rd-party bağımlılığı yok
  (`pnpm guard:purity` bunu zorlar), zincir de yok.
- `allowDangerousHtml: true` ile bilinçli olarak açılan ham HTML render'ı.
- `apps/demo` ve `apps/docs` — yayımlanmayan geliştirme araçları.
