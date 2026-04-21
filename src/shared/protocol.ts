export interface MarkdownSnapshot {
	markdown: string;
	version: number;
}

export interface FontConfig {
	fontFamily: string;
	titleFontFamily: string;
}

export interface InitMessage extends MarkdownSnapshot, FontConfig {
	type: "init";
	editable: boolean;
	completionsEnabled: boolean;
}

export interface SetFontMessage extends FontConfig {
	type: "setFont";
}

export type ExternalUpdateReason =
	| "stale"
	| "undo"
	| "redo"
	| "revert"
	| "save-normalize"
	| "edit";

export interface ExternalUpdateMessage extends MarkdownSnapshot {
	type: "externalUpdate";
	reason?: ExternalUpdateReason;
}

export interface SetCompletionsEnabledMessage {
	type: "setCompletionsEnabled";
	enabled: boolean;
}

export interface HostErrorMessage {
	type: "hostError";
	message: string;
}

export interface HostNoticeMessage {
	type: "hostNotice";
	message: string;
}

export interface SaveImageResultMessage {
	type: "saveImageResult";
	requestId: string;
	alt?: string;
	path?: string;
	error?: string;
}

export interface ResolveImageSrcResultMessage {
	type: "resolveImageSrcResult";
	requestId: string;
	resolvedSrc?: string;
	error?: string;
}

export interface FetchLinkPreviewResultMessage {
	type: "fetchLinkPreviewResult";
	requestId: string;
	title?: string;
	description?: string;
	imageUrl?: string;
	siteName?: string;
	error?: string;
}

export interface CompletionResultMessage {
	type: "completionResult";
	requestId: string;
	version: number;
	insertText: string;
	displayText: string;
}

export interface CompletionClearedMessage {
	type: "completionCleared";
	requestId?: string;
	version: number;
}

export interface GetSelectionMessage {
	type: "getSelection";
	requestId: string;
}

export interface RevealHeadingMessage {
	type: "revealHeading";
	/** 0-based sequential index of the heading */
	index: number;
}

export interface OpenSearchMessage {
	type: "openSearch";
}

export type HostToWebviewMessage =
	| InitMessage
	| ExternalUpdateMessage
	| SetCompletionsEnabledMessage
	| SetFontMessage
	| HostErrorMessage
	| HostNoticeMessage
	| SaveImageResultMessage
	| ResolveImageSrcResultMessage
	| FetchLinkPreviewResultMessage
	| CompletionResultMessage
	| CompletionClearedMessage
	| GetSelectionMessage
	| RevealHeadingMessage
	| OpenSearchMessage;

export interface EditMessage extends MarkdownSnapshot {
	type: "edit";
}

export interface ReadyMessage {
	type: "ready";
}

export interface SaveImageRequestMessage {
	type: "saveImageRequest";
	requestId: string;
	name: string;
	dataUrl: string;
}

export interface ResolveImageSrcRequestMessage {
	type: "resolveImageSrcRequest";
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
	type: "requestCompletion";
	requestId: string;
	context: CompletionContext;
}

export interface CancelCompletionMessage
	extends Pick<MarkdownSnapshot, "version"> {
	type: "cancelCompletion";
	requestId?: string;
}

export interface FetchLinkPreviewRequestMessage {
	type: "fetchLinkPreviewRequest";
	requestId: string;
	url: string;
}

export interface SelectionResponseMessage {
	type: "selectionResponse";
	requestId: string;
	selectedText: string;
	contextBefore: string;
	contextAfter: string;
}

export interface CopySelectionContextMessage {
	type: "copySelectionContext";
}

export interface RequestHistoryMessage {
	type: "requestHistory";
	direction: "undo" | "redo";
}

export type WebviewToHostMessage =
	| EditMessage
	| ReadyMessage
	| SaveImageRequestMessage
	| ResolveImageSrcRequestMessage
	| FetchLinkPreviewRequestMessage
	| RequestCompletionMessage
	| CancelCompletionMessage
	| SelectionResponseMessage
	| CopySelectionContextMessage
	| RequestHistoryMessage;

const HOST_TO_WEBVIEW_TYPES = new Set<string>([
	"init",
	"externalUpdate",
	"setCompletionsEnabled",
	"setFont",
	"hostError",
	"hostNotice",
	"saveImageResult",
	"resolveImageSrcResult",
	"fetchLinkPreviewResult",
	"completionResult",
	"completionCleared",
	"getSelection",
	"revealHeading",
	"openSearch",
]);

const WEBVIEW_TO_HOST_TYPES = new Set<string>([
	"edit",
	"ready",
	"saveImageRequest",
	"resolveImageSrcRequest",
	"fetchLinkPreviewRequest",
	"requestCompletion",
	"cancelCompletion",
	"selectionResponse",
	"copySelectionContext",
	"requestHistory",
]);

export function isHostToWebviewMessage(
	value: unknown,
): value is HostToWebviewMessage {
	if (!value || typeof value !== "object") return false;
	const type = (value as Record<string, unknown>).type;
	return typeof type === "string" && HOST_TO_WEBVIEW_TYPES.has(type);
}

export function isWebviewToHostMessage(
	value: unknown,
): value is WebviewToHostMessage {
	if (!value || typeof value !== "object") return false;
	const type = (value as Record<string, unknown>).type;
	return typeof type === "string" && WEBVIEW_TO_HOST_TYPES.has(type);
}
