import { describe, expect, it } from 'vitest';
import { extractTopLevelBlocks } from '../../src/sync/block-map';

describe('extractTopLevelBlocks', () => {
  it('extracts top-level blocks with offsets', () => {
    const markdown = '# Title\n\nParagraph text.\n\n- item\n';
    const blocks = extractTopLevelBlocks(markdown);

    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list']);
    expect(blocks[0]?.text).toBe('# Title');
    expect(blocks[0]?.segmentText).toBe('# Title\n\n');
    expect(blocks[1]?.text).toBe('Paragraph text.');
    expect(blocks[2]?.text).toBe('- item');
  });

  it('includes frontmatter as a top-level block', () => {
    const markdown = '---\ntitle: Demo\n---\n\nBody\n';
    const blocks = extractTopLevelBlocks(markdown);

    expect(blocks[0]?.type).toBe('yaml');
    expect(blocks[0]?.text).toContain('title: Demo');
  });
});
