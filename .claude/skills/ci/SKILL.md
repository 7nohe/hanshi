---
name: ci
description: Run the full CI pipeline locally (lint, typecheck, unit tests, integration tests) before pushing. Use when the user says "CI", "run checks", "run all tests", "pre-push check", "lint and test", or wants to verify everything passes locally.
user_invocable: true
model: sonnet
argument-hint: "[--fix]"
allowed-tools: Bash, Read
---

# CI

Runs the same checks as the GitHub Actions CI workflow locally, so issues are caught before push.

## Argument

```
/ci [--fix]
```

- `--fix`: auto-fix lint issues with `bun run lint --fix` instead of just reporting them
- If omitted, lint runs in check-only mode

## Steps

Run each step sequentially. Stop on first failure and report the error clearly.

1. **Lint**
   - Without `--fix`: `bun run lint`
   - With `--fix`: `bunx biome check --fix .` then re-run `bun run lint` to confirm
   - On failure: show the lint errors and suggest `--fix` if not already used

2. **Typecheck**
   - `bun run typecheck`
   - On failure: show the type errors with file paths and line numbers

3. **Unit tests**
   - `bun run test`
   - On failure: show which tests failed

4. **Integration tests**
   - `bun run test:integration`
   - On failure: show which tests failed

5. **Report**
   - If all steps pass: "All CI checks passed — safe to push."
   - If any step failed: summarize which step(s) failed
