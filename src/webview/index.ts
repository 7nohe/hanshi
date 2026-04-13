import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import { Selection, TextSelection } from '@milkdown/kit/prose/state';
import { insert, replaceAll } from '@milkdown/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/classic.css';
import './styles/editor.css';
import type { HostToWebviewMessage } from '../shared/protocol';
import { WebviewBridge } from './bridge';
import { EditorView as CMEditorView } from '@codemirror/view';
import { CompletionController } from './completion';
import { mergeFrontmatter, splitMarkdownFrontmatter, type FrontmatterState } from './frontmatter';
import { createImageMarkdown } from './markdown';
import { renderMermaidPreview } from './plugins/mermaid-block';
import { createSyncPlugin, type SyncPluginHandle } from './plugins/sync-plugin';

const COPY_REF_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

const bridge = new WebviewBridge();
const workspaceRoot = getRequiredElement<HTMLElement>('workspace');
const editorRoot = getRequiredElement<HTMLElement>('editor');
const frontmatterRoot = getRequiredElement<HTMLElement>('frontmatter');
const frontmatterSummary = getRequiredElement<HTMLElement>('frontmatter-summary');
const frontmatterRaw = getRequiredElement<HTMLElement>('frontmatter-raw');
const frontmatterToggle = getRequiredElement<HTMLButtonElement>('frontmatter-toggle');
const statusRoot = getRequiredElement<HTMLElement>('status');

let editor: Crepe | undefined;
let syncPlugin: SyncPluginHandle | undefined;
let completionController: CompletionController | undefined;
let currentVersion = 0;
let currentEditable = true;
let pendingExternalUpdate: string | undefined;
let currentFrontmatter: FrontmatterState | undefined;
let hasPendingLocalChanges = false;
let requestSequence = 0;
let lastNonEmptySelection: { from: number; to: number } | undefined;

interface SelectionSnapshot {
  anchor: number;
  head: number;
  hadFocus: boolean;
}

const pendingImageSaveRequests = new Map<
  string,
  {
    resolve: (value: { alt: string; path: string }) => void;
    reject: (reason?: unknown) => void;
  }
>();
const pendingImageSrcRequests = new Map<
  string,
  {
    resolve: (value: string) => void;
    reject: (reason?: unknown) => void;
  }
>();

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
      hasPendingLocalChanges = false;
      currentEditable = message.editable;
      await mountEditor(message.markdown);
      return;
    case 'externalUpdate':
      currentVersion = message.version;
      hasPendingLocalChanges = false;
      await replaceEditorContent(message.markdown);
      return;
    case 'setReadonly':
      currentEditable = message.editable;
      editor?.setReadonly(!message.editable);
      completionController?.onReadonlyChange(message.editable);
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
    case 'saveImageResult':
      settleImageSaveRequest(message);
      return;
    case 'resolveImageSrcResult':
      settleImageSrcRequest(message);
      return;
    case 'completionResult':
      completionController?.applyCompletionResult(message);
      return;
    case 'completionCleared':
      completionController?.clearFromHost(message);
      return;
    case 'getSelection':
      bridge.postMessage(buildSelectionResponse(message.requestId));
      return;
  }
}

function buildSelectionResponse(
  requestId: string,
): Extract<import('../shared/protocol').WebviewToHostMessage, { type: 'selectionResponse' }> {
  const empty = { type: 'selectionResponse' as const, requestId, selectedText: '', contextBefore: '', contextAfter: '' };

  if (!editor) {
    return empty;
  }

  return editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let { from, to } = view.state.selection;

    if (from === to) {
      if (lastNonEmptySelection) {
        from = lastNonEmptySelection.from;
        to = lastNonEmptySelection.to;
      } else {
        return empty;
      }
    }

    const serializer = ctx.get(serializerCtx);
    const schema = view.state.schema;

    const selectionSlice = view.state.doc.slice(from, to);
    const selectionDoc = schema.topNodeType.create(null, selectionSlice.content);
    const selectedText = serializer(selectionDoc).trim();

    const beforeSlice = view.state.doc.slice(Math.max(0, from - 200), from);
    const beforeDoc = schema.topNodeType.create(null, beforeSlice.content);
    const contextBefore = serializer(beforeDoc).trim().slice(-100);

    const afterSlice = view.state.doc.slice(to, Math.min(view.state.doc.content.size, to + 200));
    const afterDoc = schema.topNodeType.create(null, afterSlice.content);
    const contextAfter = serializer(afterDoc).trim().slice(0, 100);

    return { type: 'selectionResponse', requestId, selectedText, contextBefore, contextAfter };
  });
}

async function mountEditor(markdown: string): Promise<void> {
  const { frontmatter, body } = splitMarkdownFrontmatter(markdown);
  currentFrontmatter = frontmatter;
  lastNonEmptySelection = undefined;

  if (editor) {
    syncPlugin?.dispose();
    completionController?.dispose();
    await editor.destroy();
  }

  editorRoot.replaceChildren();
  editor = new Crepe({
    root: editorRoot,
    defaultValue: body,
    featureConfigs: {
      [CrepeFeature.CodeMirror]: {
        renderPreview: renderMermaidPreview,
        previewOnlyByDefault: true,
        previewLabel: 'Diagram Preview',
      },
      [CrepeFeature.ImageBlock]: {
        onUpload: async (file) => {
          const saved = await saveImageFile(file);
          return saved.path;
        },
        proxyDomURL: (src) => {
          return resolveImageSource(src);
        },
      },
      [CrepeFeature.Toolbar]: {
        buildToolbar: (builder) => {
          builder.addGroup('copy-ref', 'Copy Reference').addItem('copy-selection-ref', {
            icon: COPY_REF_ICON,
            active: () => false,
            onRun: () => {
              bridge.postMessage({ type: 'copySelectionContext' });
            },
          });
        },
      },
    },
  });

  await editor.create();
  editor.setReadonly(!currentEditable);

  // Track selection changes to preserve last non-empty selection for toolbar actions
  editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const originalDispatch = view.dispatch.bind(view);
    view.dispatch = (...args) => {
      originalDispatch(...args);
      const { from, to } = view.state.selection;
      if (from !== to) {
        lastNonEmptySelection = { from, to };
      }
    };
  });

  renderFrontmatter(currentFrontmatter);
  completionController = new CompletionController({
    root: editorRoot,
    scrollContainer: workspaceRoot,
    getMarkdown: () => mergeFrontmatter(currentFrontmatter?.block, editor?.getMarkdown() ?? ''),
    getVersion: () => getEditorVersion(),
    getEditable: () => currentEditable,
    postMessage: (message) => {
      bridge.postMessage(message);
    },
    insertText: (text) => {
      insertTextAtSelection(text);
    },
  });

  syncPlugin = createSyncPlugin(editor, {
    root: editorRoot,
    getVersion: () => currentVersion,
    onCompositionStart: () => {
      completionController?.onCompositionStart();
    },
    onCompositionEnd: () => {
      completionController?.onCompositionEnd();
      if (!pendingExternalUpdate) {
        return;
      }

      const next = pendingExternalUpdate;
      pendingExternalUpdate = undefined;
      void replaceEditorContent(next);
    },
    onUserInput: () => {
      hasPendingLocalChanges = true;
      completionController?.onUserInput();
    },
    onMarkdownChange: (nextMarkdown, version) => {
      const nextVersion = Math.max(currentVersion, version + 1);
      statusRoot.textContent = '';
      statusRoot.dataset.visible = 'false';
      statusRoot.dataset.kind = '';
      renderFrontmatter(currentFrontmatter);
      bridge.postMessage({
        type: 'edit',
        markdown: mergeFrontmatter(currentFrontmatter?.block, nextMarkdown),
        version: nextVersion,
      });
      currentVersion = nextVersion;
      hasPendingLocalChanges = false;
    },
  });

  attachDropHandler(editorRoot);
}

async function replaceEditorContent(markdown: string): Promise<void> {
  completionController?.onExternalUpdate();

  if (syncPlugin?.isComposing()) {
    pendingExternalUpdate = markdown;
    return;
  }

  pendingExternalUpdate = undefined;
  const { frontmatter, body } = splitMarkdownFrontmatter(markdown);
  currentFrontmatter = frontmatter;
  lastNonEmptySelection = undefined;

  if (!editor) {
    await mountEditor(markdown);
    return;
  }

  const selectionSnapshot = captureSelectionSnapshot();
  editor.editor.action(replaceAll(body, false));
  restoreSelectionSnapshot(selectionSnapshot);
  editor.setReadonly(!currentEditable);
  renderFrontmatter(currentFrontmatter);
}

function captureSelectionSnapshot(): SelectionSnapshot | undefined {
  if (!editor) {
    return undefined;
  }

  return editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    return {
      anchor: view.state.selection.anchor,
      head: view.state.selection.head,
      hadFocus: view.hasFocus(),
    };
  });
}

function restoreSelectionSnapshot(snapshot: SelectionSnapshot | undefined): void {
  if (!editor || !snapshot || !snapshot.hadFocus) {
    return;
  }

  editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const maxPosition = view.state.doc.content.size;
    const anchor = clampPosition(snapshot.anchor, maxPosition);
    const head = clampPosition(snapshot.head, maxPosition);
    const selection = TextSelection.between(
      view.state.doc.resolve(anchor),
      view.state.doc.resolve(head),
    );

    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  });
}

function clampPosition(position: number, maxPosition: number): number {
  return Math.max(0, Math.min(position, maxPosition));
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

    void saveImageFile(file)
      .then(({ alt, path }) => {
        insertImageAtSelection(alt, path);
      })
      .catch((error) => {
        showStatus(error instanceof Error ? error.message : String(error), 'error');
      });
  };
}

function insertImageAtSelection(alt: string, path: string): void {
  if (!editor) {
    return;
  }

  clearStatus();
  editor.editor.action(insert(createImageMarkdown(alt, path)));
}

async function saveImageFile(file: File): Promise<{ alt: string; path: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  const requestId = nextRequestId('save-image');

  return new Promise((resolve, reject) => {
    pendingImageSaveRequests.set(requestId, { resolve, reject });
    bridge.postMessage({
      type: 'saveImageRequest',
      requestId,
      name: file.name,
      dataUrl,
    });
  });
}

async function resolveImageSource(src: string): Promise<string> {
  if (!src || /^(?:https?:|data:|blob:|vscode-webview:)/i.test(src)) {
    return src;
  }

  const requestId = nextRequestId('resolve-image');

  return new Promise((resolve, reject) => {
    pendingImageSrcRequests.set(requestId, { resolve, reject });
    bridge.postMessage({
      type: 'resolveImageSrcRequest',
      requestId,
      src,
    });
  });
}

function settleImageSaveRequest(
  message: Extract<HostToWebviewMessage, { type: 'saveImageResult' }>,
): void {
  const pending = pendingImageSaveRequests.get(message.requestId);

  if (!pending) {
    return;
  }

  pendingImageSaveRequests.delete(message.requestId);

  if (message.error || !message.alt || !message.path) {
    pending.reject(new Error(message.error ?? 'Image upload failed.'));
    return;
  }

  pending.resolve({
    alt: message.alt,
    path: message.path,
  });
}

function settleImageSrcRequest(
  message: Extract<HostToWebviewMessage, { type: 'resolveImageSrcResult' }>,
): void {
  const pending = pendingImageSrcRequests.get(message.requestId);

  if (!pending) {
    return;
  }

  pendingImageSrcRequests.delete(message.requestId);

  if (message.error || !message.resolvedSrc) {
    pending.reject(new Error(message.error ?? 'Failed to resolve image source.'));
    return;
  }

  pending.resolve(message.resolvedSrc);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image file.'));
    };
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Image payload is not a valid data URL.'));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function nextRequestId(prefix: string): string {
  requestSequence += 1;
  return `${prefix}-${requestSequence}`;
}

function getEditorVersion(): number {
  return hasPendingLocalChanges ? currentVersion + 1 : currentVersion;
}

function clearStatus(): void {
  statusRoot.textContent = '';
  statusRoot.dataset.visible = 'false';
  statusRoot.dataset.kind = '';
}

function showStatus(message: string, kind: 'error' | 'notice'): void {
  statusRoot.textContent = message;
  statusRoot.dataset.visible = 'true';
  statusRoot.dataset.kind = kind;
}

function insertTextAtSelection(text: string): void {
  if (!text) {
    return;
  }

  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement) {
    const start = activeElement.selectionStart ?? activeElement.value.length;
    const end = activeElement.selectionEnd ?? start;
    activeElement.setRangeText(text, start, end, 'end');
    activeElement.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return;
  }

  if (insertIntoCodeMirror(text)) {
    return;
  }

  if (applyBlockMarkdownCompletion(text)) {
    return;
  }

  editor?.editor.action(insert(text, true));
}

function insertIntoCodeMirror(text: string): boolean {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
  const cmEditor = element?.closest('.cm-editor');

  if (!(cmEditor instanceof HTMLElement)) {
    return false;
  }

  const view = CMEditorView.findFromDOM(cmEditor);

  if (!view) {
    return false;
  }

  const { from, to } = view.state.selection.main;
  const end = from + text.length;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: end } });
  return true;
}

function applyBlockMarkdownCompletion(markdown: string): boolean {
  if (!editor) {
    return false;
  }

  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;

  if (anchorElement?.closest('.cm-editor, .cm-content, .cm-line')) {
    return false;
  }

  return editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const parser = ctx.get(parserCtx);
    const parsed = parser(markdown);
    const node = parsed?.firstChild;
    const { selection } = view.state;
    const { $from } = selection;

    if (
      !parsed ||
      parsed.childCount !== 1 ||
      !node ||
      !selection.empty ||
      $from.parent.type.name === 'code_block' ||
      !$from.parent.isTextblock ||
      $from.parent.textContent.length > 0
    ) {
      return false;
    }

    const from = $from.before();
    const to = from + $from.parent.nodeSize;
    const tr = view.state.tr.replaceRangeWith(from, to, node);
    const selectionPos = Math.max(from + 1, from + node.nodeSize - 1);
    tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1)).scrollIntoView();
    view.dispatch(tr);
    return true;
  });
}

function renderFrontmatter(state: FrontmatterState | undefined): void {
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
