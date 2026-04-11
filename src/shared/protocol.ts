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

export type HostToWebviewMessage =
  | InitMessage
  | ExternalUpdateMessage
  | SetReadonlyMessage
  | HostErrorMessage;

export interface EditMessage extends MarkdownSnapshot {
  type: 'edit';
}

export interface ReadyMessage {
  type: 'ready';
}

export interface DropImageMessage {
  type: 'dropImage';
  name: string;
  dataUrl: string;
}

export type WebviewToHostMessage = EditMessage | ReadyMessage | DropImageMessage;

export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as Record<string, unknown>);
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  return Boolean(value) && typeof value === 'object' && 'type' in (value as Record<string, unknown>);
}
