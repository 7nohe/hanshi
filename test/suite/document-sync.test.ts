import { describe, expect, it } from 'vitest';
import { PendingVersionTracker } from '../../src/sync/pending-version-tracker';

describe('PendingVersionTracker', () => {
  it('consumes only tracked versions', () => {
    const tracker = new PendingVersionTracker();
    tracker.mark(4);

    expect(tracker.consume(4)).toBe(true);
    expect(tracker.consume(4)).toBe(false);
  });

  it('clears pending versions', () => {
    const tracker = new PendingVersionTracker();
    tracker.mark(2);
    tracker.clear();

    expect(tracker.consume(2)).toBe(false);
  });
});
