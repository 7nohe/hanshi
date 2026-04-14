import { describe, expect, it } from 'vitest';
import { buildCompletionPrompt, sanitizeCompletion } from '../../src/ai/completion-helpers';

const context = {
  currentLinePrefix: 'console.',
  currentLineSuffix: '',
  surroundingTextBefore: 'function demo() { console.',
  surroundingTextAfter: '}',
  sectionHeadings: ['Demo', 'API'],
  currentBlockKind: 'paragraph',
  relatedFiles: [{ path: 'appendix.md', excerpt: '# Appendix\n\nMore details.' }],
};

describe('sanitizeCompletion', () => {
  it('drops repeated current-line prefixes', () => {
    expect(sanitizeCompletion('console.log(value)', context)).toBe('log(value)');
  });

  it('keeps a multi-line paragraph response', () => {
    expect(
      sanitizeCompletion('First sentence.\nSecond sentence.', {
        ...context,
        currentLinePrefix: '',
        currentLineSuffix: '',
      }),
    ).toBe('First sentence.\nSecond sentence.');
  });

  it('stops before a new markdown block starts', () => {
    expect(sanitizeCompletion('This continues the paragraph.\n## Appendix', context)).toBe(
      'This continues the paragraph.',
    );
  });

  it('keeps inline completions on a single line in the middle of text', () => {
    expect(sanitizeCompletion('log(value)\nreturn value', context)).toBe('log(value)');
  });

  it('removes fenced-code wrappers from model output', () => {
    expect(sanitizeCompletion('```ts\nconsole.log(value)\n```', context)).toBe('log(value)');
  });
});

describe('buildCompletionPrompt', () => {
  it('includes cursor context and document excerpt', () => {
    const prompt = buildCompletionPrompt('# Demo\n\nconsole.', context);

    expect(prompt).toContain('Current section headings:');
    expect(prompt).toContain('Demo > API');
    expect(prompt).toContain('Current block kind:');
    expect(prompt).toContain('paragraph');
    expect(prompt).toContain('Current line prefix:');
    expect(prompt).toContain('console.');
    expect(prompt).toContain('Document excerpt:');
    expect(prompt).toContain('# Demo');
    expect(prompt).toContain('Related file excerpts:');
    expect(prompt).toContain('Path: appendix.md');
  });
});
