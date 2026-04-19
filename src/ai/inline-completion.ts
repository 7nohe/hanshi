import * as vscode from "vscode";
import type {
	CompletionResultMessage,
	HostToWebviewMessage,
	RequestCompletionMessage,
} from "../shared/protocol";
import {
	buildCompletionPrompt,
	sanitizeCompletion,
} from "./completion-helpers";

interface InlineCompletionServiceOptions {
	postMessage: (message: HostToWebviewMessage) => Promise<void>;
	showNotice: (message: string) => void;
	getEnabled: () => boolean;
	languageModelAccessInformation: vscode.LanguageModelAccessInformation;
	selectChatModels?: (
		selector?: vscode.LanguageModelChatSelector,
	) => Thenable<vscode.LanguageModelChat[]>;
}

const COMPLETION_JUSTIFICATION =
	"Generate short inline continuation suggestions in the Hanshi Markdown editor.";
const COMPLETION_UNAVAILABLE_NOTICE =
	"AI completions are unavailable. GitHub Copilot access or consent is required.";
const PREFERRED_MODEL_FAMILIES = ["gpt-4.1", "gpt-4o", "gpt-5-mini"] as const;

export class InlineCompletionService {
	private latestRequestId: string | undefined;
	private latestVersion = 0;
	private lastNotice: string | undefined;
	private requestSource: vscode.CancellationTokenSource | undefined;
	private selectedModelPromise:
		| Promise<vscode.LanguageModelChat | undefined>
		| undefined;
	private readonly subscriptions: vscode.Disposable[] = [];

	public constructor(private readonly options: InlineCompletionServiceOptions) {
		const invalidate = () => {
			this.selectedModelPromise = undefined;
			this.lastNotice = undefined;
		};

		this.subscriptions.push(
			this.options.languageModelAccessInformation.onDidChange(invalidate),
			vscode.lm.onDidChangeChatModels(invalidate),
		);
	}

	public async handleRequest(message: RequestCompletionMessage): Promise<void> {
		this.latestRequestId = message.requestId;
		this.latestVersion = message.version;
		this.cancelOngoingRequest();

		if (!this.options.getEnabled()) {
			await this.postCleared(message.requestId, message.version);
			return;
		}

		let tokenSource: vscode.CancellationTokenSource | undefined;

		try {
			const model = await this.selectModel();
			if (!model) {
				await this.postCleared(message.requestId, message.version);
				return;
			}

			tokenSource = new vscode.CancellationTokenSource();
			this.requestSource = tokenSource;
			const response = await model.sendRequest(
				[
					vscode.LanguageModelChatMessage.User(
						buildCompletionPrompt(message.markdown, message.context),
					),
				],
				{
					justification: COMPLETION_JUSTIFICATION,
				},
				tokenSource.token,
			);

			const rawText = await collectText(response.text, tokenSource.token);

			if (
				!this.isLatest(message.requestId, message.version) ||
				tokenSource.token.isCancellationRequested
			) {
				return;
			}

			const insertText = sanitizeCompletion(rawText, message.context);

			if (!insertText) {
				await this.postCleared(message.requestId, message.version);
				return;
			}

			this.lastNotice = undefined;
			await this.options.postMessage(
				createCompletionResult(message, insertText),
			);
		} catch (error) {
			if (tokenSource?.token.isCancellationRequested) {
				return;
			}

			if (shouldInvalidateModelCache(error)) {
				this.selectedModelPromise = undefined;
			}

			const notice = toCompletionNotice(error);
			this.pushNotice(notice);
			await this.postCleared(message.requestId, message.version);
		} finally {
			if (tokenSource && this.requestSource === tokenSource) {
				tokenSource.dispose();
				this.requestSource = undefined;
			} else {
				tokenSource?.dispose();
			}
		}
	}

	public async cancel(
		requestId: string | undefined,
		version: number,
	): Promise<void> {
		if (
			requestId &&
			this.latestRequestId &&
			requestId !== this.latestRequestId
		) {
			return;
		}

		this.cancelOngoingRequest();
		await this.postCleared(requestId, version);
	}

	public dispose(): void {
		this.cancelOngoingRequest();
		this.selectedModelPromise = undefined;
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.subscriptions.length = 0;
	}

	private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
		if (!this.selectedModelPromise) {
			this.selectedModelPromise = this.resolveModel();
		}

		const model = await this.selectedModelPromise;

		if (!model) {
			this.selectedModelPromise = undefined;
			return undefined;
		}

		// Re-check access on every request: the user may have revoked consent
		// after the model was first resolved.
		if (
			this.options.languageModelAccessInformation.canSendRequest(model) ===
			false
		) {
			this.selectedModelPromise = undefined;
			this.pushNotice(COMPLETION_UNAVAILABLE_NOTICE);
			return undefined;
		}

		return model;
	}

	private async resolveModel(): Promise<vscode.LanguageModelChat | undefined> {
		const selectChatModels =
			this.options.selectChatModels ?? vscode.lm.selectChatModels;
		let model: vscode.LanguageModelChat | undefined;

		for (const family of PREFERRED_MODEL_FAMILIES) {
			const [candidate] = await selectChatModels({ vendor: "copilot", family });

			if (candidate) {
				model = candidate;
				break;
			}
		}

		if (!model) {
			const [fallback] = await selectChatModels({ vendor: "copilot" });
			model = fallback;
		}

		if (!model) {
			this.pushNotice(COMPLETION_UNAVAILABLE_NOTICE);
			return undefined;
		}

		const canSend =
			this.options.languageModelAccessInformation.canSendRequest(model);

		if (canSend === false) {
			this.pushNotice(COMPLETION_UNAVAILABLE_NOTICE);
			return undefined;
		}

		return model;
	}

	private isLatest(requestId: string, version: number): boolean {
		return this.latestRequestId === requestId && this.latestVersion === version;
	}

	private cancelOngoingRequest(): void {
		this.requestSource?.cancel();
		this.requestSource?.dispose();
		this.requestSource = undefined;
	}

	private async postCleared(
		requestId: string | undefined,
		version: number,
	): Promise<void> {
		await this.options.postMessage({
			type: "completionCleared",
			requestId,
			version,
		});
	}

	private pushNotice(message: string): void {
		if (this.lastNotice === message) {
			return;
		}

		this.lastNotice = message;
		this.options.showNotice(message);
	}
}

function createCompletionResult(
	message: RequestCompletionMessage,
	insertText: string,
): CompletionResultMessage {
	return {
		type: "completionResult",
		requestId: message.requestId,
		version: message.version,
		insertText,
		displayText: insertText,
	};
}

async function collectText(
	chunks: AsyncIterable<string>,
	token: vscode.CancellationToken,
): Promise<string> {
	let text = "";

	for await (const chunk of chunks) {
		if (token.isCancellationRequested) {
			break;
		}

		text += chunk;
	}

	return text;
}

function shouldInvalidateModelCache(error: unknown): boolean {
	if (!(error instanceof vscode.LanguageModelError)) {
		return false;
	}

	return (
		error.code === vscode.LanguageModelError.NoPermissions().code ||
		error.code === vscode.LanguageModelError.NotFound().code
	);
}

function toCompletionNotice(error: unknown): string {
	if (error instanceof vscode.LanguageModelError) {
		if (error.code === vscode.LanguageModelError.NoPermissions().code) {
			return COMPLETION_UNAVAILABLE_NOTICE;
		}

		if (error.code === vscode.LanguageModelError.Blocked().code) {
			return "AI completions are temporarily blocked because Copilot quota or policy limits were hit.";
		}

		if (error.code === vscode.LanguageModelError.NotFound().code) {
			return COMPLETION_UNAVAILABLE_NOTICE;
		}
	}

	return "AI completions failed for this request.";
}
