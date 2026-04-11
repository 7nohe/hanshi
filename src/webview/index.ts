import { Crepe } from '@milkdown/crepe';
import { insert, replaceAll } from '@milkdown/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
import './styles/editor.css';
import type { HostToWebviewMessage } from '../shared/protocol';
import { WebviewBridge } from './bridge';
import { parseFrontmatter, type FrontmatterState } from './frontmatter';
import { createImageMarkdown } from './markdown';
import { enhanceMermaidBlocks } from './plugins/mermaid-block';
import { createSyncPlugin, type SyncPluginHandle } from './plugins/sync-plugin';

const bridge = new WebviewBridge();
const editorRoot = getRequiredElement<HTMLElement>('editor');
const frontmatterRoot = getRequiredElement<HTMLElement>('frontmatter');
const frontmatterSummary = getRequiredElement<HTMLElement>('frontmatter-summary');
const frontmatterRaw = getRequiredElement<HTMLElement>('frontmatter-raw');
const frontmatterToggle = getRequiredElement<HTMLButtonElement>('frontmatter-toggle');
const statusRoot = getRequiredElement<HTMLElement>('status');

let editor: Crepe | undefined;
let syncPlugin: SyncPluginHandle | undefined;
let currentVersion = 0;
let currentEditable = true;
let pendingExternalUpdate: string | undefined;

frontmatterToggle.addEventListener('click', () => {
  const expanded = frontmatterRoot.dataset.expanded === 'true';
  frontmatterRoot.dataset.expanded = expanded ? 'false' : 'true';
  frontmatterToggle.textContent = expanded ? 'Show Raw' : 'Hide Raw';
});

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
      statusRoot.dataset.kind = 'error';
      return;
    case 'hostNotice':
      statusRoot.textContent = message.message;
      statusRoot.dataset.visible = 'true';
      statusRoot.dataset.kind = 'notice';
      return;
    case 'imageInserted':
      insertImageAtSelection(message.alt, message.path);
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
  renderFrontmatter(markdown);

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
      statusRoot.dataset.kind = '';
      renderFrontmatter(nextMarkdown);
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
  renderFrontmatter(markdown);
  await enhanceMermaidBlocks(editorRoot);
}

function attachDropHandler(root: HTMLElement): void {
  root.ondragover = (event) => {
    event.preventDefault();
  };

  root.ondrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];

    if (!file?.type.startsWith('image/')) {
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

function insertImageAtSelection(alt: string, path: string): void {
  if (!editor) {
    return;
  }

  statusRoot.textContent = '';
  statusRoot.dataset.visible = 'false';
  statusRoot.dataset.kind = '';
  editor.editor.action(insert(createImageMarkdown(alt, path)));
  void enhanceMermaidBlocks(editorRoot);
}

function renderFrontmatter(markdown: string): void {
  const state = parseFrontmatter(markdown);

  if (!state) {
    frontmatterRoot.dataset.visible = 'false';
    frontmatterRoot.dataset.expanded = 'false';
    frontmatterSummary.replaceChildren();
    frontmatterRaw.textContent = '';
    frontmatterToggle.textContent = 'Show Raw';
    return;
  }

  frontmatterRoot.dataset.visible = 'true';
  frontmatterToggle.textContent = frontmatterRoot.dataset.expanded === 'true' ? 'Hide Raw' : 'Show Raw';
  frontmatterSummary.replaceChildren(buildFrontmatterSummary(state));
  frontmatterRaw.textContent = state.raw;
}

function buildFrontmatterSummary(state: FrontmatterState): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const header = document.createElement('div');
  header.className = 'hanshi-frontmatter-header';

  const title = document.createElement('div');
  title.className = 'hanshi-frontmatter-title';
  title.textContent = state.title ? `Frontmatter: ${state.title}` : 'Frontmatter';
  header.append(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'hanshi-frontmatter-subtitle';
  subtitle.textContent = state.parseError
    ? 'Parsed with warnings. Raw YAML is still preserved.'
    : `${state.entries.length} field${state.entries.length === 1 ? '' : 's'}`;
  header.append(subtitle);

  fragment.append(header);

  if (state.parseError) {
    const warning = document.createElement('div');
    warning.className = 'hanshi-frontmatter-warning';
    warning.textContent = state.parseError;
    fragment.append(warning);
    return fragment;
  }

  const list = document.createElement('dl');
  list.className = 'hanshi-frontmatter-list';

  for (const entry of state.entries) {
    const key = document.createElement('dt');
    key.textContent = entry.key;

    const value = document.createElement('dd');
    value.textContent = entry.value || ' ';

    list.append(key, value);
  }

  fragment.append(list);
  return fragment;
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}
