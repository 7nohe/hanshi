# Hanshi Implementation Notes

## Purpose

This document records what has actually been implemented so far, why specific decisions were made, and which tradeoffs are currently accepted in the MVP.

The source of truth for planned scope is still [implementation-plan.md](../implementation-plan.md). This file exists to capture the gap between the original plan and the code that now exists.

## Current Status

The project currently ships an MVP scaffold for a VS Code custom Markdown editor:

- VS Code side uses `CustomTextEditorProvider`
- WebView side uses Milkdown Crepe
- Editing sync is wired in both directions
- Markdown persistence is currently full-document replacement
- Applied `WorkspaceEdit` ranges are now reduced to the smallest changed span after normalization
- Mermaid rendering is post-processed in the WebView
- Image drag and drop writes files into a sibling `assets/` directory
- Dropped images are inserted at the current editor selection
- Type checks, build, and unit tests are in place

## Implemented Structure

### Extension host

- `src/extension.ts`
  - Registers the custom editor provider
  - Adds `hanshi.open` convenience command

- `src/provider.ts`
  - Creates the WebView
  - Applies CSP
  - Wires message passing
  - Handles dropped image persistence
  - Sends inserted image metadata back to the WebView

- `src/sync/document-sync.ts`
  - Owns document-to-webview synchronization
  - Applies webview edits through `workspace.applyEdit`
  - Ignores self-originated updates through pending version tracking
  - Rejects stale webview edits and forces a fresh external sync

- `src/sync/patch-engine.ts`
  - Generates a minimal replacement `WorkspaceEdit` from normalized Markdown
  - Delegates normalization to the Markdown normalizer

- `src/sync/text-diff.ts`
  - Computes the smallest changed text span between current and next content

- `src/sync/block-map.ts`
  - Extracts top-level mdast blocks with original source offsets

- `src/sync/markdown-normalizer.ts`
  - Uses `remark-parse` + `remark-stringify`
  - Normalizes output style to a predictable Markdown shape

- `src/sync/pending-version-tracker.ts`
  - Tracks locally applied document versions to prevent loops

- `src/sync/versioning.ts`
  - Contains pure version-comparison logic used by tests

### WebView

- `src/webview/index.ts`
  - Boots Crepe
  - Connects sync plugin and bridge
  - Applies external updates through Milkdown `replaceAll`
  - Defers external updates while IME composition is active
  - Inserts dropped images at the current selection

- `src/webview/plugins/sync-plugin.ts`
  - Debounces editor changes
  - Tracks composition state
  - Emits Markdown snapshots back to the extension host

- `src/webview/plugins/mermaid-block.ts`
  - Dynamically imports Mermaid
  - Finds Mermaid code blocks after render
  - Appends rendered previews below source blocks

- `src/webview/bridge.ts`
  - Wraps `acquireVsCodeApi()`
  - Normalizes typed messaging

- `src/shared/protocol.ts`
  - Shared message contracts between extension host and WebView

## Important Decisions

### 1. `CustomTextEditorProvider` instead of custom document

This keeps VS Code `TextDocument` as the canonical source. Undo, dirty tracking, save, revert, and dual-view editing all come from the platform instead of being rebuilt in the extension.

### 2. Full-document replacement for Phase 1

The first patch engine replaced the whole document after WebView edits. That was simple, but it created broader document changes than necessary.

The current patch engine still normalizes the entire Markdown string, but it now reduces the applied `WorkspaceEdit` to the smallest changed span using prefix/suffix matching.

Accepted tradeoff:

- opening and saving a file can normalize Markdown formatting
- git diffs may still contain unrelated formatting churn if normalization rewrites structure broadly

Reason this was accepted:

- it unblocks end-to-end editing quickly
- it improves edit locality without yet implementing AST-aware patching
- source-fidelity work is easier to layer later than basic sync plumbing

### 3. remark-based normalization on the extension side

Normalization happens in the extension host instead of the WebView so that persistence behavior stays deterministic even if the editor implementation changes.

Current normalization rules:

- bullet marker: `-`
- emphasis: `*`
- strong: `**` emitted through `remark-stringify` star mode
- fenced code blocks only
- one-space list indentation

### 4. External updates use Milkdown `replaceAll`

The first version recreated the editor on every external change. That was too destructive because it reset more UI state than necessary.

The current implementation uses Milkdown's `replaceAll` macro after `create()`. This keeps the editor instance alive and is a better baseline for:

- undo/redo interactions
- updates from the text editor side
- future selection preservation work

### 5. IME safety over immediate freshness

While the user is composing text with an IME, external updates are queued instead of being injected immediately. This is deliberate. Japanese input stability matters more than applying remote updates a few milliseconds earlier.

Current behavior:

- composition active: external content is buffered
- composition end: buffered content is applied

### 6. Mermaid is post-processed, not modeled as a first-class node yet

The current Mermaid support scans rendered code blocks and appends a preview below blocks marked as Mermaid. This is a pragmatic MVP choice.

What this gives us:

- dynamic import
- no need to write a custom Milkdown node yet

What it does not give us:

- source/preview toggle UI
- node-level editing affordances
- serialization rules specific to Mermaid blocks

### 7. WebView bundle uses ESM splitting

Mermaid is large. Switching the WebView build from IIFE to ESM with code splitting keeps the initial entry file smaller and lets Mermaid stay in lazy chunks.

This was done in:

- `esbuild.mjs`
- `src/provider.ts`

## Message Flow

### Initial load

1. WebView posts `ready`
2. Extension sends `init` with current Markdown and document version
3. WebView creates Crepe with the document contents

### Edit from WebView

1. Milkdown updates
2. Sync plugin debounces and posts `edit`
3. Extension normalizes Markdown and applies a `WorkspaceEdit`
4. VS Code emits `onDidChangeTextDocument`
5. Sync layer ignores the change if it matches a locally tracked pending version

### Edit from outside Hanshi

1. VS Code emits `onDidChangeTextDocument`
2. Sync layer sees that the version was not self-originated
3. Extension posts `externalUpdate`
4. WebView applies content through `replaceAll`
5. If IME composition is active, the update is buffered until composition ends

## Known Limitations

### Source fidelity

This is still the biggest functional gap.

Current limitation:

- edits can rewrite unaffected formatting

Planned next step:

- replace normalized-string diffing with block-level patching based on mdast positions

### Mermaid UX

Current limitation:

- preview is append-only and loosely coupled to the source block

Planned next step:

- promote Mermaid into a custom editing surface with explicit preview/source states

### Image insertion UX

Current limitation:

- dropped images are always written to a local `assets/` folder beside the document

Planned next step:

- allow configurable asset paths

### Versioning model

Current limitation:

- stale edit detection is simple version comparison
- there is no merge or conflict resolution strategy beyond replacing with the latest external state

Planned next step:

- track acknowledged versions more explicitly
- add targeted tests around multi-edit races

## Verification Performed

The following checks have been run against the current code:

- `npm run check`
- `npm run build`
- `npm test`

Current test coverage is intentionally narrow and only covers pure logic:

- Markdown normalization behavior
- pending version tracker behavior
- stale-version detection

## Next Recommended Work

If continuing the MVP, the next highest-value items are:

1. Replace full-document persistence with block-level patch generation.
2. Turn Mermaid handling into a proper editor feature instead of DOM post-processing.
3. Add integration tests using `@vscode/test-electron`.
4. Make image asset output paths configurable.

## Remaining Tasks

This section is the practical backlog from the current state of the codebase.

### High priority

- Implement patch-based persistence instead of full-document replacement.
- Preserve selection and scroll position more carefully during external updates.
- Add race-condition coverage for rapid edits from both Hanshi and the text editor.
- Verify undo/redo behavior inside VS Code, not only in unit tests.
- Confirm Japanese IME behavior on real editor interactions, especially around composition end and external sync.

### Medium priority

- Replace Mermaid DOM post-processing with a first-class editor integration.
- Make image asset output path configurable.
- Add graceful handling for malformed Markdown or parser failures.
- Improve readonly handling when panels lose focus or become inactive.

### Lower priority

- Add richer metadata to `package.json` for publishing readiness.
- Add extension icon and marketplace-facing assets.
- Expand fixture coverage for frontmatter, nested lists, tables, math, and mixed CJK content.
- Add `@vscode/test-electron` integration coverage for open, edit, save, revert, and dual-view scenarios.
- Measure and tune WebView startup cost after more features are added.

### Explicitly out of scope for current MVP

- Block-level source fidelity heuristics based on document style detection.
- Frontmatter form UI.
- Link completion and broken link analysis.
- AI-assisted structure transforms.
- TOC generation and docs-as-code workflow helpers.
