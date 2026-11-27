# Writing Kalem extensions

This folder holds the extension API's reference (below) and `hello-api`, the
smallest extension. The extensions themselves (Graylog, Jenkins, Log Viewer,
REST, SOAP, Run Configurations…) live in
[kalem-extensions](https://github.com/yusufkocak1/kalem-extensions): they are
developed, tested in a real Kalem and published to Kalem's catalog there.

Pack an extension into a `.kalem-ext` file and install it from
**Settings › Extensions › Install from File…**:

```sh
node apps/desktop/scripts/pack-extension.mjs apps/desktop/extension-samples/hello-api
```

| Sample | Shows |
|---|---|
| `hello-api` | a command, a setting, a saved token, `http.fetch`, an assistant tool |

Each part of the API is also called once by `e2e/fixtures/api-tour`, an
extension the tests install (`e2e/extension-api.spec.ts`).

The packing and signing tools are `scripts/pack-extension.mjs` and
`scripts/extension-registry.mjs`; the catalog repository's CI uses them from
here.

## Layout

```
manifest.json   what it is, what it asks for, what it adds
host.js         ES module: export async function activate(kalem) { … }
ui.html         optional: the page of its panes
```

## manifest.json

```json
{
	"id": "acme.graylog",
	"name": "Graylog",
	"version": "1.0.0",
	"engines": { "kalem": ">=3.34.0" },
	"host": "host.js",
	"ui": "ui.html",
	"permissions": {
		"http": ["api.example.com"],
		"httpFromSettings": ["url"],
		"assistantTools": true
	},
	"contributes": {
		"panes": [{ "id": "search", "title": "Graylog", "dock": "bottom" }],
		"editors": [{ "id": "detail", "title": "Message" }],
		"commands": [{ "id": "open", "title": "Open Graylog" }],
		"settings": [{ "key": "url", "type": "string", "title": "Address" }],
		"secrets": [{ "key": "token", "title": "Access token" }]
	}
}
```

- `permissions.http`: hosts it may reach (`*.example.com` and `host:port` work).
- `"http": ["*"]`: any address the user types (an API client); shown as a warning when installing.
- `permissions.httpFromSettings`: text settings whose address it may reach,
  for a server whose address only the user knows.
- `dock`: `left`, `right` or `bottom`, where the pane goes the first time;
  the user moves it as Kalem's own panes.
- `editors`: pages of `ui.html` that open as tabs in the documents' place
  (a diff, a record's detail), as many as the host code opens.

## The host code: `activate(kalem)`

| Call | Needs |
|---|---|
| `kalem.settings.get(key)`, `kalem.settings.all()` | `contributes.settings` |
| `kalem.secrets.get(key)` | `contributes.secrets` (typed in Settings, stored encrypted) |
| `kalem.http.fetch(url, { method, headers, body, timeoutMs })` → `{ ok, status, statusText, headers, body }` | the host in `permissions.http` or in a `httpFromSettings` setting |
| `kalem.commands.register(id, run)` | `contributes.commands` (the **Extensions** menu and the command palette) |
| `kalem.assistant.registerTool({ name, description, parameters, writes }, run)` | `permissions.assistantTools` |
| `kalem.ui.handle(name, run)` | what its panes call with `kalem.call(name, input)` |
| `kalem.ui.post(message)` | sends its panes a message (`kalem.onMessage`) |
| `kalem.ui.showPane(id)` | brings one of its panes into view |
| `kalem.ui.openEditor(id, { key, title, tooltip, data })` | `contributes.editors`; a tab beside the documents; the same `key` brings that tab forward with the new `data` |
| `kalem.ui.closeEditor(key)` | closes the editor tab it opened with `key` |
| `kalem.workspace.addFolder(path)` | `permissions.files`; adds a folder to the open folders |
| `kalem.assistant.complete(system, prompt)` → text | `permissions.assistantTools`; asks the assistant the user set up, without tools |
| `kalem.process.spawn({ command, args, cwd, env, shell, encoding }, onEvent)` → id; `kill(id)`, `write(id, text)` | `permissions.process`; events: `output` (`stdout`/`stderr`), `exit`, `error`; `kill` stops what it started too |
| `kalem.fs.readText/writeText/exists/stat/list/mkdir/copy/resolve(path…)`, `kalem.fs.readRange(path, { start, length } \| { tail })` (whole lines, for following a log) | `permissions.files`; a relative path is in the first open folder |
| `kalem.workspace.folders()` | `permissions.files` |
| `kalem.ui.pickPath({ folder, title })` | — (the user picks it) |
| `kalem.ui.openExternal(url)` | — (http and https only) |
| `kalem.ui.setStatusItem(key, { text, tooltip, command })` | `null` removes it; at most 3 |
| `kalem.storage.get(key)`, `set(key, value)`, `remove(key)`, `keys()` | — (its own data, kept with Kalem's, at most 5 MB) |
| `kalem.platform`, `kalem.language` | — |
| `kalem.ui.showMessage(text)` | — |
| `kalem.log(...values)` | — (the extension's log in Settings) |

## The pane: `ui.html`

```html
<link rel="stylesheet" href="/__kalem/ui.css" />  <!-- Kalem's look, in light and dark -->
<script src="/__kalem/ui.js"></script>            <!-- window.kalem -->
<script type="module" src="ui.js"></script>
```

| In the pane | |
|---|---|
| `await kalem.call(name, input)` | runs the host code's `kalem.ui.handle(name, …)` |
| `kalem.onMessage(listener)` | what the host code sends with `kalem.ui.post` |
| `kalem.onSettingsChanged(listener)` | the user changed its settings or token |
| `kalem.pane`, `kalem.language` | the pane's id (an editor's id in an editor tab), the app's language |
| `kalem.editor`, `kalem.onEditorData(listener)` | in an editor tab: `{ id, key }`, and the `data` it was opened with (again on each `openEditor` with its key) |
| `var(--app-text)`, `var(--app-accent)`… | the app's colours, kept up to date |

`/__kalem/ui.css` is a small kit in Kalem's look, light and dark: `k-app`,
`k-toolbar`, `k-input`, `k-select`, `k-textarea`, `k-group` (a request line),
`k-button` (`primary`, `go`, `stop`, `ghost`, `small`, `icon`), `k-tabs`/`k-tab`,
`k-segmented`, `k-badge` (`ok`, `warn`, `error`, `info`), `k-dot`, `k-method`,
`k-list`/`k-list-item`, `k-table`, `k-kv` (key and value rows), `k-code` with
`tok-*` colours, `k-empty`, `k-notice`, `k-spinner`, `k-split`, `k-sidebar`.

## What an extension cannot do

The host code runs in a sandboxed page with no network of its own; the pane
is a sandboxed frame. Neither can reach a server except through
`kalem.http.fetch`, which goes through Kalem's proxy settings and only to the
allowed hosts (checked again on each redirect). Inline scripts, other sites'
scripts, images and frames are refused, and a pane cannot navigate away. A
tool with `writes: true` asks the user before each call.
