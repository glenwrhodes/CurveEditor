// ── Data Model Types ──

export interface TangentHandle {
  dx: number;
  dy: number;
}

export type InterpolationMode = 'bezier' | 'linear' | 'constant';
export type TangentMode = 'auto' | 'user' | 'break' | 'aligned';
export type InfinityMode = 'constant' | 'linear' | 'cycle' | 'oscillate';
export type CurveType = 'float' | 'int' | 'vec2' | 'vec3' | 'vec4' | 'color';

export interface KeyFrame {
  time: number;
  value: number | number[];
  interp: InterpolationMode;
  tangentMode?: TangentMode;
  tangentIn?: TangentHandle | TangentHandle[];
  tangentOut?: TangentHandle | TangentHandle[];
  /** Optional per-component interpolation override (vec/color curves only).
   *  If set for component c, overrides the default `interp` for that component. */
  componentInterp?: InterpolationMode[];
  /** Optional per-component tangent mode override (vec/color curves only). */
  componentTangentMode?: TangentMode[];
}

export interface StatesDefinition {
  count: number;
  labels?: string[];
}

export interface CurveRange {
  min: number;
  max: number;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface CurveDefinition {
  name: string;
  type: CurveType;
  range?: CurveRange;
  timeRange?: TimeRange;
  states?: StatesDefinition;
  preInfinity?: InfinityMode;
  postInfinity?: InfinityMode;
  keys: KeyFrame[];
}

export interface CurveFile {
  version: number;
  curves: CurveDefinition[];
}

// ── Host → Webview Messages ──

export interface DocUpdateMessage {
  type: 'doc:update';
  body: CurveFile;
}

export interface DocSavedMessage {
  type: 'doc:saved';
}

export interface ThemeChangedMessage {
  type: 'theme:changed';
}

export interface SettingsUpdateMessage {
  type: 'settings:update';
  body: EditorSettings;
}

export type HostToWebviewMessage =
  | DocUpdateMessage
  | DocSavedMessage
  | ThemeChangedMessage
  | SettingsUpdateMessage;

// ── Webview → Host Messages ──

export interface JsonPatchOp {
  op: 'replace' | 'add' | 'remove';
  path: string;
  value?: unknown;
}

export interface EditBatchMessage {
  type: 'edit:batch';
  ops: JsonPatchOp[];
}

export interface CommandNewCurveMessage {
  type: 'command:newCurve';
  curveType: CurveType;
}

export interface CommandDeleteCurveMessage {
  type: 'command:deleteCurve';
  name: string;
}

export interface UiReadyMessage {
  type: 'ui:ready';
}

export interface CommandViewJsonMessage {
  type: 'command:viewJson';
}

export type WebviewToHostMessage =
  | EditBatchMessage
  | CommandNewCurveMessage
  | CommandDeleteCurveMessage
  | CommandViewJsonMessage
  | UiReadyMessage;

// ── Settings ──

export interface EditorSettings {
  snapTimeInterval: number;
  snapValueInterval: number;
  defaultInterpolation: InterpolationMode;
  defaultTangentMode: TangentMode;
  showGridLabels: boolean;
  curveLineWidth: number;
  antiAlias: boolean;
}
