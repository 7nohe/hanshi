import { describe, expect, it } from 'vitest';
import { computeBlockReplaceRange, computeReplaceRange } from '../../src/sync/block-diff';
import { normalizeMarkdown, safeNormalizeMarkdown } from '../../src/sync/markdown-normalizer';

describe('normalizeMarkdown', () => {
  it('normalizes list markers and adds a trailing newline', () => {
    const input = '* one\n* two';
    expect(normalizeMarkdown(input)).toBe('- one\n- two\n');
  });

  it('preserves CJK content', () => {
    const input = '# 見出し\n\n日本語の段落です。';
    expect(normalizeMarkdown(input)).toContain('日本語の段落です。');
  });

  it('is idempotent — normalizing twice produces the same result', () => {
    const inputs = [
      '* one\n* two',
      '# Title\n\n__bold__ and _italic_\n\n~~~js\ncode\n~~~\n',
      '---\ntitle: hello\n---\n\n+ item\n  + nested\n',
      '> quote\n>\n> continued\n\n***\n',
      '1.  first\n2.  second\n',
    ];

    for (const input of inputs) {
      const first = normalizeMarkdown(input);
      const second = normalizeMarkdown(first);
      expect(second).toBe(first);
    }
  });

  it('falls back to raw markdown when normalization throws', () => {
    const result = safeNormalizeMarkdown('abc', {
      parse() {
        throw new Error('boom');
      },
      stringify() {
        return '';
      },
    });

    expect(result.didFallback).toBe(true);
    expect(result.markdown).toBe('abc\n');
    expect(result.warning).toContain('normalization failed');
  });
});

describe('computeReplaceRange', () => {
  it('replaces a single changed top-level block span', () => {
    const current = '# Title\n\nOne\n\nTwo\n';
    const next = '# Title\n\nChanged\n\nTwo\n';
    expect(computeBlockReplaceRange(current, next)).toEqual({
      start: 9,
      end: 14,
      text: 'Changed\n\n',
    });
  });

  it('falls back when changed blocks are non-contiguous', () => {
    const current = '# A\n\nOne\n\nTwo\n';
    const next = '# B\n\nOne\n\nThree\n';
    expect(computeBlockReplaceRange(current, next)).toBeUndefined();
    expect(computeReplaceRange(current, next)).toBeDefined();
  });
});
