import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // __dirname at runtime: <repo>/out/test/integration
    const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const workspacePath = path.resolve(extensionDevelopmentPath, 'test/fixtures');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath, '--disable-extensions'],
      timeout: 60_000,
    });
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

void main();
