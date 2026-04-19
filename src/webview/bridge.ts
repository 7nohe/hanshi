import type {
	HostToWebviewMessage,
	WebviewToHostMessage,
} from "../shared/protocol";

declare function acquireVsCodeApi(): {
	postMessage(message: WebviewToHostMessage): void;
	setState<T>(state: T): void;
	getState<T>(): T | undefined;
};

export class WebviewBridge {
	private readonly vscodeApi = acquireVsCodeApi();

	public postMessage(message: WebviewToHostMessage): void {
		this.vscodeApi.postMessage(message);
	}

	public onMessage(handler: (message: HostToWebviewMessage) => void): void {
		window.addEventListener(
			"message",
			(event: MessageEvent<HostToWebviewMessage>) => {
				handler(event.data);
			},
		);
	}
}
