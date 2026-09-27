# Security Policy

*English · [Türkçe](SECURITY.tr.md)*

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ security fixes |
| < 1.0 | ❌ never published |

## Reporting a vulnerability

**Please don't open a public issue for a security vulnerability.**

Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Response targets: a first reply within 72 hours, and a fix or a reasoned
explanation within 90 days.

## Threat model

Kalem must be able to render **untrusted Markdown** on a trusted page. The
following are considered vulnerabilities:

| Scenario | Expected behavior |
|---|---|
| `<script>` inside Markdown | Escaped as text, never executed |
| `[t](javascript:alert(1))` | The link is neutralized (`#`) |
| `<img onerror=...>` | Raw HTML is escaped by default; no attribute is rendered |
| `![x](data:image/svg+xml,...)` | Rejected — scripts run inside SVG |
| Pasting from Word or a web page | Converted to the AST; styles and scripts aren't carried over |
| SSR (`renderToString`) | The same escaping guarantees as the client |

### Architectural defense

Rendering is done **from the AST with DOM APIs** (`createElement` +
`createTextNode`), not from an HTML string. `innerHTML` isn't used on any
production path. That removes most of the XSS surface *structurally* — no
sanitizer dependency like DOMPurify is needed.

The remaining surfaces and their defenses:

- **URL protocols** — an allowlist: `http:`, `https:`, `mailto:`, `tel:`,
  `ftp:` and relative paths. Everything else, `javascript:` and `vbscript:`
  included, is neutralized. Images additionally accept
  `data:image/png|jpeg|gif|webp|avif`; `data:image/svg+xml` is rejected.
- **Raw HTML** — escaped by default (`html: "escape"`). With `html: "allow"`
  the library still doesn't parse HTML: it hands the string to the caller's
  `renderRawHtml` / `sanitizeHtml` hooks, and sanitizing becomes the
  caller's responsibility (documented).
- **Pasting** — incoming HTML goes through Kalem's own converter
  (`@kalem-editor/core/html`) into the AST; anything outside the allowed structure
  is dropped.

## Out of scope

- Supply-chain vulnerabilities in dependencies — the core packages have no
  third-party dependencies (`pnpm guard:purity` enforces this).
- Raw HTML rendered after deliberately opting in with `html: "allow"`
  without sanitizing it.
- `apps/*` and `examples/*` — development tools and demos that aren't
  published.
