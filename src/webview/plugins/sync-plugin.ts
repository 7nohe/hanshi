import type { Crepe } from '@milkdown/crepe';

export interface SyncPluginOptions {
  root: HTMLElement;
  getVersion: () => number;
  onMarkdownChange: (markdown: string, version: number) => void;
  onCompositionEnd?: () => void;
}

export interface SyncPluginHandle {
  dispose(): void;
  isComposing(): boolean;
}

export function createSyncPlugin(editor: Crepe, options: SyncPluginOptions): SyncPluginHandle {
  let composing = false;
  let pendingTimer: number | undefined;

  const flush = () => {
    if (composing) {
      return;
    }

    options.onMarkdownChange(editor.getMarkdown(), options.getVersion());
  };

  const schedule = () => {
    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(flush, 150);
  };

  const onCompositionStart = () => {
    composing = true;
  };

  const onCompositionEnd = () => {
    composing = false;
    options.onCompositionEnd?.();
    schedule();
  };

  options.root.addEventListener('compositionstart', onCompositionStart);
  options.root.addEventListener('compositionend', onCompositionEnd);

  editor.on((listener) => {
    listener.markdownUpdated((_ctx, markdown) => {
      if (composing) {
        return;
      }

      window.clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(() => {
        options.onMarkdownChange(markdown, options.getVersion());
      }, 150);
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
