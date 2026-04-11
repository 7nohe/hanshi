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

  if (!currentBlocks.length || currentBlocks.length !== nextBlocks.length) {
    return undefined;
  }

  const changedIndices: number[] = [];

  for (let index = 0; index < currentBlocks.length; index += 1) {
    const currentBlock = currentBlocks[index];
    const nextBlock = nextBlocks[index];

    if (!currentBlock || !nextBlock) {
      return undefined;
    }

    if (currentBlock.type !== nextBlock.type || currentBlock.segmentText !== nextBlock.segmentText) {
      changedIndices.push(index);
    }
  }

  if (!changedIndices.length) {
    return undefined;
  }

  const first = changedIndices[0];
  const last = changedIndices[changedIndices.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  for (let index = first; index <= last; index += 1) {
    if (!changedIndices.includes(index)) {
      return undefined;
    }
  }

  const currentStart = currentBlocks[first]?.start;
  const currentEnd = currentBlocks[last]?.segmentEnd;

  if (typeof currentStart !== 'number' || typeof currentEnd !== 'number') {
    return undefined;
  }

  const nextText = nextBlocks.slice(first, last + 1).map((block) => block.segmentText).join('');

  return {
    start: currentStart,
    end: currentEnd,
    text: nextText,
  };
}
