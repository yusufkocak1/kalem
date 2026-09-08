# Changesets

Bu klasör [changesets](https://github.com/changesets/changesets) tarafından kullanılır.

Davranışı değiştiren her PR bir changeset içermeli:

```bash
pnpm changeset
```

**Yayın v1.0'da yapılacak** (sessiz geliştirme kararı, iş listesi Karar #3) —
ama changelog gün 1'den itibaren birikir. v1.0 duyurusunda "bu sürümde neler
var" sorusunun cevabı bu dosyalardan otomatik üretilir.

`fixed: [["@kalem/*"]]` ayarı tüm paketleri tek sürüm numarasında tutar:
kullanıcı `@kalem/editor@1.2.0` ile `@kalem/ui@1.2.0`'ın uyumlu olduğunu
sürüm numarasına bakarak bilir.
