import type { CompletionContext } from '../shared/protocol';

export function buildCompletionPrompt(markdown: string, context: CompletionContext): string {
  const relatedFiles = context.relatedFiles
    ?.map((file) => [`Path: ${file.path}`, file.excerpt].join('\n'))
    .join('\n\n---\n\n');

  return [
    'You generate inline Markdown continuations for a VS Code editor.',
    'Return only the text to insert at the cursor.',
    'Do not repeat existing text from the current line.',
    'Prefer finishing the current sentence or paragraph naturally.',
    'A multi-line paragraph continuation is allowed when it reads naturally, but avoid jumping into unrelated new sections.',
    'Do not wrap the answer in backticks, quotes, bullets, or explanations.',
    'Prefer matching the current section structure and nearby Markdown style.',
    '',
    'Current section headings:',
    context.sectionHeadings?.join(' > ') || '(root)',
    '',
    'Current block kind:',
    context.currentBlockKind || '(unknown)',
    '',
    'Current line prefix:',
    context.currentLinePrefix || '(empty)',
    '',
    'Current line suffix:',
    context.currentLineSuffix || '(empty)',
    '',
    'Text immediately before the cursor:',
    context.surroundingTextBefore || '(empty)',
    '',
    'Text immediately after the cursor:',
    context.surroundingTextAfter || '(empty)',
    '',
    'Document excerpt:',
    truncateMarkdown(markdown),
    '',
    'Related file excerpts:',
    relatedFiles || '(none)',
  ].join('\n');
}

export function sanitizeCompletion(rawText: string, context: CompletionContext): string {
  let text = rawText.replace(/\r\n/g, '\n').trimEnd();
  text = text.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '');

  if (!text) {
    return '';
  }

  if (context.currentLinePrefix && text.startsWith(context.currentLinePrefix)) {
    text = text.slice(context.currentLinePrefix.length);
  }

  if (text.startsWith('\n')) {
    text = text.slice(1);
  }

  const clipped = clipCompletion(text, context);

  if (!clipped.trim()) {
    return '';
  }

  if (context.currentLineSuffix && clipped === context.currentLineSuffix) {
    return '';
  }

  return clipped;
}

function clipCompletion(text: string, context: CompletionContext): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((segment) => segment.trimEnd())
    .filter(Boolean);
  const firstParagraph = paragraphs[0] ?? '';
  const allowMultiline = shouldAllowMultilineCompletion(context);
  const lines = (allowMultiline ? firstParagraph : firstParagraph.split('\n')[0] ?? '').split('\n');
  const keptLines: string[] = [];
  let totalLength = 0;

  for (const line of lines) {
    if (keptLines.length > 0 && isLikelyNewMarkdownBlock(line)) {
      break;
    }

    const nextLength = totalLength + line.length + (keptLines.length > 0 ? 1 : 0);

    if (nextLength > 360) {
      break;
    }

    keptLines.push(line);
    totalLength = nextLength;
  }

  return keptLines.join('\n').trimEnd();
}

function isLikelyNewMarkdownBlock(line: string): boolean {
  return /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|---$)/.test(line.trimStart());
}

function shouldAllowMultilineCompletion(context: CompletionContext): boolean {
  const prefix = context.currentLinePrefix.trim();
  const suffix = context.currentLineSuffix.trim();

  return prefix.length === 0 && suffix.length === 0;
}

function truncateMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');

  if (normalized.length <= 6000) {
    return normalized;
  }

  return `${normalized.slice(0, 3000)}\n...\n${normalized.slice(-2500)}`;
}
