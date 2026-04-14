---
name: release
description: Automate VS Code Marketplace releases. Bumps version (patch/minor/major or explicit semver), commits, tags, and pushes to trigger the publish workflow. Use when the user says "release", "publish", "bump version", or "ship it".
user_invocable: true
model: sonnet
argument-hint: patch | minor | major | 0.2.0
allowed-tools: Bash, Read
---

# Release

Automates the full release flow for the Hanshi VS Code extension.

## Argument

```
/release <bump>
```

- `bump`: `patch` / `minor` / `major` or an explicit semver (e.g. `0.2.0`)
- If omitted, ask the user which bump type they want

## Steps

1. **Preflight checks**
   - Verify working tree is clean (`git status --porcelain`). If dirty, stop and tell the user to commit first
   - Verify current branch is `main`
   - Run `git pull --ff-only` to sync with remote

2. **Show current version**
   - Read current version from `package.json` and display it

3. **Bump version**
   - For bump keywords: `npm version <bump> --no-git-tag-version`
   - For explicit version: `npm version <version> --no-git-tag-version`
   - Display the new version

4. **Commit and tag**
   - `git add package.json bun.lock`
   - Commit message: `release: v<version>`
   - Tag: `v<version>`

5. **Confirm before push**
   - Ask the user: "Push `v<version>` to trigger Marketplace publish?"
   - On approval: `git push && git push --tags`

6. **Report**
   - Show the GitHub Actions workflow link: `https://github.com/7nohe/hanshi/actions/workflows/publish.yml`
