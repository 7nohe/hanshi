import * as vscode from 'vscode';
import type { EditMessage, HostToWebviewMessage } from '../shared/protocol';
import { createFullDocumentEdit } from './patch-engine';
import { PendingVersionTracker } from './pending-version-tracker';
import { isStaleEditVersion } from './versioning';

interface DocumentSyncOptions {
  document: vscode.TextDocument;
  postMessage: (message: HostToWebviewMessage) => Promise<void>;
  onError: (error: Error) => void;
}

export class DocumentSync {
  private readonly document: vscode.TextDocument;
  private readonly tracker = new PendingVersionTracker();

  public constructor(private readonly options: DocumentSyncOptions) {
    this.document = options.document;
  }

  public async bootstrap(editable: boolean): Promise<void> {
    await this.options.postMessage({
      type: 'init',
      markdown: this.document.getText(),
      version: this.document.version,
      editable,
    });
  }

  public async applyWebviewEdit(message: EditMessage): Promise<void> {
    try {
      if (isStaleEditVersion(message.version, this.document.version)) {
        await this.options.postMessage({
          type: 'externalUpdate',
          markdown: this.document.getText(),
          version: this.document.version,
        });
        return;
      }

      const edit = createFullDocumentEdit(this.document, message.markdown);

      if (!edit) {
        return;
      }

      this.tracker.mark(this.document.version + 1);
      await vscode.workspace.applyEdit(edit);
    } catch (error) {
      this.options.onError(asError(error));
    }
  }

  public async handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    if (this.tracker.consume(event.document.version)) {
      return;
    }

    await this.options.postMessage({
      type: 'externalUpdate',
      markdown: event.document.getText(),
      version: event.document.version,
    });
  }

  public dispose(): void {
    this.tracker.clear();
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
