# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Hanshi is a VS Code `CustomTextEditorProvider` extension that gives Markdown files a Typora-style WYSIWYG editor using Milkdown (ProseMirror). The canonical source is always VS Code's `TextDocument` — the webview never owns the file. This makes undo, dirty tracking, save, and revert work through the platform.

## Commands

```bash
bun install              # install dependencies
bun run build            # build extension + webview bundles
bun run check            # typecheck all tsconfigs
bun run lint             # lint with biome
bun run test             # unit tests (vitest)
bun run test:integration # integration tests (@vscode/test-electron)
```

To run a single unit test file: `bunx vitest run test/unit/patch-engine.test.ts`

To launch locally: F5 in VS Code → open a .md file with "Open With..." → select "Hanshi Markdown Editor".

## Architecture

Two separate esbuild bundles share a typed message protocol:

- **Extension host** (`src/extension.ts` → `dist/extension.js`, CJS): registers the CustomTextEditorProvider, commands, and LM tool. `vscode` is external.
- **Webview** (`src/webview/index.ts` → `dist/webview/`, ESM with splitting): Milkdown Crepe editor, completion ghost text, frontmatter UI. Mermaid is code-split into lazy chunks.

### Host ↔ Webview Protocol

All communication uses `postMessage`. The typed contract is in `src/shared/protocol.ts` — discriminated unions `HostToWebviewMessage` and `WebviewToHostMessage`. Never duplicate message types outside this file.

### Document Sync (`src/sync/`)

The sync loop is the most delicate part of the codebase. Key invariants:

- **Loop prevention**: before applying a `WorkspaceEdit`, `DocumentSync` marks the expected next version in `PendingVersionTracker`. When `onDidChangeTextDocument` fires, the tracker consumes the version and skips the echo.
- **Stale edit guard**: each webview `edit` message carries a version. If it's behind the document version, the edit is rejected and a fresh `externalUpdate` is sent.
- **IME safety**: the webview suppresses outgoing edits during IME composition. External updates arriving mid-composition are buffered until `compositionend`.
- **Normalization**: every webview edit is remark-parsed and re-stringified (bullet=`-`, emphasis=`*`, fences, one-space list indent). This means opening + saving can reformat markdown — an accepted tradeoff for diff stability.

### AI Features (`src/ai/`)

- `inline-completion.ts`: selects a GitHub Copilot model (preference order: gpt-4.1 → gpt-4o → gpt-5-mini → any), streams completion, caches the model promise with invalidation on permission/model changes.
- `completion-helpers.ts`: builds the LLM prompt and sanitizes responses.
- `chat-tool.ts`: registers `hanshi_getSelection` as an LM tool for Copilot Chat.

### Webview (`src/webview/`)

- Frontmatter is stripped before Milkdown sees it (it can't parse `---`). `splitMarkdownFrontmatter` removes it; `mergeFrontmatter` re-adds on every outgoing edit.
- `sync-plugin.ts`: 150ms debounce, suppresses edits during IME composition.
- `completion.ts`: browser-side ghost text overlay with 250ms debounce. Tab to accept, Escape to dismiss.

## Design Priorities

In order: source fidelity > stable sync > predictable diffs > IME safety > editor UX. If a change improves UI but weakens persistence semantics, treat it as a regression.

## Tests

- **Unit** (`test/unit/`): vitest, pure logic only (no VS Code API, no DOM). Config: `vitest.config.ts`.
- **Integration** (`test/integration/`): @vscode/test-electron + Mocha. Compiled to `out/` via `tsconfig.integration.json`. Runs a real VS Code instance with `--disable-extensions`.
- Four tsconfigs: `tsconfig.json` (host), `tsconfig.webview.json` (browser), `tsconfig.test.json` (unit), `tsconfig.integration.json` (integration).

## Key Non-obvious Details

- `HanshiEditorProvider.activeWebview` is a **static** field. Only one webview is "active" at a time — commands and the LM tool use this reference.
- `getSelection()` uses a 3-second timeout promise for the webview round-trip.
- Image resolution is sandboxed: rejects absolute paths and traversals outside the document directory.
- `retainContextWhenHidden: true` keeps the webview alive when the tab is hidden.
- Related markdown files for AI completion context are cached with an LRU cap of 32 entries, not invalidated on file changes.
