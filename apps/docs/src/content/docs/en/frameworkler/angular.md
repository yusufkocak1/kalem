---
title: Angular
description: Wrapper-free setup with CUSTOM_ELEMENTS_SCHEMA.
---

**There's no Kalem package for Angular either.** The only thing Angular
needs to be told is "I don't know this tag, the browser does".

```bash
npm i @kalem-editor/wc @kalem-editor/themes
```

```ts
import { Component, CUSTOM_ELEMENTS_SCHEMA, type ElementRef, signal, viewChild } from '@angular/core';

type Kalem = HTMLElement & { value: string; readOnly: boolean };

@Component({
  selector: 'app-document',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <kalem-editor
      #box
      class="editor"
      label="Document"
      [value]="text()"
      [readOnly]="readOnly()"
      (input)="onInput($event)"
    ></kalem-editor>

    <p>{{ text().length }} characters</p>
  `,
})
export class DocumentComponent {
  readonly text = signal('# Hello');
  readonly readOnly = signal(false);

  private readonly box = viewChild<ElementRef<Kalem>>('box');

  onInput(event: Event): void {
    this.text.set((event as CustomEvent<{ value: string }>).detail.value);
  }

  focus(): void {
    this.box()?.nativeElement.focus();
  }
}
```

Don't forget to register the element — one line in `main.ts`:

```ts
import '@kalem-editor/wc/define';
```

## How binding works

- **`[value]`** — on an element it doesn't recognize, Angular writes square
  brackets as a **DOM property**, so `el.value = …` works.
- **`(input)`** — an ordinary `addEventListener`; the event carries
  `detail.value`.
- **`viewChild`** — imperative access (`focus()`, `el.editor`).

With `strictTemplates` on, the type of `$event` is `Event`; narrow it in the
component method to reach `detail` (`onInput` above).

## The infinite loop breaks itself

The element's `value` setter stops if the incoming text equals the current
text. The user types → event → signal → the binding writes the same text
back → the setter quietly stops. The caret stays where it is.

## It works zoneless

The example uses `provideZonelessChangeDetection()`: the event the editor
fires writes a signal, and Angular's change detection sees it. You don't
need to install Zone.js.

```ts
bootstrapApplication(App, {
  providers: [provideZonelessChangeDetection()],
});
```

## Styling

Component-scoped CSS (`ViewEncapsulation.Emulated`, the default) doesn't
reach **inside** the editor: Angular didn't create those nodes, so they
don't get the `_ngcontent-*` attribute. Add the theme files to the global
`styles` list:

```json
"styles": [
  "node_modules/@kalem-editor/themes/css/tokens.css",
  "node_modules/@kalem-editor/themes/css/viewer.css",
  "node_modules/@kalem-editor/themes/css/editor.css",
  "src/styles.css"
]
```

## Reactive Forms

`<kalem-editor>` is a form-associated custom element, so it works directly
with `name` in **ordinary HTML forms**. For Angular's `ReactiveForms` you
need to write a `ControlValueAccessor` — about fifteen lines, since the
element provides `value`, `input` and `disabled`.

## Working example

[`examples/angular`](https://github.com/yusufkocak1/kalem/tree/main/examples/angular)
— Angular 21, zoneless, built in CI and tested with eight browser tests.

The element's full surface: [Web Components](/en/frameworkler/web-components/).
