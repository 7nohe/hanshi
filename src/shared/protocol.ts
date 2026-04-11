export interface MarkdownSnapshot {
  markdown: string;
  version: number;
}

export interface InitMessage extends MarkdownSnapshot {
  type: 'init';
  editable: boolean;
}

export interface ExternalUpdateMessage extends MarkdownSnapshot {
  type: 'externalUpdate';
}

export interface SetReadonlyMessage {
  type: 'setReadonly';
  editable: boolean;
}

export interface HostErrorMessage {
  type: 'hostError';
  message: string;
}

export interface HostNoticeMessage {
  type: 'hostNotice';
  message: string;
}

export interface SaveImageResultMessage {
  type: 'saveImageResult';
  requestId: string;
  alt?: string;
  path?: string;
  error?: string;
}

export interface ResolveImageSrcResultMessage {
  type: 'resolveImageSrcResult';
  requestId: string;
  resolvedSrc?: string;
  error?: string;
}

export interface CompletionResultMessage {
  type: 'completionResult';
  requestId: string;
  version: number;
  insertText: string;
  displayText: string;
}

export interface CompletionClearedMessage {
  type: 'completionCleared';
  requestId?: string;
  version: number;
}

export type HostToWebviewMessage =
  | InitMessage
  | ExternalUpdateMessage
  | SetReadonlyMessage
  | HostErrorMessage
  | HostNoticeMessage
  | SaveImageResultMessage
  | ResolveImageSrcResultMessage
  | CompletionResultMessage
  | CompletionClearedMessage;

export interface EditMessage extends MarkdownSnapshot {
  type: 'edit';
}

export interface ReadyMessage {
  type: 'ready';
}

export interface SaveImageRequestMessage {
  type: 'saveImageRequest';
  requestId: string;
  name: string;
  dataUrl: string;
}

export interface ResolveImageSrcRequestMessage {
  type: 'resolveImageSrcRequest';
  requestId: string;
  src: string;
}

export interface CompletionContext {
  currentLinePrefix: string;
  currentLineSuffix: string;
  surroundingTextBefore: string;
  surroundingTextAfter: string;
  sectionHeadings?: string[];
  currentBlockKind?: string;
  relatedFiles?: Array<{
    path: string;
    excerpt: string;
  }>;
}

export interface RequestCompletionMessage extends MarkdownSnapshot {
  type: 'requestCompletion';
  requestId: string;
  context: CompletionContext;
}

export interface CancelCompletionMessage extends Pick<MarkdownSnapshot, 'version'> {
  type: 'cancelCompletion';
  requestId?: string;
}

export type WebviewToHostMessage =
  | EditMessage
  | ReadyMessage
  | SaveImageRequestMessage
  | ResolveImageSrcRequestMessage
  | RequestCompletionMessage
  | CancelCompletionMessage;

export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as Record<string, unknown>);
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as Record<string, unknown>);
}
