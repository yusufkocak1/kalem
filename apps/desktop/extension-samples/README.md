# Kalem extension samples

Each folder is an extension. Pack one into a `.kalem-ext` file and install it
from **Settings › Extensions › Install from File…**:

```sh
node apps/desktop/scripts/pack-extension.mjs apps/desktop/extension-samples/hello-api
```

## Layout

```
manifest.json   what it is, what it asks for, what it adds
host.js         ES module: export async function activate(kalem) { … }
```

## The `kalem` object

| Call | Needs |
|---|---|
| `kalem.settings.get(key)`, `kalem.settings.all()` | `contributes.settings` |
| `kalem.secrets.get(key)` | `contributes.secrets` (the user types it in Settings; stored encrypted) |
| `kalem.http.fetch(url, { method, headers, body, timeoutMs })` → `{ ok, status, statusText, headers, body }` | `permissions.http` lists the host |
| `kalem.commands.register(id, run)` | `contributes.commands` (shown under the **Extensions** menu and in the command palette) |
| `kalem.assistant.registerTool({ name, description, parameters, writes }, run)` | `permissions.assistantTools` |
| `kalem.ui.showMessage(text)` | — |
| `kalem.log(...values)` | — (shown in the extension's log in Settings) |

The host code runs in a sandboxed page with no network of its own: it reaches
servers only through `kalem.http.fetch`, which goes through Kalem's proxy
settings and only to the hosts in `permissions.http`. A tool with
`writes: true` asks the user before each call.
