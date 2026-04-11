import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../src/webview/frontmatter';

describe('parseFrontmatter', () => {
  it('returns undefined when the document has no leading frontmatter', () => {
    expect(parseFrontmatter('# Hanshi')).toBeUndefined();
  });

  it('extracts summary entries from YAML frontmatter', () => {
    const state = parseFrontmatter(`---
title: Sample
status: draft
tags:
  - docs
  - specs
metadata:
  owner: daiki
---

# Body
`);

    expect(state?.title).toBe('Sample');
    expect(state?.entries).toEqual([
      { key: 'title', value: 'Sample' },
      { key: 'status', value: 'draft' },
      { key: 'tags', value: 'docs, specs' },
      { key: 'metadata', value: 'owner: daiki' },
    ]);
  });

  it('keeps raw YAML and surfaces parse errors', () => {
    const state = parseFrontmatter(`---
title: [oops
---
`);

    expect(state?.raw).toContain('title: [oops');
    expect(state?.parseError).toBeDefined();
  });
});
