import * as vscode from 'vscode';
import { CurveEditorProvider } from './CurveEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = CurveEditorProvider.register(context);
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.commands.registerCommand('curveEditor.newFile', async () => {
      const defaultContent = JSON.stringify(
        { version: 1, curves: [] },
        null,
        2
      );

      const doc = await vscode.workspace.openTextDocument({
        content: defaultContent,
        language: 'json',
      });

      const savedUri = await vscode.window.showSaveDialog({
        filters: { 'Curve JSON': ['curve.json'] },
        saveLabel: 'Create Curve File',
      });

      if (savedUri) {
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(savedUri, { contents: Buffer.from(defaultContent, 'utf8') });
        await vscode.workspace.applyEdit(edit);
        await vscode.commands.executeCommand('vscode.open', savedUri);
      }
    })
  );
}

export function deactivate() {}
