# Hanshi

Hanshi is a VS Code custom Markdown editor aimed at docs-as-code workflows.

The project is not trying to win on sheer editor feature count. Its main goal is to make visual Markdown editing safer for specification documents, ADRs, design docs, and other source-controlled writing where diff quality matters.

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

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, development workflow, and contribution guidelines.

## License

[MIT](./LICENSE)
