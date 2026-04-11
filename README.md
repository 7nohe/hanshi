# Hanshi

Hanshi is a VS Code custom Markdown editor aimed at docs-as-code workflows.

The project is not trying to win on sheer editor feature count. Its main goal is to make visual Markdown editing safer for specification documents, ADRs, design docs, and other source-controlled writing where diff quality matters.

## Direction

Hanshi is optimized for:

- source fidelity
- targeted `WorkspaceEdit` updates
- stable coexistence with hand-edited Markdown
- Japanese IME safety
- docs-as-code workflows

Compared to general-purpose WYSIWYG Markdown extensions, Hanshi intentionally prioritizes persistence behavior over UI breadth.

## Current Status

The project currently includes:

- VS Code `CustomTextEditorProvider`
- Milkdown Crepe webview editor
- bidirectional sync between source and webview
- version-aware sync guard
- block-aware replacement ranges for Markdown persistence
- Mermaid preview
- image drag and drop into sibling `assets/`
- basic unit tests

The project is still in active development and should be treated as pre-release software.

## Development

Install dependencies:

```bash
bun install
```

Build the extension:

```bash
bun run build
```

Run static checks:

```bash
bun run check
```

Run lint:

```bash
bun run lint
```

Run unit tests:

```bash
bun test
```

Launch the extension in VS Code:

1. Open this repository in VS Code
2. Press `F5`
3. In the Extension Development Host, open a `.md` file with `Open With...`
4. Choose `Hanshi Markdown Editor`

## Current Priorities

The current implementation priorities are:

1. preserve unchanged Markdown as much as possible
2. keep diffs readable and localized
3. avoid breaking Japanese IME input
4. add editor features only when they do not compromise persistence quality

## License

[MIT](./LICENSE)
