# Running a catalog

A catalog is a folder on any web server: `index.json`, its signature
`index.json.sig`, and the `.kalem-ext` packages. Kalem trusts it by the
public key the user adds with it (Settings › Extensions › Market ›
Catalogs): a list changed after it was signed is refused, and so is a
package whose sha256 is not the one the signed list gives.

## Once

```sh
node apps/desktop/scripts/extension-registry.mjs keygen keys
```

- `keys/private.pem`: the signing key. Keep it out of every repository:
  put its contents in the catalog repository's secret `KALEM_REGISTRY_KEY`.
- `keys/public-key.txt`: give it to the users with the catalog's address.

## The catalog repository

```
extensions/
  graylog/              an extension's folder (manifest.json, host.js…)
  run-configurations/
blocked.json            optional: [{ "id": "acme.tool", "versions": "<1.2.0", "reason": "…" }]
.github/workflows/publish-catalog.yml   ← publish-catalog.yml from here
```

Turn GitHub Pages on for the `gh-pages` branch. A push to `main` packs every
extension, adds the new versions to `index.json`, signs it and publishes it;
the address to give Kalem is `https://<owner>.github.io/<repository>/index.json`.

- A published version is never replaced: changing an extension needs a new
  `version` in its manifest, or the build stops.
- Each extension's reviewer is whoever merges its pull request: that review
  is what the users trust when they install it.
- `blocked.json` turns a version off wherever it is installed, within hours
  (Kalem checks its catalogs at start and every six hours).

## By hand

```sh
node apps/desktop/scripts/extension-registry.mjs build extensions site --key keys/private.pem --name "Acme"
```

Then copy `site/` to any web server (an internal one for a company's own
catalog).
