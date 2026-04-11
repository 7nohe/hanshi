import { describe, expect, it } from 'vitest';
import { normalizeMarkdown } from '../../src/sync/markdown-normalizer';

describe('normalizeMarkdown', () => {
  it('normalizes list markers and adds a trailing newline', () => {
    const input = '* one\n* two';
    expect(normalizeMarkdown(input)).toBe('- one\n- two\n');
  });

  it('preserves CJK content', () => {
    const input = '# 見出し\n\n日本語の段落です。';
    expect(normalizeMarkdown(input)).toContain('日本語の段落です。');
  });
});
