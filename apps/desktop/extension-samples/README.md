# Kalem extension samples

Each folder is an extension. Pack one into a `.kalem-ext` file and install it
from **Settings › Extensions › Install from File…**:

```sh
node apps/desktop/scripts/pack-extension.mjs apps/desktop/extension-samples/graylog
```

| Sample | Shows |
|---|---|
| `hello-api` | a command, a setting, a saved token, `http.fetch`, an assistant tool |
| `graylog` | a docked pane, the address the user types (`httpFromSettings`), three assistant tools, a fallback for older servers |
| `run-configurations` | IDE-like run configurations (Tomcat, Java, JAR, Maven, Gradle, npm, command, compound) kept in `.kalem/run.json`: programs, files, a status bar item, the app's language |

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
		"commands": [{ "id": "open", "title": "Open Graylog" }],
		"settings": [{ "key": "url", "type": "string", "title": "Address" }],
		"secrets": [{ "key": "token", "title": "Access token" }]
	}
}
```

- `permissions.http`: hosts it may reach (`*.example.com` and `host:port` work).
- `permissions.httpFromSettings`: text settings whose address it may reach,
  for a server whose address only the user knows.
- `dock`: `left`, `right` or `bottom`, where the pane goes the first time;
  the user moves it as Kalem's own panes.

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
| `kalem.process.spawn({ command, args, cwd, env, shell, encoding }, onEvent)` → id; `kill(id)`, `write(id, text)` | `permissions.process`; events: `output` (`stdout`/`stderr`), `exit`, `error`; `kill` stops what it started too |
| `kalem.fs.readText/writeText/exists/stat/list/mkdir/copy/resolve(path…)` | `permissions.files`; a relative path is in the first open folder |
| `kalem.workspace.folders()` | `permissions.files` |
| `kalem.ui.pickPath({ folder, title })` | — (the user picks it) |
| `kalem.ui.openExternal(url)` | — (http and https only) |
| `kalem.ui.setStatusItem(key, { text, tooltip, command })` | `null` removes it; at most 3 |
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
| `kalem.pane`, `kalem.language` | the pane's id, the app's language |
| `var(--app-text)`, `var(--app-accent)`… | the app's colours, kept up to date |

## What an extension cannot do

The host code runs in a sandboxed page with no network of its own; the pane
is a sandboxed frame. Neither can reach a server except through
`kalem.http.fetch`, which goes through Kalem's proxy settings and only to the
allowed hosts (checked again on each redirect). Inline scripts, other sites'
scripts, images and frames are refused, and a pane cannot navigate away. A
tool with `writes: true` asks the user before each call.
