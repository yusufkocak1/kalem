# @kalem/plugin-image-upload

Kalem plugin: image upload by drag and drop or paste, with your own upload hook.

Part of [Kalem](https://github.com/yusufkocak1/kalem) — a WYSIWYG editor for people who
don't know Markdown, that saves Markdown.

```bash
npm i @kalem/plugin-image-upload
```

```ts
import { imageUploadPlugin } from '@kalem/plugin-image-upload';
import '@kalem/themes/plugin-image.css';

editor.addPlugin(
  imageUploadPlugin({
    upload: async ({ file, onProgress, signal }) => {
      const response = await fetch('/api/upload', { method: 'POST', body: file, signal });
      onProgress(1);
      return (await response.json()).url;
    },
  }),
);
```

Drag and drop, paste and file picker, with progress and cancellation. The plugin knows nothing about the network — `upload` is yours.

Documentation, guides and the full API: see the
[Kalem repository](https://github.com/yusufkocak1/kalem#readme).

## License

MIT
