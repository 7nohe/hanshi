import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx, parserCtx, prosePluginsCtx, remarkStringifyOptionsCtx, serializerCtx } from "@milkdown/kit/core";
import { remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import { historyProviderConfig } from "@milkdown/kit/plugin/history";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import { insert } from "@milkdown/utils";
import { defaultHandlers } from "mdast-util-to-markdown";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";
import "./styles/editor.css";
import { EditorView as CMEditorView } from "@codemirror/view";
import type {
	ExternalUpdateReason,
	HostToWebviewMessage,
} from "../shared/protocol";
import { WebviewBridge } from "./bridge";
import { CompletionController } from "./completion";
import {
	type FrontmatterState,
	mergeFrontmatter,
	splitMarkdownFrontmatter,
} from "./frontmatter";
import { createImageMarkdown } from "./markdown";
import { renderMermaidPreview } from "./plugins/mermaid-block";
import { createLinkPreviewPlugin } from "./plugins/link-preview";
import { createSearchPlugin, type SearchController } from "./search";
import { createSyncPlugin, type SyncPluginHandle } from "./plugins/sync-plugin";

const COPY_REF_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const EXTERNAL_UPDATE_IDLE_MS = 250;
const bridge = new WebviewBridge();
const workspaceRoot = getRequiredElement<HTMLElement>("workspace");
const editorRoot = getRequiredElement<HTMLElement>("editor");
const frontmatterRoot = getRequiredElement<HTMLElement>("frontmatter");
const frontmatterSummary = getRequiredElement<HTMLElement>(
	"frontmatter-summary",
);
const frontmatterRaw = getRequiredElement<HTMLElement>("frontmatter-raw");
const frontmatterToggle =
	getRequiredElement<HTMLButtonElement>("frontmatter-toggle");
const statusRoot = getRequiredElement<HTMLElement>("status");

let editor: Crepe | undefined;
let syncPlugin: SyncPluginHandle | undefined;
let linkPreviewSettle: ((msg: import("../shared/protocol").FetchLinkPreviewResultMessage) => void) | undefined;
let completionController: CompletionController | undefined;
let searchController: SearchController | undefined;
let currentVersion = 0;
let currentEditable = true;
let currentCompletionsEnabled = true;
let pendingExternalUpdate:
	| {
			markdown: string;
			version: number;
			reason?: ExternalUpdateReason;
	  }
	| undefined;
let currentFrontmatter: FrontmatterState | undefined;
let requestSequence = 0;
let lastNonEmptySelection: { from: number; to: number } | undefined;
let lastKnownSelection: { anchor: number; head: number } | undefined;
let lastKnownCaretContext:
	| {
			blockText: string;
			parentOffset: number;
			prefix: string;
			suffix: string;
			previousBlockText?: string;
			nextBlockText?: string;
	  }
	| undefined;
let lastEditorInteractionAt = 0;
let lastTypingAt = 0;
let pendingExternalUpdateTimer: number | undefined;
let shouldRestoreSelectionOnWindowFocus = false;

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

frontmatterToggle.addEventListener("click", () => {
	const expanded = frontmatterRoot.dataset.expanded === "true";
	frontmatterRoot.dataset.expanded = expanded ? "false" : "true";
	frontmatterToggle.textContent = expanded ? "Show Raw" : "Hide Raw";
});

editorRoot.addEventListener("focusin", markEditorInteraction, true);
editorRoot.addEventListener("keydown", markEditorInteraction, true);
editorRoot.addEventListener("keydown", handleHistoryKeydown, true);
editorRoot.addEventListener("keydown", handleSearchKeydown, true);
editorRoot.addEventListener(
	"beforeinput",
	handleHistoryBeforeInput as EventListener,
	true,
);
editorRoot.addEventListener("keydown", restoreSelectionBeforeTyping, true);
editorRoot.addEventListener("pointerdown", markEditorInteraction, true);
editorRoot.addEventListener("input", markTypingActivity, true);
window.addEventListener("blur", handleWindowBlur);
window.addEventListener("focus", handleWindowFocus);

bridge.onMessage((message) => {
	void handleMessage(message);
});

bridge.postMessage({ type: "ready" });

function applyFontConfig(fontFamily: string, titleFontFamily: string): void {
	if (fontFamily) {
		editorRoot.style.setProperty("--hanshi-editor-font-default", fontFamily);
	} else {
		editorRoot.style.removeProperty("--hanshi-editor-font-default");
	}
	if (titleFontFamily) {
		editorRoot.style.setProperty("--hanshi-editor-font-title", titleFontFamily);
	} else {
		editorRoot.style.removeProperty("--hanshi-editor-font-title");
	}
}

async function handleMessage(message: HostToWebviewMessage): Promise<void> {
	switch (message.type) {
		case "init":
			currentVersion = message.version;
			pendingExternalUpdate = undefined;
			window.clearTimeout(pendingExternalUpdateTimer);
			pendingExternalUpdateTimer = undefined;
			currentEditable = message.editable;
			currentCompletionsEnabled = message.completionsEnabled;
			await mountEditor(message.markdown);
			applyFontConfig(message.fontFamily, message.titleFontFamily);
			return;
		case "externalUpdate": {
			const isAuthoritativeEqualVersion =
				message.version === currentVersion &&
				message.reason !== "stale" &&
				message.reason !== "edit";
			if (
				message.version < currentVersion ||
				(message.version === currentVersion && !isAuthoritativeEqualVersion)
			) {
				return;
			}
			if (syncPlugin?.isComposing() || shouldDelayExternalUpdate()) {
				pendingExternalUpdate = {
					markdown: message.markdown,
					version: message.version,
					reason: message.reason,
				};
				schedulePendingExternalUpdate();
				return;
			}
			await applyExternalUpdate(
				message.markdown,
				message.version,
				message.reason,
			);
			return;
		}
		case "setCompletionsEnabled":
			currentCompletionsEnabled = message.enabled;
			configureCompletionController();
			return;
		case "setFont":
			applyFontConfig(message.fontFamily, message.titleFontFamily);
			return;
		case "hostError":
			statusRoot.textContent = message.message;
			statusRoot.dataset.visible = "true";
			statusRoot.dataset.kind = "error";
			return;
		case "hostNotice":
			statusRoot.textContent = message.message;
			statusRoot.dataset.visible = "true";
			statusRoot.dataset.kind = "notice";
			return;
		case "saveImageResult":
			settleImageSaveRequest(message);
			return;
		case "resolveImageSrcResult":
			settleImageSrcRequest(message);
			return;
		case "fetchLinkPreviewResult":
			linkPreviewSettle?.(message);
			return;
		case "completionResult":
			completionController?.applyCompletionResult(message);
			return;
		case "completionCleared":
			completionController?.clearFromHost(message);
			return;
		case "getSelection":
			bridge.postMessage(buildSelectionResponse(message.requestId));
			return;
		case "revealHeading":
			revealHeadingByIndex(message.index);
			return;
		case "openSearch":
			if (searchController?.isOpen()) {
				searchController.close();
			} else {
				searchController?.open();
			}
			return;
	}
}

function buildSelectionResponse(
	requestId: string,
): Extract<
	import("../shared/protocol").WebviewToHostMessage,
	{ type: "selectionResponse" }
> {
	const empty = {
		type: "selectionResponse" as const,
		requestId,
		selectedText: "",
		contextBefore: "",
		contextAfter: "",
	};

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
		const selectionDoc = schema.topNodeType.create(
			null,
			selectionSlice.content,
		);
		const selectedText = serializer(selectionDoc).trim();

		const beforeSlice = view.state.doc.slice(Math.max(0, from - 200), from);
		const beforeDoc = schema.topNodeType.create(null, beforeSlice.content);
		const contextBefore = serializer(beforeDoc).trim().slice(-100);

		const afterSlice = view.state.doc.slice(
			to,
			Math.min(view.state.doc.content.size, to + 200),
		);
		const afterDoc = schema.topNodeType.create(null, afterSlice.content);
		const contextAfter = serializer(afterDoc).trim().slice(0, 100);

		return {
			type: "selectionResponse",
			requestId,
			selectedText,
			contextBefore,
			contextAfter,
		};
	});
}

async function mountEditor(markdown: string): Promise<void> {
	const { frontmatter, body } = splitMarkdownFrontmatter(markdown);
	currentFrontmatter = frontmatter;
	lastNonEmptySelection = undefined;
	lastKnownSelection = undefined;

	if (editor) {
		syncPlugin?.dispose();
		completionController?.dispose();
		completionController = undefined;
		searchController?.dispose();
		searchController = undefined;
		await editor.destroy();
	}

	editorRoot.replaceChildren();
	editor = new Crepe({
		root: editorRoot,
		defaultValue: body,
		features: {
			[CrepeFeature.Cursor]: false,
		},
		featureConfigs: {
			[CrepeFeature.CodeMirror]: {
				renderPreview: renderMermaidPreview,
				previewOnlyByDefault: true,
				previewLabel: "Diagram Preview",
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
					builder
						.addGroup("copy-ref", "Copy Reference")
						.addItem("copy-selection-ref", {
							icon: COPY_REF_ICON,
							active: () => false,
							onRun: () => {
								bridge.postMessage({ type: "copySelectionContext" });
							},
						});
				},
			},
		},
	});

	const linkPreview = createLinkPreviewPlugin({
		postMessage: (msg) => bridge.postMessage(msg),
		container: workspaceRoot,
	});
	linkPreviewSettle = linkPreview.settleLinkPreview;

	const search = createSearchPlugin();
	searchController = search.controller;
	searchController.mount(workspaceRoot);

	editor.editor.config((ctx) => {
		ctx.update(historyProviderConfig.key, (value) => ({
			...value,
			depth: 0,
		}));
		ctx.update(remarkStringifyOptionsCtx, (prev) => ({
			...prev,
			bullet: '-' as const,
			emphasis: '*' as const,
			strong: '*' as const,
			fence: '`' as const,
			fences: true,
			listItemIndent: 'one' as const,
			rule: '-' as const,
			handlers: {
				...prev.handlers,
				list(node, parent, state, info) {
					fixMdastSpread(node);
					return defaultHandlers.list(node, parent, state, info);
				},
			},
		}));
		ctx.set(remarkGFMPlugin.options.key, { tablePipeAlign: false });
		ctx.update(prosePluginsCtx, (plugins) => [...plugins, linkPreview.plugin, search.plugin]);
	});

	await editor.create();
	editor.setReadonly(!currentEditable);

	// Track selection changes to preserve last non-empty selection for toolbar actions
	editor.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		const originalDispatch = view.dispatch.bind(view);
		view.dispatch = (...args) => {
			originalDispatch(...args);
			const { from, to, anchor, head, $from } = view.state.selection;
			lastKnownSelection = { anchor, head };
			if (view.state.selection.empty && $from.parent.isTextblock) {
				const blockText = $from.parent.textContent;
				const parentOffset = $from.parentOffset;
				const surroundingBlocks = getSurroundingTextblocks(
					view.state.doc,
					$from.before(),
				);
				lastKnownCaretContext = {
					blockText,
					parentOffset,
					prefix: blockText.slice(Math.max(0, parentOffset - 24), parentOffset),
					suffix: blockText.slice(parentOffset, parentOffset + 24),
					previousBlockText: surroundingBlocks.previous,
					nextBlockText: surroundingBlocks.next,
				};
			}
			if (from !== to) {
				lastNonEmptySelection = { from, to };
			}
		};
	});

	renderFrontmatter(currentFrontmatter);
	configureCompletionController();

	syncPlugin = createSyncPlugin(editor, {
		root: editorRoot,
		getVersion: () => currentVersion,
		onCompositionStart: () => {
			completionController?.onCompositionStart();
		},
		onCompositionEnd: () => {
			completionController?.onCompositionEnd();
			flushPendingExternalUpdate();
		},
		onUserInput: () => {
			markTypingActivity();
			completionController?.onUserInput();
		},
		onMarkdownChange: (nextMarkdown, version) => {
			const nextVersion = Math.max(currentVersion, version + 1);
			clearStatus();
			bridge.postMessage({
				type: "edit",
				markdown: mergeFrontmatter(currentFrontmatter?.block, nextMarkdown),
				version: nextVersion,
			});
			currentVersion = nextVersion;
		},
	});

	attachDropHandler(editorRoot);
}

function configureCompletionController(): void {
	if (!currentCompletionsEnabled) {
		completionController?.dispose();
		completionController = undefined;
		editorRoot.dataset.inlineCompletionVisible = "false";
		return;
	}

	if (completionController) {
		return;
	}

	completionController = new CompletionController({
		root: editorRoot,
		scrollContainer: workspaceRoot,
		getMarkdown: () =>
			mergeFrontmatter(currentFrontmatter?.block, editor?.getMarkdown() ?? ""),
		getVersion: () => currentVersion,
		getEditable: () => currentEditable,
		postMessage: (message) => {
			bridge.postMessage(message);
		},
		insertText: (text) => {
			insertTextAtSelection(text);
		},
	});
}

async function applyExternalUpdate(
	markdown: string,
	version: number,
	reason: ExternalUpdateReason = "edit",
): Promise<void> {
	currentVersion = version;
	await replaceEditorContent(markdown, reason);
}

async function replaceEditorContent(
	markdown: string,
	reason: ExternalUpdateReason = "edit",
): Promise<void> {
	completionController?.onExternalUpdate();

	pendingExternalUpdate = undefined;
	window.clearTimeout(pendingExternalUpdateTimer);
	pendingExternalUpdateTimer = undefined;
	const { frontmatter, body } = splitMarkdownFrontmatter(markdown);
	currentFrontmatter = frontmatter;
	lastNonEmptySelection = undefined;
	const selectionSnapshot = lastKnownSelection
		? { ...lastKnownSelection }
		: undefined;
	const scrollSnapshot = captureScrollSnapshot();

	if (!editor) {
		await mountEditor(markdown);
		return;
	}

	if (isHistoryReason(reason) && !editor) {
		await mountEditor(markdown);
		lastKnownSelection = selectionSnapshot;
		restoreSelectionAfterRemount(scrollSnapshot);
		return;
	}

	// Prevent feedback loop: dispatch → markdownUpdated → edit → re-normalize → externalUpdate
	syncPlugin?.setSuppressed(true);
	syncPlugin?.ignoreNextChange();
	try {
		replaceBodyMinimal(body, reason);
	} finally {
		syncPlugin?.setSuppressed(false);
	}
	renderFrontmatter(currentFrontmatter);
}

function replaceBodyMinimal(
	body: string,
	reason: ExternalUpdateReason = "edit",
): void {
	if (!editor) {
		return;
	}

	editor.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		const shouldRestoreFocus = shouldRestoreEditorFocus(view);
		const parser = ctx.get(parserCtx);
		const serializer = ctx.get(serializerCtx);
		const nextDoc = parser(body);
		if (!nextDoc) {
			return;
		}

		// The TextDocument stores remark-normalized markdown while ProseMirror
		// holds Milkdown-serialized markdown.  These differ in syntax (e.g.
		// bullet markers, emphasis style) even when the *content* is identical.
		// Round-trip the incoming body through PM's own parser→serializer so we
		// compare like-with-like and avoid a spurious full-document replacement
		// that destroys cursor position.
		const currentMd = serializer(view.state.doc);
		const incomingMd = serializer(nextDoc);
		if (currentMd === incomingMd) {
			restoreSelectionAfterAuthoritativeUpdate(
				view,
				shouldRestoreFocus,
				reason,
			);
			return;
		}

		const { doc, selection } = view.state;

		const start = doc.content.findDiffStart(nextDoc.content);
		if (start == null) {
			restoreSelectionAfterAuthoritativeUpdate(
				view,
				shouldRestoreFocus,
				reason,
			);
			return;
		}

		const end = doc.content.findDiffEnd(nextDoc.content);
		if (!end) {
			restoreSelectionAfterAuthoritativeUpdate(
				view,
				shouldRestoreFocus,
				reason,
			);
			return;
		}

		const overlap = start - Math.min(end.a, end.b);
		const from = start;
		const toA = overlap > 0 ? end.a + overlap : end.a;
		const toB = overlap > 0 ? end.b + overlap : end.b;

		const tr = view.state.tr.replace(from, toA, nextDoc.slice(from, toB));
		tr.setMeta("addToHistory", false);
		if ((reason === "undo" || reason === "redo") && lastKnownSelection) {
			const anchor = clampPosition(
				lastKnownSelection.anchor,
				tr.doc.content.size,
			);
			const head = clampPosition(lastKnownSelection.head, tr.doc.content.size);
			tr.setSelection(
				TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)),
			);
		} else {
			tr.setSelection(selection.map(tr.doc, tr.mapping));
		}
		view.dispatch(tr);

		const {
			from: nextFrom,
			to: nextTo,
			anchor: nextAnchor,
			head: nextHead,
		} = tr.selection;
		lastKnownSelection = { anchor: nextAnchor, head: nextHead };
		if (nextFrom !== nextTo) {
			lastNonEmptySelection = { from: nextFrom, to: nextTo };
		}

		if (shouldRestoreFocus) {
			view.focus();
		}

		if (isHistoryReason(reason)) {
			queueDomSelectionSync(view);
		}
	});
}

function restoreSelectionAfterAuthoritativeUpdate(
	view: import("@milkdown/kit/prose/view").EditorView,
	shouldRestoreFocus: boolean,
	reason: ExternalUpdateReason,
): void {
	const shouldRestoreSelection = isHistoryReason(reason);

	if (shouldRestoreSelection && lastKnownSelection) {
		const anchor = clampPosition(
			lastKnownSelection.anchor,
			view.state.doc.content.size,
		);
		const head = clampPosition(
			lastKnownSelection.head,
			view.state.doc.content.size,
		);
		const selection = TextSelection.between(
			view.state.doc.resolve(anchor),
			view.state.doc.resolve(head),
		);
		view.dispatch(view.state.tr.setSelection(selection));
	}

	if (shouldRestoreFocus) {
		view.focus();
	}

	if (shouldRestoreSelection) {
		queueDomSelectionSync(view);
	}
}

function markEditorInteraction(): void {
	lastEditorInteractionAt = Date.now();
	shouldRestoreSelectionOnWindowFocus = true;
}

function markTypingActivity(): void {
	lastTypingAt = Date.now();
	markEditorInteraction();

	if (pendingExternalUpdate) {
		schedulePendingExternalUpdate();
	}
}

function restoreSelectionBeforeTyping(event: KeyboardEvent): void {
	if (
		event.defaultPrevented ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		!isTypingKey(event.key) ||
		hasEditorDomSelection()
	) {
		return;
	}

	restoreLastKnownSelection();
}

function handleHistoryKeydown(event: KeyboardEvent): void {
	if (event.defaultPrevented) {
		return;
	}

	const isUndo =
		event.key.toLowerCase() === "z" &&
		((event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) ||
			(event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey));

	const isRedo =
		(event.key.toLowerCase() === "z" &&
			((event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey) ||
				(event.ctrlKey &&
					!event.metaKey &&
					!event.altKey &&
					event.shiftKey))) ||
		(event.key.toLowerCase() === "y" &&
			event.ctrlKey &&
			!event.metaKey &&
			!event.altKey);

	if (!isUndo && !isRedo) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	bridge.postMessage({
		type: "requestHistory",
		direction: isUndo ? "undo" : "redo",
	});
}

function handleSearchKeydown(event: KeyboardEvent): void {
	if (event.defaultPrevented) return;

	const isFind =
		event.key.toLowerCase() === "f" &&
		(event.metaKey || event.ctrlKey) &&
		!event.altKey &&
		!event.shiftKey;

	if (!isFind) return;

	event.preventDefault();
	event.stopPropagation();
	if (searchController?.isOpen()) {
		searchController.close();
	} else {
		searchController?.open();
	}
}

function handleHistoryBeforeInput(event: InputEvent): void {
	if (event.defaultPrevented) {
		return;
	}

	if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	const direction = event.inputType === "historyUndo" ? "undo" : "redo";
	bridge.postMessage({
		type: "requestHistory",
		direction,
	});
}

function handleWindowBlur(): void {
	if (!editor) {
		shouldRestoreSelectionOnWindowFocus = false;
		return;
	}

	shouldRestoreSelectionOnWindowFocus = editor.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		return view.hasFocus();
	});
}

function handleWindowFocus(): void {
	if (!shouldRestoreSelectionOnWindowFocus) {
		return;
	}

	requestAnimationFrame(() => {
		if (!shouldRestoreSelectionOnWindowFocus || hasEditorDomSelection()) {
			return;
		}

		restoreLastKnownSelection();
	});
}

function shouldRestoreEditorFocus(
	view: import("@milkdown/kit/prose/view").EditorView,
): boolean {
	return view.hasFocus() || Date.now() - lastEditorInteractionAt < 1000;
}

function shouldDelayExternalUpdate(): boolean {
	return Date.now() - lastTypingAt < EXTERNAL_UPDATE_IDLE_MS;
}

function schedulePendingExternalUpdate(): void {
	window.clearTimeout(pendingExternalUpdateTimer);
	pendingExternalUpdateTimer = window.setTimeout(() => {
		pendingExternalUpdateTimer = undefined;

		if (
			!pendingExternalUpdate ||
			syncPlugin?.isComposing() ||
			shouldDelayExternalUpdate()
		) {
			if (pendingExternalUpdate) {
				schedulePendingExternalUpdate();
			}
			return;
		}

		flushPendingExternalUpdate();
	}, EXTERNAL_UPDATE_IDLE_MS);
}

function flushPendingExternalUpdate(): void {
	if (!pendingExternalUpdate) {
		return;
	}

	const next = pendingExternalUpdate;
	if (next.version <= currentVersion) {
		pendingExternalUpdate = undefined;
		return;
	}

	pendingExternalUpdate = undefined;
	void applyExternalUpdate(next.markdown, next.version, next.reason);
}

function restoreLastKnownSelection(): void {
	if (!editor || !lastKnownSelection) {
		return;
	}

	editor.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		const { doc } = view.state;
		const anchor = clampPosition(
			lastKnownSelection?.anchor ?? 0,
			doc.content.size,
		);
		const head = clampPosition(
			lastKnownSelection?.head ?? anchor,
			doc.content.size,
		);
		const selection = TextSelection.between(
			doc.resolve(anchor),
			doc.resolve(head),
		);
		view.dispatch(view.state.tr.setSelection(selection));
		view.focus();
	});
	shouldRestoreSelectionOnWindowFocus = false;
}

function restoreSelectionAfterRemount(scrollSnapshot: {
	workspaceTop: number;
	windowTop: number;
}): void {
	if (!editor) {
		return;
	}

	editor.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		const restored = restoreSelectionFromCaretContext(view);

		if (!restored && lastKnownSelection) {
			const { doc } = view.state;
			const anchor = clampPosition(lastKnownSelection.anchor, doc.content.size);
			const head = clampPosition(lastKnownSelection.head, doc.content.size);
			const selection = TextSelection.between(
				doc.resolve(anchor),
				doc.resolve(head),
			);
			view.dispatch(view.state.tr.setSelection(selection));
		}

		view.focus();
		queueDomSelectionSync(view);
	});

	requestAnimationFrame(() => {
		workspaceRoot.scrollTop = scrollSnapshot.workspaceTop;
		window.scrollTo({ top: scrollSnapshot.windowTop });
	});
}

function restoreSelectionFromCaretContext(
	view: import("@milkdown/kit/prose/view").EditorView,
): boolean {
	const context = lastKnownCaretContext;
	if (!context) {
		return false;
	}

	let resolvedPos: number | undefined;

	const textblocks = collectTextblocks(view.state.doc);

	for (let index = 0; index < textblocks.length; index += 1) {
		const { node, pos } = textblocks[index];
		if (!node.isTextblock) {
			continue;
		}

		const text = node.textContent;
		const previousBlockText = textblocks[index - 1]?.node.textContent;
		const nextBlockText = textblocks[index + 1]?.node.textContent;
		const previousMatches =
			context.previousBlockText == null ||
			previousBlockText === context.previousBlockText;
		const nextMatches =
			context.nextBlockText == null || nextBlockText === context.nextBlockText;

		if (!previousMatches || !nextMatches) {
			continue;
		}

		const hasPrefix = !context.prefix || text.includes(context.prefix);
		const hasSuffix = !context.suffix || text.includes(context.suffix);
		const matchesBlock =
			text === context.blockText ||
			(context.blockText.length > 0 && hasPrefix && hasSuffix) ||
			(context.blockText.length > 0 && text.includes(context.blockText)) ||
			(text.length > 0 && context.blockText.includes(text));

		if (!matchesBlock) {
			if (context.blockText.length === 0 && text.length === 0) {
				resolvedPos = pos + 1;
				break;
			}
			// Undo-back-to-empty: if the candidate block is empty and both neighbor
			// anchors positively match the stored context, the user has undone all
			// their typing in this block. `context.blockText` still reflects the
			// last typed state (non-empty), but block identity is nailed down by
			// the surrounding blocks — so adopt this empty block as the target.
			if (
				text.length === 0 &&
				context.previousBlockText != null &&
				context.nextBlockText != null &&
				previousBlockText === context.previousBlockText &&
				nextBlockText === context.nextBlockText
			) {
				resolvedPos = pos + 1;
				break;
			}
			continue;
		}

		const parentOffset = Math.min(context.parentOffset, text.length);
		resolvedPos = pos + 1 + parentOffset;
		break;
	}

	if (resolvedPos == null) {
		return false;
	}

	const selection = TextSelection.between(
		view.state.doc.resolve(resolvedPos),
		view.state.doc.resolve(resolvedPos),
	);
	view.dispatch(view.state.tr.setSelection(selection));
	return true;
}

function collectTextblocks(
	doc: import("@milkdown/kit/prose/model").Node,
): Array<{
	node: import("@milkdown/kit/prose/model").Node;
	pos: number;
}> {
	const blocks: Array<{
		node: import("@milkdown/kit/prose/model").Node;
		pos: number;
	}> = [];
	doc.descendants((node, pos) => {
		if (node.isTextblock) {
			blocks.push({ node, pos });
		}
	});
	return blocks;
}

function getSurroundingTextblocks(
	doc: import("@milkdown/kit/prose/model").Node,
	blockPos: number,
): { previous?: string; next?: string } {
	let previous: string | undefined;
	let next: string | undefined;
	let found = false;
	doc.descendants((node, pos) => {
		if (next != null) return false;
		if (!node.isTextblock) return;
		if (found) {
			next = node.textContent;
			return false;
		}
		if (pos === blockPos) {
			found = true;
			return false;
		}
		previous = node.textContent;
	});
	return { previous: found ? previous : undefined, next };
}

function captureScrollSnapshot(): { workspaceTop: number; windowTop: number } {
	return {
		workspaceTop: workspaceRoot.scrollTop,
		windowTop: window.scrollY,
	};
}

function hasEditorDomSelection(): boolean {
	const selection = window.getSelection();

	if (!selection || selection.rangeCount === 0) {
		return false;
	}

	const anchorNode = selection.anchorNode;
	return Boolean(anchorNode && editorRoot.contains(anchorNode));
}

function isTypingKey(key: string): boolean {
	return (
		key.length === 1 ||
		key === "Enter" ||
		key === "Backspace" ||
		key === "Delete"
	);
}

function isHistoryReason(reason: ExternalUpdateReason | undefined): boolean {
	return reason === "undo" || reason === "redo" || reason === "revert";
}

function clampPosition(position: number, maxPosition: number): number {
	return Math.max(0, Math.min(position, maxPosition));
}

function queueDomSelectionSync(
	view: import("@milkdown/kit/prose/view").EditorView,
): void {
	requestAnimationFrame(() => {
		if (!editorRoot.isConnected) {
			return;
		}

		forceDomSelectionSync(view);
	});
}

function forceDomSelectionSync(
	view: import("@milkdown/kit/prose/view").EditorView,
): void {
	view.updateState(view.state);
	(
		view as unknown as { domObserver?: { setCurSelection?: () => void } }
	).domObserver?.setCurSelection?.();
	view.focus();
}

function attachDropHandler(root: HTMLElement): void {
	root.ondragover = (event) => {
		event.preventDefault();
	};

	root.ondrop = (event) => {
		event.preventDefault();
		const file = event.dataTransfer?.files?.[0];

		if (!file?.type.startsWith("image/")) {
			return;
		}

		void saveImageFile(file)
			.then(({ alt, path }) => {
				insertImageAtSelection(alt, path);
			})
			.catch((error) => {
				showStatus(
					error instanceof Error ? error.message : String(error),
					"error",
				);
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

async function saveImageFile(
	file: File,
): Promise<{ alt: string; path: string }> {
	const dataUrl = await readFileAsDataUrl(file);
	const requestId = nextRequestId("save-image");

	return new Promise((resolve, reject) => {
		pendingImageSaveRequests.set(requestId, { resolve, reject });
		bridge.postMessage({
			type: "saveImageRequest",
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

	const requestId = nextRequestId("resolve-image");

	return new Promise((resolve, reject) => {
		pendingImageSrcRequests.set(requestId, { resolve, reject });
		bridge.postMessage({
			type: "resolveImageSrcRequest",
			requestId,
			src,
		});
	});
}

function settleImageSaveRequest(
	message: Extract<HostToWebviewMessage, { type: "saveImageResult" }>,
): void {
	const pending = pendingImageSaveRequests.get(message.requestId);

	if (!pending) {
		return;
	}

	pendingImageSaveRequests.delete(message.requestId);

	if (message.error || !message.alt || !message.path) {
		pending.reject(new Error(message.error ?? "Image upload failed."));
		return;
	}

	pending.resolve({
		alt: message.alt,
		path: message.path,
	});
}

function settleImageSrcRequest(
	message: Extract<HostToWebviewMessage, { type: "resolveImageSrcResult" }>,
): void {
	const pending = pendingImageSrcRequests.get(message.requestId);

	if (!pending) {
		return;
	}

	pendingImageSrcRequests.delete(message.requestId);

	if (message.error || !message.resolvedSrc) {
		pending.reject(
			new Error(message.error ?? "Failed to resolve image source."),
		);
		return;
	}

	pending.resolve(message.resolvedSrc);
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => {
			reject(reader.error ?? new Error("Failed to read image file."));
		};
		reader.onload = () => {
			if (typeof reader.result !== "string") {
				reject(new Error("Image payload is not a valid data URL."));
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

function clearStatus(): void {
	statusRoot.textContent = "";
	statusRoot.dataset.visible = "false";
	statusRoot.dataset.kind = "";
}

function showStatus(message: string, kind: "error" | "notice"): void {
	statusRoot.textContent = message;
	statusRoot.dataset.visible = "true";
	statusRoot.dataset.kind = kind;
}

function insertTextAtSelection(text: string): void {
	if (!text) {
		return;
	}

	const activeElement = document.activeElement;

	if (
		activeElement instanceof HTMLTextAreaElement ||
		activeElement instanceof HTMLInputElement
	) {
		const start = activeElement.selectionStart ?? activeElement.value.length;
		const end = activeElement.selectionEnd ?? start;
		activeElement.setRangeText(text, start, end, "end");
		activeElement.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				data: text,
				inputType: "insertText",
			}),
		);
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
	const element =
		anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
	const cmEditor = element?.closest(".cm-editor");

	if (!(cmEditor instanceof HTMLElement)) {
		return false;
	}

	const view = CMEditorView.findFromDOM(cmEditor);

	if (!view) {
		return false;
	}

	const { from, to } = view.state.selection.main;
	const end = from + text.length;
	view.dispatch({
		changes: { from, to, insert: text },
		selection: { anchor: end },
	});
	return true;
}

function applyBlockMarkdownCompletion(markdown: string): boolean {
	if (!editor) {
		return false;
	}

	const selection = window.getSelection();
	const anchorNode = selection?.anchorNode;
	const anchorElement =
		anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;

	if (anchorElement?.closest(".cm-editor, .cm-content, .cm-line")) {
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
			$from.parent.type.name === "code_block" ||
			!$from.parent.isTextblock ||
			$from.parent.textContent.length > 0
		) {
			return false;
		}

		const from = $from.before();
		const to = from + $from.parent.nodeSize;
		const tr = view.state.tr.replaceRangeWith(from, to, node);
		const selectionPos = Math.max(from + 1, from + node.nodeSize - 1);
		tr.setSelection(
			Selection.near(tr.doc.resolve(selectionPos), -1),
		).scrollIntoView();
		view.dispatch(tr);
		return true;
	});
}

function revealHeadingByIndex(targetIndex: number): void {
	if (!editor) return;

	editor.editor.action((ctx) => {
		const view = ctx.get(editorViewCtx);
		const { doc } = view.state;
		let headingCount = 0;
		let targetPos: number | undefined;

		doc.descendants((node, pos) => {
			if (targetPos != null) return false;
			if (node.type.name === "heading") {
				if (headingCount === targetIndex) {
					targetPos = pos;
					return false;
				}
				headingCount++;
			}
		});

		if (targetPos == null) return;

		const selection = TextSelection.near(doc.resolve(targetPos + 1));
		const tr = view.state.tr.setSelection(selection).scrollIntoView();
		view.dispatch(tr);
		view.focus();
	});
}

function renderFrontmatter(state: FrontmatterState | undefined): void {
	if (!state) {
		frontmatterRoot.dataset.visible = "false";
		frontmatterRoot.dataset.expanded = "false";
		frontmatterSummary.replaceChildren();
		frontmatterRaw.textContent = "";
		frontmatterToggle.textContent = "Show Raw";
		return;
	}

	frontmatterRoot.dataset.visible = "true";
	frontmatterToggle.textContent =
		frontmatterRoot.dataset.expanded === "true" ? "Hide Raw" : "Show Raw";
	frontmatterSummary.replaceChildren(buildFrontmatterSummary(state));
	frontmatterRaw.textContent = state.raw;
}

function buildFrontmatterSummary(state: FrontmatterState): DocumentFragment {
	const fragment = document.createDocumentFragment();

	const header = document.createElement("div");
	header.className = "hanshi-frontmatter-header";

	const title = document.createElement("div");
	title.className = "hanshi-frontmatter-title";
	title.textContent = state.title
		? `Frontmatter: ${state.title}`
		: "Frontmatter";
	header.append(title);

	const subtitle = document.createElement("div");
	subtitle.className = "hanshi-frontmatter-subtitle";
	subtitle.textContent = state.parseError
		? "Parsed with warnings. Raw YAML is still preserved."
		: `${state.entries.length} field${state.entries.length === 1 ? "" : "s"}`;
	header.append(subtitle);

	fragment.append(header);

	if (state.parseError) {
		const warning = document.createElement("div");
		warning.className = "hanshi-frontmatter-warning";
		warning.textContent = state.parseError;
		fragment.append(warning);
		return fragment;
	}

	const list = document.createElement("dl");
	list.className = "hanshi-frontmatter-list";

	for (const entry of state.entries) {
		const key = document.createElement("dt");
		key.textContent = entry.key;

		const value = document.createElement("dd");
		value.textContent = entry.value || " ";

		list.append(key, value);
	}

	fragment.append(list);
	return fragment;
}

// Milkdown stores the mdast `spread` attribute as a string ('true'/'false')
// instead of a boolean. remark-stringify treats the string 'false' as truthy,
// causing tight lists to be serialized as loose. This function walks the mdast
// list subtree and coerces spread back to a proper boolean before stringify.
function fixMdastSpread(node: { spread?: unknown; children?: unknown[] }): void {
  if (node.spread != null) {
    node.spread = node.spread === true || node.spread === 'true';
  }
  if (node.children) {
    for (const child of node.children as Array<{ spread?: unknown; children?: unknown[] }>) {
      fixMdastSpread(child);
    }
  }
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);

	if (!element) {
		throw new Error(`Missing required element: ${id}`);
	}

	return element as T;
}
