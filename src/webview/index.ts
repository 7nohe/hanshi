import { Crepe } from '@milkdown/crepe';
import { replaceAll } from '@milkdown/utils';
import '@milkdown/crepe/theme/classic.css';
import './styles/editor.css';
import type { HostToWebviewMessage } from '../shared/protocol';
import { WebviewBridge } from './bridge';
import { enhanceMermaidBlocks } from './plugins/mermaid-block';
import { createSyncPlugin, type SyncPluginHandle } from './plugins/sync-plugin';

const bridge = new WebviewBridge();
const editorRoot = getRequiredElement<HTMLElement>('editor');
const statusRoot = getRequiredElement<HTMLElement>('status');

let editor: Crepe | undefined;
let syncPlugin: SyncPluginHandle | undefined;
let currentVersion = 0;
let currentEditable = true;
let pendingExternalUpdate: string | undefined;

bridge.onMessage((message) => {
  void handleMessage(message);
});

bridge.postMessage({ type: 'ready' });

async function handleMessage(message: HostToWebviewMessage): Promise<void> {
  switch (message.type) {
    case 'init':
      currentVersion = message.version;
      currentEditable = message.editable;
      await mountEditor(message.markdown);
      return;
    case 'externalUpdate':
      currentVersion = message.version;
      await replaceEditorContent(message.markdown);
      return;
    case 'setReadonly':
      currentEditable = message.editable;
      editor?.setReadonly(!message.editable);
      return;
    case 'hostError':
      statusRoot.textContent = message.message;
      statusRoot.dataset.visible = 'true';
      return;
  }
}

async function mountEditor(markdown: string): Promise<void> {
  if (editor) {
    syncPlugin?.dispose();
    await editor.destroy();
  }

  editorRoot.replaceChildren();
  editor = new Crepe({
    root: editorRoot,
    defaultValue: markdown,
  });

  await editor.create();
  editor.setReadonly(!currentEditable);

  syncPlugin = createSyncPlugin(editor, {
    root: editorRoot,
    getVersion: () => currentVersion,
    onCompositionEnd: () => {
      if (!pendingExternalUpdate) {
        return;
      }

      const next = pendingExternalUpdate;
      pendingExternalUpdate = undefined;
      void replaceEditorContent(next);
    },
    onMarkdownChange: (nextMarkdown, version) => {
      statusRoot.textContent = '';
      statusRoot.dataset.visible = 'false';
      bridge.postMessage({
        type: 'edit',
        markdown: nextMarkdown,
        version,
      });
      currentVersion = Math.max(currentVersion, version + 1);
      void enhanceMermaidBlocks(editorRoot);
    },
  });

  attachDropHandler(editorRoot);
  await enhanceMermaidBlocks(editorRoot);
}

async function replaceEditorContent(markdown: string): Promise<void> {
  if (syncPlugin?.isComposing()) {
    pendingExternalUpdate = markdown;
    return;
  }

  pendingExternalUpdate = undefined;

  if (!editor) {
    await mountEditor(markdown);
    return;
  }

  editor.editor.action(replaceAll(markdown, false));
  editor.setReadonly(!currentEditable);
  await enhanceMermaidBlocks(editorRoot);
}

function attachDropHandler(root: HTMLElement): void {
  root.ondragover = (event) => {
    event.preventDefault();
  };

  root.ondrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];

    if (!file || !file.type.startsWith('image/')) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== 'string') {
        return;
      }

      bridge.postMessage({
        type: 'dropImage',
        name: file.name,
        dataUrl: result,
      });
    };
    reader.readAsDataURL(file);
  };
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}
