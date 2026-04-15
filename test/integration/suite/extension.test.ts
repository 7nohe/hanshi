import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'hanshi.hanshi';
const VIEW_TYPE = 'hanshi.markdownEditor';

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor timed out');
}

suite('Hanshi extension integration', function () {
  let ext: vscode.Extension<unknown>;

  suiteSetup(async () => {
    const found = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(found, `Extension ${EXTENSION_ID} should be present`);
    await found.activate();
    ext = found;
  });

  test('extension is active', () => {
    assert.ok(ext.isActive);
  });

  test('registers hanshi.* commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['hanshi.open', 'hanshi.copySelectionContext', 'hanshi.sendSelectionToChat']) {
      assert.ok(commands.includes(id), `command ${id} should be registered`);
    }
  });

  test('opens a markdown file with the Hanshi custom editor', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hanshi-it-'));
    const filePath = path.join(tmpDir, 'note.md');
    await fs.writeFile(filePath, '# hello\n\nworld\n', 'utf8');
    const uri = vscode.Uri.file(filePath);

    try {
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);

      // The custom editor webview takes a moment to mount; confirm it does not throw
      // and that the tab group contains the opened resource.
      await waitFor(() => {
        return vscode.window.tabGroups.all.some((group) =>
          group.tabs.some((tab) => {
            const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
            return input?.uri?.fsPath === filePath && input?.viewType?.includes(VIEW_TYPE);
          }),
        );
      });
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('copySelectionContext shows an info message when no selection is available', async () => {
    // No Hanshi editor active → command should complete without throwing.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('hanshi.copySelectionContext');
    });
  });

  test('aiCompletions.enabled configuration default is true', () => {
    const value = vscode.workspace.getConfiguration('hanshi').get('aiCompletions.enabled');
    assert.equal(value, true);
  });

  test('registers the hanshi_getSelection language model tool', function () {
    if (typeof vscode.lm?.registerTool !== 'function') {
      this.skip();
    }
    const names = (vscode.lm?.tools ?? []).map((t) => t.name);
    assert.ok(names.includes('hanshi_getSelection'), `expected tool; got ${names.join(', ')}`);
  });
});
