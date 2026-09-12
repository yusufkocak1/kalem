---
title: Kontrollü bileşen
description: Metni kendi durumunuzda tutmak ve imleci kaçırmamak.
---

Kontrollü kip, metnin **uygulamanızın durumunda** yaşaması demek. Klasik
tuzağı da burada: kullanıcı yazıyor → `onChange` → `setState` → `value`
değişiyor → editöre yazılıyor → **imleç başa kaçıyor**.

## Döngü nasıl kırılıyor

Editörün en son **kendi yaydığı** metin hatırlanıyor; gelen değer ona
eşitse hiçbir şey yapılmıyor. Yani yalnızca gerçekten dışarıdan gelen bir
değişiklik editöre iniyor.

React ve Vue sarmalayıcıları bunu içeride yapıyor:

```tsx
const [metin, setMetin] = useState('# Merhaba');
<KalemEditor value={metin} onChange={setMetin} lang="tr" label="Belge" />
```

```vue
<KalemEditor v-model="metin" lang="tr" label="Belge" />
```

Özel elemanda döngü setter'ın kendisinde kırılıyor (`el.value = x` gelen
metin güncelse hiçbir şey yapmıyor), yani Svelte ve Angular'da da
bildirimsel bağlama güvenli:

```svelte
<kalem-editor value={metin} oninput={(e) => (metin = e.detail.value)}></kalem-editor>
```

## Vanilla'da

Sarmalayıcı kullanmıyorsanız aynı kalıbı kendiniz yazın:

```ts
let yayilan: string | null = null;

const editor = new Editor(el, {
  value: durum.metin,
  onChange: (markdown) => {
    yayilan = markdown;
    durumuGuncelle({ metin: markdown });
  },
});

function durumDegisti(yeni: string) {
  if (yeni === yayilan) return;   // editörün kendi metni — dokunma
  yayilan = yeni;
  editor.setValue(yeni);
}
```

:::caution[`setValue` ucuz değil]
"Başka bir belge aç" demek: kimlikler yeniden dağıtılıyor, tüm bloklar
yeniden kuruluyor ve **geçmiş sıfırlanıyor**. Yazarken çağırmayın.
:::

## Ne zaman kontrollü olmamalı

Çoğu kullanımda gerekmiyor. Metne her tuşta ihtiyacınız yoksa
kontrolsüz kip hem daha hızlı hem daha az kod:

```tsx
<KalemEditor defaultValue={md} onChange={(m) => taslagaYaz(m)} />
```

Metni okumak isteyen ama **sahiplenmek istemeyen** kardeş bileşenler için
`useKalemValue()` var: bir kelime sayacı, bir önizleme, bir
"kaydedilmedi" rozeti.

## Belgeyi değiştirmek

Kullanıcı başka bir belgeye geçtiğinde `setValue` yerine **bileşeni
yeniden kurmak** çoğu zaman daha doğru:

```tsx
<KalemEditor key={belge.id} defaultValue={belge.metin} onChange={…} />
```

`setValue` geçmişi zaten sıfırlıyor, yani kazandıracağı bir şey yok;
yeniden kurmak ayrıca otomatik kaydetmenin kurtarma anahtarını belgeye
bağlıyor. Bu kalıbın tamamı
[Kalem Notlar](https://github.com/yusufkocak1/kalem/tree/main/apps/notlar)
uygulamasında.
