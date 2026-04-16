import type {
  CompletionClearedMessage,
  CompletionContext,
  CompletionResultMessage,
  RequestCompletionMessage,
} from '../shared/protocol';

interface CompletionControllerOptions {
  root: HTMLElement;
  scrollContainer: HTMLElement;
  getMarkdown: () => string;
  getVersion: () => number;
  getEditable: () => boolean;
  postMessage: (message: RequestCompletionMessage | { type: 'cancelCompletion'; requestId?: string; version: number }) => void;
  insertText: (text: string) => void;
}

interface ActiveCompletion {
  requestId: string;
  version: number;
  insertText: string;
  displayText: string;
}

const COMPLETION_DEBOUNCE_MS = 250;

export class CompletionController {
  private readonly overlay = document.createElement('div');
  private activeCompletion: ActiveCompletion | undefined;
  private composing = false;
  private pendingTimer: number | undefined;
  private pendingRequestId: string | undefined;
  private requestCounter = 0;

  public constructor(private readonly options: CompletionControllerOptions) {
    this.overlay.className = 'hanshi-inline-completion';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.dataset.visible = 'false';
    this.options.scrollContainer.append(this.overlay);

    this.options.root.addEventListener('keydown', this.onKeydown, true);
    this.options.root.addEventListener('pointerdown', this.onPointerDown, true);
    this.options.root.addEventListener('focusout', this.onFocusOut, true);
    this.options.scrollContainer.addEventListener('scroll', this.onViewportChange, { passive: true });
    window.addEventListener('resize', this.onViewportChange);
  }

  public dispose(): void {
    window.clearTimeout(this.pendingTimer);
    this.options.root.removeEventListener('keydown', this.onKeydown, true);
    this.options.root.removeEventListener('pointerdown', this.onPointerDown, true);
    this.options.root.removeEventListener('focusout', this.onFocusOut, true);
    this.options.scrollContainer.removeEventListener('scroll', this.onViewportChange);
    window.removeEventListener('resize', this.onViewportChange);
    this.overlay.remove();
  }

  public onUserInput(): void {
    if (this.pendingRequestId || this.activeCompletion || this.pendingTimer !== undefined) {
      this.cancelPendingRequest();
      this.clearActiveCompletion();
    }

    if (!this.options.getEditable() || this.composing) {
      return;
    }

    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = undefined;
      const context = this.buildContext();

      if (!context) {
        return;
      }

      const requestId = `completion-${++this.requestCounter}`;
      this.pendingRequestId = requestId;
      const markdown = this.options.getMarkdown();
      this.options.postMessage({
        type: 'requestCompletion',
        requestId,
        version: this.options.getVersion(),
        markdown: markdown.length > 6000 ? `${markdown.slice(0, 3000)}\n...\n${markdown.slice(-2500)}` : markdown,
        context,
      });
    }, COMPLETION_DEBOUNCE_MS);
  }

  public onCompositionStart(): void {
    this.composing = true;
    this.cancelPendingRequest();
    this.clearActiveCompletion();
  }

  public onCompositionEnd(): void {
    this.composing = false;
  }

  public onReadonlyChange(editable: boolean): void {
    if (editable) {
      return;
    }

    this.cancelPendingRequest();
    this.clearActiveCompletion();
  }

  public onExternalUpdate(): void {
    this.cancelPendingRequest();
    this.clearActiveCompletion();
  }

  public applyCompletionResult(message: CompletionResultMessage): void {
    if (message.requestId !== this.pendingRequestId || message.version !== this.options.getVersion()) {
      return;
    }

    if (!this.options.getEditable() || this.composing) {
      return;
    }

    this.activeCompletion = {
      requestId: message.requestId,
      version: message.version,
      insertText: message.insertText,
      displayText: message.displayText,
    };
    this.pendingRequestId = undefined;
    this.syncOverlayTypography();
    this.renderActiveCompletion();
  }

  public clearFromHost(message: CompletionClearedMessage): void {
    if (message.requestId && this.pendingRequestId && message.requestId !== this.pendingRequestId) {
      return;
    }

    if (message.version !== this.options.getVersion()) {
      return;
    }

    this.pendingRequestId = undefined;
    this.clearActiveCompletion();
  }

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (!this.isEditorSelectionActive()) {
      return;
    }

    if (this.activeCompletion && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.options.insertText(this.activeCompletion.insertText);
        this.clearActiveCompletion();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.clearActiveCompletion();
        return;
      }

      if (shouldDismissForKey(event.key)) {
        this.clearActiveCompletion();
      }
    }
  };

  private readonly onPointerDown = () => {
    if (!this.activeCompletion) {
      return;
    }
    this.clearActiveCompletion();
  };

  private readonly onFocusOut = (event: FocusEvent) => {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && this.options.root.contains(nextTarget)) {
      return;
    }

    if (!this.activeCompletion) {
      return;
    }

    this.clearActiveCompletion();
  };

  private readonly onViewportChange = () => {
    if (!this.activeCompletion) {
      return;
    }

    this.renderActiveCompletion();
  };

  private renderActiveCompletion(): void {
    if (!this.activeCompletion) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      this.clearActiveCompletion();
      return;
    }

    const range = selection.getRangeAt(0);
    const caretRect = getCaretRect(range);
    const containerRect = this.options.scrollContainer.getBoundingClientRect();
    const lineElement = findLineElement(range.startContainer, this.options.root);
    const lineRect = lineElement?.getBoundingClientRect() ?? caretRect;
    const firstLineOffset = Math.max(0, caretRect.left - lineRect.left);
    const availableWidth = Math.max(120, lineRect.width);
    const availableHeight = computeAvailableHeight(lineElement, caretRect);

    this.overlay.textContent = this.activeCompletion.displayText;
    this.overlay.style.left = `${lineRect.left - containerRect.left + this.options.scrollContainer.scrollLeft}px`;
    this.overlay.style.top = `${caretRect.top - containerRect.top + this.options.scrollContainer.scrollTop}px`;
    this.overlay.style.maxWidth = `${availableWidth}px`;
    this.overlay.style.maxHeight = availableHeight ? `${availableHeight}px` : '';
    this.overlay.style.textIndent = `${firstLineOffset}px`;
    this.overlay.dataset.visible = 'true';
    this.options.root.dataset.inlineCompletionVisible = 'true';
  }

  private clearActiveCompletion(): void {
    this.activeCompletion = undefined;
    this.options.root.dataset.inlineCompletionVisible = 'false';
    this.overlay.dataset.visible = 'false';
    this.overlay.textContent = '';
    this.overlay.style.textIndent = '';
    this.overlay.style.maxHeight = '';
  }

  private cancelPendingRequest(): void {
    window.clearTimeout(this.pendingTimer);

    if (this.pendingRequestId) {
      this.options.postMessage({
        type: 'cancelCompletion',
        requestId: this.pendingRequestId,
        version: this.options.getVersion(),
      });
      this.pendingRequestId = undefined;
    }
  }

  private isEditorSelectionActive(): boolean {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const anchorNode = selection.anchorNode;
    return Boolean(anchorNode && this.options.root.contains(anchorNode));
  }

  private buildContext(): CompletionContext | undefined {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return undefined;
    }

    const range = selection.getRangeAt(0);

    if (!this.options.root.contains(range.startContainer)) {
      return undefined;
    }

    const lineElement = findLineElement(range.startContainer, this.options.root);
    const blockElement = findBlockElement(range.startContainer, this.options.root);

    if (!lineElement || !blockElement) {
      return undefined;
    }

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(lineElement);
    prefixRange.setEnd(range.startContainer, range.startOffset);

    const suffixRange = document.createRange();
    suffixRange.selectNodeContents(lineElement);
    suffixRange.setStart(range.startContainer, range.startOffset);

    const prefix = prefixRange.toString();
    const suffix = suffixRange.toString();

    const blockPrefixRange = document.createRange();
    blockPrefixRange.selectNodeContents(blockElement);
    blockPrefixRange.setEnd(range.startContainer, range.startOffset);
    const blockPrefix = normalizeWhitespace(blockPrefixRange.toString());
    const blockText = normalizeWhitespace(blockElement.textContent ?? '');

    const before = blockText.slice(Math.max(0, blockPrefix.length - 240), blockPrefix.length);
    const after = blockText.slice(blockPrefix.length, blockPrefix.length + 120);

    return {
      currentLinePrefix: prefix.slice(-200),
      currentLineSuffix: suffix.slice(0, 120),
      surroundingTextBefore: before,
      surroundingTextAfter: after,
      sectionHeadings: extractSectionHeadings(this.options.root, range),
      currentBlockKind: getBlockKind(blockElement),
    };
  }

  private syncOverlayTypography(): void {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const referenceElement = getReferenceElement(selection.getRangeAt(0));

    if (!referenceElement) {
      return;
    }

    const computed = window.getComputedStyle(referenceElement);
    this.overlay.style.fontFamily = computed.fontFamily;
    this.overlay.style.fontSize = computed.fontSize;
    this.overlay.style.fontWeight = computed.fontWeight;
    this.overlay.style.fontStyle = computed.fontStyle;
    this.overlay.style.lineHeight = computed.lineHeight;
    this.overlay.style.letterSpacing = computed.letterSpacing;
  }
}

function shouldDismissForKey(key: string): boolean {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Backspace' ||
    key === 'Delete' ||
    key === 'Enter' ||
    key.length === 1
  );
}

function findLineElement(node: Node, root: HTMLElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return (
    element?.closest('.cm-line, p, li, h1, h2, h3, h4, h5, h6, blockquote, pre') ??
    root.querySelector('.ProseMirror')
  );
}

function findBlockElement(node: Node, root: HTMLElement): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return (
    element?.closest('.cm-line, p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th') ??
    root.querySelector('.ProseMirror')
  );
}

function getCaretRect(range: Range): DOMRect {
  const collapsed = range.cloneRange();
  collapsed.collapse(true);
  const rects = collapsed.getClientRects();
  const lastRect = rects.item(rects.length - 1);

  if (lastRect) {
    return lastRect;
  }

  const referenceElement = getReferenceElement(collapsed);

  if (referenceElement) {
    const rect = referenceElement.getBoundingClientRect();
    const computed = window.getComputedStyle(referenceElement);
    const lineHeight = Number.parseFloat(computed.lineHeight);
    const height = Number.isFinite(lineHeight) ? lineHeight : rect.height || 16;
    return new DOMRect(rect.left, rect.top, 0, height);
  }

  return new DOMRect(0, 0, 0, 16);
}

function getReferenceElement(range: Range): HTMLElement | undefined {
  const startContainer = range.startContainer;

  if (startContainer instanceof HTMLElement) {
    return startContainer;
  }

  if (startContainer.parentElement instanceof HTMLElement) {
    return startContainer.parentElement;
  }

  return undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractSectionHeadings(root: HTMLElement, range: Range): string[] {
  const prosemirror = root.querySelector('.ProseMirror');

  if (!prosemirror) {
    return [];
  }

  const headings = Array.from(prosemirror.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  const stack: Array<{ level: number; text: string }> = [];

  for (const heading of headings) {
    const position = heading.compareDocumentPosition(range.startContainer);

    if (!(position & Node.DOCUMENT_POSITION_FOLLOWING) && heading !== range.startContainer && !heading.contains(range.startContainer)) {
      break;
    }

    const level = Number.parseInt(heading.tagName[1], 10);
    const text = (heading.textContent ?? '').trim();

    while (stack.length >= level) {
      stack.pop();
    }

    stack.push({ level, text });
  }

  return stack.map((entry) => entry.text).filter(Boolean).slice(-4);
}

function computeAvailableHeight(
  lineElement: HTMLElement | null,
  caretRect: DOMRect,
): number | undefined {
  if (!lineElement) {
    return undefined;
  }

  const blockParent = lineElement.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre');
  const reference = blockParent ?? lineElement;
  const nextSibling = reference.nextElementSibling;

  if (!nextSibling) {
    return undefined;
  }

  const nextRect = nextSibling.getBoundingClientRect();
  const gap = nextRect.top - caretRect.top;
  return gap > 0 ? gap : undefined;
}

function getBlockKind(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tagName)) {
    return tagName;
  }

  if (tagName === 'li') {
    return 'list-item';
  }

  if (tagName === 'blockquote') {
    return 'blockquote';
  }

  if (tagName === 'pre') {
    return 'code-block';
  }

  if (tagName === 'td' || tagName === 'th') {
    return 'table-cell';
  }

  return tagName || 'paragraph';
}
