import * as path from "node:path";
import { runTests, type TestOptions } from "@vscode/test-electron";

async function main(): Promise<void> {
	const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
	const extensionTestsPath = path.resolve(__dirname, "./suite/index");
	const workspacePath = path.resolve(extensionDevelopmentPath, "test/fixtures");
	const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;

	const options: TestOptions = {
		extensionDevelopmentPath,
		extensionTestsPath,
		launchArgs: [workspacePath, "--disable-extensions", "--no-sandbox"],
		timeout: 120_000,
	};

	if (vscodeExecutablePath) {
		options.vscodeExecutablePath = vscodeExecutablePath;
	} else {
		// Keep a fixed fallback for local runs that still rely on @vscode/test-electron downloads.
		options.version = process.env.VSCODE_TEST_VERSION || "1.116.0";
	}

	const maxRetries = 3;
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			await runTests(options);
			return;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const isDownloadError =
				message.includes("Failed to get JSON") ||
				message.includes("Failed to parse response") ||
				message.includes("timeout");
			if (isDownloadError && attempt < maxRetries) {
				console.warn(`Attempt ${attempt} failed (${message}), retrying...`);
				continue;
			}
			console.error("Failed to run integration tests:", err);
			process.exit(1);
		}
	}
}

void main();
