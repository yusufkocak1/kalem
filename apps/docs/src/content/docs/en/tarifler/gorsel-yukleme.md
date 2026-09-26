---
title: Image upload
description: Drag and drop, paste, and your own storage service.
---

`@kalem/plugin-image-upload` handles drag and drop, pasting and the file
picker; **it knows nothing about the network**. Which service, which
authentication, which retry policy — all yours.

```bash
npm i @kalem/plugin-image-upload
```

```ts
import { imageUploadPlugin } from '@kalem/plugin-image-upload';
import '@kalem/themes/plugin-image.css';

editor.addPlugin(
  imageUploadPlugin({
    accept: ['image/'],
    maxSize: 5 * 1024 * 1024,

    async upload({ file, onProgress, signal }) {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch('/api/images', { method: 'POST', body: form, signal });
      if (!response.ok) throw new Error('Upload failed');

      onProgress(1);
      const { url, alt } = await response.json();
      return { url, alt };
    },

    onError(error, file, reason) {
      // reason: "type" | "size" | "upload"
      warn(`${file.name}: ${error.message}`);
    },
  }),
);
```

`upload` returns either a URL string or `{ url, alt }`.

## Progress

As you call `onProgress(0…1)`, progress shows on top of the temporary image
in the document. `fetch` doesn't report progress, so if you want the real
percentage you need `XMLHttpRequest`:

```ts
async upload({ file, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    request.addEventListener('load', () => resolve(JSON.parse(request.responseText).url));
    request.addEventListener('error', () => reject(new Error('Network error')));
    signal.addEventListener('abort', () => request.abort());
    request.open('POST', '/api/images');
    request.send(file);
  });
}
```

## Cancellation

If the user deletes the image while the upload is in progress, `signal` is
aborted. Don't forget to pass it to your request — otherwise the server keeps
storing a file that isn't in the document.

## The temporary address

While the upload is in progress, a **temporary address** goes into the
document, and it's replaced with the permanent one when it completes. So the
user can keep typing while they wait, and their caret doesn't jump.

If the upload fails, the temporary image is removed from the document; no
half-finished `![](blob:…)` is left behind.

## Acceptance rules

| Option | Default | Note |
|---|---|---|
| `accept` | `["image/"]` | A **prefix** comparison, not an exact match |
| `maxSize` | unlimited | Bytes |

The prefix comparison is deliberate: `image/` covers every image type, and a
format released tomorrow doesn't require updating the list.

A rejected file reaches `onError` with the reason `"type"` or `"size"`.

## `data:` images

If you want to embed small images, the allowlist is limited: `image/png`,
`image/jpeg`, `image/gif`, `image/webp`, `image/avif`.

`data:image/svg+xml` is **deliberately excluded** — scripts run inside SVG.
Details: [Security](/en/rehber/guvenlik/).

## Alternative text

The plugin opens an alt text editor when an image is clicked
(`createAltEditor`). Alternative text isn't treated as mandatory for
accessibility, but when it's left empty a screen reader reads the file name
— `IMG_20240115_112233.jpg` tells nobody anything.

## Resizing

The plugin **doesn't resize** the image itself; Markdown has no width
syntax, and falling back to HTML would make the document non-portable. If
you need it, attach your own solution through the `onResize` hook.
