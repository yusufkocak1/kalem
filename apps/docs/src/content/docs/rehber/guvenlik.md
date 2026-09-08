---
title: Güvenlik
description: Kalem'in XSS'e karşı yapısal savunması.
---

## Yapısal savunma

Kalem render sırasında **hiçbir yerde `innerHTML` kullanmaz.** AST, `createElement`
ve `textContent` ile DOM'a çevrilir. Hiçbir noktada bir HTML string'i parse
edilmez.

Bu, enjeksiyon yüzeyinin büyük kısmını baştan yok eder. Kalem'in DOMPurify gibi
bir temizleyiciye bağımlılığı yoktur — güvenlik bir kütüphane eklemekle değil,
mimariyle sağlanır.

Geriye üç yüzey kalır ve üçü de varsayılan olarak kapalıdır.

## 1. URL protokol beyaz listesi

Bağlantı ve görsel adreslerinde yalnızca şu protokoller kabul edilir:

`http:` · `https:` · `mailto:` · `tel:` · göreli adresler · `#` çapaları

`javascript:`, `vbscript:` ve (görsel istisnası dışında) `data:` reddedilir.

```ts
new Editor(el, {
  allowedProtocols: ['http:', 'https:', 'mailto:'], // daha da daraltabilirsiniz
});
```

## 2. Ham HTML

Markdown içindeki ham HTML varsayılan olarak **çalıştırılmaz**, kaçış
karakterlenip metin olarak gösterilir.

```ts
renderToString(ast, {
  allowHtml: true,
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
});
```

`allowHtml: true` verip `sanitizeHtml` vermezseniz Kalem geliştirme modunda
konsola uyarı basar.

## 3. Yapıştırma

Panodan gelen HTML asla doğrudan DOM'a konmaz. Önce ayrıştırılıp AST'ye çevrilir;
beyaz listede olmayan her etiket ve öznitelik atılır. Bilinmeyen bir etiket
içeriğini düz metne düşürür.

## Sunucu tarafı

`renderToString` çıktı HTML'ini kaçış karakterler. Yine de sonucu kendi sayfanıza
gömerken CSP kullanmanızı öneririz:

```
Content-Security-Policy: default-src 'self'; script-src 'self'
```

## Açıkların bildirimi

Güvenlik açığı bulduysanız lütfen public issue açmayın.
`security@kalem.dev` adresine yazın — 48 saat içinde dönüş yapılır.
Ayrıntılı süreç için depodaki `SECURITY.md` dosyasına bakın.
