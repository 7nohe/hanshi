import type { Crepe } from "@milkdown/crepe";

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
	isSuppressed(): boolean;
	setSuppressed(value: boolean): void;
	ignoreNextChange(): void;
}

const SYNC_DEBOUNCE_MS = 150;

export function createSyncPlugin(
	editor: Crepe,
	options: SyncPluginOptions,
): SyncPluginHandle {
	let composing = false;
	let suppressed = false;
	let pendingTimer: number | undefined;
	let ignoredChanges = 0;

	const schedule = () => {
		window.clearTimeout(pendingTimer);
		pendingTimer = window.setTimeout(() => {
			if (!composing && !suppressed) {
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

	options.root.addEventListener("compositionstart", onCompositionStart);
	options.root.addEventListener("compositionend", onCompositionEnd);

	editor.on((listener) => {
		listener.markdownUpdated((_ctx, _markdown) => {
			if (ignoredChanges > 0) {
				ignoredChanges -= 1;
				return;
			}

			if (composing || suppressed) {
				return;
			}

			options.onUserInput?.();
			schedule();
		});
	});

	return {
		dispose() {
			window.clearTimeout(pendingTimer);
			options.root.removeEventListener("compositionstart", onCompositionStart);
			options.root.removeEventListener("compositionend", onCompositionEnd);
		},
		isComposing() {
			return composing;
		},
		isSuppressed() {
			return suppressed;
		},
		setSuppressed(value: boolean) {
			suppressed = value;
			if (suppressed) {
				window.clearTimeout(pendingTimer);
			}
		},
		ignoreNextChange() {
			ignoredChanges += 1;
			window.clearTimeout(pendingTimer);
		},
	};
}
