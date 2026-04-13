# Using Hanshi

Hanshi adds a custom editor for `*.md` files. The default Markdown text editor in VS Code is unchanged; you opt in to Hanshi per file or per workspace.

## Opening a Markdown File With Hanshi

Hanshi registers itself with `priority: option`, so VS Code does not pick it automatically. Use one of the following:

- **From the Explorer**: right click a `.md` file → **Open With…** → **Hanshi Markdown Editor**.
- **From the Command Palette**: run **Open With Hanshi** with the target file in the active editor.
- **Set Hanshi as the default for a workspace**: run **Configure Default Editor for `*.md`…** and choose **Hanshi Markdown Editor**. Subsequent `.md` opens will use Hanshi until you change the setting back.

The editor opens as a webview-backed view, but the underlying file remains a regular text document. Saving (`Cmd/Ctrl+S`), undo/redo, source control, and other VS Code workflows behave normally.

## Editing

Hanshi is built on [Milkdown Crepe](https://milkdown.dev/), a WYSIWYG-style Markdown editor:

- Type Markdown directly; headings, lists, code blocks, tables, and inline marks render as you type.
- Block-level operations (move, delete) come from the Milkdown block handle that appears in the gutter.
- IME input (Japanese, Chinese, Korean) is supported and edits are committed only when composition ends, so source diffs stay clean.

Source-fidelity is the priority over UI breadth: edits are written back to the underlying Markdown file using minimal, block-aware ranges so the diff matches what you visually changed.

## Mermaid Preview

Mermaid code fences (` ```mermaid `) are rendered inline. Edit the source inside the fence and the diagram updates when you leave the block.

## Inserting Images

Drag and drop an image file from Finder/Explorer (or paste from the clipboard) onto the editor. Hanshi:

1. Saves the image into a sibling `assets/` directory next to the Markdown file (created if missing).
2. Inserts a Markdown image reference using a relative path.

If a file with the same name already exists, the new file is renamed to avoid clobbering.

## Selection References

To share a precise pointer to a passage of Markdown:

- **Copy Selection Reference** — `Cmd+Shift+C` (macOS) / `Ctrl+Shift+C` (Windows/Linux), or run **Hanshi: Copy Selection Reference** from the Command Palette.

  Copies a `path:line:column` (or `path:line:col-line:col` for multi-line) reference to the clipboard, so you can paste it into a chat, PR, or issue and have someone open the exact range.

- **Send Selection to Chat** — run **Hanshi: Send Selection to Chat** to push the current selection into the active VS Code chat panel as context.

The same selection is also exposed to AI agents through the `hanshi-selection` language model tool, so chat participants can request the current selection without you copying it manually.

## AI Inline Completions

Hanshi can suggest short continuations as you type, using GitHub Copilot through the VS Code Language Model API. This is a separate, opt-in feature. See [ai-completions.md](./ai-completions.md) for the full setup, consent flow, and troubleshooting steps.

The `hanshi.aiCompletions.enabled` setting (default `true`) toggles the feature without affecting Copilot access for other extensions.

## Switching Back to the Plain Text Editor

Right click a `.md` file → **Open With…** → **Text Editor**, or use **Reopen Editor With…** from the Command Palette. If you previously set Hanshi as the default editor, **Configure Default Editor for `*.md`…** lets you switch the default back.
