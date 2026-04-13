# AI Inline Completions

Hanshi can produce short inline continuation suggestions while you write Markdown. The feature is built on top of the VS Code [Language Model API](https://code.visualstudio.com/api/extension-guides/language-model) and currently routes requests through GitHub Copilot's chat models.

## Requirements

- VS Code 1.85 or later (declared in `package.json`).
- An active GitHub Copilot subscription with the GitHub Copilot extension installed and signed in.
- The user must grant Hanshi access to the Copilot language model. VS Code prompts for this consent the first time a request is made.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `hanshi.aiCompletions.enabled` | `true` | Enables or disables inline completion requests from the Hanshi editor. |

The setting can be changed per workspace or per folder in the standard `settings.json`:

```jsonc
{
  "hanshi.aiCompletions.enabled": true
}
```

When the setting is `false`, Hanshi never calls the language model and silently clears any pending suggestion.

## Granting or Revoking Copilot Access

Access to the language model is controlled by VS Code, not by Hanshi. Hanshi merely reacts to whatever access state VS Code reports.

### First-time consent

The first time you trigger a completion in a Hanshi document, VS Code shows a modal asking whether you want to allow the Hanshi extension to use the Copilot model. The justification displayed is:

> Generate short inline continuation suggestions in the Hanshi Markdown editor.

Choose **Allow** to enable completions. Choose **Deny** (or close the dialog) to keep them disabled — Hanshi will then show a status notice such as `AI completions are unavailable. GitHub Copilot access or consent is required.`

### Granting access after a previous denial

If you initially denied access and later want to opt in:

1. Open the Command Palette and run **Manage Language Model Access**.
2. Find **Hanshi** in the list and toggle Copilot access on.
3. Return to a Hanshi document and continue typing — the next request will pick up the change automatically. There is no need to reload the window.

Alternatively you can simply trigger a completion again; if no consent state is recorded yet, VS Code will show the consent prompt once more.

### Revoking access after granting it

To turn completions off without disabling the feature globally:

1. Run **Manage Language Model Access** from the Command Palette.
2. Toggle Hanshi's Copilot access off.

Hanshi listens for access changes (`LanguageModelAccessInformation.onDidChange`) and for model availability changes (`vscode.lm.onDidChangeChatModels`), and invalidates its cached model selection immediately. Subsequent completion requests will see the new state and stop hitting Copilot. A `NoPermissions` error returned mid-request also forces Hanshi to drop its cached model so it does not keep retrying with stale credentials.

If you only want to pause completions temporarily, prefer toggling `hanshi.aiCompletions.enabled` to `false` instead — that does not affect any other extension's Copilot access.

## Model Selection

Hanshi prefers the following Copilot model families in order, falling back to any available Copilot model if none of them are present:

1. `gpt-4.1`
2. `gpt-4o`
3. `gpt-5-mini`

Model selection is cached for the lifetime of the editor instance and is invalidated automatically whenever VS Code reports a change to chat model availability or to the extension's language model access.

## Troubleshooting

- **"AI completions are unavailable. GitHub Copilot access or consent is required."** — Either the Copilot extension is not signed in, no Copilot chat model is installed, or you have not granted Hanshi access. Check **Manage Language Model Access** and the Copilot status bar item.
- **"AI completions are temporarily blocked because Copilot quota or policy limits were hit."** — Copilot returned a `Blocked` error. Wait for quota to recover or check your organisation's Copilot policy.
- **Completions seem to ignore a recent settings change.** — Hanshi reads `hanshi.aiCompletions.enabled` on every request, so toggling the setting takes effect immediately. If completions still do not appear, ensure the file is opened with the Hanshi editor (right click → **Open With…** → **Hanshi Markdown Editor**).
