import { describe, expect, it } from 'vitest';
import { PendingVersionTracker } from '../../src/sync/pending-version-tracker';
import { isStaleEditVersion } from '../../src/sync/versioning';

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

describe('isStaleEditVersion', () => {
  it('marks older webview edits as stale', () => {
    expect(isStaleEditVersion(3, 4)).toBe(true);
  });

  it('allows equal and optimistic next versions', () => {
    expect(isStaleEditVersion(4, 4)).toBe(false);
    expect(isStaleEditVersion(5, 4)).toBe(false);
  });
});
