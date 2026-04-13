import { extractTopLevelBlocks } from './block-map';
import { computeMinimalReplaceRange } from './text-diff';

export interface ReplaceSpan {
  start: number;
  end: number;
  text: string;
}

export function computeReplaceRange(current: string, next: string): ReplaceSpan | undefined {
  const blockRange = computeBlockReplaceRange(current, next);
  if (blockRange) {
    return blockRange;
  }

  return computeMinimalReplaceRange(current, next);
}

export function computeBlockReplaceRange(current: string, next: string): ReplaceSpan | undefined {
  const currentBlocks = extractTopLevelBlocks(current);
  const nextBlocks = extractTopLevelBlocks(next);

  if (!currentBlocks.length || !nextBlocks.length) {
    return undefined;
  }

  // Find common prefix blocks
  const minLen = Math.min(currentBlocks.length, nextBlocks.length);
  let prefixCount = 0;
  while (prefixCount < minLen) {
    const cb = currentBlocks[prefixCount];
    const nb = nextBlocks[prefixCount];
    if (!cb || !nb || cb.type !== nb.type || cb.segmentText !== nb.segmentText) break;
    prefixCount++;
  }

  // Find common suffix blocks (not overlapping with prefix)
  let suffixCount = 0;
  while (suffixCount < minLen - prefixCount) {
    const ci = currentBlocks.length - 1 - suffixCount;
    const ni = nextBlocks.length - 1 - suffixCount;
    const cb = currentBlocks[ci];
    const nb = nextBlocks[ni];
    if (!cb || !nb || cb.type !== nb.type || cb.segmentText !== nb.segmentText) break;
    suffixCount++;
  }

  if (prefixCount + suffixCount >= currentBlocks.length && prefixCount + suffixCount >= nextBlocks.length) {
    return undefined; // no change
  }

  // Detect non-contiguous changes: if any block inside the middle span is unchanged
  // (i.e. shared between current and next middles), fall back to text diff.
  const currentMiddle = currentBlocks.slice(prefixCount, currentBlocks.length - suffixCount);
  const nextMiddle = nextBlocks.slice(prefixCount, nextBlocks.length - suffixCount);
  const nextMiddleTexts = new Set(nextMiddle.map((b) => b.segmentText));
  for (const cb of currentMiddle) {
    if (nextMiddleTexts.has(cb.segmentText)) {
      return undefined;
    }
  }

  const currentStart = prefixCount < currentBlocks.length
    ? currentBlocks[prefixCount]!.start
    : current.length;
  const currentEnd = suffixCount > 0
    ? currentBlocks[currentBlocks.length - suffixCount]!.start
    : current.length;

  const nextFirst = prefixCount;
  const nextLast = nextBlocks.length - suffixCount;
  const nextText = nextBlocks.slice(nextFirst, nextLast).map((b) => b.segmentText).join('');

  return {
    start: currentStart,
    end: currentEnd,
    text: nextText,
  };
}
