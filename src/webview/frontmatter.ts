import YAML from 'yaml';

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface FrontmatterState {
  raw: string;
  title?: string;
  entries: FrontmatterEntry[];
  parseError?: string;
}

export function parseFrontmatter(markdown: string): FrontmatterState | undefined {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!match) {
    return undefined;
  }

  const raw = match[1] ?? '';

  try {
    const document = YAML.parseDocument(raw);

    if (document.errors.length > 0) {
      return {
        raw,
        entries: [],
        parseError: document.errors[0]?.message ?? 'Failed to parse YAML frontmatter.',
      };
    }

    const data = document.toJS();

    if (!isRecord(data)) {
      return {
        raw,
        entries: [
          {
            key: 'value',
            value: summarizeValue(data),
          },
        ],
      };
    }

    const entries = Object.entries(data).map(([key, value]) => ({
      key,
      value: summarizeValue(value),
    }));

    const title = typeof data.title === 'string' ? data.title : undefined;

    return {
      raw,
      title,
      entries,
    };
  } catch (error) {
    return {
      raw,
      entries: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
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
