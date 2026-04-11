import YAML from 'yaml';

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface FrontmatterState {
  block: string;
  raw: string;
  title?: string;
  entries: FrontmatterEntry[];
  parseError?: string;
}

export interface SplitMarkdownResult {
  frontmatter?: FrontmatterState;
  body: string;
}

export function splitMarkdownFrontmatter(markdown: string): SplitMarkdownResult {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    return { body: markdown };
  }

  const block = match[0];
  const raw = match[1] ?? '';
  const body = markdown.slice(block.length);

  try {
    const document = YAML.parseDocument(raw);

    if (document.errors.length > 0) {
      return {
        body,
        frontmatter: {
          block,
          raw,
          entries: [],
          parseError: document.errors[0]?.message ?? 'Failed to parse YAML frontmatter.',
        },
      };
    }

    const data = document.toJS();

    if (!isRecord(data)) {
      return {
        body,
        frontmatter: {
          block,
          raw,
          entries: [
            {
              key: 'value',
              value: summarizeValue(data),
            },
          ],
        },
      };
    }

    const entries = Object.entries(data).map(([key, value]) => ({
      key,
      value: summarizeValue(value),
    }));

    const title = typeof data.title === 'string' ? data.title : undefined;

    return {
      body,
      frontmatter: {
        block,
        raw,
        title,
        entries,
      },
    };
  } catch (error) {
    return {
      body,
      frontmatter: {
        block,
        raw,
        entries: [],
        parseError: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function mergeFrontmatter(frontmatterBlock: string | undefined, body: string): string {
  return frontmatterBlock ? `${frontmatterBlock}${body}` : body;
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => summarizeValue(entry)).join(', ');
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${summarizeValue(entry)}`)
      .join(', ');
  }

  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
