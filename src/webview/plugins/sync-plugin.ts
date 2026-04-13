import type { Crepe } from '@milkdown/crepe';

export interface SyncPluginOptions {
  root: HTMLElement;
  getVersion: () => number;
  onMarkdownChange: (markdown: string, version: number) => void;
  onUserInput?: () => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

export interface SyncPluginHandle {
  dispose(): void;
  isComposing(): boolean;
}

const SYNC_DEBOUNCE_MS = 150;

export function createSyncPlugin(editor: Crepe, options: SyncPluginOptions): SyncPluginHandle {
  let composing = false;
  let pendingTimer: number | undefined;

  const schedule = () => {
    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      if (!composing) {
        options.onMarkdownChange(editor.getMarkdown(), options.getVersion());
      }
    }, SYNC_DEBOUNCE_MS);
  };

  const onCompositionStart = () => {
    composing = true;
    options.onCompositionStart?.();
  };

  const onCompositionEnd = () => {
    composing = false;
    options.onUserInput?.();
    options.onCompositionEnd?.();
    schedule();
  };

  options.root.addEventListener('compositionstart', onCompositionStart);
  options.root.addEventListener('compositionend', onCompositionEnd);

  editor.on((listener) => {
    listener.markdownUpdated((_ctx, _markdown) => {
      if (composing) {
        return;
      }

      options.onUserInput?.();
      schedule();
    });
  });

  return {
    dispose() {
      window.clearTimeout(pendingTimer);
      options.root.removeEventListener('compositionstart', onCompositionStart);
      options.root.removeEventListener('compositionend', onCompositionEnd);
    },
    isComposing() {
      return composing;
    },
  };
}
