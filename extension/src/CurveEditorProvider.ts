import * as vscode from 'vscode';
import {
  CurveFile,
  HostToWebviewMessage,
  WebviewToHostMessage,
  EditorSettings,
  CurveDefinition,
  JsonPatchOp,
} from './protocol';

export class CurveEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = 'curveEditor.curveView';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new CurveEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      CurveEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const postMessage = (msg: HostToWebviewMessage) => {
      webviewPanel.webview.postMessage(msg);
    };

    const sendDocUpdate = () => {
      try {
        const parsed: CurveFile = JSON.parse(document.getText());
        postMessage({ type: 'doc:update', body: parsed });
      } catch {
        // Invalid JSON — don't crash the webview
      }
    };

    const sendSettings = () => {
      const config = vscode.workspace.getConfiguration('curveEditor');
      const settings: EditorSettings = {
        snapTimeInterval: config.get<number>('snapTimeInterval', 0.1),
        snapValueInterval: config.get<number>('snapValueInterval', 0.1),
        defaultInterpolation: config.get('defaultInterpolation', 'bezier') as EditorSettings['defaultInterpolation'],
        defaultTangentMode: config.get('defaultTangentMode', 'auto') as EditorSettings['defaultTangentMode'],
        showGridLabels: config.get<boolean>('showGridLabels', true),
        curveLineWidth: config.get<number>('curveLineWidth', 2),
        antiAlias: config.get<boolean>('antiAlias', true),
      };
      postMessage({ type: 'settings:update', body: settings });
    };

    const disposables: vscode.Disposable[] = [];

    disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          sendDocUpdate();
        }
      })
    );

    disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.toString() === document.uri.toString()) {
          postMessage({ type: 'doc:saved' });
        }
      })
    );

    disposables.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        postMessage({ type: 'theme:changed' });
      })
    );

    disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('curveEditor')) {
          sendSettings();
        }
      })
    );

    webviewPanel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => {
        switch (msg.type) {
          case 'ui:ready':
            sendDocUpdate();
            sendSettings();
            break;
          case 'edit:batch':
            this.applyEdits(document, msg.ops);
            break;
          case 'command:newCurve':
            this.addCurve(document, msg.curveType);
            break;
          case 'command:deleteCurve':
            this.deleteCurve(document, msg.name);
            break;
        }
      },
      undefined,
      disposables
    );

    webviewPanel.onDidDispose(() => {
      disposables.forEach((d) => d.dispose());
    });
  }

  private async applyEdits(
    document: vscode.TextDocument,
    ops: JsonPatchOp[]
  ): Promise<void> {
    try {
      let obj: CurveFile = JSON.parse(document.getText());
      for (const op of ops) {
        obj = this.applyPatchOp(obj, op);
      }
      const newText = JSON.stringify(obj, null, 2);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        newText
      );
      await vscode.workspace.applyEdit(edit);
    } catch (e) {
      console.error('Failed to apply edit batch:', e);
    }
  }

  private applyPatchOp(obj: any, op: JsonPatchOp): any {
    const segments = op.path.split('/').filter(Boolean);
    if (segments.length === 0) {
      if (op.op === 'replace') return op.value;
      return obj;
    }

    const clone = JSON.parse(JSON.stringify(obj));
    let target: any = clone;

    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i];
      const index = Number(key);
      target = Number.isNaN(index) ? target[key] : target[index];
    }

    const lastKey = segments[segments.length - 1];
    const lastIndex = Number(lastKey);
    const finalKey = Number.isNaN(lastIndex) ? lastKey : lastIndex;

    switch (op.op) {
      case 'replace':
        target[finalKey] = op.value;
        break;
      case 'add':
        if (Array.isArray(target)) {
          if (lastKey === '-') {
            target.push(op.value);
          } else {
            target.splice(finalKey as number, 0, op.value);
          }
        } else {
          target[finalKey] = op.value;
        }
        break;
      case 'remove':
        if (Array.isArray(target)) {
          target.splice(finalKey as number, 1);
        } else {
          delete target[finalKey];
        }
        break;
    }

    return clone;
  }

  private async addCurve(
    document: vscode.TextDocument,
    curveType: string
  ): Promise<void> {
    let obj: CurveFile;
    try {
      obj = JSON.parse(document.getText());
    } catch {
      return;
    }

    const existingNames = new Set(obj.curves.map((c) => c.name));
    let name = `curve${obj.curves.length + 1}`;
    let counter = obj.curves.length + 1;
    while (existingNames.has(name)) {
      counter++;
      name = `curve${counter}`;
    }

    const defaultValue = this.getDefaultValue(curveType);
    const newCurve: CurveDefinition = {
      name,
      type: curveType as CurveDefinition['type'],
      preInfinity: 'constant',
      postInfinity: 'constant',
      keys: [
        { time: 0, value: defaultValue, interp: curveType === 'int' ? 'constant' : 'bezier', tangentMode: 'auto' },
        { time: 1, value: defaultValue, interp: curveType === 'int' ? 'constant' : 'bezier', tangentMode: 'auto' },
      ],
    };

    obj.curves.push(newCurve);
    const newText = JSON.stringify(obj, null, 2);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newText
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async deleteCurve(
    document: vscode.TextDocument,
    name: string
  ): Promise<void> {
    let obj: CurveFile;
    try {
      obj = JSON.parse(document.getText());
    } catch {
      return;
    }

    obj.curves = obj.curves.filter((c) => c.name !== name);
    const newText = JSON.stringify(obj, null, 2);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newText
    );
    await vscode.workspace.applyEdit(edit);
  }

  private getDefaultValue(curveType: string): number | number[] {
    switch (curveType) {
      case 'float': return 0;
      case 'int': return 0;
      case 'vec2': return [0, 0];
      case 'vec3': return [0, 0, 0];
      case 'vec4': return [0, 0, 0, 0];
      case 'color': return [1, 1, 1, 1];
      default: return 0;
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    );

    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>Curve Editor</title>
</head>
<body>
  <div id="curve-editor-root" role="application" aria-label="Curve Editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
