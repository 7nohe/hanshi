# Contributing

## Scope

Hanshi is a docs-as-code oriented Markdown editor for VS Code.

When contributing, optimize for:

1. source fidelity
2. stable sync behavior
3. predictable diffs
4. IME safety
5. only then additional editor UX

If a proposed change improves UI but weakens persistence semantics, treat that as a regression unless there is a strong reason otherwise.

## Setup

Install dependencies:

```bash
bun install
```

Build:

```bash
bun run build
```

Type-check:

```bash
bun run check
```

Lint:

```bash
bun run lint
```

Run unit tests:

```bash
bun test
```

## Running Locally

1. Open the repository in VS Code.
2. Press `F5` to start an Extension Development Host.
3. In the development host, open a Markdown file with `Open With...`.
4. Select `Hanshi Markdown Editor`.

## Contribution Guidelines

### Persistence-first changes

Changes that affect Markdown serialization, patch generation, sync, or IME handling should include:

- a clear explanation of the behavior change
- unit tests where practical
- manual verification notes if the change affects editor interaction

### UI changes

UI work should preserve the existing goal of keeping the editor reliable for source-controlled documents.

Avoid adding complex behavior that:

- forces broad rewrites of source Markdown
- makes diff output less predictable
- introduces hidden mutations on open or save

### Tests

At minimum, run:

```bash
bun run lint
bun run check
bun test
bun run build
```

There is an integration test runner scaffold, but it is not yet stable in all environments. If you work on it, document whether it passes locally and under what conditions.

## Design Notes

Project notes and implementation decisions live in:

- [docs/implementation-notes.md](./docs/implementation-notes.md)
- [.agents/plans/implementation-plan.md](./.agents/plans/implementation-plan.md)
- [.agents/plans/overview.md](./.agents/plans/overview.md)
