import './styles/editor.css';
import { EditorState } from './state/EditorState';
import { CurveCanvas } from './canvas/CurveCanvas';
import { InteractionHandler } from './canvas/InteractionHandler';
import { Toolbar } from './panels/Toolbar';
import { KeyInspector } from './panels/KeyInspector';
import { CurveList } from './panels/CurveList';
import { HostToWebviewMessage, WebviewToHostMessage, JsonPatchOp } from '../src/protocol';

declare function acquireVsCodeApi(): {
  postMessage(msg: any): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

function postMessage(msg: WebviewToHostMessage): void {
  vscode.postMessage(msg);
}

function postEdit(ops: JsonPatchOp[]): void {
  postMessage({ type: 'edit:batch', ops });
}

function postCommand(msg: any): void {
  postMessage(msg);
}

// ── Build UI ──

const root = document.getElementById('curve-editor-root')!;
const state = new EditorState();

// Toolbar
let interactionHandler: InteractionHandler;

const toolbar = new Toolbar(
  root,
  state,
  postCommand,
  postEdit,
  () => interactionHandler?.frameAll(),
  () => interactionHandler?.frameSelection()
);

// Content area (sidebar + canvas)
const contentArea = document.createElement('div');
contentArea.className = 'editor-content';
root.appendChild(contentArea);

// Curve list (left sidebar)
const curveList = new CurveList(contentArea, state, postCommand, postEdit);

// Canvas container
const canvasContainer = document.createElement('div');
canvasContainer.className = 'canvas-container';
contentArea.appendChild(canvasContainer);

const curveCanvas = new CurveCanvas(canvasContainer, state);
interactionHandler = new InteractionHandler(curveCanvas, state, postEdit);

// Key Inspector (bottom)
const keyInspector = new KeyInspector(root, state, postEdit);

// ── Message Handling ──

window.addEventListener('message', (event) => {
  const msg = event.data as HostToWebviewMessage;

  switch (msg.type) {
    case 'doc:update':
      state.updateDoc(msg.body);
      break;
    case 'doc:saved':
      // Could show a save indicator
      break;
    case 'theme:changed':
      state.markDirty();
      break;
    case 'settings:update':
      state.updateSettings(msg.body);
      break;
  }
});

// Signal ready
postMessage({ type: 'ui:ready' });
