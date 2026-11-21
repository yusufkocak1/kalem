<div align="center">
  <img src="./logo.svg" alt="logo" width="120">
  <h1>örnek-paket</h1>
</div>

[![npm](https://img.shields.io/npm/v/ornek.svg)](https://www.npmjs.com/package/ornek)
[![CI](https://github.com/ornek/ornek/actions/workflows/ci.yml/badge.svg)](https://github.com/ornek/ornek/actions)
[![lisans][lisans-rozet]][lisans]

> Küçük, hızlı ve **bağımlılıksız**.

## İçindekiler

- [Kurulum](#kurulum)
- [Kullanım](#kullanım)
- [API](#api)

## Kurulum

```sh
npm install ornek
# veya
pnpm add ornek
```

## Kullanım

```ts
import { ornek } from "ornek";

ornek({ hizli: true });
```

<details>
<summary>Gelişmiş seçenekler</summary>

| Seçenek | Tip | Varsayılan |
| --- | --- | --- |
| `hizli` | `boolean` | `false` |

</details>

## API

### `ornek(secenekler?)`

Döner: `Promise<void>`.\
Ters bölü ile satır sonu.  
İki boşlukla satır sonu.

<!-- yorum: bu satır render edilmez -->

## Lisans

[MIT](./LICENSE) © 2026

[lisans-rozet]: https://img.shields.io/badge/lisans-MIT-blue.svg
[lisans]: ./LICENSE "Lisans dosyası"
