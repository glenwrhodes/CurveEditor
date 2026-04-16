import { CurveFile, CurveDefinition, KeyFrame, EditorSettings, InterpolationMode, TangentMode } from '../../src/protocol';
import { Viewport, createViewport } from '../math/transforms';

export type EventCallback = () => void;

export interface SelectedKey {
  curveIndex: number;
  keyIndex: number;
  component?: number;
}

export interface DragState {
  type: 'none' | 'key' | 'tangentIn' | 'tangentOut' | 'marquee' | 'pan';
  startScreenX: number;
  startScreenY: number;
  currentScreenX: number;
  currentScreenY: number;
  constrainAxis?: 'horizontal' | 'vertical' | null;
  shiftHeld: boolean;
  /** For key/tangent drags: snapshot of original values before drag started */
  originalKeys?: KeyFrame[];
  /** Index of the tangent component being dragged (for vec/color) */
  tangentComponent?: number;
}

const CURVE_PALETTE = [
  '#e06c75', // red
  '#61afef', // blue
  '#98c379', // green
  '#e5c07b', // yellow
  '#c678dd', // purple
  '#56b6c2', // cyan
  '#d19a66', // orange
  '#be5046', // dark red
  '#7ec699', // mint
  '#f0c674', // gold
];

export class EditorState {
  doc: CurveFile = { version: 1, curves: [] };
  viewport: Viewport = createViewport();
  selectedCurves: Set<number> = new Set();
  selectedKeys: SelectedKey[] = [];
  drag: DragState = {
    type: 'none',
    startScreenX: 0,
    startScreenY: 0,
    currentScreenX: 0,
    currentScreenY: 0,
    shiftHeld: false,
  };
  snapEnabled = false;
  tangentDisplayEnabled = true;
  hoveredKey: SelectedKey | null = null;
  hoveredTangent: { curveIndex: number; keyIndex: number; which: 'in' | 'out'; component?: number } | null = null;
  canvasWidth = 0;
  canvasHeight = 0;

  /** Per-curve visibility (independent from selection) */
  curveVisibility: Map<number, boolean> = new Map();
  /** Per-curve lock state — locked curves can't be edited */
  curveLocked: Map<number, boolean> = new Map();
  /** Per-curve custom color override */
  curveColorOverride: Map<number, string> = new Map();
  /** Per-curve-component visibility: key = "curveIdx:compIdx", value = visible */
  componentVisibility: Map<string, boolean> = new Map();

  settings: EditorSettings = {
    snapTimeInterval: 0.1,
    snapValueInterval: 0.1,
    defaultInterpolation: 'bezier',
    defaultTangentMode: 'auto',
    showGridLabels: true,
    curveLineWidth: 2,
    antiAlias: true,
  };

  private dirty = true;
  private listeners: EventCallback[] = [];

  /** Preview overrides applied during drag (not yet committed to doc) */
  previewKeyOverrides: Map<string, KeyFrame> = new Map();

  onChange(cb: EventCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  markDirty(): void {
    this.dirty = true;
    for (const cb of this.listeners) cb();
  }

  consumeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  forceDirty(): void {
    this.dirty = true;
  }

  updateDoc(doc: CurveFile): void {
    this.doc = doc;
    // Auto-select and auto-show first curve if nothing selected
    if (this.selectedCurves.size === 0 && doc.curves.length > 0) {
      this.selectedCurves.add(0);
      this.curveVisibility.set(0, true);
    }
    // Ensure new curves are visible by default
    for (let i = 0; i < doc.curves.length; i++) {
      if (!this.curveVisibility.has(i)) {
        this.curveVisibility.set(i, true);
      }
    }
    // Prune invalid selections
    this.selectedKeys = this.selectedKeys.filter(
      (sk) =>
        sk.curveIndex < doc.curves.length &&
        sk.keyIndex < doc.curves[sk.curveIndex].keys.length
    );
    this.previewKeyOverrides.clear();
    this.markDirty();
  }

  updateSettings(s: EditorSettings): void {
    this.settings = s;
    this.markDirty();
  }

  getCurveColor(index: number): string {
    return this.curveColorOverride.get(index) || CURVE_PALETTE[index % CURVE_PALETTE.length];
  }

  isCurveVisible(index: number): boolean {
    const vis = this.curveVisibility.get(index);
    return vis !== undefined ? vis : this.selectedCurves.has(index);
  }

  isCurveLocked(index: number): boolean {
    return this.curveLocked.get(index) || false;
  }

  isComponentVisible(curveIndex: number, componentIndex: number): boolean {
    const key = `${curveIndex}:${componentIndex}`;
    const vis = this.componentVisibility.get(key);
    return vis !== undefined ? vis : true;
  }

  setComponentVisibility(curveIndex: number, componentIndex: number, visible: boolean): void {
    this.componentVisibility.set(`${curveIndex}:${componentIndex}`, visible);
    this.markDirty();
  }

  getVisibleCurves(): { curve: CurveDefinition; index: number }[] {
    return this.doc.curves
      .map((curve, index) => ({ curve, index }))
      .filter(({ index }) => this.isCurveVisible(index));
  }

  isKeySelected(curveIndex: number, keyIndex: number): boolean {
    return this.selectedKeys.some(
      (sk) => sk.curveIndex === curveIndex && sk.keyIndex === keyIndex
    );
  }

  selectKey(curveIndex: number, keyIndex: number, addToSelection: boolean): void {
    if (!addToSelection) {
      this.selectedKeys = [];
    }
    const existing = this.selectedKeys.findIndex(
      (sk) => sk.curveIndex === curveIndex && sk.keyIndex === keyIndex
    );
    if (existing >= 0) {
      if (addToSelection) {
        this.selectedKeys.splice(existing, 1);
      }
    } else {
      this.selectedKeys.push({ curveIndex, keyIndex });
    }
    this.markDirty();
  }

  selectAllKeysOnVisibleCurves(): void {
    this.selectedKeys = [];
    for (const { curve, index } of this.getVisibleCurves()) {
      for (let ki = 0; ki < curve.keys.length; ki++) {
        this.selectedKeys.push({ curveIndex: index, keyIndex: ki });
      }
    }
    this.markDirty();
  }

  deselectAll(): void {
    this.selectedKeys = [];
    this.markDirty();
  }

  getKey(curveIndex: number, keyIndex: number): KeyFrame {
    const overrideKey = `${curveIndex}:${keyIndex}`;
    const override = this.previewKeyOverrides.get(overrideKey);
    if (override) return override;
    return this.doc.curves[curveIndex].keys[keyIndex];
  }

  getSelectedCurveIndex(): number | null {
    if (this.selectedCurves.size === 1) {
      return this.selectedCurves.values().next().value!;
    }
    if (this.selectedKeys.length > 0) {
      return this.selectedKeys[0].curveIndex;
    }
    return this.selectedCurves.size > 0 ? this.selectedCurves.values().next().value! : null;
  }

  snapValue(val: number, interval: number): number {
    if (!this.snapEnabled || interval <= 0) return val;
    return Math.round(val / interval) * interval;
  }

  snapTime(time: number): number {
    return this.snapValue(time, this.settings.snapTimeInterval);
  }

  snapVal(value: number): number {
    return this.snapValue(value, this.settings.snapValueInterval);
  }
}
