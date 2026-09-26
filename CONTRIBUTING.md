# Contributing

*English · [Türkçe](CONTRIBUTING.tr.md)*

Thanks for looking. Bug reports are the most valuable contribution right
now — especially **a Markdown document that doesn't survive the round trip**
(opening it in Kalem and saving it without edits changes it). There's an
issue template for exactly that.

## Setup

```bash
pnpm install
pnpm verify     # lint + types + tests + build + gates + size + publint
pnpm e2e        # browser tests: Chromium, Firefox, WebKit
```

Node ≥ 20 (22 recommended for development, `.nvmrc`), pnpm 10.

## Repository layout

| Path | What | Published |
|---|---|---|
| `packages/*` | The library itself | **Yes** — to npm |
| `apps/docs` | Astro Starlight documentation site (English and Turkish) | No |
| `apps/playground` | The playground | No |
| `apps/notlar` | A notes app built on the library (dogfooding) | No |
| `apps/demo` | Test fixtures for the browser tests | No |
| `examples/*` | React, Next.js, Vue, Nuxt, Svelte, Angular and plain HTML apps | No |
| `docs/` | Analysis and roadmap (Turkish) | No |
| `scripts/` | Guard gates and tools | No |

Everything under `apps/*` and `examples/*` is `private: true`. Heavy tools
like Astro and sharp live only there; **they never reach a user's
`node_modules`.**

## A note on language

Kalem was built in Turkey. Source comments, commit messages and the design
documents in `docs/` are in Turkish. **You don't need to write Turkish:**
issues, pull requests and code comments in English are welcome.

Anything a developer sees at runtime is in English: thrown error messages
and console output. UI strings come from dictionaries (`labels.ts`) and
follow the document's language.

## Non-negotiable rules

These are the reason the project exists. CI enforces them automatically.

### 1. No third-party dependencies in the core packages

`packages/{core,viewer,editor,ui}` may depend only on each other. If you
need a helper library: bring the code in, or move the feature into an
optional plugin package.

`pnpm guard:purity` checks this.

### 2. No framework leakage

No trace of `react` / `vue` / `preact` / `svelte` may appear in a production
bundle. React never getting into a user's Vue project is a core promise of
this library.

Framework bindings live only in the `@kalem/react` and `@kalem/vue` wrappers,
as `peerDependencies`.

### 3. `@kalem/core` doesn't touch the DOM

The core must run on the server (SSR, Node, workers). `document`, `window`,
`navigator` and `localStorage` are forbidden in core — blocked at the type
level too (`lib` in `packages/core/tsconfig.json` has no DOM).

### 4. Locale sensitivity ⭐

A bare `toLowerCase()`, `toUpperCase()` or single-argument
`localeCompare()` is **forbidden.**

```js
"Işık".toLowerCase()              // → "işık"  ✗  wrong in Turkish
"Işık".toLocaleLowerCase("tr")    // → "ışık"  ✓
"iyi".toUpperCase()               // → "IYI"   ✗
"iyi".toLocaleUpperCase("tr")     // → "İYİ"   ✓
```

These calls **don't crash, they silently return the wrong result** — tests
written in English never catch them. That's why they're blocked at build
time.

If you genuinely need a locale-independent comparison (a protocol name, an
HTML tag, a file extension), write the reason on the line:

```js
const proto = url.toLowerCase(); // kalem-locale-ok: URL scheme is ASCII
```

`pnpm guard:locale` checks this.

### 5. Size budgets

| Package | Budget (min+gzip) |
|---|---|
| `@kalem/core` | 14 kB |
| `@kalem/viewer` | 14 kB |
| `@kalem/editor` (core included) | 38 kB |
| `@kalem/editor` + `@kalem/ui` | 58 kB |

`pnpm size` checks this. Going over budget fails the build — raising a
budget is a decision, and it needs a justification in the PR.

Sizes written in the docs (README, documentation site, announcement drafts)
are checked against the measurement by `pnpm guard:sizes`. If a package
grew, `node scripts/guard-sizes.mjs --fix` updates the numbers while keeping
their format.

### 6. Round-trip fidelity

`serialize(parse(md)) === md` for the corpus in `packages/core/fixtures/`,
and serialization must stay idempotent. If you fix a normalization, add the
pattern to the corpus.

## If the guard gates break

```bash
pnpm guard:selftest
```

This verifies that the gates still catch violations. If it's red, the gates
no longer protect anything — fix that first.

## Changesets

Every PR that changes behavior should include a changeset:

```bash
pnpm changeset
```

All `@kalem/*` packages share one version number (`fixed` group).

## Code style

Biome. `pnpm format` fixes everything. No debate; the tool decides.
